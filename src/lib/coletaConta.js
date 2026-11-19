/**
 * Estado da COLETA da conta de energia de uma UC num mês (Calendário de Leituras).
 *
 * Responde uma pergunta só: a conta deste ciclo chegou no prazo? Não fala de
 * pagamento -- paga, atrasada, contestada e a vencer são da conta a pagar e
 * vivem nas abas Lista e Kanban (decisão do dono em 19/11/2026).
 *
 *   recebida  conta baixada com PDF e lida
 *   no_prazo  leitura futura, ou até PRAZO_PUBLICACAO_DIAS depois dela
 *   portal    prazo vencido e a concessionária não publicou (ou publicou sem PDF)
 *   falha     o robô não buscou, não achou a UC ou não leu o PDF
 *   cadastro  falta dado para o robô sequer tentar (dia de leitura, titular, credencial)
 *   fora      a UC não existia, ainda não era deste titular ou já estava encerrada
 *
 * Antes, a tela mostrava toda UC criada até o mês e pintava "pendente" quem
 * nunca poderia ter conta: a Harmony (criada em 15/10, TT em 19/10, leitura
 * dia 1) aparecia pendente em 01/10.
 */

// A Cosern tem até 15 dias para publicar a conta depois da leitura.
export const PRAZO_PUBLICACAO_DIAS = 15;

// Mesma lista de STATUS_ENCERRADOS do robô (scraper/scraper.js).
const STATUS_ENCERRADOS = ['cancelado', 'cancelado_inadimplente', 'desconectado', 'desligado_por_tt'];

export const ESTADOS_COLETA = [
    { key: 'recebida', label: 'Recebida',            descricao: 'Conta baixada e lida',                       color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
    { key: 'no_prazo', label: 'No prazo',            descricao: `Até ${PRAZO_PUBLICACAO_DIAS} dias após a leitura`, color: '#475569', bg: '#f8fafc', border: '#e2e8f0' },
    { key: 'portal',   label: 'Atrasada no portal',  descricao: 'Prazo vencido, concessionária não publicou', color: '#92400e', bg: '#fffbeb', border: '#fcd34d' },
    { key: 'falha',    label: 'Falha do robô',       descricao: 'Robô não buscou, não achou ou não leu',      color: '#b91c1c', bg: '#fef2f2', border: '#fca5a5' },
    { key: 'cadastro', label: 'Cadastro',            descricao: 'Falta dado para o robô tentar',             color: '#5b21b6', bg: '#f5f3ff', border: '#c4b5fd' },
];

export const ESTADO_FORA = { key: 'fora', label: 'Fora do escopo', color: '#94a3b8', bg: '#ffffff', border: '#e2e8f0' };

export const ESTADOS_PENDENCIA = ['portal', 'falha', 'cadastro'];

export const configEstado = (key) => ESTADOS_COLETA.find(e => e.key === key) || ESTADO_FORA;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Data local em ISO (AAAA-MM-DD), sem passar por UTC. */
export const isoLocal = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const soData = (v) => (v ? String(v).slice(0, 10) : null);

const diasEntre = (isoA, isoB) => {
    const [a1, a2, a3] = isoA.split('-').map(Number);
    const [b1, b2, b3] = isoB.split('-').map(Number);
    return Math.round((Date.UTC(b1, b2 - 1, b3) - Date.UTC(a1, a2 - 1, a3)) / DIA_MS);
};

const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

/** Dia de leitura do mês, limitado ao último dia (leitura 31 em novembro = 30/11). */
export const diaDeLeituraNoMes = (diaLeitura, ano, mes) => {
    if (!diaLeitura) return null;
    const ultimo = new Date(ano, mes, 0).getDate();
    return Math.min(Number(diaLeitura), ultimo);
};

/** Início e fim do período em que a UC deve ter conta no CRM. */
export const escopoDaUc = (uc) => {
    const candidatosInicio = [soData(uc.created_at), soData(uc.data_troca_titularidade)].filter(Boolean).sort();
    const inicio = candidatosInicio[candidatosInicio.length - 1] || null;
    const encerrada = STATUS_ENCERRADOS.includes(uc.status);
    // Depois do desligamento nenhuma conta é ESPERADA. O acompanhamento do robô
    // (acompanhar_conta_ate) existe para pegar a conta final se ela vier; se
    // vier, aparece como recebida, mas a falta dela não é pendência.
    const fim = encerrada ? (soData(uc.data_desligamento) || soData(uc.acompanhar_conta_ate) || null) : null;
    return { inicio, fim, encerrada };
};

// Filtra pela conta de energia, nunca pela fatura do assinante: em UG a fatura
// do assinante é sempre `cancelado` e a conta da concessionária existe.
const contaDoMes = (invoicesDoMes) => {
    const validas = (invoicesDoMes || []).filter(i => !['cancelado', 'cancelada'].includes(String(i.energy_bill_status || '').trim().toLowerCase()));
    return validas.find(i => i.concessionaria_pdf_url) || validas[0] || null;
};

const motivoDoRobo = (erro) => {
    const e = String(erro || '');
    if (/não encontrada|nao encontrada/i.test(e)) return 'UC não achada no portal';
    if (/autentica|login|senha/i.test(e)) return 'Login no portal falhou';
    if (/inst[aá]vel|inesperado/i.test(e)) return 'Portal instável';
    return 'Erro do robô';
};

/**
 * @param uc        linha de consumer_units (com status, dia_leitura, created_at,
 *                  data_troca_titularidade, data_desligamento, acompanhar_conta_ate,
 *                  titular_fatura_id, subscriber_id, last_scraping_*)
 * @param ano, mes  ciclo (mês 1-12)
 * @param invoicesDoMes faturas da UC com mes_referencia neste mês
 * @param hojeIso   AAAA-MM-DD
 * @returns { estado, tag, detalhe, leituraIso, invoice }
 */
export const estadoDaColeta = (uc, ano, mes, invoicesDoMes, hojeIso) => {
    const dia = diaDeLeituraNoMes(uc.dia_leitura, ano, mes);
    const leituraPrevista = dia ? `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}` : null;
    const inv = contaDoMes(invoicesDoMes);
    const base = { leituraIso: soData(inv?.data_leitura) || leituraPrevista, invoice: inv };

    if (inv) {
        const erroLeitura = String(inv.reading_error || '');
        if (inv.concessionaria_pdf_url) {
            if (inv.reading_status === 'error') {
                return { ...base, estado: 'falha', tag: 'PDF não lido', detalhe: erroLeitura || 'Falha na leitura do PDF' };
            }
            const lida = soData(inv.data_leitura);
            return { ...base, estado: 'recebida', tag: lida ? `Lida ${ddmm(lida)}` : 'Recebida', detalhe: null };
        }
        if (/conta m[ií]nima/i.test(erroLeitura)) {
            return { ...base, estado: 'recebida', tag: 'Conta mínima', detalhe: 'A concessionária não emite PDF; o saldo vai para o mês seguinte' };
        }
        if (inv.energy_bill_status === 'parcelada') {
            return { ...base, estado: 'portal', tag: 'Parcelada sem PDF', detalhe: 'O portal lista a conta parcelada sem opção de download' };
        }
        if (/falha no download/i.test(erroLeitura)) {
            return { ...base, estado: 'falha', tag: 'Download falhou', detalhe: erroLeitura };
        }
        // Linha sem PDF e sem motivo conhecido (placeholder ou criada à mão):
        // não prova que a conta chegou -- segue a regra de quem não tem conta.
    }

    const { inicio, fim, encerrada } = escopoDaUc(uc);
    if (leituraPrevista && inicio && leituraPrevista < inicio) {
        const porTt = soData(uc.data_troca_titularidade) === inicio;
        return { ...base, estado: 'fora', tag: porTt ? `Titular desde ${ddmm(inicio)}` : `Cadastrada em ${ddmm(inicio)}`, detalhe: null };
    }
    if (encerrada && (!fim || (leituraPrevista && leituraPrevista > fim))) {
        const quando = soData(uc.data_desligamento) ? ` em ${ddmm(soData(uc.data_desligamento))}` : '';
        return { ...base, estado: 'fora', tag: `${uc.status === 'desligado_por_tt' ? 'Desligada por TT' : 'Encerrada'}${quando}`, detalhe: null };
    }

    if (!leituraPrevista) {
        return { ...base, estado: 'cadastro', tag: 'Sem dia de leitura', detalhe: 'Cadastre o dia de leitura da UC' };
    }
    if (!uc.titular_fatura_id && !uc.subscriber_id) {
        return { ...base, estado: 'cadastro', tag: 'Sem titular', detalhe: 'Sem titular da conta não há login no portal' };
    }
    if (/credenc/i.test(String(uc.last_scraping_error || ''))) {
        return { ...base, estado: 'cadastro', tag: 'Sem credencial', detalhe: uc.last_scraping_error };
    }

    const dias = diasEntre(leituraPrevista, hojeIso);
    if (dias < 0) {
        return { ...base, estado: 'no_prazo', tag: `Leitura ${ddmm(leituraPrevista)}`, detalhe: null };
    }
    if (dias <= PRAZO_PUBLICACAO_DIAS) {
        return { ...base, estado: 'no_prazo', tag: `D+${dias} de ${PRAZO_PUBLICACAO_DIAS}`, detalhe: null };
    }

    const ultimaBusca = soData(uc.last_scraping_at);
    if (!ultimaBusca || ultimaBusca < leituraPrevista) {
        return { ...base, estado: 'falha', tag: `Robô não buscou · D+${dias}`, detalhe: ultimaBusca ? `Última busca em ${ddmm(ultimaBusca)}` : 'O robô nunca buscou esta UC' };
    }
    if (uc.last_scraping_status === 'error') {
        return { ...base, estado: 'falha', tag: `${motivoDoRobo(uc.last_scraping_error)} · D+${dias}`, detalhe: uc.last_scraping_error };
    }
    return { ...base, estado: 'portal', tag: `Não publicada · D+${dias}`, detalhe: `Última busca em ${ddmm(ultimaBusca)}` };
};
