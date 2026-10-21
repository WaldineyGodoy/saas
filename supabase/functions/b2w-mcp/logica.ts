/**
 * Servidor MCP da B2W para os agentes do DeskcommCRM
 * (spec docs/superpowers/specs/2026-10-20-bel-recepcao-design.md §8).
 * Ferramentas: b2w_concessionaria, b2w_identificar_contato e
 * b2w_simular_assinatura (spec 2026-10-20-base-agente-assinatura-design.md §5).
 *
 * Sem dependencia de Deno nem de Supabase: roda na Edge Function e no vitest.
 * O acesso ao banco entra por `Dependencias` (RPCs restritas a service_role).
 *
 * Protocolo: JSON-RPC 2.0 do MCP por Streamable HTTP, respondendo em JSON
 * (o cliente do SDK aceita application/json). Metodos: initialize,
 * notifications/initialized, ping, tools/list, tools/call.
 *
 * O telefone do contato NAO e argumento: vem do cabecalho
 * X-Deskcomm-Contato-Telefone, que o Deskcomm monta do banco (o modelo nao o
 * controla). Assim o agente nao consegue perguntar por outro numero.
 */

export interface Concessionaria {
    encontrada: boolean
    cidade: string | null
    uf: string | null
    concessionaria: string | null
    atende_assinatura: boolean
}

export interface Identificacao {
    tipo: 'cliente_ativo' | 'lead_retorno' | 'novo'
    primeiro_nome: string | null
}

export interface Simulacao {
    atende: boolean
    concessionaria: string | null
    desconto_pct: number | null
    tarifa?: number
    consumo_kwh?: number | null
    consumo_convertido?: boolean
    economia_mensal?: number | null
    economia_anual?: number | null
    atinge_minimo?: boolean | null
    vaga?: 'imediata' | 'pre_operacao' | 'fila' | null
    previsao_operacao?: string | null
    link_adesao: string
}

export interface Dependencias {
    concessionaria(cidadeNormalizada: string, uf: string): Promise<Concessionaria>
    identificar(telefone: string): Promise<Identificacao>
    simular(cidade: string, uf: string, consumoKwh: number | null, valorReais: number | null,
            telefone: string | null): Promise<Simulacao>
}

export interface Contexto {
    telefone: string | null
}

const UFS: Record<string, string> = {
    acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
    'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
    'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
    paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
    'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
    'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
}
const SIGLAS = new Set(Object.values(UFS))

/** Minusculas, sem acento, sem espaco sobrando. Mesma regra de ponte_deskcomm.fn_sem_acento. */
export function normalizarTexto(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** "Rio Grande do Sul", "rs", "RS." -> "RS". Desconhecido -> null. */
export function normalizarUf(texto: string): string | null {
    const t = normalizarTexto(texto).replace(/[.\-]/g, '').replace(/^estado d[eo]s? /, '').trim()
    if (t.length === 2 && SIGLAS.has(t.toUpperCase())) return t.toUpperCase()
    return UFS[t] ?? null
}

/** So digitos, com 55 na frente quando vier sem DDI (mesma regra de ponte_deskcomm.fn_telefone). */
export function normalizarTelefone(texto: string | null): string | null {
    const d = (texto ?? '').replace(/\D/g, '')
    if (d.length < 10) return null
    return d.length <= 11 ? `55${d}` : d
}

/** 300, "300 kWh", "R$ 1.250,90" -> número positivo; o resto -> null. */
export function lerNumero(valor: unknown): number | null {
    if (typeof valor === 'number') return Number.isFinite(valor) && valor > 0 ? valor : null
    if (typeof valor !== 'string') return null
    const limpo = valor.replace(/[^\d.,]/g, '')
    const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo
    const n = Number(normal)
    return Number.isFinite(n) && n > 0 ? n : null
}

export const FERRAMENTAS = [
    {
        name: 'b2w_concessionaria',
        title: 'Concessionária da cidade',
        description:
            'Descobre a concessionária de energia que atende uma cidade e se a B2W Energia já oferece ' +
            'Energia por Assinatura nela. Use depois que o cliente disser a cidade e o estado.',
        inputSchema: {
            type: 'object',
            properties: {
                cidade: { type: 'string', description: 'Nome da cidade, como o cliente escreveu.' },
                uf: { type: 'string', description: 'Estado: sigla (RN) ou nome (Rio Grande do Norte).' },
            },
            required: ['cidade', 'uf'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: 'b2w_identificar_contato',
        title: 'Quem é este contato',
        description:
            'Diz se o contato desta conversa já é cliente ativo da B2W Energia, se é um lead que voltou ' +
            'ou se é novo, e o primeiro nome cadastrado. Não recebe argumentos: usa o telefone da conversa.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: 'b2w_simular_assinatura',
        title: 'Simular Energia por Assinatura',
        description:
            'Estima a economia mensal e anual na Energia por Assinatura (mesma conta do simulador do site), ' +
            'diz se o consumo atinge o mínimo, se há vaga em usina (imediata, pre_operacao ou fila) e devolve ' +
            'o link de adesão. Informe o consumo em kWh OU o valor da conta em reais.',
        inputSchema: {
            type: 'object',
            properties: {
                cidade: { type: 'string', description: 'Nome da cidade, como o cliente escreveu.' },
                uf: { type: 'string', description: 'Estado: sigla (RN) ou nome (Rio Grande do Norte).' },
                consumo_kwh: { type: 'number', description: 'Consumo médio mensal em kWh.' },
                valor_conta_reais: { type: 'number', description: 'Valor médio da conta em reais, se o cliente não souber o kWh.' },
            },
            required: ['cidade', 'uf'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
] as const

const PROTOCOLO_PADRAO = '2025-06-18'

type Id = string | number | null
interface Pedido { jsonrpc?: string; id?: Id; method?: string; params?: any }

const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result })
const falha = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
const resultadoDeFerramenta = (dados: unknown, erro = false) => ({
    content: [{ type: 'text', text: JSON.stringify(dados) }],
    structuredContent: dados,
    ...(erro ? { isError: true } : {}),
})

async function chamarFerramenta(nome: string, args: any, ctx: Contexto, deps: Dependencias) {
    if (nome === 'b2w_concessionaria') {
        const cidade = typeof args?.cidade === 'string' ? normalizarTexto(args.cidade) : ''
        const uf = typeof args?.uf === 'string' ? normalizarUf(args.uf) : null
        if (!cidade || !uf) {
            return resultadoDeFerramenta({ erro: 'Informe a cidade e o estado (sigla ou nome).' }, true)
        }
        return resultadoDeFerramenta(await deps.concessionaria(cidade, uf))
    }
    if (nome === 'b2w_identificar_contato') {
        const telefone = normalizarTelefone(ctx.telefone)
        if (!telefone) return resultadoDeFerramenta({ tipo: 'novo', primeiro_nome: null })
        return resultadoDeFerramenta(await deps.identificar(telefone))
    }
    if (nome === 'b2w_simular_assinatura') {
        const cidade = typeof args?.cidade === 'string' ? normalizarTexto(args.cidade) : ''
        const uf = typeof args?.uf === 'string' ? normalizarUf(args.uf) : null
        const kwh = lerNumero(args?.consumo_kwh)
        const reais = kwh === null ? lerNumero(args?.valor_conta_reais) : null
        if (!cidade || !uf) {
            return resultadoDeFerramenta({ erro: 'Informe a cidade e o estado (sigla ou nome).' }, true)
        }
        if (kwh === null && reais === null) {
            return resultadoDeFerramenta({ erro: 'Informe o consumo em kWh ou o valor da conta em reais.' }, true)
        }
        return resultadoDeFerramenta(await deps.simular(cidade, uf, kwh, reais, normalizarTelefone(ctx.telefone)))
    }
    return null
}

/**
 * Responde um pedido JSON-RPC. Devolve null para notificacao (sem id), que o
 * transporte responde com 202 sem corpo.
 */
export async function responder(pedido: Pedido, ctx: Contexto, deps: Dependencias): Promise<unknown | null> {
    const id: Id = pedido?.id ?? null
    const notificacao = pedido?.id === undefined
    if (!pedido || pedido.jsonrpc !== '2.0' || typeof pedido.method !== 'string') {
        return notificacao ? null : falha(id, -32600, 'Invalid Request')
    }
    if (notificacao) return null

    switch (pedido.method) {
        case 'initialize':
            return ok(id, {
                protocolVersion: typeof pedido.params?.protocolVersion === 'string'
                    ? pedido.params.protocolVersion : PROTOCOLO_PADRAO,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'b2w-mcp', version: '1.0.0' },
            })
        case 'ping':
            return ok(id, {})
        case 'tools/list':
            return ok(id, { tools: FERRAMENTAS })
        case 'tools/call': {
            const nome = pedido.params?.name
            try {
                const resultado = await chamarFerramenta(String(nome), pedido.params?.arguments ?? {}, ctx, deps)
                return resultado ? ok(id, resultado) : falha(id, -32602, `Ferramenta desconhecida: ${nome}`)
            } catch {
                // Erro de banco vira resultado de ferramenta: o agente segue a conversa.
                return ok(id, resultadoDeFerramenta({ erro: 'Consulta indisponível no momento.' }, true))
            }
        }
        default:
            return falha(id, -32601, 'Method not found')
    }
}

/** Comparacao de tempo constante para o Bearer. */
export function tokenConfere(recebido: string | null, esperado: string | undefined): boolean {
    if (!esperado || !recebido) return false
    const a = new TextEncoder().encode(recebido)
    const b = new TextEncoder().encode(esperado)
    let dif = a.length ^ b.length
    for (let i = 0; i < Math.max(a.length, b.length); i++) dif |= (a[i] ?? 0) ^ (b[i] ?? 0)
    return dif === 0
}
