/**
 * Regras puras da adesão pelo WhatsApp
 * (spec docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md §5.2).
 * Sem Deno nem Supabase: roda na Edge Function e no vitest.
 */
import type { ContaCompleta } from '../_shared/leitura-conta.ts'

export type CamposCard = { adesao_cpf?: string; adesao_email?: string; adesao_telefone?: string; adesao_titular_ok?: boolean | null }
export type EntradaAssinante = {
    conta: ContaCompleta; cpf: string; email: string; telefone: string; ibge: string | null
    leadId: string; originatorId: string | null; indicadorId: string | null
}

/** Erros que param a adesão e chamam humano (etapa "Pendência de adesão"). */
export const PENDENCIAS = new Set([
    'titular_divergente', 'titular_cnpj', 'cpf_diferente_conta', 'cpf_ja_cadastrado', 'falha_criacao',
])

export const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function cpfValido(cpf: string): boolean {
    const d = soDigitos(cpf)
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
    const dv = (n: number) => {
        let soma = 0
        for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i)
        const r = (soma * 10) % 11
        return r === 10 ? 0 : r
    }
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

export const emailValido = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email ?? '').trim())

/** A conta mostra o CPF mascarado ("529.9**.***-**"): compara só os dígitos visíveis. */
export function documentoCompativel(cpf: string, mascarado: string): boolean {
    const d = soDigitos(cpf)
    const m = (mascarado ?? '').replace(/[^\d*]/g, '')
    if (m.length !== 11) return true
    for (let i = 0; i < 11; i++) if (m[i] !== '*' && m[i] !== d[i]) return false
    return true
}

export function separarNumero(logradouro: string): { rua: string; numero: string } {
    const t = (logradouro ?? '').trim()
    const m = t.match(/^(.*?)[,\s]+(\d+[A-Za-z]?)\s*$/)
    return m ? { rua: m[1].trim(), numero: m[2] } : { rua: t, numero: 'S/N' }
}

export function errosDaConta(c: ContaCompleta, sim: { atende: boolean; atinge_minimo: boolean | null } | null): string[] {
    const erros: string[] = []
    if (!c?.numeroUc || !c?.titular) erros.push('conta_ilegivel')
    if (c?.documentoTipo === 'CNPJ') erros.push('titular_cnpj')
    if (sim && !sim.atende) erros.push('sem_cobertura')
    if (sim && sim.atende && sim.atinge_minimo === false) erros.push('abaixo_minimo')
    return erros
}

export function errosDeValidacao(cf: CamposCard, conta: ContaCompleta | null, cpfJaExiste: boolean): string[] {
    const erros: string[] = []
    if (cf.adesao_cpf) {
        if (!cpfValido(cf.adesao_cpf)) erros.push('cpf_invalido')
        else {
            if (conta && conta.documentoTipo === 'CPF' && !documentoCompativel(cf.adesao_cpf, conta.documento)) erros.push('cpf_diferente_conta')
            if (cpfJaExiste) erros.push('cpf_ja_cadastrado')
        }
    }
    if (cf.adesao_email && !emailValido(cf.adesao_email)) erros.push('email_invalido')
    if (cf.adesao_titular_ok === false) erros.push('titular_divergente')
    return erros
}

export function statusDaAdesao(erros: string[], temLink: boolean): 'pendencia' | 'coletando' | 'contrato_pronto' {
    if (erros.some((e) => PENDENCIAS.has(e))) return 'pendencia'
    return temLink ? 'contrato_pronto' : 'coletando'
}

export function parametrosAssinante(a: EntradaAssinante): Record<string, unknown> {
    const e = a.conta.endereco ?? { logradouro: '', complemento: '', bairro: '', cep: '', cidade: '', uf: '' }
    const { rua, numero } = separarNumero(e.logradouro)
    const cep = soDigitos(e.cep)
    const cpf = soDigitos(a.cpf)
    const uf = (e.uf ?? '').toUpperCase()
    const complemento = e.complemento || null
    return {
        p_nome: a.conta.titular.trim(), p_cpf_cnpj: cpf, p_email: a.email.trim().toLowerCase(),
        p_telefone: soDigitos(a.telefone), p_cep: cep, p_rua: rua, p_numero: numero, p_complemento: complemento,
        p_bairro: e.bairro, p_cidade: e.cidade, p_uf: uf, p_ibge: a.ibge,
        p_originator_id: a.originatorId, p_lead_id: a.leadId,
        p_ucs: [{
            numero_uc: a.conta.numeroUc, titular_conta: a.conta.titular.trim(), cpf_cnpj_fatura: cpf,
            tipo_ligacao: a.conta.ligacao, concessionaria: a.conta.concessionaria, franquia: String(a.conta.mediaKwh || 0),
            ibge: a.ibge, cep, rua, numero, bairro: e.bairro, cidade: e.cidade, uf, complemento,
        }],
        p_dia_vencimento: 5, p_representante_nome: null, p_representante_cpf: null,
        p_aceite_versao: 'whatsapp-v1', p_indicador_assinante_id: a.indicadorId,
    }
}
