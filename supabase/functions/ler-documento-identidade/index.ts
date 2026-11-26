import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'
import { lerDocumento, lerDocumentoEmpresa, TIPOS_ARQUIVO_DOCUMENTO } from '../_shared/leitura-documento.ts'

/**
 * Leitura de documento no cadastro do assinante (CRM e adesão pelo app).
 *
 * POST { imageBase64, mediaType, tipo? }
 *   mediaType: image/jpeg | image/png | image/webp | application/pdf
 *   tipo 'identidade' (padrão): CNH ou RG
 *     200 { ok: true, dados: { tipoDocumento, nome, cpf, cpfLido, nascimento, observacoes }, modelo }
 *   tipo 'empresa': Cartão CNPJ ou Contrato Social
 *     200 { ok: true, dados: { tipoDocumento, cnpj, cnpjLido, razaoSocial, observacoes }, modelo }
 *   400 entrada | 401 sem sessão | 422 ilegível | 500 configuração | 502 falha na leitura
 *
 * Exige login (como parse-invoice-image): a equipe no CRM e, desde 26/11/2026,
 * quem faz a adesão pelo app (o próprio assinante ou o Parceiro Power pelo
 * cliente). Nada é gravado aqui; o arquivo e o cadastro são de quem chama.
 *
 * Segredos (os mesmos de parse-invoice-image): OPENROUTER_API_KEY, OPENROUTER_MODEL.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status
})

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const auth = await requireUser(req, supabase)
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

    let imageBase64: string, mediaType: string, tipo: string
    try {
        const body = await req.json()
        imageBase64 = String(body.imageBase64 || '')
        mediaType = String(body.mediaType || 'image/jpeg')
        tipo = String(body.tipo || 'identidade')
    } catch {
        return json({ ok: false, error: 'Corpo JSON inválido.' }, 400)
    }

    if (imageBase64.includes(',')) imageBase64 = imageBase64.split(',')[1]
    if (!imageBase64) return json({ ok: false, error: 'imageBase64 é obrigatório.' }, 400)
    if (tipo !== 'identidade' && tipo !== 'empresa') return json({ ok: false, error: `Tipo de documento inválido: ${tipo}.` }, 400)
    if (!TIPOS_ARQUIVO_DOCUMENTO.includes(mediaType)) return json({ ok: false, error: `Tipo de arquivo não suportado: ${mediaType}.` }, 400)
    if (imageBase64.length > 7_000_000) return json({ ok: false, error: 'Arquivo grande demais. Envie uma foto menor.' }, 400)

    const apiKey = Deno.env.get('OPENROUTER_API_KEY')
    const modelo = Deno.env.get('OPENROUTER_MODEL')
    if (!apiKey || !modelo) {
        console.error('ler-documento-identidade: OPENROUTER_API_KEY ou OPENROUTER_MODEL ausente')
        return json({ ok: false, error: 'Leitura de documento não configurada.' }, 500)
    }

    const r = tipo === 'empresa'
        ? await lerDocumentoEmpresa(imageBase64, mediaType, { apiKey, modelo })
        : await lerDocumento(imageBase64, mediaType, { apiKey, modelo })
    if (!r.ok) return json({ ok: false, error: r.erro }, r.status)
    return json({ ok: true, dados: r.dados, modelo: r.modelo })
})
