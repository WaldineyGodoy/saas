/**
 * Estado de cobrança de uma fatura, do ponto de vista do ASSINANTE.
 *
 * Lê `invoices.status` + `invoices.valor_a_pagar`, nunca `energy_bill_status`
 * nem `valor_concessionaria`: são duas obrigações diferentes na mesma linha, e
 * misturá-las já produziu receita fantasma no razão mais de uma vez.
 *
 * A legenda de quatro cores é regra do dono (03/11/2026): verde pago, amarelo
 * em aberto, azul não faturado, vermelho atrasado. O azul foi dividido a pedido
 * do dono: "pronto para emitir" (azul, valor apurado) e "sem conta" (tracejado,
 * nada a cobrar). O enum `fatura_status` tem
 * nove valores, então três não cabem na legenda e recebem tratamento próprio:
 *
 *   - `cancelado`/`cancelada` → neutro, e FORA do total devido. "Exceto já
 *     pagos" lido ao pé da letra somaria cancelada como dívida; são R$ 2.941,52
 *     na base em 03/11/2026 que ninguém deve.
 *   - `erro` → entra como não faturado: o robô não conseguiu ler a conta, logo
 *     não há valor apurado para cobrar.
 *   - mês sem linha de fatura nenhuma → `sem_registro`, que NÃO é zero. Zero
 *     apurado e ausência de apuração são coisas distintas, e tratá-las igual é
 *     o defeito recorrente deste pipeline.
 */

export const ESTADO = {
    PAGO: 'pago',
    ABERTO: 'aberto',
    PRONTO: 'pronto',
    SEM_CONTA: 'sem_conta',
    ATRASADO: 'atrasado',
    CANCELADO: 'cancelado',
    SEM_REGISTRO: 'sem_registro',
};

const POR_STATUS = {
    pago: ESTADO.PAGO,
    confirmado: ESTADO.PAGO,
    a_vencer: ESTADO.ABERTO,
    ag_emissao_boleto: ESTADO.ABERTO,
    atrasado: ESTADO.ATRASADO,
    sem_faturamento: ESTADO.SEM_CONTA,
    erro: ESTADO.SEM_CONTA,
    cancelado: ESTADO.CANCELADO,
    cancelada: ESTADO.CANCELADO,
};

/** Estado de uma fatura; `null`/ausente vira SEM_REGISTRO. */
export const estadoDaFatura = (invoice) => {
    if (!invoice) return ESTADO.SEM_REGISTRO;
    const status = String(invoice.status || '').trim();
    const estado = POR_STATUS[status] || ESTADO.SEM_CONTA;

    // `sem_faturamento` guarda dois estados com o mesmo rotulo: conta apurada
    // esperando boleto (valor maior que zero) e conta que a concessionaria nao
    // postou (valor zero). `erro` nunca vira PRONTO: a leitura falhou, entao
    // qualquer valor na linha nao e confiavel.
    if (status === 'sem_faturamento' && (Number(invoice.valor_a_pagar) || 0) > 0) {
        return ESTADO.PRONTO;
    }
    return estado;
};

/** Os três estados que compõem o total devido. Pago e cancelado ficam fora. */
const ESTADOS_DEVIDOS = new Set([ESTADO.ABERTO, ESTADO.ATRASADO, ESTADO.PRONTO, ESTADO.SEM_CONTA]);

export const contaNoDevido = (estado) => ESTADOS_DEVIDOS.has(estado);

/**
 * Soma o devido de uma lista de faturas.
 *
 * `Number(...) || 0` e não `coalesce`: o default da coluna é 0 e o valor pode
 * vir como string do PostgREST.
 */
export const somarDevido = (invoices) =>
    (invoices || []).reduce((acc, inv) => {
        if (!contaNoDevido(estadoDaFatura(inv))) return acc;
        return acc + (Number(inv.valor_a_pagar) || 0);
    }, 0);

export const ROTULO_ESTADO = {
    [ESTADO.PAGO]: 'Pago',
    [ESTADO.ABERTO]: 'Em aberto',
    [ESTADO.PRONTO]: 'Pronto para emitir',
    [ESTADO.SEM_CONTA]: 'Sem conta',
    [ESTADO.ATRASADO]: 'Atrasado',
    [ESTADO.CANCELADO]: 'Cancelado',
    [ESTADO.SEM_REGISTRO]: 'Sem registro',
};

/**
 * Tinta de fundo e tinta de texto por estado.
 *
 * Só fundo e texto: borda colorida de um lado só em caixa arredondada é o
 * clichê que o detector de design acusa, e o segundo canal para quem não
 * distingue verde de vermelho é a marca desenhada em `MarcaEstado`, não a cor.
 */
export const PINTURA_ESTADO = {
    [ESTADO.PAGO]: { fundo: 'var(--color-success-bg)', tinta: '#065f46' },
    [ESTADO.ABERTO]: { fundo: 'var(--color-warning-bg)', tinta: '#92400e' },
    [ESTADO.PRONTO]: { fundo: '#dbeafe', tinta: '#1e40af' },
    // Tracejado e o segundo canal: sem conta nao tem valor a cobrar, e nao pode
    // parecer o azul de quem esta pronto para emitir.
    [ESTADO.SEM_CONTA]: { fundo: 'transparent', tinta: '#4b5563', tracejado: true },
    [ESTADO.ATRASADO]: { fundo: 'var(--color-error-bg)', tinta: '#991b1b' },
    [ESTADO.CANCELADO]: { fundo: '#f3f4f6', tinta: '#4b5563' },
    [ESTADO.SEM_REGISTRO]: { fundo: 'transparent', tinta: '#9ca3af' },
};

/**
 * Doze meses de referência terminando no mês corrente.
 *
 * O mês corrente é a PENÚLTIMA coluna da tabela — a última é o somatório — e a
 * coluna mais à esquerda é a mais antiga.
 */
export const dozeMeses = (hoje = new Date()) => {
    const meses = [];
    for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        meses.push({
            chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            rotulo: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`,
            atual: i === 0,
        });
    }
    return meses;
};

/** Chave de mês de um `mes_referencia` do banco (date ou 'YYYY-MM-DD'). */
export const chaveDoMes = (mesReferencia) =>
    mesReferencia ? String(mesReferencia).slice(0, 7) : null;

/**
 * Casa o termo de busca com uma UC.
 *
 * Por dígitos, e também contra `numero_uc_anterior`: a renumeração da ANEEL de
 * 2026 trocou o número de todas as UCs, e quem procura ainda tem o antigo na
 * mão. Buscar "7030003955" precisa achar a UC que hoje é 49706003220.
 */
export const ucCasaBusca = (uc, termo) => {
    const alvo = String(termo || '').replace(/\D/g, '');
    if (!alvo) return true;
    const atual = String(uc?.numero_uc || '').replace(/\D/g, '');
    const anterior = String(uc?.numero_uc_anterior || '').replace(/\D/g, '');
    return atual.includes(alvo) || (anterior !== '' && anterior.includes(alvo));
};

export const moeda = (valor) =>
    (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const moedaCurta = (valor) =>
    (Number(valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
