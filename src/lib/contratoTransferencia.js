import { dataPorExtenso, gerarPdfBase64, paginarTexto, qualificaParte, rotuloDocumento } from './contratoBase';

/**
 * Termo de autorização para transferência de titularidade de UC.
 *
 * Em autoconsumo remoto o titular da conta na distribuidora tem de ser o
 * mesmo da usina, então a UC do assinante costuma estar em nome da
 * Associação (ou de quem responde pela usina), não do assinante. Quando o
 * assinante sai e leva a UC para o próprio nome, é o titular atual quem
 * precisa autorizar — e o assinante precisa ficar ciente de duas coisas que
 * não aparecem na conta da distribuidora: a UC para de receber créditos, e
 * o que foi compensado até a data da transferência continua devido.
 *
 * O titular assina; o assinante reconhece como ciente (RECOGNIZE, na
 * Autentique). Cada um recebe o próprio link.
 */

export const TITULO_TRANSFERENCIA = 'Termo de Autorização para Transferência de Titularidade de Unidade Consumidora';

const ou = (valor, alternativa = '_______________') => String(valor ?? '').trim() || alternativa;

/** Endereço de assinante: colunas soltas primeiro, `address` como reserva. */
const enderecoPessoa = (p) => {
    const base = p?.address || {};
    const a = {
        rua: p?.rua || base.rua || base.logradouro,
        numero: p?.numero || base.numero,
        complemento: p?.complemento || base.complemento,
        bairro: p?.bairro || base.bairro,
        cidade: p?.cidade || base.cidade || base.municipio,
        uf: p?.uf || base.uf,
        cep: p?.cep || base.cep
    };
    return formatarEndereco(a);
};

const formatarEndereco = (a = {}) => {
    const partes = [
        [a.rua || a.logradouro, a.numero].filter(Boolean).join(', '),
        a.complemento,
        a.bairro,
        [a.cidade || a.municipio, a.uf].filter(Boolean).join('/'),
        a.cep ? `CEP ${a.cep}` : ''
    ].filter(Boolean);
    return partes.join(' - ') || '_______________';
};

const cidadeUf = (a = {}) => {
    const cidade = a.cidade || a.municipio;
    return cidade && a.uf ? `${cidade}/${a.uf}` : 'Natal/RN';
};

/**
 * @param uc         linha de `consumer_units`
 * @param titular    assinante apontado por `titular_fatura_id` — o titular da conta
 * @param assinante  assinante apontado por `subscriber_id`
 */
export const montarTermoTransferencia = ({ uc, titular, assinante } = {}) => {
    const enderecoUc = formatarEndereco(uc?.address || {});
    const local = cidadeUf(uc?.address || {});
    const distribuidora = ou(uc?.concessionaria, 'distribuidora local');

    return `TERMO DE AUTORIZAÇÃO PARA TRANSFERÊNCIA DE TITULARIDADE DE UNIDADE CONSUMIDORA

(I). TITULAR: ${qualificaParte({ nome: titular?.name, doc: titular?.cpf_cnpj, endereco: enderecoPessoa(titular) })}, atual titular, perante a DISTRIBUIDORA, da unidade consumidora descrita na Cláusula 1 ("TITULAR");

(II). ASSINANTE: ${qualificaParte({ nome: assinante?.name, doc: assinante?.cpf_cnpj, endereco: enderecoPessoa(assinante) })} ("ASSINANTE").

CLÁUSULA 1 – DA UNIDADE CONSUMIDORA
1.1. Este Termo refere-se à unidade consumidora nº ${ou(uc?.numero_uc)}, atendida pela ${distribuidora} ("DISTRIBUIDORA"), instalada em ${enderecoUc} ("UC").

CLÁUSULA 2 – DA AUTORIZAÇÃO
2.1. O TITULAR autoriza o ASSINANTE a requerer, perante a DISTRIBUIDORA, a transferência da titularidade da UC para o nome do ASSINANTE, podendo apresentar este Termo e praticar os atos necessários à conclusão do pedido.
2.2. Esta autorização não confere ao ASSINANTE poderes para contrair obrigações em nome do TITULAR.

CLÁUSULA 3 – DA SAÍDA DO SISTEMA DE COMPENSAÇÃO
3.1. Concluída a transferência de titularidade na DISTRIBUIDORA, a UC deixa de receber créditos de energia e deixa de integrar o sistema de compensação de energia elétrica ao qual estava vinculada.
3.2. Considera-se data efetiva da transferência aquela em que a DISTRIBUIDORA registrar a conclusão do pedido.

CLÁUSULA 4 – DOS VALORES REMANESCENTES
4.1. Os créditos de energia compensados na UC e os saldos acumulados até a data efetiva da transferência, inclusive os apurados retroativamente em faturas emitidas depois dela, permanecem devidos e poderão ser cobrados do ASSINANTE, nas condições do contrato de adesão vigente.
4.2. A partir da data efetiva da transferência, as contas de energia da UC passam a ser de responsabilidade exclusiva do ASSINANTE perante a DISTRIBUIDORA.

CLÁUSULA 5 – DA CIÊNCIA DO ASSINANTE
5.1. O ASSINANTE declara-se ciente das condições deste Termo, em especial de que, após a transferência, a UC não receberá créditos de energia, e de que os valores da Cláusula 4 poderão ser cobrados mesmo depois de concluída a transferência.

CLÁUSULA 6 – DAS DISPOSIÇÕES GERAIS
6.1. O tratamento de dados pessoais observará a Lei nº 13.709/2018, restrito às finalidades deste Termo.
6.2. As partes reconhecem a validade da assinatura eletrônica deste Termo, nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020.
6.3. Fica eleito o foro da comarca de ${local}, com renúncia a qualquer outro, por mais privilegiado que seja.

${local}, ${dataPorExtenso()}.

________________________________________
${ou(titular?.name)}
${rotuloDocumento(titular?.cpf_cnpj)} ${ou(titular?.cpf_cnpj)} — Titular

________________________________________
${ou(assinante?.name)}
${rotuloDocumento(assinante?.cpf_cnpj)} ${ou(assinante?.cpf_cnpj)} — Assinante, ciente`;
};

export const dividirEmPaginasTransferencia = (texto) => paginarTexto(texto);

export const gerarPdfTransferenciaBase64 = () => gerarPdfBase64('[data-contract="transferencia"]');
