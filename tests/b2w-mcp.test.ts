import { describe, it, expect, vi } from 'vitest'
import {
    responder, normalizarTexto, normalizarUf, normalizarTelefone, lerNumero, tokenConfere, ufDoTelefone, FERRAMENTAS,
    type Dependencias,
} from '../supabase/functions/b2w-mcp/logica'

const deps = (over: Partial<Dependencias> = {}): Dependencias => ({
    concessionaria: vi.fn(async (cidade, uf) => ({
        encontrada: true, cidade: 'Santa Maria', uf, concessionaria: 'Neoenergia Cosern', atende_assinatura: true,
    })),
    identificar: vi.fn(async () => ({ tipo: 'novo' as const, primeiro_nome: null })),
    simular: vi.fn(async () => ({
        atende: true, concessionaria: 'Neoenergia Cosern', desconto_pct: 15, tarifa: 1.0347,
        consumo_kwh: 300, consumo_convertido: false, economia_mensal: 46.56, economia_anual: 558.74,
        atinge_minimo: true, vaga: 'imediata' as const, previsao_operacao: null,
        link_adesao: 'https://b2wenergia.com.br/',
    })),
    statusAdesao: vi.fn(async () => ({ etapa: 'aguardando_cpf', status: 'coletando', conta: null, cpf_mascarado: null,
        erros: [], link_assinatura: null, assinado: false })),
    ...over,
})
const chamar = (name: string, args: unknown, d = deps(), telefone: string | null = null) =>
    responder({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { telefone }, d)

describe('normalização', () => {
    it('cidade sem acento, caixa e espaço sobrando', () => {
        expect(normalizarTexto('  São   José de Mipibu ')).toBe('sao jose de mipibu')
    })
    it('UF por sigla ou nome', () => {
        expect(normalizarUf('RN')).toBe('RN')
        expect(normalizarUf('rs.')).toBe('RS')
        expect(normalizarUf('Rio Grande do Sul')).toBe('RS')
        expect(normalizarUf('estado de São Paulo')).toBe('SP')
        expect(normalizarUf('Paraná')).toBe('PR')
        expect(normalizarUf('Narnia')).toBeNull()
        expect(normalizarUf('XX')).toBeNull()
    })
    it('telefone com 55 na frente', () => {
        expect(normalizarTelefone('(84) 99613-4234')).toBe('5584996134234')
        expect(normalizarTelefone('5584996134234')).toBe('5584996134234')
        expect(normalizarTelefone('123')).toBeNull()
        expect(normalizarTelefone(null)).toBeNull()
    })
})

describe('protocolo MCP', () => {
    it('initialize devolve capacidades de tools e ecoa a versão pedida', async () => {
        const r: any = await responder({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, { telefone: null }, deps())
        expect(r.result.protocolVersion).toBe('2025-03-26')
        expect(r.result.capabilities.tools).toBeDefined()
    })
    it('notificação não tem resposta', async () => {
        expect(await responder({ jsonrpc: '2.0', method: 'notifications/initialized' }, { telefone: null }, deps())).toBeNull()
    })
    it('tools/list anuncia as quatro ferramentas como somente leitura', async () => {
        const r: any = await responder({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { telefone: null }, deps())
        expect(r.result.tools.map((t: any) => t.name)).toEqual(['b2w_concessionaria', 'b2w_identificar_contato', 'b2w_simular_assinatura', 'b2w_status_adesao'])
        for (const t of FERRAMENTAS) expect(t.annotations.readOnlyHint).toBe(true)
    })
    it('método desconhecido e pedido inválido', async () => {
        const r1: any = await responder({ jsonrpc: '2.0', id: 3, method: 'x' }, { telefone: null }, deps())
        expect(r1.error.code).toBe(-32601)
        const r2: any = await responder({ id: 4 } as any, { telefone: null }, deps())
        expect(r2.error.code).toBe(-32600)
    })
})

describe('b2w_concessionaria', () => {
    it('normaliza cidade e UF antes de consultar', async () => {
        const d = deps()
        const r: any = await chamar('b2w_concessionaria', { cidade: 'Santa María', uf: 'Rio Grande do Norte' }, d)
        expect(d.concessionaria).toHaveBeenCalledWith('santa maria', 'RN')
        expect(r.result.structuredContent.concessionaria).toBe('Neoenergia Cosern')
    })
    it('UF inválida vira erro de ferramenta, sem consultar', async () => {
        const d = deps()
        const r: any = await chamar('b2w_concessionaria', { cidade: 'Natal', uf: 'Narnia' }, d)
        expect(r.result.isError).toBe(true)
        expect(d.concessionaria).not.toHaveBeenCalled()
    })
    it('falha do banco vira erro de ferramenta, não exceção', async () => {
        const d = deps({ concessionaria: vi.fn(async () => { throw new Error('db') }) })
        const r: any = await chamar('b2w_concessionaria', { cidade: 'Natal', uf: 'RN' }, d)
        expect(r.result.isError).toBe(true)
    })
    it('sem UF consulta só pela cidade', async () => {
        const d = deps({ concessionaria: vi.fn(async () => ({
            encontrada: true, cidade: 'Pau dos Ferros', uf: 'RN', concessionaria: 'Neoenergia Cosern',
            atende_assinatura: true, uf_deduzida: true,
        })) })
        const r: any = await chamar('b2w_concessionaria', { cidade: 'Pau dos ferros' }, d, '5584999990000')
        expect(d.concessionaria).toHaveBeenCalledWith('pau dos ferros', null)
        expect(r.result.structuredContent.uf_deduzida).toBe(true)
        expect(r.result.structuredContent.uf_provavel).toBeUndefined()
    })
    it('UF vazia conta como sem UF', async () => {
        const d = deps()
        await chamar('b2w_concessionaria', { cidade: 'Natal', uf: '  ' }, d)
        expect(d.concessionaria).toHaveBeenCalledWith('natal', null)
    })
    it('cidade ambígua ganha a UF do DDD quando ela é uma das opções', async () => {
        const ambigua = { encontrada: false, cidade: 'parnamirim', uf: null, concessionaria: null,
            atende_assinatura: false, ambigua: true, opcoes_uf: ['PE', 'RN'] }
        const d = deps({ concessionaria: vi.fn(async () => ambigua) })
        const r: any = await chamar('b2w_concessionaria', { cidade: 'Parnamirim' }, d, '(84) 99999-0000')
        expect(r.result.structuredContent).toMatchObject({ ambigua: true, uf_provavel: 'RN', estado_provavel: 'Rio Grande do Norte' })
        const r2: any = await chamar('b2w_concessionaria', { cidade: 'Parnamirim' }, d, '(11) 99999-0000')
        expect(r2.result.structuredContent.uf_provavel).toBeUndefined()
    })
    it('sem cidade é erro', async () => {
        const r: any = await chamar('b2w_concessionaria', { uf: 'RN' })
        expect(r.result.isError).toBe(true)
    })
})

describe('ufDoTelefone', () => {
    it('DDD do telefone brasileiro', () => {
        expect(ufDoTelefone('5584981924058')).toBe('RN')
        expect(ufDoTelefone('(83) 98888-7777')).toBe('PB')
        expect(ufDoTelefone('11 99999-0000')).toBe('SP')
        expect(ufDoTelefone('14155550000123')).toBeNull()
        expect(ufDoTelefone(null)).toBeNull()
    })
})

describe('b2w_identificar_contato', () => {
    it('usa o telefone do cabeçalho e ignora argumento', async () => {
        const d = deps({ identificar: vi.fn(async () => ({ tipo: 'cliente_ativo' as const, primeiro_nome: 'Maria' })) })
        const r: any = await chamar('b2w_identificar_contato', { telefone: '5511000000000' }, d, '5584996134234')
        expect(d.identificar).toHaveBeenCalledWith('5584996134234')
        expect(r.result.structuredContent).toEqual({ tipo: 'cliente_ativo', primeiro_nome: 'Maria' })
    })
    it('sem telefone no cabeçalho responde novo sem consultar', async () => {
        const d = deps()
        const r: any = await chamar('b2w_identificar_contato', {}, d, null)
        expect(d.identificar).not.toHaveBeenCalled()
        expect(r.result.structuredContent.tipo).toBe('novo')
    })
})

describe('b2w_simular_assinatura', () => {
    it('normaliza cidade e UF e passa o telefone do cabeçalho, nunca de argumento', async () => {
        const d = deps()
        const r: any = await chamar('b2w_simular_assinatura',
            { cidade: 'Natal', uf: 'rn', consumo_kwh: 300, telefone: '5511000000000' }, d, '(84) 99999-0001')
        expect(d.simular).toHaveBeenCalledWith('natal', 'RN', 300, null, '5584999990001')
        expect(r.result.structuredContent.economia_mensal).toBe(46.56)
    })
    it('aceita valor da conta em reais', async () => {
        const d = deps()
        await chamar('b2w_simular_assinatura', { cidade: 'Natal', uf: 'RN', valor_conta_reais: 'R$ 310,41' }, d)
        expect(d.simular).toHaveBeenCalledWith('natal', 'RN', null, 310.41, null)
    })
    it('sem consumo nem valor vira erro de ferramenta, sem consultar', async () => {
        const d = deps()
        const r: any = await chamar('b2w_simular_assinatura', { cidade: 'Natal', uf: 'RN' }, d)
        expect(r.result.isError).toBe(true)
        expect(d.simular).not.toHaveBeenCalled()
    })
    it('falha do banco vira erro de ferramenta', async () => {
        const d = deps({ simular: vi.fn(async () => { throw new Error('db') }) })
        const r: any = await chamar('b2w_simular_assinatura', { cidade: 'Natal', uf: 'RN', consumo_kwh: 300 }, d)
        expect(r.result.isError).toBe(true)
    })
})

describe('b2w_status_adesao', () => {
    it('usa só o telefone do cabeçalho, ignora argumento', async () => {
        const d = deps()
        const r: any = await chamar('b2w_status_adesao', { telefone: '5511000000000' }, d, '(84) 99999-0009')
        expect(d.statusAdesao).toHaveBeenCalledWith('5584999990009')
        expect(r.result.structuredContent.etapa).toBe('aguardando_cpf')
    })
    it('sem telefone responde etapa vazia sem consultar', async () => {
        const d = deps()
        const r: any = await chamar('b2w_status_adesao', {}, d, null)
        expect(d.statusAdesao).not.toHaveBeenCalled()
        expect(r.result.structuredContent.etapa).toBeNull()
    })
})

describe('lerNumero', () => {
    it('lê número, texto com vírgula e com milhar', () => {
        expect(lerNumero(300)).toBe(300)
        expect(lerNumero('300 kWh')).toBe(300)
        expect(lerNumero('R$ 1.250,90')).toBe(1250.9)
        expect(lerNumero('0')).toBeNull()
        expect(lerNumero('abc')).toBeNull()
        expect(lerNumero(undefined)).toBeNull()
    })
})

describe('tokenConfere', () => {
    it('confere só o token exato', () => {
        expect(tokenConfere('abc', 'abc')).toBe(true)
        expect(tokenConfere('abd', 'abc')).toBe(false)
        expect(tokenConfere('abc', undefined)).toBe(false)
        expect(tokenConfere(null, 'abc')).toBe(false)
    })
})
