import { describe, it, expect } from 'vitest'
import {
    soDigitos, cpfValido, emailValido, documentoCompativel, separarNumero, errosDaConta,
    errosDeValidacao, parametrosAssinante, statusDaAdesao,
} from '../supabase/functions/adesao-whatsapp/regras'
import { completarLeitura } from '../supabase/functions/_shared/leitura-conta'

const conta = completarLeitura({
    legivel: true, observacoes: '', numeroUcNovo: '', codigoCliente: '7012345', codigoInstalacao: '',
    titular: 'MARIA TESTE', documentoTipo: 'CPF', documento: '529.9**.***-**',
    endereco: { logradouro: 'RUA DAS FLORES, 120', complemento: 'AP 2', bairro: 'CENTRO', cep: '59000-000', cidade: 'NATAL', uf: 'RN' },
    tipoFornecimento: 'Bifásico', historico: [{ mes: '2026-08', kwh: 300, dias: 30 }],
})

describe('CPF e e-mail', () => {
    it('cpfValido', () => {
        expect(cpfValido('529.982.247-25')).toBe(true)
        expect(cpfValido('52998224724')).toBe(false)
        expect(cpfValido('11111111111')).toBe(false)
        expect(cpfValido('123')).toBe(false)
    })
    it('emailValido', () => {
        expect(emailValido('maria@exemplo.com')).toBe(true)
        expect(emailValido('maria@exemplo')).toBe(false)
        expect(emailValido('maria exemplo.com')).toBe(false)
    })
    it('documentoCompativel compara só os dígitos visíveis da máscara', () => {
        expect(documentoCompativel('52998224725', '529.9**.***-**')).toBe(true)
        expect(documentoCompativel('12345678909', '529.9**.***-**')).toBe(false)
        expect(documentoCompativel('52998224725', '')).toBe(true)
    })
    it('soDigitos', () => expect(soDigitos('(84) 9 9999-0001')).toBe('84999990001'))
})

describe('separarNumero', () => {
    it('separa o número do fim do logradouro', () => {
        expect(separarNumero('RUA DAS FLORES, 120')).toEqual({ rua: 'RUA DAS FLORES', numero: '120' })
        expect(separarNumero('AV BRASIL 45A')).toEqual({ rua: 'AV BRASIL', numero: '45A' })
        expect(separarNumero('TRAVESSA SEM NUMERO')).toEqual({ rua: 'TRAVESSA SEM NUMERO', numero: 'S/N' })
    })
})

describe('erros', () => {
    it('da conta: CNPJ, sem cobertura, abaixo do mínimo', () => {
        expect(errosDaConta(conta, { atende: true, atinge_minimo: true })).toEqual([])
        expect(errosDaConta({ ...conta, documentoTipo: 'CNPJ' }, { atende: true, atinge_minimo: true })).toContain('titular_cnpj')
        expect(errosDaConta(conta, { atende: false, atinge_minimo: null })).toContain('sem_cobertura')
        expect(errosDaConta(conta, { atende: true, atinge_minimo: false })).toContain('abaixo_minimo')
        expect(errosDaConta({ ...conta, numeroUc: '' }, null)).toContain('conta_ilegivel')
    })
    it('de validação', () => {
        expect(errosDeValidacao({ adesao_cpf: '529.982.247-25', adesao_email: 'm@x.com', adesao_titular_ok: true }, conta, false)).toEqual([])
        expect(errosDeValidacao({ adesao_cpf: '52998224724' }, conta, false)).toContain('cpf_invalido')
        expect(errosDeValidacao({ adesao_cpf: '12345678909' }, conta, false)).toContain('cpf_diferente_conta')
        expect(errosDeValidacao({ adesao_cpf: '52998224725' }, conta, true)).toContain('cpf_ja_cadastrado')
        expect(errosDeValidacao({ adesao_email: 'x' }, conta, false)).toContain('email_invalido')
        expect(errosDeValidacao({ adesao_titular_ok: false }, conta, false)).toContain('titular_divergente')
    })
    it('status', () => {
        expect(statusDaAdesao(['cpf_invalido'], false)).toBe('coletando')
        expect(statusDaAdesao(['titular_divergente'], false)).toBe('pendencia')
        expect(statusDaAdesao([], true)).toBe('contrato_pronto')
    })
})

describe('parametrosAssinante', () => {
    it('monta os parâmetros de fn_criar_assinante_publico com originador e indicador', () => {
        const p = parametrosAssinante({
            conta, cpf: '529.982.247-25', email: ' Maria@Exemplo.com ', telefone: '5584999990001', ibge: '2408102',
            leadId: 'lead-1', originatorId: 'orig-1', indicadorId: null,
        })
        expect(p).toMatchObject({
            p_nome: 'MARIA TESTE', p_cpf_cnpj: '52998224725', p_email: 'maria@exemplo.com', p_telefone: '5584999990001',
            p_cep: '59000000', p_rua: 'RUA DAS FLORES', p_numero: '120', p_complemento: 'AP 2', p_bairro: 'CENTRO',
            p_cidade: 'NATAL', p_uf: 'RN', p_ibge: '2408102', p_originator_id: 'orig-1', p_lead_id: 'lead-1',
            p_dia_vencimento: 5, p_aceite_versao: 'whatsapp-v1', p_indicador_assinante_id: null,
            p_representante_nome: null, p_representante_cpf: null,
        })
        expect((p.p_ucs as any[])[0]).toMatchObject({
            numero_uc: '7012345', titular_conta: 'MARIA TESTE', cpf_cnpj_fatura: '52998224725', tipo_ligacao: 'bifasico',
            concessionaria: 'Neoenergia Cosern', franquia: '300', ibge: '2408102', cep: '59000000',
            rua: 'RUA DAS FLORES', numero: '120', bairro: 'CENTRO', cidade: 'NATAL', uf: 'RN', complemento: 'AP 2',
        })
    })
})
