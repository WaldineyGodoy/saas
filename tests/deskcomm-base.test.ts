import { describe, it, expect } from 'vitest'
import {
    montarUsinasAVenda, lerFaq, hashTexto, SEM_USINAS, type UsinaAVenda,
} from '../supabase/functions/deskcomm-base/montar'
import { FAQ_INVESTIDOR } from '../supabase/functions/deskcomm-base/bases/investidor-faq'

const santaMaria: UsinaAVenda = {
    nome: 'UFV Santa Maria', cidade: 'Santa Maria', uf: 'RN', status: 'pre_operacao',
    previsao_entrega: '2026-12-01', potencia_kwp: 102.24, potencia_inversor_w: 75000,
    modalidade_gd: 'GD2', modalidade: 'auto_consumo_remoto', valor_investido: 330000,
    modelo_venda: 'integral', short_url: 'https://link.b2wenergia.com.br/ufvsantamariausina',
}

describe('montarUsinasAVenda', () => {
    it('monta o bloco da usina com estágio, previsão, potência, preço, modelo e link', () => {
        const md = montarUsinasAVenda([santaMaria])
        expect(md).toContain('## UFV Santa Maria — Santa Maria/RN')
        expect(md).toContain('Estágio: em obra (pré-operação) · Previsão de entrega: dez/2026')
        expect(md).toContain('Potência: 102,24 kWp · inversor 75 kW · GD2 autoconsumo remoto')
        expect(md).toContain('Preço: a partir de R$ 330.000')
        expect(md).toContain('Modelo de venda: Integral')
        expect(md).toContain('Página da usina: https://link.b2wenergia.com.br/ufvsantamariausina')
    })

    it('mostra Cotas quando o modelo de venda é cotas', () => {
        expect(montarUsinasAVenda([{ ...santaMaria, modelo_venda: 'cotas' }])).toContain('Modelo de venda: Cotas')
    })

    it('campo vazio sai como "a confirmar com o consultor"', () => {
        const md = montarUsinasAVenda([{
            ...santaMaria, previsao_entrega: null, valor_investido: null, short_url: null, potencia_kwp: null,
        }])
        expect(md).toContain('Previsão de entrega: a confirmar com o consultor')
        expect(md).toContain('Preço: a confirmar com o consultor')
        expect(md).toContain('Página da usina: a confirmar com o consultor')
        expect(md).toContain('Potência: a confirmar com o consultor')
    })

    it('sem usina válida devolve o aviso de que não há usina disponível', () => {
        expect(montarUsinasAVenda([])).toBe(SEM_USINAS)
        expect(montarUsinasAVenda([{ ...santaMaria, status: 'cancelada' }])).toBe(SEM_USINAS)
        expect(montarUsinasAVenda([{ ...santaMaria, status: 'inativa' }])).toBe(SEM_USINAS)
    })

    it('ordena pela previsão de entrega, sem data por último', () => {
        const md = montarUsinasAVenda([
            { ...santaMaria, nome: 'C', previsao_entrega: null },
            { ...santaMaria, nome: 'B', previsao_entrega: '2027-03-01' },
            { ...santaMaria, nome: 'A', previsao_entrega: '2026-11-01' },
        ])
        expect(md.indexOf('## A')).toBeLessThan(md.indexOf('## B'))
        expect(md.indexOf('## B')).toBeLessThan(md.indexOf('## C'))
    })

    it('não carrega campos fora do contrato (dado pessoal que vier por engano)', () => {
        const comLixo = { ...santaMaria, cnpj_cpf: '12.345.678/0001-90', supplier_id: 'abc' } as UsinaAVenda
        const md = montarUsinasAVenda([comLixo])
        expect(md).not.toContain('12.345.678')
        expect(md).not.toContain('abc')
    })
})

describe('lerFaq', () => {
    it('lê pares com resposta em várias linhas', () => {
        const pares = lerFaq('## Pergunta: Quanto custa?\n## Resposta: A partir de R$ 290.000.\nDepende da obra.\n\n## Pergunta: Posso visitar?\n## Resposta: Sim.')
        expect(pares).toEqual([
            { question: 'Quanto custa?', answer: 'A partir de R$ 290.000.\nDepende da obra.' },
            { question: 'Posso visitar?', answer: 'Sim.' },
        ])
    })

    it('ignora pergunta sem resposta', () => {
        expect(lerFaq('## Pergunta: Sozinha?\n')).toEqual([])
    })

    it('o FAQ do Investidor tem as 15 perguntas aprovadas e respeita as proibições', () => {
        const md = FAQ_INVESTIDOR
        const pares = lerFaq(md)
        expect(pares).toHaveLength(15)
        const tudo = md.toLowerCase()
        for (const proibido of ['garantid', 'risco zero', 'blindad', '100% segur', 'matrícula', 'retenção', 'multa']) {
            expect(tudo, proibido).not.toContain(proibido)
        }
        expect(tudo).toContain('projeção, não garantia')
    })
})

describe('hashTexto', () => {
    it('é estável e muda com o texto', async () => {
        expect(await hashTexto('a')).toBe(await hashTexto('a'))
        expect(await hashTexto('a')).not.toBe(await hashTexto('b'))
        expect(await hashTexto('a')).toMatch(/^[0-9a-f]{64}$/)
    })
})
