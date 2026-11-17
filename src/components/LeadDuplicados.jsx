import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitMerge, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { maskPhoneDdi } from '../lib/validators';
import {
    camposEmConflito, camposPreenchidosPeloOutro, escolhasIniciais,
    montarCamposMesclados, rotuloStatus,
} from '../lib/mesclaLead';

const ROTULO_CHAVE = { telefone: 'telefone', email: 'e-mail', cpf_cnpj: 'CPF/CNPJ' };

const dataCurta = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');

// Procura, enquanto se digita, outro lead com o mesmo telefone, e-mail ou
// CPF/CNPJ (RPC `fn_leads_duplicados`, que respeita o que o usuário pode ver)
// e oferece a mescla. Não espera o salvar: o aviso aparece antes de nascer o
// lead duplicado.
export default function LeadDuplicados({ lead, formData, contaLida, originators, onMesclado }) {
    const [duplicados, setDuplicados] = useState([]);
    const [ignorados, setIgnorados] = useState(() => new Set());
    const [mesclando, setMesclando] = useState(null);

    const { phone, email, cpf_cnpj: cpf } = formData;

    useEffect(() => {
        let cancelado = false;
        const t = setTimeout(async () => {
            if (!phone && !email && !cpf) {
                setDuplicados([]);
                return;
            }
            const { data, error } = await supabase.rpc('fn_leads_duplicados', {
                p_lead_id: lead?.id || null,
                p_phone: phone || null,
                p_email: email || null,
                p_cpf: cpf || null,
            });
            if (cancelado) return;
            if (error) {
                console.error('Busca de lead duplicado:', error);
                return;
            }
            setDuplicados(data || []);
        }, 500);
        return () => { cancelado = true; clearTimeout(t); };
    }, [phone, email, cpf, lead?.id]);

    const visiveis = duplicados.filter(d => !ignorados.has(d.id));
    if (!visiveis.length && !mesclando) return null;

    return (
        <>
            {visiveis.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: '0.9rem 1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#92400e', fontWeight: 700, fontSize: '0.9rem' }}>
                        <AlertTriangle size={16} />
                        {visiveis.length === 1 ? 'Já existe um lead com estes dados' : `Já existem ${visiveis.length} leads com estes dados`}
                    </div>
                    {visiveis.map(d => (
                        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'white', border: '1px solid #fde68a', borderRadius: 8, padding: '0.55rem 0.75rem', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 200 }}>
                                <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>{d.name || 'Sem nome'}</div>
                                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                    Mesmo {d.chaves.map(k => ROTULO_CHAVE[k] || k).join(', ')}
                                    {' · '}{rotuloStatus(d.status)}
                                    {' · '}criado em {dataCurta(d.created_at)}
                                    {d.arquivado_em ? ' · arquivado' : ''}
                                </div>
                            </div>
                            <button type="button" onClick={() => setMesclando(d.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.8rem', background: '#003366', color: 'white', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}>
                                <GitMerge size={14} /> Mesclar
                            </button>
                            <button type="button" onClick={() => setIgnorados(prev => new Set(prev).add(d.id))}
                                style={{ padding: '0.4rem 0.6rem', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer' }}>
                                Não é a mesma pessoa
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {mesclando && (
                <DialogoMescla
                    outroId={mesclando}
                    lead={lead}
                    formData={formData}
                    contaLida={contaLida}
                    originators={originators}
                    onCancelar={() => setMesclando(null)}
                    onMesclado={onMesclado}
                />
            )}
        </>
    );
}

function DialogoMescla({ outroId, lead, formData, contaLida, originators, onCancelar, onMesclado }) {
    const [outro, setOutro] = useState(null);
    const [erro, setErro] = useState(null);
    const [escolhas, setEscolhas] = useState({});
    const [gravando, setGravando] = useState(false);

    // "Este lead" é o que está no modal agora, inclusive o que ainda não foi salvo.
    const atual = useMemo(() => ({
        ...(lead || {}),
        ...formData,
        conta_lida: contaLida || lead?.conta_lida || null,
    }), [lead, formData, contaLida]);

    useEffect(() => {
        supabase.from('leads').select('*').eq('id', outroId).single()
            .then(({ data, error }) => {
                if (error) { setErro(error.message); return; }
                setOutro(data);
                setEscolhas(escolhasIniciais(atual, data));
            });
        // Carrega uma vez por lead escolhido; edições no modal depois disso
        // não devem trocar as escolhas já feitas.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [outroId]);

    const conflitos = outro ? camposEmConflito(atual, outro) : [];
    const herdados = outro ? camposPreenchidosPeloOutro(atual, outro) : [];

    const nomeOriginador = (id) => originators.find(o => o.id === id)?.name || id;
    const mostrar = (key, v) => {
        if (key === 'status') return rotuloStatus(v);
        if (key === 'originator_id') return nomeOriginador(v);
        if (key === 'phone') return maskPhoneDdi(v);
        if (key === 'conta_lida') return v?.numeroUc ? `UC ${v.numeroUc}` : 'lida';
        return String(v);
    };

    // Fica o lead mais antigo: é o que já tem histórico, vínculos e link.
    // Sem lead salvo, os dados digitados vão para o que já existe.
    const manterOutro = !lead?.id || new Date(outro?.created_at) <= new Date(lead.created_at);

    const confirmar = async () => {
        setGravando(true);
        setErro(null);
        const campos = montarCamposMesclados(atual, outro, escolhas);
        const { data, error } = await supabase.rpc('fn_mesclar_leads', {
            p_manter: manterOutro ? outro.id : lead.id,
            p_remover: lead?.id ? (manterOutro ? lead.id : outro.id) : null,
            p_campos: campos,
        });
        setGravando(false);
        if (error) { setErro(error.message); return; }
        onMesclado(data);
    };

    const celula = (lado, c) => {
        const valor = lado === 'atual' ? atual[c.key] : outro[c.key];
        const marcado = escolhas[c.key] === lado;
        return (
            <label style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'flex-start', padding: '0.55rem 0.65rem', borderRadius: 8, cursor: 'pointer', border: `1px solid ${marcado ? '#003366' : '#e2e8f0'}`, background: marcado ? '#eff6ff' : 'white' }}>
                <input type="radio" name={`mescla-${c.key}`} checked={marcado}
                    onChange={() => setEscolhas(prev => ({ ...prev, [c.key]: lado }))} style={{ marginTop: 3 }} />
                <span style={{ fontSize: '0.85rem', color: '#1e293b', wordBreak: 'break-word' }}>{mostrar(c.key, valor)}</span>
            </label>
        );
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0' }}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <GitMerge size={18} style={{ color: '#003366' }} /> Mesclar leads
                    </h3>
                    <button type="button" onClick={onCancelar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                    {!outro && !erro && <div style={{ color: '#64748b', fontSize: '0.9rem' }}>Carregando…</div>}
                    {outro && (
                        <>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569' }}>
                                {lead?.id
                                    ? <>Os dois viram um só lead. Fica o cadastro <b>{manterOutro ? 'mais antigo (o outro)' : 'mais antigo (este)'}</b>; agendamentos, mensagens, assinaturas, histórico e vínculos do outro passam para ele.</>
                                    : <>Este cadastro ainda não foi salvo: os dados escolhidos vão para o lead que já existe, e nenhum lead novo é criado.</>}
                            </p>

                            {conflitos.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    <div style={{ display: 'flex', gap: 8, fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                        <span style={{ width: 120 }}>Campo</span>
                                        <span style={{ flex: 1 }}>Este lead</span>
                                        <span style={{ flex: 1 }}>Outro lead · {dataCurta(outro.created_at)}</span>
                                    </div>
                                    {conflitos.map(c => (
                                        <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                                            <span style={{ width: 120, fontSize: '0.85rem', fontWeight: 600, color: '#334155', paddingTop: 8 }}>{c.label}</span>
                                            {celula('atual', c)}
                                            {celula('outro', c)}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ fontSize: '0.85rem', color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                                    Nenhum campo em conflito.
                                </div>
                            )}

                            {(herdados.length > 0 || (outro.tags || []).length > 0) && (
                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                    {herdados.length > 0 && <>Vêm do outro lead, porque aqui estão vazios: {herdados.map(c => c.label).join(', ')}. </>}
                                    As tags dos dois são somadas.
                                </div>
                            )}
                        </>
                    )}
                    {erro && <div style={{ color: '#b91c1c', fontSize: '0.85rem' }}>Erro: {erro}</div>}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.9rem 1.25rem', borderTop: '1px solid #e2e8f0' }}>
                    <button type="button" onClick={onCancelar}
                        style={{ padding: '0.55rem 1rem', background: 'white', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer', color: '#334155' }}>
                        Cancelar
                    </button>
                    <button type="button" onClick={confirmar} disabled={!outro || gravando}
                        style={{ padding: '0.55rem 1.1rem', background: '#003366', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: outro && !gravando ? 'pointer' : 'default', opacity: outro && !gravando ? 1 : 0.6 }}>
                        {gravando ? 'Mesclando…' : 'Mesclar leads'}
                    </button>
                </div>
            </div>
        </div>
    );
}
