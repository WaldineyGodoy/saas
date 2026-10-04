import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'

/**
 * Leitura de conta de luz: FOTO (conta física fotografada) ou PDF.
 *
 * POST { imageBase64, mediaType? }   (exige sessão de usuário)
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

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp']
const TIPO_PDF = 'application/pdf'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status
})

const texto = { type: 'string' }
const numero = { type: 'number' }
const objeto = (properties: Record<string, unknown>) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
})

const ESQUEMA = objeto({
    legivel: { type: 'boolean' },
    observacoes: texto,
    numeroUcNovo: texto,
    codigoCliente: texto,
    codigoInstalacao: texto,
    titular: texto,
    documentoTipo: { type: 'string', enum: ['CPF', 'CNPJ', ''] },
    documento: texto,
    endereco: objeto({ logradouro: texto, complemento: texto, bairro: texto, cep: texto, cidade: texto, uf: texto }),
    classificacao: texto,
    tipoFornecimento: texto,
    mesReferencia: texto,
    vencimento: texto,
    dataLeitura: texto,
    valorTotal: numero,
    consumoKwh: numero,
    consumoCompensado: numero,
    cipValor: numero,
    historico: { type: 'array', items: objeto({ mes: texto, kwh: numero, dias: numero }) },
})

const INSTRUCOES = `Você lê contas de energia (foto ou PDF) da Neoenergia Cosern (Rio Grande do Norte) e transcreve os campos para o JSON pedido.

Regras:
- Transcreva só o que está impresso. Campo que não aparece ou que você não consegue ler com segurança fica como "" (texto) ou 0 (número). Não deduza dígitos borrados, cortados ou cobertos: um número de UC errado associa a conta ao cliente errado.
- Existem dois layouts. No antigo há "CÓDIGO DA INSTALAÇÃO" (codigoInstalacao) e "CÓDIGO DO CLIENTE" (codigoCliente). No novo há "NÚMERO DA UNIDADE CONSUMIDORA" no formato 1.234.567.890-12 (numeroUcNovo, mantenha pontos e traço) e "CÓDIGO DÉBITO EM CONTA" (codigoCliente). Copie os códigos com os zeros à esquerda como aparecem.
- documento: copie exatamente, inclusive os asteriscos da máscara (ex.: "701.1**.***-**").
- endereco: a linha do bairro vem como "CENTRO/AREA URBANA"; bairro é a parte antes da barra. A última linha é "CEP CIDADE UF".
- classificacao: ex. "B3 COMERCIAL". tipoFornecimento: ex. "Conv. Monômia - Trifásico".
- mesReferencia no formato MM/AAAA. vencimento e dataLeitura (leitura atual) no formato AAAA-MM-DD.
- Valores em reais e kWh como número (2.541,09 vira 2541.09). consumoKwh é a quantidade da linha Consumo-TE. consumoCompensado é a soma das linhas de compensação (G1Comp/G2Comp ... -TE); 0 se não houver. cipValor é "Ilum. Púb. Municipal".
- historico: cada linha do quadro "CONSUMO FATURADO" com mes no formato AAAA-MM, kwh e dias. Inclua meses com 0 se o 0 estiver impresso; omita meses em branco.
- legivel: false se o arquivo não for uma conta de energia ou estiver ilegível demais para identificar a UC. Use observacoes para avisar, em uma frase, sobre partes que não deu para ler.`

// Campos derivados, iguais a completarLeitura (src/lib/energyBillParser.js),
// para o app mobile receber a leitura pronta. O CRM web reaplica a função dele
// sobre este resultado; como os derivados saem dos mesmos campos, dá o mesmo.
const ligacaoDoFornecimento = (tipo: string) =>
    /mono/i.test(tipo) ? 'monofasico' : /bif/i.test(tipo) ? 'bifasico' : /trif/i.test(tipo) ? 'trifasico' : ''

// deno-lint-ignore no-explicit-any
const completarLeitura = (lido: any) => {
    const historico: { kwh: number }[] = lido.historico || []
    const comConsumo = historico.filter((h) => h.kwh > 0)
    const end = lido.endereco
    return {
        ...lido,
        concessionaria: 'Neoenergia Cosern',
        numeroUc: lido.numeroUcNovo || lido.codigoCliente || lido.codigoInstalacao || '',
        endereco: end ? {
            ...end,
            completo: [end.logradouro, end.complemento, end.bairro, [end.cep, end.cidade, end.uf].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        } : null,
        ligacao: ligacaoDoFornecimento(lido.tipoFornecimento || ''),
        mediaKwh: comConsumo.length ? Math.round(comConsumo.reduce((s, h) => s + h.kwh, 0) / comConsumo.length) : 0,
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const auth = await requireUser(req, supabase)
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

    let imageBase64: string, mediaType: string
    try {
        const body = await req.json()
        imageBase64 = String(body.imageBase64 || '')
        mediaType = String(body.mediaType || 'image/jpeg')
    } catch {
        return json({ ok: false, error: 'Corpo JSON inválido.' }, 400)
    }

    if (imageBase64.includes(',')) imageBase64 = imageBase64.split(',')[1]
    if (!imageBase64) return json({ ok: false, error: 'imageBase64 é obrigatório.' }, 400)
    const ehPdf = mediaType === TIPO_PDF
    if (!ehPdf && !TIPOS_IMAGEM.includes(mediaType)) return json({ ok: false, error: `Tipo de arquivo não suportado: ${mediaType}.` }, 400)
    // ~5 MB; o front já reduz a foto antes de enviar, e a conta em PDF tem ~70 KB
    if (imageBase64.length > 7_000_000) return json({ ok: false, error: 'Arquivo grande demais. Envie uma foto menor.' }, 400)

    const apiKey = Deno.env.get('OPENROUTER_API_KEY')
    const modelo = Deno.env.get('OPENROUTER_MODEL')
    if (!apiKey || !modelo) {
        console.error('parse-invoice-image: OPENROUTER_API_KEY ou OPENROUTER_MODEL ausente')
        return json({ ok: false, error: 'Leitura de conta não configurada.' }, 500)
    }

    let resposta: Response
    try {
        resposta = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                // Identificação do app no painel de uso do OpenRouter
                'X-Title': 'B2W Energia - leitura de conta',
            },
            body: JSON.stringify({
                model: modelo,
                // Sem temperature: com require_parameters, pedir temperature
                // excluiria os provedores (e modelos de raciocínio) que não a
                // aceitam. O schema strict já fixa o formato da resposta.
                max_tokens: 8000,
                response_format: {
                    type: 'json_schema',
                    json_schema: { name: 'conta_energia', strict: true, schema: ESQUEMA },
                },
                // Só roteia para provedores que respeitam o response_format;
                // sem isso um provedor pode ignorar o schema e devolver texto livre.
                provider: { require_parameters: true },
                // PDF: o conversor gratuito do OpenRouter tira o texto da conta
                // (as da Cosern têm camada de texto) antes de chegar ao modelo.
                ...(ehPdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] } : {}),
                messages: [
                    { role: 'system', content: INSTRUCOES },
                    {
                        role: 'user',
                        content: [
                            ehPdf
                                ? { type: 'file', file: { filename: 'conta.pdf', file_data: `data:${TIPO_PDF};base64,${imageBase64}` } }
                                : { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
                            { type: 'text', text: 'Transcreva esta conta de energia.' },
                        ],
                    },
                ],
            }),
        })
    } catch (err) {
        console.error('parse-invoice-image: falha de rede', err)
        return json({ ok: false, error: 'Falha ao ler a foto. Tente de novo.' }, 502)
    }

    const corpo = await resposta.json().catch(() => null)
    if (!resposta.ok || !corpo || corpo.error) {
        console.error('parse-invoice-image: OpenRouter', resposta.status, JSON.stringify(corpo?.error ?? corpo))
        return json({ ok: false, error: 'Falha ao ler a foto. Tente de novo.' }, 502)
    }

    const escolha = corpo.choices?.[0]
    if (escolha?.finish_reason === 'length') {
        console.error('parse-invoice-image: resposta cortada por max_tokens', corpo.model)
        return json({ ok: false, error: 'Não foi possível ler a foto.' }, 502)
    }

    let dados
    try {
        // Alguns modelos embrulham o JSON em ```json ... ``` mesmo com schema
        const conteudo = String(escolha?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
        dados = JSON.parse(conteudo)
    } catch {
        console.error('parse-invoice-image: JSON inválido de', corpo.model)
        return json({ ok: false, error: 'Leitura da foto veio em formato inesperado.' }, 502)
    }

    if (!dados.legivel) {
        return json({ ok: false, error: dados.observacoes || (ehPdf ? 'Não foi possível ler este PDF de conta de energia.' : 'Foto ilegível. Tire outra com boa luz, a conta inteira e sem dobras.') }, 422)
    }

    // corpo.model é o modelo que de fato respondeu (útil quando OPENROUTER_MODEL é um preset)
    return json({ ok: true, dados: completarLeitura(dados), modelo: corpo.model })
})
