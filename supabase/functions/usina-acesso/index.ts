// Acesso a' pagina publica da usina (www.b2wenergia.com.br/usina).
//
// A pagina e' estatica e vive em outro dominio, entao ela nao pode carregar a
// service_role key nem escrever direto em `leads`. Toda a escrita passa por
// aqui. `verify_jwt` fica desligado de proposito: quem chama e' um visitante
// anonimo que ainda nao tem conta. A protecao nao e' JWT, sao as guardas
// abaixo — limite de envio por telefone, teto de tentativas por codigo e
// expiracao curta. Ver o achado (b) da spec do fechamento: funcao publica sem
// nenhuma guarda ja' foi problema neste projeto.
//
// O objetivo declarado pelo dono e' CAPTURAR O LEAD, nao proteger numeros: o
// dado da usina viaja dentro do proprio link. Este portao existe para saber
// quem olhou, nao para esconder o que foi olhado.

import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Mesma normalizacao de send-whatsapp: so' digitos, com DDI 55 no Brasil. */
function normalizePhone(raw: string): string {
  let p = String(raw || '').replace(/\D/g, '')
  if ((p.length === 10 || p.length === 11) && !p.startsWith('55')) p = '55' + p
  return p
}

const enc = new TextEncoder()

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return b64url(String.fromCharCode(...new Uint8Array(sig)))
}

/** Codigo de 6 digitos com fonte criptografica, nao Math.random. */
function gerarCodigo(): string {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(a[0] % 1000000).padStart(6, '0')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { acao, nome, email, telefone, codigo } = await req.json()
    const phone = normalizePhone(telefone)

    if (!phone || phone.length < 12) {
      return json({ erro: 'Telefone inválido. Informe DDD e número.' }, 400)
    }

    // Regras e segredo vivem no banco, nao no codigo.
    const { data: cfg, error: cfgErr } = await admin
      .from('integrations_config').select('api_key, variables')
      .eq('service_name', 'usina_acesso').single()
    if (cfgErr || !cfg?.api_key) return json({ erro: 'Configuração de acesso ausente.' }, 500)

    const v = cfg.variables || {}
    const TTL_MIN   = Number(v.codigo_ttl_min)   || 10
    const MAX_TENT  = Number(v.max_tentativas)   || 5
    const MAX_ENVIO = Number(v.max_envios_hora)  || 5

    // ---------------------------------------------------------------- emitir
    async function emitirCodigo(): Promise<Response> {
      // Teto de envios por telefone na ultima hora: sem isto a funcao vira
      // um disparador de WhatsApp de graca para qualquer um.
      const desde = new Date(Date.now() - 3600_000).toISOString()
      const { count } = await admin
        .from('lead_access_codes')
        .select('id', { count: 'exact', head: true })
        .eq('phone', phone).gte('created_at', desde)

      if ((count ?? 0) >= MAX_ENVIO) {
        return json({ erro: 'Muitas tentativas. Aguarde uma hora para pedir um novo código.' }, 429)
      }

      const code = gerarCodigo()
      const { error: insErr } = await admin.from('lead_access_codes').insert({
        phone,
        code_hash: await sha256Hex(code + phone),
        expires_at: new Date(Date.now() + TTL_MIN * 60_000).toISOString(),
      })
      if (insErr) return json({ erro: 'Não foi possível gerar o código.' }, 500)

      // Envio pela Evolution, mesmo caminho de send-whatsapp.
      const { data: evo } = await admin
        .from('integrations_config').select('endpoint_url, api_key, variables')
        .eq('service_name', 'evolution_api').single()

      if (!evo?.endpoint_url || !evo?.api_key) {
        return json({ erro: 'Envio de WhatsApp não configurado.' }, 500)
      }

      const instancia = (evo.variables || {})['instance_name'] || 'default'
      const baseUrl = String(evo.endpoint_url).replace(/\/+$/, '')
      const texto =
        `Seu código de acesso à página da usina é *${code}*.\n\n` +
        `Ele vale por ${TTL_MIN} minutos. Se você não pediu este código, ignore esta mensagem.`

      const r = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instancia)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evo.api_key },
        body: JSON.stringify({ number: phone, text: texto, delay: 800, linkPreview: false }),
      })

      if (!r.ok) {
        console.error('Evolution respondeu', r.status, await r.text())
        return json({ erro: 'Não conseguimos enviar o código pelo WhatsApp.' }, 502)
      }
      return json({ ok: true, expiraEm: TTL_MIN })
    }

    // --------------------------------------------------------------- acoes
    if (acao === 'cadastrar') {
      if (!nome || !email) return json({ erro: 'Informe nome e e-mail.' }, 400)

      const { data: existente } = await admin
        .from('leads').select('id, tags').eq('phone', phone).maybeSingle()

      if (existente) {
        // Ja' era lead: nao sobrescreve o cadastro, so' garante a etiqueta.
        const tags: string[] = existente.tags || []
        if (!tags.includes('#Investidor')) {
          await admin.from('leads').update({ tags: [...tags, '#Investidor'] }).eq('id', existente.id)
        }
      } else {
        // `status` tem default 'simulacao' no banco; explicito aqui para o
        // leitor nao precisar consultar o schema para saber onde o lead entra.
        const { error } = await admin.from('leads').insert({
          name: String(nome).trim(),
          email: String(email).trim().toLowerCase(),
          phone,
          status: 'simulacao',
          tags: ['#Investidor'],
        })
        if (error) {
          console.error('Falha ao criar lead:', error.message)
          return json({ erro: 'Não foi possível concluir o cadastro.' }, 500)
        }
      }
      return await emitirCodigo()
    }

    if (acao === 'entrar') {
      const { data: lead } = await admin
        .from('leads').select('id').eq('phone', phone).maybeSingle()
      // O dono pediu explicitamente que o login diga se o numero consta.
      if (!lead) return json({ encontrado: false })
      return await emitirCodigo()
    }

    if (acao === 'verificar') {
      const informado = String(codigo || '').replace(/\D/g, '')
      if (informado.length !== 6) return json({ erro: 'Código inválido.' }, 400)

      const { data: reg } = await admin
        .from('lead_access_codes').select('*')
        .eq('phone', phone).is('consumed_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()

      if (!reg) return json({ erro: 'Peça um novo código.' }, 400)
      if (new Date(reg.expires_at) < new Date()) return json({ erro: 'Código expirado. Peça outro.' }, 400)
      if (reg.attempts >= MAX_TENT) return json({ erro: 'Tentativas esgotadas. Peça um novo código.' }, 429)

      if (await sha256Hex(informado + phone) !== reg.code_hash) {
        await admin.from('lead_access_codes').update({ attempts: reg.attempts + 1 }).eq('id', reg.id)
        const restam = MAX_TENT - (reg.attempts + 1)
        return json({ erro: restam > 0 ? `Código incorreto. Restam ${restam} tentativas.` : 'Tentativas esgotadas.' }, 400)
      }

      // Codigo e' de uso unico.
      await admin.from('lead_access_codes').update({ consumed_at: new Date().toISOString() }).eq('id', reg.id)

      const payload = b64url(JSON.stringify({ p: phone, exp: Date.now() + 30 * 24 * 3600_000 }))
      const token = payload + '.' + await hmac(payload, cfg.api_key)

      const { data: lead } = await admin
        .from('leads').select('name').eq('phone', phone).maybeSingle()

      return json({ ok: true, token, nome: lead?.name || null })
    }

    return json({ erro: 'Ação desconhecida.' }, 400)

  } catch (e) {
    console.error('usina-acesso:', (e as Error).message)
    return json({ erro: 'Erro inesperado.' }, 500)
  }
})
