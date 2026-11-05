/**
 * Condições comerciais do contrato de Gestão de Créditos
 * (`suppliers.contract_terms`): listas de campos e conversão para o banco.
 * Fora do componente para o PowerPlantModal gravá-las no Salvar da usina.
 */
import { paraNumero } from './contratoBase';

/**
 * Condições comerciais do contrato de gestão.
 *
 * A validação de envio e o formulário usam a mesma lista: duas cópias é
 * como um campo novo entra na tela sem entrar na checagem.
 */
export const CAMPOS_CONDICOES = [
    { key: 'desconto', label: 'Desconto ao consumidor (%)' },
    { key: 'percentualRecorrente', label: 'Remuneração recorrente (%)' },
    { key: 'taxaAdmin', label: 'Taxa de administração (R$)' },
    { key: 'taxaRecuperacao', label: 'Taxa de recuperação (%)' },
    { key: 'diaCorte', label: 'Dia de corte' },
    { key: 'diaRepasse', label: 'Dia do repasse' },
    { key: 'prazoTransferencia', label: 'Prazo de transferência (dias)' },
    { key: 'prazoHonorarios', label: 'Prazo de honorários (dias)' }
];

/**
 * Fidelidade e setup do contrato de gestão (05/11/2026).
 *
 * Opcionais, fora de CAMPOS_CONDICOES de propósito: em branco quer dizer
 * "sem fidelidade" / "sem setup", e não pode barrar o envio como barram as
 * condições obrigatórias. Ficam gravados em `suppliers.contract_terms`; a
 * forma como entram na minuta é decidida no gerador (contratoFornecedor.js).
 *
 * Faturas retidas: quantas faturas pagas no início por cada assinante não
 * geram repasse ao fornecedor — o valor vai à Associação para pagar a
 * comissão dos corretores de energia. Contagem por UC: o gatilho de fatura
 * paga (migração 20261105a) manda a parte do fornecedor das N primeiras
 * faturas pagas de cada UC à conta 2.1.7, e o relatório da usina desconta.
 */
export const CAMPOS_FIDELIDADE_SETUP = [
    { key: 'prazoFidelidadeMeses', label: 'Prazo de fidelidade (meses)', vazio: 'sem fidelidade' },
    { key: 'valorSetup', label: 'Setup (R$)', vazio: 'sem setup' },
    {
        key: 'faturasRetidas', label: 'Faturas retidas', vazio: 'nenhuma',
        dica: 'Faturas pagas no início por cada assinante sem repasse ao fornecedor: vão à Associação para a comissão dos corretores de energia.'
    }
];

/**
 * Condições da tela no formato que vai para o banco.
 *
 * Os campos são texto para aceitar a vírgula, então "17,5" precisa virar
 * 17.5 antes de gravar. Campo ilegível ou em branco não é gravado: o
 * gerador cai no padrão (ou em "sem fidelidade" / "sem setup").
 */
export const condicoesGestaoParaGravar = (opts) => {
    const gravar = { foro: opts.foro };
    for (const campo of [...CAMPOS_CONDICOES, ...CAMPOS_FIDELIDADE_SETUP]) {
        const n = paraNumero(opts[campo.key]);
        if (Number.isFinite(n)) gravar[campo.key] = n;
    }
    // A minuta editada à mão não está em CAMPOS_CONDICOES e seria apagada
    // por quem reescreve `contract_terms` inteiro.
    if (opts.minutas && Object.keys(opts.minutas).length) gravar.minutas = opts.minutas;
    return gravar;
};

/**
 * `suppliers.contract_terms` com as condições da tela por cima do que já
 * está gravado.
 *
 * Usado pelo Salvar da usina. Chave que esta tela não conhece fica como
 * está; campo desta tela que foi esvaziado sai do jsonb, senão "apagar a
 * fidelidade" não apagaria nada. A minuta editada à mão é a do banco: este
 * painel a grava na hora em que é gerada ou descartada.
 */
export const mesclarCondicoesGestao = (atual, opts) => {
    const termos = { ...(atual || {}) };
    delete termos.foro;
    for (const campo of [...CAMPOS_CONDICOES, ...CAMPOS_FIDELIDADE_SETUP]) delete termos[campo.key];
    // eslint-disable-next-line no-unused-vars
    const { minutas, ...condicoes } = condicoesGestaoParaGravar(opts);
    return { ...termos, ...condicoes };
};
