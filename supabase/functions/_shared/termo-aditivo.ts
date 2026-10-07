/**
 * Texto do Termo Aditivo de inclusao de UC (assinante existente, pedido pelo app).
 *
 * Rascunho aprovado pelo dono como base em 05/10/2026, sujeito a revisao
 * juridica antes do primeiro envio real (docs/plano-termo-aditivo.md).
 * Modulo puro: a Edge Function aditivo-nova-uc monta o PDF com ele, e os
 * testes (tests/termo-aditivo.test.js) conferem o texto sem Deno.
 */

export type Assinante = {
    name?: string | null
    cpf_cnpj?: string | null
    representante_nome?: string | null
    representante_cpf?: string | null
    rua?: string | null
    numero?: string | null
    complemento?: string | null
    bairro?: string | null
    cidade?: string | null
    uf?: string | null
    cep?: string | null
}

export type UcAditivo = {
    numeroUc: string
    titular?: string | null
    concessionaria?: string | null
    endereco?: { completo?: string | null } | null
}

export type Plano = { nome?: string | null; desconto_assinante?: number | string | null }

export const TITULO_ADITIVO = 'TERMO ADITIVO AO TERMO DE INGRESSO E ADESÃO — INCLUSÃO DE UNIDADE CONSUMIDORA'
export const TITULO_PROCURACAO = 'PROCURAÇÃO PARA LIBERAÇÃO DE ACESSO'

const ASSOCIACAO = 'ASSOCIAÇÃO DE USINAS B2W ENERGIA, associação de direito privado, CNPJ 64.561.352/0001-07, com sede na Praça Apolinário Barbosa, 86 – Centro, Caraí/MG, CEP 39800-000, neste ato representada na forma do seu Estatuto Social por seu presidente ("ASSOCIAÇÃO")'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const ou = (v: unknown, alt = '_______________') => String(v ?? '').trim() || alt

export const enderecoAssinante = (s: Assinante) => {
    const linha1 = [s.rua, s.numero].map((v) => String(v ?? '').trim()).filter(Boolean).join(', ')
    const cidadeUf = [s.cidade, s.uf].map((v) => String(v ?? '').trim()).filter(Boolean).join('/')
    return [linha1, s.complemento, s.bairro, cidadeUf, s.cep ? `CEP ${s.cep}` : '']
        .map((v) => String(v ?? '').trim()).filter(Boolean).join(', ')
}

/** 20 -> "20"; 17.5 -> "17,5". */
export const percentualBr = (v: number | string | null | undefined) => {
    const n = Number(String(v ?? '').replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return ''
    return String(Math.round(n * 100) / 100).replace('.', ',')
}

export const dataPorExtenso = (d: Date) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`

export const qualificacaoAssinante = (s: Assinante) => {
    const doc = String(s.cpf_cnpj ?? '').replace(/\D/g, '')
    const endereco = ou(enderecoAssinante(s))
    if (doc.length === 14 && s.representante_nome) {
        return `${ou(s.name)}, pessoa jurídica inscrita no CNPJ ${ou(s.cpf_cnpj)}, com sede à ${endereco}, neste ato representada por ${s.representante_nome}, CPF ${ou(s.representante_cpf)} ("ASSOCIADO")`
    }
    return `${ou(s.name)}, CPF/CNPJ ${ou(s.cpf_cnpj)}, residente e domiciliado à ${endereco} ("ASSOCIADO")`
}

/** Corpo do termo: lista de paragrafos (o titulo vai a parte). */
export const paragrafosTermoAditivo = (
    { assinante, uc, plano, data = new Date() }: { assinante: Assinante; uc: UcAditivo; plano: Plano; data?: Date },
): string[] => {
    const dist = ou(uc.concessionaria, 'Neoenergia Cosern')
    const desconto = percentualBr(plano.desconto_assinante)
    return [
        `(I). ASSOCIAÇÃO: ${ASSOCIACAO};`,
        `(II). ASSOCIADO: ${qualificacaoAssinante(assinante)}.`,
        'As partes, que já mantêm entre si Termo de Ingresso e Adesão à Associação de Geração Compartilhada, firmam o presente Termo Aditivo, que se rege pelas cláusulas a seguir.',
        'CLÁUSULA 1 – DO OBJETO',
        `Fica incluída no Termo de Ingresso e Adesão firmado pelo ASSOCIADO a unidade consumidora nº ${ou(uc.numeroUc)}, cujo titular perante a distribuidora é ${ou(uc.titular)}, localizada em ${ou(uc.endereco?.completo)}, atendida pela distribuidora ${dist}.`,
        'CLÁUSULA 2 – DAS CONDIÇÕES',
        'Aplicam-se à unidade consumidora incluída todas as cláusulas do Termo de Ingresso e Adesão, inclusive as de elegibilidade, contribuição associativa e desconto, faturamento, titularidade e representação operacional.',
        'CLÁUSULA 3 – DO PLANO E DO DESCONTO',
        desconto
            ? `Para a unidade consumidora incluída vale o plano ${ou(plano.nome)}, com desconto de ${desconto}% sobre o valor cheio da contribuição, condicionado ao pagamento até a data de vencimento, nos termos do Termo de Ingresso e Adesão.`
            : `Para a unidade consumidora incluída vale o plano ${ou(plano.nome)}, nas condições de desconto previstas no Termo de Ingresso e Adesão.`,
        'CLÁUSULA 4 – DO INÍCIO DA COMPENSAÇÃO',
        'A compensação de créditos na unidade consumidora incluída somente se iniciará após a análise de elegibilidade e o aceite da distribuidora, nos termos do Termo de Ingresso e Adesão.',
        'CLÁUSULA 5 – DA RATIFICAÇÃO',
        'Permanecem inalteradas e em pleno vigor as demais cláusulas do Termo de Ingresso e Adesão, das quais este Termo Aditivo passa a fazer parte integrante.',
        'CLÁUSULA 6 – DA ASSINATURA ELETRÔNICA',
        'As partes reconhecem a validade da assinatura eletrônica deste instrumento, nos termos da legislação vigente.',
        `${ou(assinante.cidade, 'Natal')}/${ou(assinante.uf, 'RN')}, ${dataPorExtenso(data)}.`,
    ]
}

export const paragrafosProcuracao = ({ assinante, uc }: { assinante: Assinante; uc: UcAditivo }): string[] => [
    `OUTORGANTE: ${ou(assinante.name)}, inscrito no CPF/CNPJ sob o nº ${ou(assinante.cpf_cnpj)}, residente e domiciliado à ${ou(enderecoAssinante(assinante))}, doravante denominado "ASSOCIADO".`,
    'OUTORGADO: ASSOCIAÇÃO DE USINAS B2W ENERGIA, inscrita no CNPJ sob nº 64.561.352/0001-07, com sede na Praça Apolinário Barbosa, 86 – Centro, Caraí/MG, CEP 39800-000, doravante denominada "ASSOCIAÇÃO".',
    `PODERES: Pelo presente instrumento, o OUTORGANTE nomeia o OUTORGADO seu procurador para o fim especial de representá-lo junto à concessionária ${ou(uc.concessionaria, 'Neoenergia Cosern')}, podendo solicitar acesso a dados de consumo, histórico de faturamento e realizar o cadastro da Unidade Consumidora no Sistema de Compensação de Energia Elétrica (Geração Distribuída).`,
    `UNIDADE CONSUMIDORA: nº ${ou(uc.numeroUc)} — ${ou(uc.endereco?.completo)}.`,
]

export const nomeArquivoAditivo = (assinante: Assinante, numeroUc: string) =>
    `Termo_Aditivo_UC_${String(numeroUc).replace(/\W+/g, '')}_${String(assinante.name ?? 'Assinante').trim().replace(/\s+/g, '_')}`.slice(0, 120)
