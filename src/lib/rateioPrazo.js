// Alerta de prazo da solicitação de lista de rateio na distribuidora
// (calculado por fn_rateio_acompanhar, pg_cron diário).
export const ALERTA_PRAZO = {
    dentro_do_prazo: { label: 'No prazo', color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
    atencao: { label: 'Atenção', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
    critico: { label: 'Prazo crítico', color: '#c2410c', bg: '#fff7ed', border: '#fdba74' },
    vencido: { label: 'Prazo vencido', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' }
};
