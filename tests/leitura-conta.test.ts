import { describe, it, expect } from 'vitest'
import { completarLeitura } from '../supabase/functions/_shared/leitura-conta'

describe('completarLeitura', () => {
    const base = {
        legivel: true, observacoes: '', numeroUcNovo: '', codigoCliente: '7012345', codigoInstalacao: '',
        titular: 'MARIA TESTE', documentoTipo: 'CPF', documento: '529.9**.***-**',
        endereco: { logradouro: 'RUA DAS FLORES, 120', complemento: '', bairro: 'CENTRO', cep: '59000-000', cidade: 'NATAL', uf: 'RN' },
        classificacao: 'B1 RESIDENCIAL', tipoFornecimento: 'Conv. Monômia - Bifásico',
        historico: [{ mes: '2026-08', kwh: 300, dias: 30 }, { mes: '2026-09', kwh: 0, dias: 30 }, { mes: '2026-07', kwh: 200, dias: 31 }],
    }
    it('número da UC: novo > cliente > instalação', () => {
        expect(completarLeitura(base).numeroUc).toBe('7012345')
        expect(completarLeitura({ ...base, numeroUcNovo: '1.234.567.890-12' }).numeroUc).toBe('1.234.567.890-12')
    })
    it('ligação pelo tipo de fornecimento', () => {
        expect(completarLeitura(base).ligacao).toBe('bifasico')
        expect(completarLeitura({ ...base, tipoFornecimento: 'Trifásico' }).ligacao).toBe('trifasico')
    })
    it('média só dos meses com consumo', () => {
        expect(completarLeitura(base).mediaKwh).toBe(250)
    })
    it('endereço completo e concessionária', () => {
        const c = completarLeitura(base)
        expect(c.endereco?.completo).toBe('RUA DAS FLORES, 120, CENTRO, 59000-000 NATAL RN')
        expect(c.concessionaria).toBe('Neoenergia Cosern')
    })
})
