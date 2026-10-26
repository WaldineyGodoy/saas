import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'
import { lerConta, TIPOS_IMAGEM, TIPO_PDF } from '../_shared/leitura-conta.ts'

/**
 * Leitura de conta de luz: FOTO (conta física fotografada) ou PDF.
 *
 * POST { imageBase64, mediaType?, visita? }   (sessão de usuário, ou visita da adesão pelo site)
 *   mediaType: image/jpeg | image/png | image/webp | application/pdf
 *   200 { ok: true, dados, modelo }   mesmo formato de completarLeitura (src/lib/energyBillParser.js)
 *   400 entrada | 401/403 portão | 422 conta ilegível | 500 configuração | 502 falha na leitura
 *
 * No CRM web o PDF é lido no navegador (pdfjs), exato e sem custo. O app
 * mobile não roda pdfjs, então manda o PDF para cá: o OpenRouter extrai o
 * texto com o conversor gratuito (file-parser cloudflare-ai) e o modelo
 * transcreve. Foto não tem camada de texto, e as fotos reais vêm tortas,
 * dobradas e com pouca luz; por isso a leitura é feita por um modelo com
 * visão. Nos dois casos a saída é presa a um JSON Schema.
 *
 * Segredos:
 *   OPENROUTER_API_KEY  chave do OpenRouter
 *   OPENROUTER_MODEL    modelo com visão (ex.: "anthropic/claude-sonnet-5.5")
 *                       ou um preset ("@preset/leitura-conta"), que deixa
 *                       trocar o modelo no painel do OpenRouter sem redeploy.
 */


const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status
})


Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    let imageBase64: string, mediaType: string, visita: string
    try {
        const body = await req.json()
        imageBase64 = String(body.imageBase64 || '')
        mediaType = String(body.mediaType || 'image/jpeg')
        visita = String(body.visita || '')
    } catch {
        return json({ ok: false, error: 'Corpo JSON inválido.' }, 400)
    }

    if (imageBase64.includes(',')) imageBase64 = imageBase64.split(',')[1]
    if (!imageBase64) return json({ ok: false, error: 'imageBase64 é obrigatório.' }, 400)
    const ehPdf = mediaType === TIPO_PDF
    if (!ehPdf && !TIPOS_IMAGEM.includes(mediaType)) return json({ ok: false, error: `Tipo de arquivo não suportado: ${mediaType}.` }, 400)
    // ~5 MB; o front já reduz a foto antes de enviar, e a conta em PDF tem ~70 KB
    if (imageBase64.length > 7_000_000) return json({ ok: false, error: 'Arquivo grande demais. Envie uma foto menor.' }, 400)

    // Usuário logado (CRM, app) lê à vontade. Sem login, só a adesão pelo
    // site (/contrato): vale o id da visita da simulação, com teto de
    // leituras por visita (fn_consumir_leitura_conta), porque a leitura é
    // paga (decisão do dono, 15/10/2026).
    const auth = await requireUser(req, supabase)
    if (!auth.ok) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(visita)) {
            return json({ ok: false, error: auth.error }, auth.status)
        }
        const { data: liberado, error } = await supabase.rpc('fn_consumir_leitura_conta', { p_chave: visita })
        if (error) {
            console.error('parse-invoice-image: fn_consumir_leitura_conta', error.message)
            return json({ ok: false, error: 'Falha ao ler a conta. Tente de novo.' }, 500)
        }
        if (!liberado) {
            return json({ ok: false, error: 'Limite de leituras atingido. Envie o PDF da conta ou preencha os dados à mão.' }, 429)
        }
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY')
    const modelo = Deno.env.get('OPENROUTER_MODEL')
    if (!apiKey || !modelo) {
        console.error('parse-invoice-image: OPENROUTER_API_KEY ou OPENROUTER_MODEL ausente')
        return json({ ok: false, error: 'Leitura de conta não configurada.' }, 500)
    }

    const r = await lerConta(imageBase64, mediaType, { apiKey, modelo })
    if (!r.ok) return json({ ok: false, error: r.erro }, r.status)
    return json({ ok: true, dados: r.dados, modelo: r.modelo })
})
