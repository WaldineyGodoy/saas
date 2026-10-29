import { describe, it, expect } from 'vitest'
import {
    montarUsinasAVenda, montarCoberturaAssinatura, montarUsinasCotas, montarEntradas, montarGestoraPlanos, lerFaq, hashTexto,
    SEM_USINAS, SEM_COBERTURA, SEM_COTAS, SEM_ANUNCIOS, SEM_PLANOS_GESTORA, type PlanoGestora, type UsinaAVenda, type CoberturaAssinatura, type UsinaCotas, type AnuncioEntrada,
} from '../supabase/functions/deskcomm-base/montar'
import { FAQ_INVESTIDOR } from '../supabase/functions/deskcomm-base/bases/investidor-faq'
import { FAQ_ASSINATURA } from '../supabase/functions/deskcomm-base/bases/assinatura-faq'
import { FAQ_COTAS } from '../supabase/functions/deskcomm-base/bases/cotas-faq'
import { FAQ_RECEPCAO } from '../supabase/functions/deskcomm-base/bases/recepcao-faq'
import { FAQ_GESTORA } from '../supabase/functions/deskcomm-base/bases/gestora-faq'
import { FAQ_CONSTRUCAO } from '../supabase/functions/deskcomm-base/bases/construcao-faq'

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
    concessionaria: 'Neoenergia Cosern', ufs: 'RN', desconto_pct: 15, tarifa: 1.0347, credito_indicacao_100kwh: 1.33, pct_indicacao: 2,
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
        expect(md).toContain('Cashback de indicação: 2% sobre a energia compensada de cada indicado (cerca de R$ 1,33 a cada 100 kWh), abatido na fatura de quem indicou')
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
        expect(montarCoberturaAssinatura([{ ...cosern, credito_indicacao_100kwh: 0 }])).not.toContain('Cashback de indicação')
        expect(montarCoberturaAssinatura([{ ...cosern, pct_indicacao: null }])).not.toContain('Cashback de indicação')
    })
})

describe('FAQ da Assinatura', () => {
    it('tem as 20 perguntas aprovadas e respeita as proibições', () => {
        const pares = lerFaq(FAQ_ASSINATURA)
        expect(pares).toHaveLength(20)
        const tudo = FAQ_ASSINATURA.toLowerCase()
        // respostas do dono em 28/10/2026: indicação na mesma distribuidora e localização das usinas
        expect(tudo).toContain('mesma distribuidora (concessionária)')
        expect(tudo).toContain('taxa de ocupação das usinas')
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

describe('FAQ da Recepção', () => {
    it('tem as 18 perguntas aprovadas, com os fatos do dono e sem número comercial', () => {
        const pares = lerFaq(FAQ_RECEPCAO)
        expect(pares).toHaveLength(18)
        const tudo = FAQ_RECEPCAO.toLowerCase()

        // fatos informados pelo dono em 24/10/2026
        expect(tudo).toContain('olavo lacerda montenegro, 467')
        expect(tudo).toContain('parnamirim')
        expect(tudo).toContain('das 9h às 17h')
        expect(tudo).toContain('videochamada')
        expect(tudo).toContain('o cnpj consta no contrato')
        expect(tudo).toContain('(31) 99536-7744')
        expect(tudo).toContain('contato@b2wenergia.com.br')
        expect(tudo).toContain('donos de usina')

        // nenhum percentual, preço ou lista de estados do site
        expect(tudo).not.toMatch(/\d\s?%/)
        expect(tudo).not.toContain('r$')
        for (const estado of ['mato grosso', 'paraná', 'goiás', 'são paulo', 'rio de janeiro']) {
            expect(tudo, estado).not.toContain(estado)
        }

        // a Gestora não é mercado livre, e nada de promessa
        expect(tudo).not.toContain('mercado livre')
        for (const proibido of ['garantid', 'risco zero', 'fidelidade de', 'multa']) {
            expect(tudo, proibido).not.toContain(proibido)
        }
    })

    it('a primeira resposta é a mesma "Quem é a B2W Energia" do FAQ do Investidor', () => {
        const rec = lerFaq(FAQ_RECEPCAO)[0]
        const inv = lerFaq(FAQ_INVESTIDOR).find((p) => p.question.startsWith('Quem é a B2W Energia'))
        expect(inv).toBeDefined()
        expect(rec.question).toBe(inv!.question)
        expect(rec.answer).toBe(inv!.answer)
    })
})

const anuncioPf: AnuncioEntrada = {
    slug: 'conta-pf-20', nome: 'Conta de luz PF', titulo: 'Sua conta de luz até 20% menor',
    plataformas: ['instagram', 'facebook'], publico: 'ambos', categoria_nome: 'Energia por Assinatura',
    promessa: 'Desconto na conta de luz, sem obra',
}

describe('montarEntradas', () => {
    it('monta o bloco de cada anúncio com etiqueta, plataformas, público, produto, título e promessa', () => {
        const md = montarEntradas([anuncioPf])
        expect(md).toContain('# Recepção: entradas')
        expect(md).toContain('### anuncio:conta-pf-20 — Conta de luz PF')
        expect(md).toContain('Plataformas: instagram, facebook · Público: pessoa física e empresa · Produto: Energia por Assinatura')
        expect(md).toContain('Título do anúncio: Sua conta de luz até [percentual do anúncio] menor')
        expect(md).toContain('Promessa do anúncio: Desconto na conta de luz, sem obra')
    })

    it('público não definido manda perguntar; campos vazios saem como "a confirmar"', () => {
        const md = montarEntradas([{ ...anuncioPf, publico: 'nao_definido', promessa: null, titulo: null, plataformas: [] }])
        expect(md).toContain('Público: não definido (pergunte se é pessoa física ou empresa)')
        expect(md).toContain('Promessa do anúncio: a confirmar com o consultor')
        expect(md).toContain('Título do anúncio: a confirmar com o consultor')
        expect(md).toContain('Plataformas: a confirmar')
    })

    it('sem anúncio devolve o aviso e mantém as seções fixas', () => {
        const md = montarEntradas([])
        expect(md).toContain(SEM_ANUNCIOS)
        for (const secao of ['## Site (botões e simulador)', '## Indicação e origem', '## App do assinante', '## Cliente já cadastrado', '## Mensagem genérica de anúncio']) {
            expect(md, secao).toContain(secao)
        }
    })

    it('regras de abertura: pergunta pessoa física ou empresa e nunca repete percentual do anúncio como garantia', () => {
        const md = montarEntradas([anuncioPf])
        expect(md).toContain('nunca presuma, mesmo no anúncio de CNPJ')
        expect(md).toContain('nunca repita um percentual do anúncio como valor garantido')
        expect(md).toContain('vale a última')
    })

    it('traz as mensagens prontas do site e o motivo de humano do app', () => {
        const md = montarEntradas([])
        expect(md).toContain('Olá! Vim pelo site da B2W Energia e quero assinar e começar a economizar.')
        expect(md).toContain('Olá! Tenho uma dúvida sobre a energia solar por assinatura da B2W Energia.')
        expect(md).toContain('Olá! Simulei no site da B2W Energia:')
        expect(md).toContain('motivo "cadastro no app"')
        expect(md).toContain('(cód. IND-xxxxxxxx)')
    })

    it('mascara percentual no nome, no título e na promessa (a trava de promessas aceitaria o número como provado)', () => {
        const md = montarEntradas([{
            ...anuncioPf, nome: 'Conta até 20% menor', titulo: 'Plano Connect de 15%', promessa: 'Desconto de 12,5 % na conta',
        }])
        expect(md).not.toMatch(/\d\s?%/)
        expect(md).toContain('### anuncio:conta-pf-20 — Conta até [percentual do anúncio] menor')
        expect(md).toContain('Título do anúncio: Plano Connect de [percentual do anúncio]')
        expect(md).toContain('Promessa do anúncio: Desconto de [percentual do anúncio] na conta')
    })

    it('ordena como veio e não carrega campo fora do contrato', () => {
        const comLixo = { ...anuncioPf, ad_id: '120250561928760337', cnpj: '12.345.678/0001-90', corpo: 'texto longo' } as AnuncioEntrada
        const md = montarEntradas([comLixo, { ...anuncioPf, slug: 'cnpj-20', nome: 'Faturamento alto' }])
        expect(md).not.toContain('120250561928760337')
        expect(md).not.toContain('12.345.678')
        expect(md).not.toContain('texto longo')
        expect(md.indexOf('anuncio:conta-pf-20')).toBeLessThan(md.indexOf('anuncio:cnpj-20'))
    })
})

describe('FAQ da Gestora (Helena)', () => {
    const pares = lerFaq(FAQ_GESTORA)

    it('tem perguntas no formato da tela e nenhum número (percentual, valor ou dia vêm do documento do plano)', () => {
        expect(pares.length).toBeGreaterThanOrEqual(12)
        expect(FAQ_GESTORA.replace(/B2W/g, '')).not.toMatch(/\d/)
    })

    it('explica compensada e injetada como grandezas distintas, sem dizer que se complementam', () => {
        const r = pares.find((p) => /sobre qual energia/i.test(p.question))!.answer
        expect(r).toContain('compensada')
        expect(r).toContain('injetada')
        expect(r).toContain('grandezas diferentes')
        expect(r).not.toMatch(/complement|o restante|o que sobra/i)
    })

    it('traz a fórmula do repasse e o limite a solar operando ou em construção', () => {
        const todo = pares.map((p) => p.answer).join(' ')
        expect(todo).toContain('a tarifa da concessionária, menos o desconto dado ao assinante, menos o Fio B, menos a taxa de gestão')
        expect(todo).toContain('Usinas solares, de qualquer potência')
        expect(todo).toContain('operando ou em construção com prazo de entrega')
    })

    it('projeto no papel oferece o Leo, de Usinas de Investimento', () => {
        const r = pares.find((p) => /no papel/i.test(p.question))!.answer
        expect(r).toContain('Usinas de Investimento')
        expect(r).toContain('Leo')
        expect(r).toContain('proposta especial para construir')
    })

    it('setup, carência e prazo são tratados como assunto obrigatório e nunca estimados', () => {
        const r = pares.find((p) => /setup/i.test(p.question))!.answer
        expect(r).toContain('custo de setup')
        expect(r).toContain('carência')
        expect(r).toContain('primeiro repasse')
        expect(r).toContain('nunca estimo')
    })

    it('não afirma o que é do especialista: nada de multa, retenção, recuperação ou exclusividade', () => {
        expect(FAQ_GESTORA).not.toMatch(/multa|retenção|recuperação|exclusividade|mercado livre/i)
    })
})

const planoAtivo: PlanoGestora = {
    nome: 'Plano Usina - Recorrencia Corretor', taxa_gestao_pct: 12, desconto_assinante_pct: 15,
    dia_corte: 5, dia_repasse: 10, setup_pct: null, setup_base: null,
    carencia_dias: null, prazo_primeiro_repasse_dias: null,
}

describe('montarGestoraPlanos', () => {
    it('monta o plano vigente com taxa de gestão, desconto, dia de repasse e dia de corte', () => {
        const md = montarGestoraPlanos([planoAtivo])
        expect(md).toContain('# Gestora: planos vigentes')
        expect(md).toContain('## Plano Usina - Recorrencia Corretor')
        expect(md).toContain('Taxa de gestão: 12%')
        expect(md).toContain('Desconto do assinante: 15%')
        expect(md).toContain('Repasse ao dono: todo dia 10')
        expect(md).toContain('Dia de corte: dia 5 (fechamento da apuração das faturas pagas pelo assinante que entram no repasse do dia 10)')
    })

    it('campos novos vazios saem como a confirmar e não inventam número', () => {
        const md = montarGestoraPlanos([planoAtivo])
        expect(md).toContain('Custo de setup: existe, mas o valor ainda não está definido; o especialista confirma')
        expect(md).toContain('Carência: ainda não definida; o especialista confirma')
        expect(md).toContain('Prazo até o primeiro repasse: ainda não definido; o especialista confirma')
    })

    it('com os campos novos preenchidos, cita setup (com a base), carência e prazo', () => {
        const md = montarGestoraPlanos([{
            ...planoAtivo, setup_pct: 3.5, setup_base: 'o valor do projeto', carencia_dias: 60, prazo_primeiro_repasse_dias: 90,
        }])
        expect(md).toContain('Custo de setup: 3,5% sobre o valor do projeto')
        expect(md).toContain('Carência: 60 dias')
        expect(md).toContain('Prazo até o primeiro repasse: 90 dias')
    })

    it('setup em percentual sem a base de cálculo não é citado como número', () => {
        const md = montarGestoraPlanos([{ ...planoAtivo, setup_pct: 3, setup_base: null }])
        expect(md).not.toContain('3%')
        expect(md).toContain('Custo de setup: existe, mas o valor ainda não está definido')
    })

    it('regra de uso: só cita taxa e desconto se perguntarem, com a ressalva do especialista', () => {
        const md = montarGestoraPlanos([planoAtivo])
        expect(md).toContain('só cite a taxa de gestão e o desconto se o fornecedor perguntar')
        expect(md).toContain('o especialista confirma')
    })

    it('sem plano ativo devolve o aviso', () => {
        expect(montarGestoraPlanos([])).toContain(SEM_PLANOS_GESTORA)
    })

    it('não carrega campo fora do contrato (taxa de recuperação, retenção, multas)', () => {
        const comLixo = { ...planoAtivo, taxa_recuperacao_pct: 8, retencao_rescisao_pct: 10, multa_atraso_mes_pct: 2 } as PlanoGestora
        const md = montarGestoraPlanos([comLixo])
        expect(md).not.toMatch(/recupera|retenç|multa/i)
        expect(md).not.toContain('8%')
    })
})

describe('FAQ de Construção sob medida (Leo)', () => {
    const pares = lerFaq(FAQ_CONSTRUCAO)

    it('tem perguntas no formato da tela', () => {
        expect(pares.length).toBeGreaterThanOrEqual(9)
    })

    it('só repete números que já estão na base do Investidor e nunca cita valor de obra', () => {
        const permitidos = new Set(['2', '8', '10', '90', '1', '000'])
        const numeros = FAQ_CONSTRUCAO.replace(/B2W/g, '').match(/\d+/g) ?? []
        for (const n of numeros) expect(permitidos.has(n), n).toBe(true)
        expect(FAQ_CONSTRUCAO).not.toMatch(/R\$|kWp|por cento|retorno de/i)
    })

    it('a B2W cuida de tudo e a usina continua sendo do dono', () => {
        const r = pares.find((p) => /pode construir/i.test(p.question))!.answer
        expect(r).toContain('projeto, homologação, obra e conexão')
        expect(r).toContain('continua sendo sua')
    })

    it('destaca experiência, assinantes e gestão desde o início, acompanhamento e custos iniciais', () => {
        const r = pares.find((p) => /vantagens/i.test(p.question))!.answer
        expect(r).toContain('8 anos')
        expect(r).toContain('já nasce com assinantes')
        expect(r).toContain('app do investidor')
        expect(r).toContain('seguro e manutenção')
        expect(r).toContain('contador')
    })

    it('apresenta as duas opções: construir a sua ou comprar uma da B2W em construção', () => {
        const r = pares.find((p) => /construir a minha ou comprar/i.test(p.question))!.answer
        expect(r).toContain('Usinas à venda')
        expect(r).toContain('em construção')
    })

    it('custo da obra é orçamento do consultor e o requisito é ter recursos para a obra', () => {
        expect(pares.find((p) => /quanto custa/i.test(p.question))!.answer).toContain('orçamento depende do projeto')
        const req = pares.find((p) => /preciso ter/i.test(p.question))!.answer
        expect(req).toContain('recursos para a obra')
        expect(req).toContain('caso a caso')
    })

    it('não promete retorno, nem usa palavras proibidas ao Leo', () => {
        expect(FAQ_CONSTRUCAO).not.toMatch(/garantido|risco zero|blindado|100% seguro|rescis|multa|matrícula/i)
    })
})
