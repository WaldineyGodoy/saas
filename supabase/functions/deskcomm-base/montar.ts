/**
 * Monta os textos da base do Agente Investidor no Deskcomm
 * (spec docs/superpowers/specs/2026-10-19-base-agente-investidor-design.md §4).
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
