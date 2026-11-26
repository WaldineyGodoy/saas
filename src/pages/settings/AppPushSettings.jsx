import { useEffect, useMemo, useState } from 'react';
import { Bell, Send, Smartphone, FlaskConical, Save, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useUI } from '../../contexts/UIContext';

/**
 * Central de notificações do app (migração 20261126b).
 * Eventos automáticos (liga/desliga e texto), comunicado avulso para um
 * público e os últimos envios. Só o super admin altera; os demais só leem.
 */

const PUBLICOS = [
    { value: 'todos', label: 'Todos os logins do app' },
    { value: 'assinantes', label: 'Assinantes (contrato assinado ou ativo)' },
    { value: 'parceiros', label: 'Parceiros Power' },
    { value: 'investidores', label: 'Investidores (fornecedores)' },
];

const TELAS = [
    { value: '', label: 'Só abrir as notificações' },
    { value: '/', label: 'Início' },
    { value: '/energia', label: 'Energia (UCs e faturas)' },
    { value: '/connect/home', label: 'Home Connect (rede)' },
    { value: '/invest', label: 'B2W Invest (usinas)' },
    { value: '/eletroposto', label: 'Eletroposto' },
];

const STATUS = {
    enviado: { label: 'Entregue ao aparelho', cor: '#047857', bg: '#ecfdf5' },
    enviando: { label: 'Enviando', cor: '#0369a1', bg: '#f0f9ff' },
    pendente: { label: 'Na fila', cor: '#0369a1', bg: '#f0f9ff' },
    sem_aparelho: { label: 'Só na caixa (sem aparelho)', cor: '#475569', bg: '#f1f5f9' },
    erro: { label: 'Erro no envio', cor: '#b91c1c', bg: '#fef2f2' },
};

const card = { background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' };
const rotulo = { display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: '#64748b', fontWeight: 600 };
const campo = { width: '100%', padding: '0.6rem 0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
const botao = (primario) => ({
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
    border: primario ? 'none' : '1px solid #cbd5e1', background: primario ? '#003366' : 'white', color: primario ? 'white' : '#334155',
});

function exemplo(texto) {
    const vars = { nome: 'Maria', cidade: 'Natal', nivel: '1', valor: 'R$ 12,34', descricao: 'exemplo', titulo: 'Título', corpo: 'Texto' };
    return String(texto || '').replace(/\{\{([a-z_]+)\}\}/g, (_, k) => vars[k] ?? '');
}

function TipoEvento({ tipo, podeEditar, onSalvo }) {
    const { showAlert } = useUI();
    const [f, setF] = useState(tipo);
    const [salvando, setSalvando] = useState(false);
    const mudou = f.ativo !== tipo.ativo || f.titulo !== tipo.titulo || f.corpo !== tipo.corpo
        || JSON.stringify(f.config) !== JSON.stringify(tipo.config);

    const salvar = async (patch = {}) => {
        const dados = { ...f, ...patch };
        if (!dados.titulo.trim() || !dados.corpo.trim()) return showAlert('Título e texto não podem ficar vazios.', 'warning');
        setSalvando(true);
        const { error } = await supabase.from('app_notificacao_tipos')
            .update({ ativo: dados.ativo, titulo: dados.titulo.trim(), corpo: dados.corpo.trim(), config: dados.config, atualizado_em: new Date().toISOString(), atualizado_por: (await supabase.auth.getUser()).data.user?.id })
            .eq('codigo', tipo.codigo);
        setSalvando(false);
        if (error) return showAlert('Não foi possível salvar: ' + error.message, 'error');
        onSalvo();
    };

    const testar = async () => {
        const { error } = await supabase.rpc('crm_testar_notificacao', { p_tipo: tipo.codigo });
        if (error) return showAlert('Teste não enviado: ' + error.message, 'error');
        showAlert('Teste enviado para o seu login. Chega no celular em até 1 minuto, se o app estiver instalado e com notificações permitidas.', 'success');
    };

    return (
        <div style={{ ...card, opacity: f.ativo ? 1 : 0.8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{tipo.nome}</div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.2rem', maxWidth: '60ch' }}>{tipo.descricao}</div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 600, color: f.ativo ? '#047857' : '#64748b', cursor: podeEditar ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={f.ativo} disabled={!podeEditar || salvando}
                        onChange={(e) => { setF({ ...f, ativo: e.target.checked }); salvar({ ativo: e.target.checked }); }} />
                    {f.ativo ? 'Ligado' : 'Desligado'}
                </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: '0.9rem' }}>
                <div>
                    <label style={rotulo}>Título</label>
                    <input style={campo} value={f.titulo} maxLength={120} disabled={!podeEditar} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
                </div>
                <div>
                    <label style={rotulo}>Texto</label>
                    <textarea style={{ ...campo, minHeight: '64px', resize: 'vertical' }} value={f.corpo} maxLength={400} disabled={!podeEditar} onChange={(e) => setF({ ...f, corpo: e.target.value })} />
                </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem', color: '#64748b' }}>
                Variáveis:
                {(tipo.variaveis || []).map((v) => (
                    <code key={v} style={{ background: '#f1f5f9', padding: '0.1rem 0.4rem', borderRadius: '4px', color: '#334155' }}>{`{{${v}}}`}</code>
                ))}
                {tipo.codigo === 'rede_novo_assinante' && (
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        Avisar até o nível
                        <select style={{ ...campo, width: 'auto', padding: '0.3rem 0.5rem' }} disabled={!podeEditar}
                            value={f.config?.niveis ?? 3} onChange={(e) => setF({ ...f, config: { ...f.config, niveis: Number(e.target.value) } })}>
                            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </span>
                )}
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.7rem 0.9rem', display: 'flex', gap: '0.7rem' }}>
                <Bell size={18} style={{ color: '#FF6600', flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: '0.85rem' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{exemplo(f.titulo)}</div>
                    <div style={{ color: '#475569' }}>{exemplo(f.corpo)}</div>
                </div>
            </div>

            {podeEditar && (
                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                    <button type="button" style={botao(false)} onClick={testar}><FlaskConical size={15} /> Enviar teste para mim</button>
                    <button type="button" style={{ ...botao(true), opacity: mudou ? 1 : 0.5 }} disabled={!mudou || salvando} onClick={() => salvar()}>
                        <Save size={15} /> {salvando ? 'Salvando…' : 'Salvar'}
                    </button>
                </div>
            )}
        </div>
    );
}

export default function AppPushSettings() {
    const { profile } = useAuth();
    const { showAlert, showConfirm } = useUI();
    const podeEditar = profile?.role === 'super_admin';
    const [tipos, setTipos] = useState([]);
    const [envios, setEnvios] = useState([]);
    const [aparelhos, setAparelhos] = useState(null);
    const [com, setCom] = useState({ publico: 'todos', titulo: '', corpo: '', rota: '' });
    const [alcance, setAlcance] = useState(null);
    const [enviando, setEnviando] = useState(false);

    const carregar = async () => {
        const [t, e, a] = await Promise.all([
            supabase.from('app_notificacao_tipos').select('*').order('ordem'),
            supabase.from('app_notificacoes').select('id, tipo, titulo, corpo, criada_em, push_status, push_erro, lida_em').order('criada_em', { ascending: false }).limit(30),
            supabase.from('app_push_tokens').select('id', { count: 'exact', head: true }).eq('ativo', true),
        ]);
        setTipos(t.data || []);
        setEnvios(e.data || []);
        setAparelhos(a.count ?? 0);
    };
    useEffect(() => { carregar(); }, []);

    useEffect(() => {
        if (!podeEditar) return;
        setAlcance(null);
        supabase.rpc('crm_app_publico_total', { p_publico: com.publico }).then(({ data }) => setAlcance(data));
    }, [com.publico, podeEditar]);

    const automaticos = useMemo(() => tipos.filter((t) => t.codigo !== 'comunicado'), [tipos]);

    const enviarComunicado = async () => {
        if (!com.titulo.trim() || !com.corpo.trim()) return showAlert('Preencha o título e o texto.', 'warning');
        const publico = PUBLICOS.find((p) => p.value === com.publico)?.label;
        const ok = await showConfirm(
            `Enviar "${com.titulo.trim()}" para ${publico}? ${alcance ? `São ${alcance.logins} logins, ${alcance.com_aparelho} com o app instalado.` : ''} O envio não pode ser desfeito.`,
            'Enviar comunicado', 'Enviar');
        if (!ok) return;
        setEnviando(true);
        const { data, error } = await supabase.rpc('crm_enviar_comunicado', { p_publico: com.publico, p_titulo: com.titulo, p_corpo: com.corpo, p_rota: com.rota || null });
        setEnviando(false);
        if (error) return showAlert('Comunicado não enviado: ' + error.message, 'error');
        showAlert(`Comunicado enviado para ${data?.total ?? 0} logins.`, 'success');
        setCom({ ...com, titulo: '', corpo: '' });
        carregar();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '980px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h3 style={{ margin: 0, color: '#0f172a' }}>Notificações do app</h3>
                    <p style={{ margin: '0.3rem 0 0', color: '#64748b', fontSize: '0.9rem', maxWidth: '70ch' }}>
                        Avisos que chegam no celular de quem usa o app B2W Energia e ficam guardados no sino do app.
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155', fontSize: '0.9rem' }}>
                    <Smartphone size={18} /> <b>{aparelhos ?? '…'}</b> aparelhos com o app e notificações permitidas
                </div>
            </div>

            {!podeEditar && (
                <div style={{ display: 'flex', gap: '0.6rem', padding: '0.75rem 1rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', color: '#92400e', fontSize: '0.85rem' }}>
                    <AlertTriangle size={18} style={{ flexShrink: 0 }} /> Só o super admin altera os avisos e envia comunicados. Aqui você acompanha.
                </div>
            )}

            <section style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <h4 style={{ margin: 0, color: '#1e293b' }}>Avisos automáticos</h4>
                {automaticos.map((t) => <TipoEvento key={`${t.codigo}-${t.atualizado_em}`} tipo={t} podeEditar={podeEditar} onSalvo={carregar} />)}
            </section>

            {podeEditar && (
                <section style={card}>
                    <h4 style={{ margin: 0, color: '#1e293b' }}>Enviar comunicado</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.9rem' }}>
                        <div>
                            <label style={rotulo}>Para quem</label>
                            <select style={campo} value={com.publico} onChange={(e) => setCom({ ...com, publico: e.target.value })}>
                                {PUBLICOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                            </select>
                            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.35rem' }}>
                                {alcance ? `${alcance.logins} logins · ${alcance.com_aparelho} recebem no celular; os demais veem no sino ao abrir o app.` : 'Calculando…'}
                            </div>
                        </div>
                        <div>
                            <label style={rotulo}>Ao tocar, abrir</label>
                            <select style={campo} value={com.rota} onChange={(e) => setCom({ ...com, rota: e.target.value })}>
                                {TELAS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style={rotulo}>Título</label>
                        <input style={campo} value={com.titulo} maxLength={120} placeholder="Ex.: Bandeira tarifária de dezembro" onChange={(e) => setCom({ ...com, titulo: e.target.value })} />
                    </div>
                    <div>
                        <label style={rotulo}>Texto</label>
                        <textarea style={{ ...campo, minHeight: '80px', resize: 'vertical' }} value={com.corpo} maxLength={400} onChange={(e) => setCom({ ...com, corpo: e.target.value })} />
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'right' }}>{com.corpo.length}/400</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button type="button" style={botao(true)} disabled={enviando} onClick={enviarComunicado}>
                            <Send size={15} /> {enviando ? 'Enviando…' : 'Enviar comunicado'}
                        </button>
                    </div>
                </section>
            )}

            <section style={card}>
                <h4 style={{ margin: 0, color: '#1e293b' }}>Últimos envios</h4>
                {envios.length === 0 ? (
                    <div style={{ color: '#64748b', fontSize: '0.9rem' }}>Nenhum aviso enviado ainda.</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', color: '#64748b' }}>
                                <th style={{ padding: '0.4rem 0.5rem' }}>Quando</th>
                                <th style={{ padding: '0.4rem 0.5rem' }}>Aviso</th>
                                <th style={{ padding: '0.4rem 0.5rem' }}>Entrega</th>
                                <th style={{ padding: '0.4rem 0.5rem' }}>Lida</th>
                            </tr>
                        </thead>
                        <tbody>
                            {envios.map((n) => {
                                const st = STATUS[n.push_status] || STATUS.pendente;
                                return (
                                    <tr key={n.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                                            {new Date(n.criada_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        </td>
                                        <td style={{ padding: '0.5rem' }}>
                                            <div style={{ fontWeight: 600, color: '#0f172a' }}>{n.titulo}</div>
                                            <div style={{ color: '#64748b' }}>{n.corpo}</div>
                                        </td>
                                        <td style={{ padding: '0.5rem' }} title={n.push_erro || ''}>
                                            <span style={{ background: st.bg, color: st.cor, padding: '0.15rem 0.5rem', borderRadius: '999px', fontWeight: 600, whiteSpace: 'nowrap' }}>{st.label}</span>
                                        </td>
                                        <td style={{ padding: '0.5rem', color: n.lida_em ? '#047857' : '#94a3b8' }}>{n.lida_em ? 'Sim' : 'Não'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    );
}
