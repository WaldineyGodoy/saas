/**
 * Leitura de conta de energia (foto ou PDF) pelo OpenRouter, compartilhada por
 * parse-invoice-image e adesao-whatsapp. Sem Deno nem Supabase: roda no vitest.
 * Segredos de quem chama: OPENROUTER_API_KEY e OPENROUTER_MODEL.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp']
export const TIPO_PDF = 'application/pdf'

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
export const completarLeitura = (lido: any) => {
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

export type ContaCompleta = ReturnType<typeof completarLeitura>

/**
 * Chama o OpenRouter e devolve a conta lida. Mesmos status de erro que o
 * parse-invoice-image devolvia (400 entrada, 422 ilegível, 502 falha).
 */
export async function lerConta(base64: string, mime: string, cfg: { apiKey: string; modelo: string }):
    Promise<{ ok: true; dados: ContaCompleta; modelo: string } | { ok: false; status: number; erro: string }> {
    const ehPdf = mime === TIPO_PDF
    if (!ehPdf && !TIPOS_IMAGEM.includes(mime)) return { ok: false, status: 400, erro: `Tipo de arquivo não suportado: ${mime}.` }
    if (base64.length > 7_000_000) return { ok: false, status: 400, erro: 'Arquivo grande demais. Envie uma foto menor.' }
    let resposta: Response
    try {
        resposta = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'B2W Energia - leitura de conta' },
            body: JSON.stringify({
                model: cfg.modelo,
                max_tokens: 8000,
                response_format: { type: 'json_schema', json_schema: { name: 'conta_energia', strict: true, schema: ESQUEMA } },
                provider: { require_parameters: true },
                ...(ehPdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] } : {}),
                messages: [
                    { role: 'system', content: INSTRUCOES },
                    { role: 'user', content: [
                        ehPdf
                            ? { type: 'file', file: { filename: 'conta.pdf', file_data: `data:${TIPO_PDF};base64,${base64}` } }
                            : { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
                        { type: 'text', text: 'Transcreva esta conta de energia.' },
                    ] },
                ],
            }),
        })
    } catch (err) {
        console.error('leitura-conta: falha de rede', err)
        return { ok: false, status: 502, erro: 'Falha ao ler a foto. Tente de novo.' }
    }
    const corpo = await resposta.json().catch(() => null)
    if (!resposta.ok || !corpo || corpo.error) {
        console.error('leitura-conta: OpenRouter', resposta.status, JSON.stringify(corpo?.error ?? corpo))
        return { ok: false, status: 502, erro: 'Falha ao ler a foto. Tente de novo.' }
    }
    const escolha = corpo.choices?.[0]
    if (escolha?.finish_reason === 'length') return { ok: false, status: 502, erro: 'Não foi possível ler a foto.' }
    let dados
    try {
        dados = JSON.parse(String(escolha?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } catch {
        return { ok: false, status: 502, erro: 'Leitura da foto veio em formato inesperado.' }
    }
    if (!dados.legivel) {
        return { ok: false, status: 422, erro: dados.observacoes || (ehPdf ? 'Não foi possível ler este PDF de conta de energia.' : 'Foto ilegível. Tire outra com boa luz, a conta inteira e sem dobras.') }
    }
    return { ok: true, dados: completarLeitura(dados), modelo: corpo.model }
}
