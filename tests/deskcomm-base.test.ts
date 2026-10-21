import { describe, it, expect } from 'vitest'
import {
    montarUsinasAVenda, montarCoberturaAssinatura, montarUsinasCotas, lerFaq, hashTexto,
    SEM_USINAS, SEM_COBERTURA, SEM_COTAS, type UsinaAVenda, type CoberturaAssinatura, type UsinaCotas,
} from '../supabase/functions/deskcomm-base/montar'
import { FAQ_INVESTIDOR } from '../supabase/functions/deskcomm-base/bases/investidor-faq'
import { FAQ_ASSINATURA } from '../supabase/functions/deskcomm-base/bases/assinatura-faq'
import { FAQ_COTAS } from '../supabase/functions/deskcomm-base/bases/cotas-faq'

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

const cosern: CoberturaAssinatura = {
    concessionaria: 'Neoenergia Cosern', ufs: 'RN', desconto_pct: 15, tarifa: 1.0347, credito_indicacao_100kwh: 1.33,
}

describe('montarCoberturaAssinatura', () => {
    it('monta a seção da distribuidora com desconto, tarifa, fórmula, exemplo, mínimo, indicação e vencimento', () => {
        const md = montarCoberturaAssinatura([cosern])
        expect(md).toContain('## Neoenergia Cosern (RN)')
        expect(md).toContain('Desconto do assinante: 15% sobre a energia compensada (Fio B incluído; bandeira tarifária não é cobrada)')
        expect(md).toContain('Tarifa usada na estimativa: R$ 1,0347/kWh')
        expect(md).toContain('Fórmula: economia mensal estimada = consumo (kWh) × tarifa × desconto')
        expect(md).toContain('Exemplo: 300 kWh/mês → economia estimada de R$ 46,56/mês (R$ 558,74/ano)')
        expect(md).toContain('Custo mínimo da distribuidora: 30 kWh (mono), 50 kWh (bi), 100 kWh (tri)')
        expect(md).toContain('Consumo mínimo para assinar: 150 kWh/mês')
        expect(md).toContain('Crédito de indicação: cerca de R$ 1,33 a cada 100 kWh compensados pelo indicado')
        expect(md).toContain('Vencimento do boleto: dia 5')
    })
    it('sem distribuidora devolve o aviso', () => {
        expect(montarCoberturaAssinatura([])).toBe(SEM_COBERTURA)
        expect(montarCoberturaAssinatura([{ ...cosern, desconto_pct: null }])).toBe(SEM_COBERTURA)
    })
    it('ordena por nome e não carrega campo fora do contrato', () => {
        const md = montarCoberturaAssinatura([
            { ...cosern, concessionaria: 'Zeta' },
            { ...cosern, concessionaria: 'Alfa', cnpj: '12.345.678/0001-90' } as CoberturaAssinatura,
        ])
        expect(md.indexOf('## Alfa')).toBeLessThan(md.indexOf('## Zeta'))
        expect(md).not.toContain('12.345.678')
    })
    it('sem crédito de indicação omite a linha', () => {
        expect(montarCoberturaAssinatura([{ ...cosern, credito_indicacao_100kwh: 0 }])).not.toContain('Crédito de indicação')
    })
})

describe('FAQ da Assinatura', () => {
    it('tem as 18 perguntas aprovadas e respeita as proibições', () => {
        const pares = lerFaq(FAQ_ASSINATURA)
        expect(pares).toHaveLength(18)
        const tudo = FAQ_ASSINATURA.toLowerCase()
        expect(tudo).not.toContain('30%')
        expect(tudo).not.toContain('fidelidade de')
        expect(tudo).toContain('não há fidelidade nem multa')
        expect(tudo).toContain('todo dia 5')
        expect(tudo).toContain('fio b incluído')
        // Números que mudam ficam na Fonte B, não aqui.
        expect(tudo).not.toMatch(/\b15%/)
        expect(tudo).not.toContain('1,0347')
    })
})

const cotaSantaMaria: UsinaCotas = {
    nome: 'UFV Santa Maria', cidade: 'Santa Maria', uf: 'RN', status: 'pre_operacao',
    previsao_entrega: '2026-12-01', valor_investido: 315000, cotas_vendidas: 3,
    short_url: 'https://link.b2wenergia.com.br/ufvsantamariausina',
}

describe('montarUsinasCotas', () => {
    it('monta preço da cota, cotas livres, pagamento e link', () => {
        const md = montarUsinasCotas([cotaSantaMaria])
        expect(md).toContain('## UFV Santa Maria — Santa Maria/RN')
        expect(md).toContain('Estágio: em obra (pré-operação) · Previsão de entrega: dez/2026')
        expect(md).toContain('Preço da cota: R$ 34.650 (usina R$ 315.000 ÷ 10 + 10%)')
        expect(md).toContain('Cotas livres: 7 de 10')
        expect(md).toContain('Pagamento: somente à vista')
        expect(md).toContain('Página da usina: https://link.b2wenergia.com.br/ufvsantamariausina')
    })
    it('sem preço e sem link saem como "a confirmar com o consultor"', () => {
        const md = montarUsinasCotas([{ ...cotaSantaMaria, valor_investido: 0, short_url: null, previsao_entrega: null }])
        expect(md).toContain('Preço da cota: a confirmar com o consultor')
        expect(md).toContain('Página da usina: a confirmar com o consultor')
        expect(md).toContain('Previsão de entrega: a confirmar com o consultor')
    })
    it('esgotada, cancelada ou lista vazia → aviso', () => {
        expect(montarUsinasCotas([])).toBe(SEM_COTAS)
        expect(montarUsinasCotas([{ ...cotaSantaMaria, cotas_vendidas: 10 }])).toBe(SEM_COTAS)
        expect(montarUsinasCotas([{ ...cotaSantaMaria, status: 'cancelada' }])).toBe(SEM_COTAS)
    })
    it('ordena pela previsão e não carrega campo fora do contrato', () => {
        const md = montarUsinasCotas([
            { ...cotaSantaMaria, nome: 'B', previsao_entrega: null },
            { ...cotaSantaMaria, nome: 'A', previsao_entrega: '2026-11-01', cpf: '529.982.247-25' } as UsinaCotas,
        ])
        expect(md.indexOf('## A')).toBeLessThan(md.indexOf('## B'))
        expect(md).not.toContain('529.982')
    })
})

describe('FAQ de Cotas', () => {
    it('tem as 14 perguntas aprovadas e respeita as proibições', () => {
        expect(lerFaq(FAQ_COTAS)).toHaveLength(14)
        const tudo = FAQ_COTAS.toLowerCase()
        for (const proibido of ['garantid', 'risco zero', 'blindad', '100% segur', 'parcel', 'financiamento', 'multa']) {
            expect(tudo, proibido).not.toContain(proibido)
        }
        expect(tudo).toContain('somente à vista')
        expect(tudo).toContain('1,8% a 2% ao mês')
        expect(tudo).toContain('título de propriedade')
    })
    it('o FAQ do Investidor não cita mais R$ 35.000', () => {
        expect(FAQ_INVESTIDOR).not.toContain('35.000')
        expect(FAQ_INVESTIDOR).toContain('dividido por 10, mais 10%')
    })
})
