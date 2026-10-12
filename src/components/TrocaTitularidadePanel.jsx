import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { ArrowRight, Loader2, RefreshCcw, AlertCircle, CheckCircle, Clock } from 'lucide-react';

// Troca de titularidade (TT) da UC para o titular da UG da usina de
// autoconsumo remoto. O processo vive em uc_transferencias_titularidade e so
// muda por RPC (fn_iniciar_tt, fn_tt_retentar, fn_tt_encerrar, fn_concluir_tt).
// Enquanto a TT nao conclui, a UC fica sem usina_id: o vinculo so nasce em
// fn_concluir_tt, depois que o titular da conta ja e o da UG.

const STATUS_TT = {
    a_iniciar: { label: 'Na fila do robô', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
    em_execucao: { label: 'Robô executando', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
    bloqueada_por_debito: { label: 'Bloqueada por débito', color: '#dc2626', bg: '#fff1f2', border: '#fecaca' },
    protocolada: { label: 'Protocolada', color: '#5b21b6', bg: '#f5f3ff', border: '#ddd6fe' },
    em_analise: { label: 'Em análise na concessionária', color: '#5b21b6', bg: '#f5f3ff', border: '#ddd6fe' },
    concluida: { label: 'Concluída', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
    recusada: { label: 'Recusada', color: '#dc2626', bg: '#fff1f2', border: '#fecaca' },
    cancelada: { label: 'Cancelada', color: '#475569', bg: '#f8fafc', border: '#cbd5e1' },
    erro: { label: 'Erro na execução', color: '#dc2626', bg: '#fff1f2', border: '#fecaca' }
};
const ENCERRADAS = ['concluida', 'recusada', 'cancelada'];

const EVENTOS = {
    iniciada: 'TT iniciada no CRM',
    execucao_iniciada: 'Robô iniciou a execução no portal',
    debito_reportado: 'Débito reportado pela concessionária',
    quitacao_informada: 'Quitação informada — nova tentativa solicitada',
    nova_tentativa: 'Nova tentativa solicitada',
    protocolada: 'Pedido protocolado',
    em_analise: 'Em análise na concessionária',
    erro: 'Erro na execução',
    cancelada: 'TT cancelada',
    recusada: 'TT recusada pela concessionária',
    concluida: 'TT concluída'
};

const label = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' };
const campo = { width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none', background: '#fff' };
const botao = (cor, preenchido = true) => ({
    padding: '0.6rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${cor}`, background: preenchido ? cor : '#fff', color: preenchido ? '#fff' : cor,
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem'
});

const fmtData = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '—');
const fmtMoeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function TrocaTitularidadePanel({ uc, usinas, subscribers, onUcAtualizada }) {
    const { showAlert, showConfirm } = useUI();
    const [tt, setTt] = useState(null);
    const [eventos, setEventos] = useState([]);
    const [ugNumero, setUgNumero] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [agindo, setAgindo] = useState(false);

    // Iniciar
    const [usinaId, setUsinaId] = useState('');
    // Guarda a usina junto: a prévia só vale para a usina escolhida agora.
    const [previaUg, setPreviaUg] = useState(null);

    // Concluir manualmente (a TT foi feita fora do robô, ou o robô ainda não leu)
    const [concluindo, setConcluindo] = useState(false);
    const [numeroNovo, setNumeroNovo] = useState('');
    const [dataConclusao, setDataConclusao] = useState(new Date().toISOString().split('T')[0]);

    const nomeSub = (id) => subscribers.find(s => s.id === id)?.name || '—';
    const nomeUsina = (id) => usinas.find(u => u.id === id)?.name || '—';

    const ucId = uc?.id;
    const carregar = useCallback(async () => {
        if (!ucId) return;
        const { data, error } = await supabase
            .from('uc_transferencias_titularidade')
            .select('*')
            .eq('uc_id', ucId)
            .order('criado_em', { ascending: false })
            .limit(1);
        if (error) {
            // Migração 20261012g ainda não aplicada: o painel some em vez de quebrar a UC.
            setTt(null);
            setCarregando(false);
            return;
        }
        const atual = data?.[0] || null;
        setTt(atual);
        if (atual) {
            const [ev, ug] = await Promise.all([
                supabase.from('uc_transferencias_titularidade_eventos')
                    .select('id, evento, detalhe, criado_em').eq('tt_id', atual.id).order('criado_em', { ascending: false }),
                supabase.from('consumer_units').select('numero_uc').eq('id', atual.ug_id).maybeSingle()
            ]);
            setEventos(ev.data || []);
            setUgNumero(ug.data?.numero_uc || '');
        } else {
            setEventos([]);
        }
        setCarregando(false);
    }, [ucId]);

    // Fora do corpo síncrono do efeito: carregar() grava estado ao terminar.
    useEffect(() => { Promise.resolve().then(carregar); }, [carregar]);

    // Prévia do cessionário: titular da UG da usina escolhida.
    useEffect(() => {
        if (!usinaId) return;
        let vivo = true;
        supabase.from('consumer_units')
            .select('numero_uc, titular_fatura_id')
            .eq('usina_id', usinaId).eq('tipo_unidade', 'geradora').limit(1)
            .then(({ data }) => { if (vivo) setPreviaUg({ usinaId, ...(data?.[0] || { numero_uc: null, titular_fatura_id: null }) }); });
        return () => { vivo = false; };
    }, [usinaId]);

    // Depois de iniciar/concluir/cancelar a UC mudou no banco (status, usina,
    // titular, número). Devolve a linha nova ao modal para o formulário não
    // regravar valores velhos no próximo salvar.
    const atualizarUc = async () => {
        const { data } = await supabase.from('consumer_units').select('*').eq('id', uc.id).maybeSingle();
        if (data && onUcAtualizada) onUcAtualizada(data);
    };

    const rpc = async (nome, args, sucesso) => {
        setAgindo(true);
        const { data, error } = await supabase.rpc(nome, args);
        setAgindo(false);
        if (error) {
            showAlert((error.message || 'Erro') + (error.hint ? ' — ' + error.hint : ''), 'error');
            return { ok: false };
        }
        if (sucesso) showAlert(sucesso, 'success');
        await Promise.all([carregar(), atualizarUc()]);
        return { ok: true, data };
    };

    const iniciar = async () => {
        if (!usinaId) return;
        const ok = await showConfirm(
            `Iniciar a troca de titularidade da UC ${uc.numero_uc} para o titular da UG da usina ${nomeUsina(usinaId)}? A UC passa a Em Transf. de Titularidade e o robô protocola o pedido no portal.`,
            'Iniciar TT'
        );
        if (!ok) return;
        const r = await rpc('fn_iniciar_tt', { p_uc_id: uc.id, p_usina_id: usinaId }, 'TT criada. O robô protocola o pedido no portal.');
        if (r.ok) setUsinaId('');
    };

    const retentar = async () => {
        const quitacao = tt.status === 'bloqueada_por_debito';
        const ok = await showConfirm(
            quitacao
                ? 'Confirma que o débito da UG foi quitado? O robô fará nova tentativa no portal.'
                : 'Pedir nova tentativa ao robô?',
            quitacao ? 'Informar quitação' : 'Nova tentativa'
        );
        if (ok) await rpc('fn_tt_retentar', { p_tt_id: tt.id }, 'Nova tentativa na fila do robô.');
    };

    const encerrar = async (novoStatus) => {
        const recusada = novoStatus === 'recusada';
        const motivo = window.prompt(recusada ? 'Motivo da recusa pela concessionária:' : 'Motivo do cancelamento (opcional):', '');
        if (motivo === null) return;
        if (recusada && !motivo.trim()) { showAlert('Informe o motivo da recusa.', 'warning'); return; }
        const ok = await showConfirm(
            'A UC volta ao status que tinha antes da TT e continua sem usina. Confirma?',
            recusada ? 'Registrar recusa' : 'Cancelar TT'
        );
        if (ok) await rpc('fn_tt_encerrar', { p_tt_id: tt.id, p_novo_status: novoStatus, p_motivo: motivo.trim() || null }, recusada ? 'Recusa registrada.' : 'TT cancelada.');
    };

    const concluir = async () => {
        const ok = await showConfirm(
            `Confirma que a TT foi concluída na concessionária? A UC passa ao titular ${nomeSub(tt.cessionario_id)}, é vinculada à usina ${nomeUsina(tt.usina_destino_id)}, e a UC antiga (${tt.numero_uc_origem}) é criada como registro "Desligado por TT" para o robô buscar a conta final.`,
            'Concluir TT'
        );
        if (!ok) return;
        const r = await rpc('fn_concluir_tt', {
            p_tt_id: tt.id,
            p_numero_uc_novo: numeroNovo.trim() || null,
            p_data: dataConclusao
        }, 'TT concluída: UC vinculada à usina e UC antiga criada para a conta final.');
        if (r.ok) { setConcluindo(false); setNumeroNovo(''); }
    };

    if (!uc?.id) return null;
    if (carregando && !tt) return null;

    const aberta = tt && !ENCERRADAS.includes(tt.status);
    const podeIniciar = !aberta && !uc.usina_id && (uc.tipo_unidade || 'beneficiaria') !== 'geradora';
    // Sem TT, sem possibilidade de iniciar e sem histórico: nada a mostrar.
    if (!tt && !podeIniciar) return null;

    const usinasAcr = usinas.filter(u => u.modalidade === 'auto_consumo_remoto');
    const st = tt ? STATUS_TT[tt.status] : null;

    return (
        <div style={{ marginTop: '1rem', background: '#fff', border: '1.5px solid #ddd6fe', borderRadius: '12px', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#5b21b6', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Clock size={16} /> Troca de titularidade
                </div>
                {st && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: st.color, background: st.bg, border: `1px solid ${st.border}`, borderRadius: '999px', padding: '0.2rem 0.7rem' }}>
                        {st.label}
                    </span>
                )}
            </div>

            {/* ---- Sem TT aberta: iniciar ---- */}
            {!aberta && podeIniciar && (
                <>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
                        Em usina de autoconsumo remoto o titular da conta de energia tem que ser o mesmo da UG. Esta UC ainda não está no nome da UG: inicie a troca aqui. A UC só é vinculada à usina quando a TT concluir.
                    </p>
                    <div>
                        <label style={label}>Usina de destino (autoconsumo remoto)</label>
                        <select value={usinaId} onChange={e => setUsinaId(e.target.value)} style={campo}>
                            <option value="">Selecione…</option>
                            {usinasAcr.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                    </div>
                    {usinaId && previaUg?.usinaId === usinaId && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.82rem', color: '#334155', flexWrap: 'wrap' }}>
                            <span><b>Cedente:</b> {nomeSub(uc.titular_fatura_id)}</span>
                            <ArrowRight size={14} color="#64748b" />
                            <span><b>Cessionário (titular da UG {previaUg.numero_uc || '—'}):</b> {previaUg.titular_fatura_id ? nomeSub(previaUg.titular_fatura_id) : 'UG sem titular cadastrado'}</span>
                        </div>
                    )}
                    <div>
                        <button type="button" disabled={!usinaId || agindo} onClick={iniciar} style={{ ...botao('#7c3aed'), opacity: !usinaId || agindo ? 0.5 : 1 }}>
                            {agindo ? <Loader2 size={14} className="spin" /> : null} Iniciar TT
                        </button>
                    </div>
                </>
            )}

            {/* ---- TT existente ---- */}
            {tt && (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.7rem', fontSize: '0.82rem', color: '#334155' }}>
                        <div><b>Cedente (ponto A):</b> {nomeSub(tt.cedente_id)}<br /><span style={{ color: '#64748b' }}>UC {tt.numero_uc_origem}</span></div>
                        <div><b>Cessionário (ponto B):</b> {nomeSub(tt.cessionario_id)}<br /><span style={{ color: '#64748b' }}>UC {tt.numero_uc_destino || 'número novo a confirmar'} · UG {ugNumero || '—'}</span></div>
                        <div><b>Usina destino:</b> {nomeUsina(tt.usina_destino_id)}</div>
                        <div><b>Protocolo:</b> {tt.protocolo || '—'}<br /><span style={{ color: '#64748b' }}>Tentativas do robô: {tt.tentativas}</span></div>
                    </div>

                    {tt.status === 'bloqueada_por_debito' && (
                        <div style={{ background: '#fff1f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.8rem', fontSize: '0.82rem', color: '#9f1239', lineHeight: 1.5 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
                                <AlertCircle size={15} /> A UG tem débito{tt.debito_valor != null ? ` de ${fmtMoeda(tt.debito_valor)}` : ''}
                            </div>
                            <div>A concessionária não aceita a TT enquanto houver débito. O processo foi finalizado e o robô não tenta de novo sozinho. Quite o débito e peça nova tentativa.</div>
                            {tt.debito_detalhe && <div style={{ marginTop: '0.4rem', color: '#be123c' }}>{tt.debito_detalhe}</div>}
                        </div>
                    )}

                    {tt.status === 'erro' && (
                        <div style={{ background: '#fff1f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.8rem', fontSize: '0.82rem', color: '#9f1239', lineHeight: 1.5 }}>
                            <div style={{ fontWeight: 700 }}>O robô não conseguiu protocolar</div>
                            <div>{tt.erro || 'Erro sem detalhe.'}</div>
                        </div>
                    )}

                    {tt.status === 'concluida' && (
                        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '0.8rem', fontSize: '0.82rem', color: '#047857', lineHeight: 1.5, display: 'flex', gap: '0.4rem' }}>
                            <CheckCircle size={15} style={{ minWidth: 15, marginTop: 2 }} />
                            <span>Concluída em {fmtData(tt.data_conclusao)}. A UC antiga ({tt.numero_uc_origem}) segue como registro "Desligado por TT", acompanhada por cerca de 90 dias para a conta final.</span>
                        </div>
                    )}

                    {aberta && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {(tt.status === 'bloqueada_por_debito' || tt.status === 'erro') && (
                                <button type="button" disabled={agindo} onClick={retentar} style={botao('#2563eb')}>
                                    <RefreshCcw size={14} /> {tt.status === 'bloqueada_por_debito' ? 'Informei a quitação — tentar novamente' : 'Tentar novamente'}
                                </button>
                            )}
                            <button type="button" disabled={agindo} onClick={() => setConcluindo(v => !v)} style={botao('#059669', false)}>
                                Registrar conclusão
                            </button>
                            {['protocolada', 'em_analise'].includes(tt.status) && (
                                <button type="button" disabled={agindo} onClick={() => encerrar('recusada')} style={botao('#dc2626', false)}>
                                    Registrar recusa
                                </button>
                            )}
                            <button type="button" disabled={agindo} onClick={() => encerrar('cancelada')} style={botao('#64748b', false)}>
                                Cancelar TT
                            </button>
                        </div>
                    )}

                    {aberta && concluindo && (
                        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.9rem', display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.8rem', alignItems: 'end' }}>
                            <div>
                                <label style={label}>Número novo da UC (se a concessionária mudou)</label>
                                <input type="text" value={numeroNovo} onChange={e => setNumeroNovo(e.target.value)} placeholder={`Vazio = mantém ${uc.numero_uc}`} style={campo} />
                            </div>
                            <div>
                                <label style={label}>Data da conclusão</label>
                                <input type="date" value={dataConclusao} onChange={e => setDataConclusao(e.target.value)} style={campo} />
                            </div>
                            <button type="button" disabled={agindo || !dataConclusao} onClick={concluir} style={botao('#059669')}>Concluir</button>
                        </div>
                    )}

                    {eventos.length > 0 && (
                        <details>
                            <summary style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b', cursor: 'pointer' }}>Histórico da TT ({eventos.length})</summary>
                            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.78rem', color: '#475569' }}>
                                {eventos.map(ev => (
                                    <div key={ev.id}>
                                        <span style={{ color: '#94a3b8' }}>{new Date(ev.criado_em).toLocaleString('pt-BR')}</span>{' · '}
                                        {EVENTOS[ev.evento] || ev.evento}
                                        {ev.detalhe?.protocolo ? ` (${ev.detalhe.protocolo})` : ''}
                                        {ev.detalhe?.valor != null ? ` (${fmtMoeda(ev.detalhe.valor)})` : ''}
                                        {ev.detalhe?.motivo ? ` — ${ev.detalhe.motivo}` : ''}
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}
                </>
            )}
        </div>
    );
}
