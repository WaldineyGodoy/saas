/**
 * Monta os textos das bases do Agente Investidor
 * (spec docs/superpowers/specs/2026-10-19-base-agente-investidor-design.md §4)
 * do Agente Assinatura (spec 2026-10-20-base-agente-assinatura-design.md §4)
 * e do Agente Cotas (spec 2026-10-20-base-agente-cotas-design.md §4).
 *
 * Sem dependencia de Deno nem de Supabase: roda na Edge Function e no vitest.
 * Quem filtra o que pode sair (sem CPF/CNPJ, dono, credenciais) e a RPC
 * ponte_deskcomm_usinas_a_venda; aqui so entra o que ela devolve.
 */

export interface UsinaAVenda {
    nome: string
    cidade: string | null
    uf: string | null
    status: string
    previsao_entrega: string | null // YYYY-MM-DD
    potencia_kwp: number | null
    potencia_inversor_w: number | null
    modalidade_gd: string | null
    modalidade: string | null
    valor_investido: number | null
    modelo_venda: string
    short_url: string | null
}

export interface ParFaq {
    question: string
    answer: string
}

export interface CoberturaAssinatura {
    concessionaria: string
    ufs: string | null
    desconto_pct: number | null
    tarifa: number | null
    credito_indicacao_100kwh: number | null
}

export const SEM_COBERTURA =
    '# Assinatura: cobertura, desconto e indicação\n\nNo momento a energia por assinatura não está disponível em nenhuma região.\n'

const A_CONFIRMAR = 'a confirmar com o consultor'

// usina_status sem "em construcao": a usina nasce em pre_operacao
// (spec 2026-09-27-status-fornecedor-usina-pre-operacao-design.md).
const ESTAGIO: Record<string, string> = {
    pre_operacao: 'em obra (pré-operação)',
    em_conexao: 'em conexão',
    gerando: 'gerando',
    manutencao: 'em manutenção',
}

const MODALIDADE: Record<string, string> = {
    auto_consumo_remoto: 'autoconsumo remoto',
    geracao_compartilhada: 'geração compartilhada',
    geracao_distribuida: 'geração distribuída',
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export const SEM_USINAS =
    '# Usinas à venda\n\nNo momento não há usina disponível; o consultor avisa quando a próxima abrir.\n'

const numero = (v: number, casas = 0) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

function mesAno(data: string | null) {
    const m = data?.match(/^(\d{4})-(\d{2})/)
    return m ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : A_CONFIRMAR
}

function blocoUsina(u: UsinaAVenda) {
    const local = [u.cidade, u.uf].filter(Boolean).join('/')
    const kwp = u.potencia_kwp ? `${numero(u.potencia_kwp, 2)} kWp` : A_CONFIRMAR
    const inversor = u.potencia_inversor_w ? ` · inversor ${numero(u.potencia_inversor_w / 1000)} kW` : ''
    const regime = [u.modalidade_gd?.toUpperCase(), u.modalidade ? MODALIDADE[u.modalidade] ?? u.modalidade : null]
        .filter(Boolean).join(' ')
    const preco = u.valor_investido ? `a partir de R$ ${numero(u.valor_investido)}` : A_CONFIRMAR
    const modelo = u.modelo_venda === 'cotas' ? 'Cotas' : 'Integral'

    return [
        `## ${u.nome}${local ? ` — ${local}` : ''}`,
        `Estágio: ${ESTAGIO[u.status] ?? u.status} · Previsão de entrega: ${mesAno(u.previsao_entrega)}`,
        `Potência: ${kwp}${inversor}${regime ? ` · ${regime}` : ''}`,
        `Preço: ${preco}`,
        `Modelo de venda: ${modelo}`,
        `Página da usina: ${u.short_url || A_CONFIRMAR}`,
    ].join('\n')
}

/** Documento "Usinas à venda". Ordena pela previsão de entrega (sem data por último). */
export function montarUsinasAVenda(usinas: UsinaAVenda[]): string {
    const validas = usinas.filter((u) => u.status in ESTAGIO)
    if (validas.length === 0) return SEM_USINAS
    const ordenadas = [...validas].sort((a, b) =>
        (a.previsao_entrega ?? '9999').localeCompare(b.previsao_entrega ?? '9999') || a.nome.localeCompare(b.nome))
    return '# Usinas à venda\n\n' + ordenadas.map(blocoUsina).join('\n\n') + '\n'
}

const reais = (v: number) => `R$ ${numero(v, 2)}`

function blocoCobertura(c: CoberturaAssinatura) {
    const d = Number(c.desconto_pct)
    const t = Number(c.tarifa)
    // Mesma conta do simulador do site e da RPC b2w_mcp_simular_assinatura.
    const mensal = Math.round(300 * t * d) / 100
    const anual = Math.round(300 * t * d * 12) / 100
    const linhas = [
        `## ${c.concessionaria}${c.ufs ? ` (${c.ufs})` : ''}`,
        `Desconto do assinante: ${numero(d)}% sobre a energia compensada (Fio B incluído; bandeira tarifária não é cobrada)`,
        `Tarifa usada na estimativa: R$ ${t.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}/kWh`,
        'Fórmula: economia mensal estimada = consumo (kWh) × tarifa × desconto',
        `Exemplo: 300 kWh/mês → economia estimada de ${reais(mensal)}/mês (${reais(anual)}/ano)`,
        'Custo mínimo da distribuidora: 30 kWh (mono), 50 kWh (bi), 100 kWh (tri)',
        'Consumo mínimo para assinar: 150 kWh/mês',
    ]
    if (c.credito_indicacao_100kwh && Number(c.credito_indicacao_100kwh) > 0) {
        linhas.push(`Crédito de indicação: cerca de ${reais(Number(c.credito_indicacao_100kwh))} a cada 100 kWh compensados pelo indicado`)
    }
    linhas.push('Vencimento do boleto: dia 5')
    return linhas.join('\n')
}

/** Documento "Assinatura: cobertura, desconto e indicação". Só distribuidora com desconto e tarifa. */
export function montarCoberturaAssinatura(linhas: CoberturaAssinatura[]): string {
    const validas = linhas.filter((c) => c.desconto_pct != null && Number(c.desconto_pct) > 0 && Number(c.tarifa) > 0)
    if (validas.length === 0) return SEM_COBERTURA
    const ordenadas = [...validas].sort((a, b) => a.concessionaria.localeCompare(b.concessionaria))
    return '# Assinatura: cobertura, desconto e indicação\n\n' + ordenadas.map(blocoCobertura).join('\n\n') + '\n'
}

export interface UsinaCotas {
    nome: string
    cidade: string | null
    uf: string | null
    status: string
    previsao_entrega: string | null
    valor_investido: number | null
    cotas_vendidas: number
    short_url: string | null
}

export const SEM_COTAS =
    '# Usinas com cotas\n\nNo momento não há cota disponível; o consultor avisa quando a próxima abrir.\n'

function blocoCotas(u: UsinaCotas) {
    const local = [u.cidade, u.uf].filter(Boolean).join('/')
    const usina = Number(u.valor_investido) || 0
    const preco = usina > 0
        ? `R$ ${numero(Math.round(usina / 10 * 1.1))} (usina R$ ${numero(usina)} ÷ 10 + 10%)`
        : A_CONFIRMAR
    return [
        `## ${u.nome}${local ? ` — ${local}` : ''}`,
        `Estágio: ${ESTAGIO[u.status] ?? u.status} · Previsão de entrega: ${mesAno(u.previsao_entrega)}`,
        `Preço da cota: ${preco}`,
        `Cotas livres: ${10 - Number(u.cotas_vendidas)} de 10`,
        'Pagamento: somente à vista',
        `Página da usina: ${u.short_url || A_CONFIRMAR}`,
    ].join('\n')
}

/** Documento "Usinas com cotas". Só usina válida e com cota livre; ordem pela previsão. */
export function montarUsinasCotas(usinas: UsinaCotas[]): string {
    const validas = usinas.filter((u) => u.status in ESTAGIO && Number(u.cotas_vendidas) < 10)
    if (validas.length === 0) return SEM_COTAS
    const ordenadas = [...validas].sort((a, b) =>
        (a.previsao_entrega ?? '9999').localeCompare(b.previsao_entrega ?? '9999') || a.nome.localeCompare(b.nome))
    return '# Usinas com cotas\n\n' + ordenadas.map(blocoCotas).join('\n\n') + '\n'
}

export interface AnuncioEntrada {
    slug: string
    nome: string
    titulo: string | null
    plataformas: string[]
    publico: string
    categoria_nome: string
    promessa: string | null
}

export const SEM_ANUNCIOS =
    'Nenhum anúncio identificado até agora. Contato de anúncio sem etiqueta: veja "Contato da Meta sem etiqueta de anúncio".\n'

const PUBLICO: Record<string, string> = {
    pf: 'pessoa física',
    pj: 'empresa (CNPJ)',
    ambos: 'pessoa física e empresa',
}
const PUBLICO_INDEFINIDO = 'não definido (pergunte se é pessoa física ou empresa)'

/**
 * Percentual de anuncio nao entra na base: a trava de promessas do Deskcomm aceita como
 * provado qualquer numero que apareca numa fonte, e "ate 20%" no titulo faria a Bel
 * repeti-lo como valor garantido. O percentual do cliente sai da simulacao.
 */
const semPercentual = (t: string) => t.replace(/\d+(?:[.,]\d+)?\s?%/g, '[percentual do anúncio]')

function blocoAnuncio(a: AnuncioEntrada): string {
    const plataformas = a.plataformas.length > 0 ? a.plataformas.join(', ') : 'a confirmar'
    return [
        `### anuncio:${a.slug} — ${semPercentual(a.nome)}`,
        `Plataformas: ${plataformas} · Público: ${PUBLICO[a.publico] ?? PUBLICO_INDEFINIDO} · Produto: ${a.categoria_nome}`,
        `Título do anúncio: ${semPercentual(a.titulo?.trim() || A_CONFIRMAR)}`,
        `Promessa do anúncio: ${semPercentual(a.promessa?.trim() || A_CONFIRMAR)}`,
    ].join('\n')
}

const ABERTURA_ANUNCIO =
    'Com a etiqueta, abra falando do que o anúncio ofereceu e não pergunte o que a pessoa procura. ' +
    'Confirme se é pessoa física ou empresa: nunca presuma, mesmo no anúncio de CNPJ. ' +
    'A promessa do anúncio não é garantia: nunca repita um percentual do anúncio como valor garantido; ' +
    'o percentual do cliente sai da simulação. Se o contato tiver mais de uma etiqueta de anúncio, vale a última.'

const ENTRADAS_FIXAS = `## Contato da Meta sem etiqueta de anúncio
Contato com origem meta_ads e sem etiqueta anuncio:… é interesse em desconto na conta de luz (Energia por Assinatura). Pergunte se é pessoa física ou empresa.

## Mensagem genérica de anúncio
"Olá! Posso ter mais informações sobre isso?" vem do botão do anúncio e não diz o produto. Use a etiqueta do anúncio; sem etiqueta, siga a regra acima.

## Site (botões e simulador)
Mensagens prontas dos botões do site b2wenergia.com.br. Todas são de Energia por Assinatura:
- "Olá! Vim pelo site da B2W Energia e quero assinar e começar a economizar." — quer assinar.
- "Olá! Quero assinar a energia solar da B2W Energia e começar a economizar." — quer assinar.
- "Olá! Tenho uma dúvida sobre a energia solar por assinatura da B2W Energia." — tem dúvida.
- "Olá! Vim pelo site da B2W Energia." — botão flutuante, sem intenção clara; o mais provável é Energia por Assinatura.
Mensagem do simulador: "Olá! Simulei no site da B2W Energia: <distribuidora>, <consumo> kWh/mês, economia estimada de R$ <valor> por mês. Quero assinar." Ela já traz distribuidora e consumo: grave o consumo (consumo_kwh) e não pergunte de novo. A economia é estimativa do simulador; a confirmação sai da simulação do atendimento.

## Indicação e origem
O texto pronto do site pode terminar com um código. (cód. IND-xxxxxxxx) é indicação de um assinante ou originador; (cód. IG), (cód. GG) e (cód. FB) são Instagram, Google e Facebook. Se a origem ou o indicador já estiver gravado, não pergunte de novo.

## App do assinante
Quem diz que não conseguiu se cadastrar pelo link do app: passe para humano (crm_request_human_handoff) com o motivo "cadastro no app".

## Cliente já cadastrado
Se b2w_identificar_contato disser cliente_ativo, abra como cliente, sem dizer qual produto ele tem. Fatura, boleto, contrato, repasse ou app: humano, motivo "suporte".
`

/** Documento "Recepção: entradas". Anúncios na ordem recebida; o resto é texto fixo. */
export function montarEntradas(anuncios: AnuncioEntrada[]): string {
    const secaoAnuncios = anuncios.length === 0 ? SEM_ANUNCIOS : anuncios.map(blocoAnuncio).join('\n\n') + '\n'
    return [
        '# Recepção: entradas',
        '',
        'Como cada porta de entrada chega à Recepção e como a Bel abre a conversa.',
        '',
        '## Anúncios da Meta (etiqueta anuncio:… no contato)',
        ABERTURA_ANUNCIO,
        '',
        secaoAnuncios,
        ENTRADAS_FIXAS,
    ].join('\n')
}

/**
 * Le o FAQ no formato que a tela do Deskcomm aceita:
 *   ## Pergunta: ...
 *   ## Resposta: ... (pode seguir em varias linhas)
 */
export function lerFaq(md: string): ParFaq[] {
    const pares: ParFaq[] = []
    let atual: { question: string; answer: string[] } | null = null
    let lendo: 'q' | 'a' | null = null
    const fechar = () => {
        if (atual && atual.question && atual.answer.join('\n').trim()) {
            pares.push({ question: atual.question.trim(), answer: atual.answer.join('\n').trim() })
        }
    }
    for (const linha of md.split(/\r?\n/)) {
        const q = linha.match(/^##\s*Pergunta:\s*(.*)$/i)
        const a = linha.match(/^##\s*Resposta:\s*(.*)$/i)
        if (q) {
            fechar()
            atual = { question: q[1], answer: [] }
            lendo = 'q'
        } else if (a && atual) {
            atual.answer.push(a[1])
            lendo = 'a'
        } else if (atual && lendo === 'a') {
            atual.answer.push(linha)
        } else if (atual && lendo === 'q' && linha.trim()) {
            atual.question += ' ' + linha.trim()
        }
    }
    fechar()
    return pares
}

/** SHA-256 em hex (crypto.subtle existe no Deno e no Node 18+). */
export async function hashTexto(texto: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
