import { describe, it, expect } from 'vitest'
import { normalizarDocumento, TIPOS_ARQUIVO_DOCUMENTO } from '../supabase/functions/_shared/leitura-documento'

const base = { legivel: true, observacoes: '', tipoDocumento: 'CNH', nome: 'MARIA DA SILVA SANTOS', cpf: '529.982.247-25', dataNascimento: '07/03/1985' }

describe('normalizarDocumento: o que a leitura do modelo vira antes de chegar a tela', () => {
    it('CPF sai so com digitos e nome em caixa de nome proprio', () => {
        const r = normalizarDocumento(base)
        expect(r.cpf).toBe('52998224725')
        expect(r.nome).toBe('Maria da Silva Santos')
    })

    it('nascimento DD/MM/AAAA vira AAAA-MM-DD', () => {
        expect(normalizarDocumento(base).nascimento).toBe('1985-03-07')
    })

    it('CPF com digito verificador errado NAO passa: erro de leitura nao vira cadastro', () => {
        const r = normalizarDocumento({ ...base, cpf: '529.982.247-26' })
        expect(r.cpf).toBe('')
        expect(r.cpfLido).toBe('52998224726')
    })

    it('CPF incompleto ou ausente fica vazio', () => {
        expect(normalizarDocumento({ ...base, cpf: '529.982' }).cpf).toBe('')
        expect(normalizarDocumento({ ...base, cpf: '' }).cpf).toBe('')
    })

    it('data impossivel, futura ou em outro formato fica vazia (nunca inventa data)', () => {
        expect(normalizarDocumento({ ...base, dataNascimento: '31/02/1985' }).nascimento).toBe('')
        expect(normalizarDocumento({ ...base, dataNascimento: '01/01/2999' }).nascimento).toBe('')
        expect(normalizarDocumento({ ...base, dataNascimento: '1985' }).nascimento).toBe('')
        expect(normalizarDocumento({ ...base, dataNascimento: '' }).nascimento).toBe('')
    })

    it('nome so de uma palavra ou vazio fica vazio', () => {
        expect(normalizarDocumento({ ...base, nome: 'MARIA' }).nome).toBe('')
        expect(normalizarDocumento({ ...base, nome: '   ' }).nome).toBe('')
    })

    it('tipo de documento desconhecido vira OUTRO; valores validos passam', () => {
        expect(normalizarDocumento({ ...base, tipoDocumento: 'RG' }).tipoDocumento).toBe('RG')
        expect(normalizarDocumento({ ...base, tipoDocumento: 'passaporte' }).tipoDocumento).toBe('OUTRO')
    })

    it('entrada nula ou sem campos nao quebra', () => {
        const r = normalizarDocumento(null)
        expect(r).toMatchObject({ cpf: '', nome: '', nascimento: '' })
    })

    it('aceita foto e PDF', () => {
        expect(TIPOS_ARQUIVO_DOCUMENTO).toEqual(expect.arrayContaining(['image/jpeg', 'image/png', 'application/pdf']))
    })
})

import { cnpjValido, normalizarEmpresa } from '../supabase/functions/_shared/leitura-documento'

describe('documento da empresa (Cartao CNPJ / Contrato Social)', () => {
    // CNPJ ficticio com digitos verificadores validos.
    const cnpj = '11.222.333/0001-81'

    it('cnpjValido confere os dois digitos verificadores', () => {
        expect(cnpjValido(cnpj)).toBe(true)
        expect(cnpjValido('11.222.333/0001-82')).toBe(false)
        expect(cnpjValido('11111111111111')).toBe(false)
        expect(cnpjValido('1122233300018')).toBe(false)
    })

    it('CNPJ lido certo sai so com digitos; errado fica vazio mas guarda o lido', () => {
        const ok = normalizarEmpresa({ tipoDocumento: 'cartao_cnpj', cnpj, razaoSocial: '  EXEMPLO   COMERCIO LTDA ' })
        expect(ok).toMatchObject({ tipoDocumento: 'CARTAO_CNPJ', cnpj: '11222333000181', razaoSocial: 'EXEMPLO COMERCIO LTDA' })
        const ruim = normalizarEmpresa({ tipoDocumento: 'CONTRATO_SOCIAL', cnpj: '11.222.333/0001-80', razaoSocial: 'X' })
        expect(ruim.cnpj).toBe('')
        expect(ruim.cnpjLido).toBe('11222333000180')
    })

    it('contrato social sem CNPJ volta vazio (o usuario digita e a busca preenche)', () => {
        const r = normalizarEmpresa({ tipoDocumento: 'CONTRATO_SOCIAL', cnpj: '', razaoSocial: 'Exemplo Ltda' })
        expect(r.cnpj).toBe('')
        expect(r.tipoDocumento).toBe('CONTRATO_SOCIAL')
    })

    it('tipo desconhecido vira OUTRO', () => {
        expect(normalizarEmpresa({ tipoDocumento: 'boleto' }).tipoDocumento).toBe('OUTRO')
        expect(normalizarEmpresa(null).cnpj).toBe('')
    })
})
