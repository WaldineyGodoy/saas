import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { AlertTriangle, Clock, CheckCircle, Info } from 'lucide-react';
import { ALERTA_PRAZO } from '../lib/rateioPrazo';

// Acompanhamento do pedido de alteração da lista de compensação na
// distribuidora: prazo (15 dias), alerta calculado pelo cron diário
// (fn_rateio_acompanhar), última leitura do portal, motivo da reprovação e o
// histórico de eventos do card.

const PORTAL = {
    em_analise: 'Em análise na distribuidora',
    aprovada: 'Aprovada pela distribuidora',
    reprovada: 'Reprovada pela distribuidora',
    cancelada_pela_distribuidora: 'Cancelada pela distribuidora'
};

const EVENTOS = {
    criada: 'Card criado',
    retrato_renovado: 'Retrato das UCs renovado',
    protocolo_registrado: 'Protocolo registrado',
    alerta_prazo: 'Alerta de prazo',
    portal_em_analise: 'Portal: em análise',
    portal_aprovada: 'Portal: aprovada',
    portal_reprovada: 'Portal: reprovada',
    portal_cancelada_pela_distribuidora: 'Portal: cancelada pela distribuidora',
    concluida: 'Concluída — UCs ativadas',
    reprovada: 'Reprovada'
};

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDia = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—');

function descreverEvento(ev) {
    const d = ev.detalhe || {};
    const base = EVENTOS[ev.evento] || ev.evento;
    if (ev.evento === 'alerta_prazo') return `${base}: ${ALERTA_PRAZO[d.alerta]?.label || d.alerta} (${d.dias} dia(s) desde o protocolo)`;
    if (ev.evento === 'protocolo_registrado') return `${base} ${d.protocolo || ''} — prazo até ${fmtDia(d.prazo_limite)}`;
    if (ev.evento === 'concluida') return `${base}: ${d.ucs_ativadas ?? 0}${d.falhas?.length ? `, ${d.falhas.length} falha(s)` : ''}`;
    if (ev.evento === 'reprovada' && d.motivo) return `${base}: ${d.motivo}`;
    if (d.origem === 'tt' && (ev.evento === 'criada' || ev.evento === 'retrato_renovado')) return `${base} (troca de titularidade concluída, ${d.qtd_ucs} UC(s))`;
    return base;
}

export default function RateioAcompanhamento({ rateio }) {
    const [eventos, setEventos] = useState([]);
    const [agora] = useState(() => Date.now());

    useEffect(() => {
        let vivo = true;
        supabase.from('rateio_list_eventos')
            .select('id, evento, detalhe, criado_em')
            .eq('rateio_id', rateio.id)
            .order('criado_em', { ascending: false })
            .then(({ data }) => { if (vivo) setEventos(data || []); });
        return () => { vivo = false; };
    }, [rateio.id, rateio.status, rateio.updated_at]);

    const alerta = ALERTA_PRAZO[rateio.alerta_prazo];
    const emAndamento = rateio.status === 'processando';
    const dias = emAndamento && rateio.status_dates?.processando_at
        ? Math.floor((agora - new Date(rateio.status_dates.processando_at).getTime()) / 86400000)
        : null;
    const mostrar = rateio.origem === 'tt' || emAndamento || rateio.motivo_reprovacao || rateio.portal_status || eventos.length > 0;
    if (!mostrar) return null;

    return (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', marginBottom: '1rem', background: '#fff', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Clock size={14} /> Acompanhamento na distribuidora
                </span>
                {rateio.origem === 'tt' && (
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#5b21b6', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '999px', padding: '0.1rem 0.6rem' }}>
                        Gerada por troca de titularidade
                    </span>
                )}
                {emAndamento && alerta && (
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: alerta.color, background: alerta.bg, border: `1px solid ${alerta.border}`, borderRadius: '999px', padding: '0.1rem 0.6rem' }}>
                        {alerta.label}
                    </span>
                )}
            </div>

            {emAndamento && (
                <div style={{ fontSize: '0.82rem', color: '#334155', lineHeight: 1.6 }}>
                    <div><b>Prazo máximo da distribuidora:</b> {fmtDia(rateio.prazo_limite)}{dias != null ? ` — ${dias} dia(s) desde o protocolo` : ''}</div>
                    <div><b>Última leitura do portal:</b> {rateio.portal_status ? `${PORTAL[rateio.portal_status] || rateio.portal_status} (${fmt(rateio.portal_ultima_consulta_em)})` : 'ainda não consultado'}</div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', marginTop: '0.4rem', color: '#64748b', fontSize: '0.76rem' }}>
                        <Info size={13} style={{ minWidth: 13, marginTop: 2 }} />
                        <span>A distribuidora cancela a solicitação se algum dado divergir (número da UC, titular). Nesse caso, marque como Reprovada com o motivo, corrija o cadastro e crie a lista de novo.</span>
                    </div>
                </div>
            )}

            {rateio.status === 'reprovada' && (
                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '0.7rem', fontSize: '0.82rem', color: '#991b1b', display: 'flex', gap: '0.4rem' }}>
                    <AlertTriangle size={15} style={{ minWidth: 15, marginTop: 2 }} />
                    <span><b>Motivo:</b> {rateio.motivo_reprovacao || 'não informado'}. Corrija o cadastro e crie a lista de novo (ou volte este card a Processando se já reenviou).</span>
                </div>
            )}

            {rateio.status === 'concluida' && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.7rem', fontSize: '0.82rem', color: '#166534', display: 'flex', gap: '0.4rem' }}>
                    <CheckCircle size={15} style={{ minWidth: 15, marginTop: 2 }} />
                    <span>Aprovada pela distribuidora. As UCs que aguardavam conexão foram ativadas.</span>
                </div>
            )}

            {eventos.length > 0 && (
                <details>
                    <summary style={{ fontSize: '0.76rem', fontWeight: 600, color: '#64748b', cursor: 'pointer' }}>Histórico ({eventos.length})</summary>
                    <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.76rem', color: '#475569' }}>
                        {eventos.map(ev => (
                            <div key={ev.id}><span style={{ color: '#94a3b8' }}>{fmt(ev.criado_em)}</span>{' · '}{descreverEvento(ev)}</div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}
