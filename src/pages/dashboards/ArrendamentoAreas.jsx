import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import { MapPin, Plus, Save, X, Trash2, Search, Landmark, Users, AlertTriangle, Banknote } from 'lucide-react';
import { ratear, num, dinheiro, competenciaLegivel } from '../../lib/rateioArrendamento';
import { conferirChavePix } from '../../lib/pixChave';
import RepasseAcoes from '../../components/RepasseAcoes';
import BoletosDoBeneficiario from '../../components/BoletosDoBeneficiario';

/**
 * Áreas arrendadas — cadastro na seção Arrendamento.
 *
 * A área é entidade própria, não campo da usina: tem dono, matrícula e vida
 * independente. Pode receber outra usina e pode ser vendida.
 *
 * Quem recebe o dinheiro mora em `leased_area_beneficiaries`, não aqui. São
 * coisas diferentes: o dono da terra assina o contrato e recebe; a imobiliária
 * recebe e não assina; a B2W retém margem e nem recebe nem assina, porque o
 * dinheiro já está na conta dela.
 *
 * O fornecedor NÃO é cadastrado: ele vem de `usinas.leased_area_id`. Uma área
 * pode abrigar duas usinas, e aí um campo de fornecedor aqui passaria a mentir.
 */

const VAZIO = {
    nome: '',
    matricula: '',
    cartorio: '',
    endereco: { cep: '', rua: '', numero: '', bairro: '', cidade: '', uf: '' },
    coordenadas: '',
    area_m2: '',
    valor_aluguel: '',
    dia_pagamento: 5,
    mes_inicio: '',
    indice_reajuste: 'IPCA',
    comarca: '',
    observacoes: ''
};

const BENEF_VAZIO = {
    nome: '',
    doc: '',
    tipo: 'terceiro',
    assina_contrato: true,
    rateio_tipo: 'percentual',
    rateio_valor: '',
    forma_pagamento: '',
    pix_key: '',
    pix_key_type: 'CPF',
    endereco: { cep: '', rua: '', numero: '', bairro: '', cidade: '', uf: '' },
    ativo: true
};

const card = {
    background: 'white',
    padding: '1.5rem',
    borderRadius: '16px',
    border: '1px solid #f1f5f9',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
    marginBottom: '1.5rem'
};

const rotulo = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' };
const campo = { width: '100%', padding: '0.65rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' };
const ajuda = { margin: '0.35rem 0 0 0', fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.35 };
const grade = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem' };

const TIPO_ROTULO = {
    terceiro: 'Arrendante (dono da terra)',
    intermediario: 'Imobiliária / intermediário',
    casa: 'B2W (margem de intermediação)'
};

export default function ArrendamentoAreas() {
    const { showAlert, showConfirm } = useUI();
    const [areas, setAreas] = useState([]);
    const [benefPorArea, setBenefPorArea] = useState({});
    const [usinasPorArea, setUsinasPorArea] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busca, setBusca] = useState('');
    const [editando, setEditando] = useState(null);
    const [benefs, setBenefs] = useState([]);
    const [removidos, setRemovidos] = useState([]);
    const [repasses, setRepasses] = useState([]);

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            const [{ data: as, error: e1 }, { data: bs, error: e2 }, { data: us, error: e3 }] = await Promise.all([
                supabase.from('leased_areas').select('*').order('nome'),
                supabase.from('leased_area_beneficiaries').select('*').order('created_at'),
                supabase.from('usinas').select('id, name, leased_area_id').not('leased_area_id', 'is', null)
            ]);
            // supabase-js devolve { data, error } e nunca lança: sem este teste
            // a tela mostraria lista vazia como se não houvesse cadastro.
            if (e1 || e2 || e3) throw (e1 || e2 || e3);

            setAreas(as || []);

            const porArea = {};
            for (const b of bs || []) {
                porArea[b.leased_area_id] = [...(porArea[b.leased_area_id] || []), b];
            }
            setBenefPorArea(porArea);

            const mapa = {};
            for (const u of us || []) {
                mapa[u.leased_area_id] = [...(mapa[u.leased_area_id] || []), u.name];
            }
            setUsinasPorArea(mapa);
        } catch (e) {
            console.error('Erro ao carregar áreas:', e);
            showAlert('Erro ao carregar áreas arrendadas: ' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [showAlert]);

    useEffect(() => { carregar(); }, [carregar]);

    /**
     * Os repasses desta area, para o pagamento acontecer onde a pessoa ja'
     * esta' quando abre o contrato. A fila geral continua existindo para a
     * pergunta oposta: o que devo este mes, atravessando todas as areas.
     */
    const carregarRepasses = useCallback(async (areaId) => {
        if (!areaId) { setRepasses([]); return; }
        const { data, error } = await supabase
            .from('arrendamento_pagamentos')
            .select('*, beneficiario:leased_area_beneficiaries!inner(id, nome, tipo, forma_pagamento, pix_key, pix_key_type, leased_area_id), usina:usinas(id, name)')
            .eq('beneficiario.leased_area_id', areaId)
            .order('competencia', { ascending: false });
        if (error) { console.error('Erro ao carregar repasses da área:', error); setRepasses([]); return; }
        setRepasses(data || []);
    }, []);

    const abrir = (area) => {
        setRemovidos([]);
        carregarRepasses(area?.id);
        if (area) {
            setEditando({ ...VAZIO, ...area, endereco: { ...VAZIO.endereco, ...(area.endereco || {}) } });
            setBenefs((benefPorArea[area.id] || []).map(b => ({
                ...BENEF_VAZIO, ...b,
                rateio_valor: b.rateio_valor ?? '',
                forma_pagamento: b.forma_pagamento || '',
                pix_key: b.pix_key || '',
                pix_key_type: b.pix_key_type || 'CPF',
                endereco: { ...BENEF_VAZIO.endereco, ...(b.endereco || {}) }
            })));
        } else {
            setEditando({ ...VAZIO });
            setBenefs([{ ...BENEF_VAZIO, rateio_valor: 100 }]);
        }
    };

    const setCampo = (chave, valor) => setEditando(prev => ({ ...prev, [chave]: valor }));
    const setEnd = (chave, valor) => setEditando(prev => ({ ...prev, endereco: { ...prev.endereco, [chave]: valor } }));

    const setBenef = (i, chave, valor) => setBenefs(prev => prev.map((b, j) => {
        if (j !== i) return b;
        const novo = { ...b, [chave]: valor };
        // A B2W é a arrendatária: se entrasse como arrendante, o contrato teria
        // a mesma empresa nos dois polos. E ela não recebe nada, porque o
        // dinheiro já está na conta dela.
        if (chave === 'tipo') {
            if (valor !== 'terceiro') novo.assina_contrato = false;
            if (valor === 'casa') {
                novo.forma_pagamento = '';
                novo.pix_key = '';
            }
        }
        if (chave === 'forma_pagamento' && valor !== 'pix') novo.pix_key = '';
        return novo;
    }));

    const setBenefEnd = (i, chave, valor) => setBenefs(prev => prev.map((b, j) =>
        j === i ? { ...b, endereco: { ...b.endereco, [chave]: valor } } : b));

    const addBenef = () => setBenefs(prev => [...prev, { ...BENEF_VAZIO, assina_contrato: true, rateio_valor: '' }]);

    const removerBenef = (i) => setBenefs(prev => {
        const alvo = prev[i];
        if (alvo?.id) setRemovidos(r => [...r, alvo.id]);
        return prev.filter((_, j) => j !== i);
    });

    // O rateio e a coerencia das chaves sao problemas diferentes, mas travam a
    // mesma coisa: salvar. Chave PIX errada nao da erro visivel -- da dinheiro
    // na conta de outra pessoa -- entao ela bloqueia, nao avisa.
    const previaBase = editando ? ratear(editando.valor_aluguel, benefs) : null;
    const problemasChave = benefs
        .filter(b => b.ativo !== false && b.forma_pagamento === 'pix' && b.tipo !== 'casa')
        .map(b => {
            const r = conferirChavePix(b.pix_key_type, b.pix_key);
            return r.ok ? null : `${b.nome?.trim() || 'Beneficiário sem nome'}: ${r.erro}`;
        })
        .filter(Boolean);

    const previa = previaBase && {
        ...previaBase,
        problemas: [...previaBase.problemas, ...problemasChave],
        valido: previaBase.valido && problemasChave.length === 0
    };

    const salvar = async () => {
        if (!editando.nome?.trim()) {
            showAlert('Dê um nome à área para poder identificá-la depois.', 'warning');
            return;
        }
        if (!previa.valido) {
            showAlert('O rateio ainda não fecha:\n\n' + previa.problemas.join('\n'), 'warning');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                nome: editando.nome.trim(),
                matricula: editando.matricula || null,
                cartorio: editando.cartorio || null,
                endereco: editando.endereco,
                coordenadas: editando.coordenadas || null,
                area_m2: num(editando.area_m2),
                valor_aluguel: num(editando.valor_aluguel),
                dia_pagamento: num(editando.dia_pagamento),
                mes_inicio: editando.mes_inicio || null,
                indice_reajuste: editando.indice_reajuste || 'IPCA',
                comarca: editando.comarca || null,
                observacoes: editando.observacoes || null,
                updated_at: new Date().toISOString()
            };

            let areaId = editando.id;
            if (areaId) {
                const { error } = await supabase.from('leased_areas').update(payload).eq('id', areaId);
                if (error) throw error;
            } else {
                const { data, error } = await supabase.from('leased_areas').insert(payload).select('id').single();
                if (error) throw error;
                areaId = data.id;
            }

            if (removidos.length) {
                const { error } = await supabase.from('leased_area_beneficiaries').delete().in('id', removidos);
                if (error) throw error;
            }

            for (const b of benefs) {
                const linha = {
                    leased_area_id: areaId,
                    nome: b.nome.trim(),
                    doc: b.doc || null,
                    tipo: b.tipo,
                    assina_contrato: b.tipo === 'terceiro' ? !!b.assina_contrato : false,
                    rateio_tipo: b.rateio_tipo === 'fixo' ? 'fixo' : 'percentual',
                    rateio_valor: num(b.rateio_valor) ?? 0,
                    // Vazio vira NULL: "trilho ainda não definido" é diferente
                    // de um trilho escolhido, e o pagamento barra em cima disso.
                    forma_pagamento: b.tipo === 'casa' ? null : (b.forma_pagamento || null),
                    pix_key: b.forma_pagamento === 'pix' ? (b.pix_key || null) : null,
                    pix_key_type: b.forma_pagamento === 'pix' ? (b.pix_key_type || null) : null,
                    endereco: b.endereco,
                    ativo: b.ativo !== false,
                    updated_at: new Date().toISOString()
                };
                const { error } = b.id
                    ? await supabase.from('leased_area_beneficiaries').update(linha).eq('id', b.id)
                    : await supabase.from('leased_area_beneficiaries').insert(linha);
                if (error) throw error;
            }

            showAlert('Área arrendada salva.', 'success');
            setEditando(null);
            carregar();
        } catch (e) {
            showAlert('Erro ao salvar: ' + e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const excluir = async (area) => {
        const usinas = usinasPorArea[area.id] || [];
        if (usinas.length) {
            showAlert(`Esta área abriga ${usinas.join(', ')}. Desvincule a usina antes de excluir.`, 'warning');
            return;
        }
        const ok = await showConfirm(`Excluir a área "${area.nome}"?`, 'Excluir área');
        if (!ok) return;
        try {
            const { error } = await supabase.from('leased_areas').delete().eq('id', area.id);
            if (error) throw error;
            showAlert('Área excluída.', 'success');
            carregar();
        } catch (e) {
            showAlert('Erro ao excluir: ' + e.message, 'error');
        }
    };

    const filtradas = areas.filter(a => {
        const t = busca.toLowerCase();
        if (!t) return true;
        const nomes = (benefPorArea[a.id] || []).map(b => b.nome).join(' ');
        return [a.nome, nomes, a.matricula, a.endereco?.cidade].some(v => (v || '').toLowerCase().includes(t));
    });

    return (
        <div>
            <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                        <MapPin size={20} color="#3b82f6" /> Áreas Arrendadas
                    </h3>
                    <p style={{ margin: '0.4rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                        Alimentam o Contrato de Arrendamento e o repasse mensal aos beneficiários. O fornecedor vem da usina vinculada à área.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => abrir(null)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.2rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer' }}
                >
                    <Plus size={18} /> Nova área
                </button>
            </div>

            <div style={card}>
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                    <Search size={16} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                        placeholder="Buscar por nome, beneficiário, matrícula ou cidade"
                        style={{ ...campo, paddingLeft: '2.3rem' }}
                    />
                </div>

                {loading ? (
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Carregando…</p>
                ) : filtradas.length === 0 ? (
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                        {areas.length === 0 ? 'Nenhuma área cadastrada ainda.' : 'Nenhuma área corresponde à busca.'}
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {filtradas.map(a => {
                            const usinas = usinasPorArea[a.id] || [];
                            const bs = (benefPorArea[a.id] || []).filter(b => b.ativo !== false);
                            const semTrilho = bs.filter(b => b.tipo !== 'casa' && !b.forma_pagamento);
                            return (
                                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '1rem', border: '1px solid #f1f5f9', borderRadius: '12px', flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, color: '#1e293b' }}>{a.nome}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
                                            {bs.length
                                                ? bs.map(b => `${b.nome}${b.forma_pagamento ? ` (${b.forma_pagamento})` : ''}`).join(' · ')
                                                : 'nenhum beneficiário cadastrado'}
                                            {a.area_m2 ? ` · ${a.area_m2} m²` : ''}
                                            {a.valor_aluguel ? ` · ${dinheiro(a.valor_aluguel)}/mês` : ''}
                                            {a.matricula ? ` · matrícula ${a.matricula}` : ''}
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: usinas.length ? '#166534' : '#94a3b8', marginTop: '0.2rem' }}>
                                            {usinas.length ? `Usina: ${usinas.join(', ')}` : 'Sem usina vinculada'}
                                        </div>
                                        {semTrilho.length > 0 && (
                                            <div style={{ fontSize: '0.78rem', color: '#b45309', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                <AlertTriangle size={13} />
                                                {semTrilho.map(b => b.nome).join(', ')} sem forma de pagamento: não dá para repassar.
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button type="button" onClick={() => abrir(a)} style={{ padding: '0.5rem 0.9rem', border: '1px solid #bfdbfe', borderRadius: '10px', background: 'white', color: '#3b82f6', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>Editar</button>
                                        <button type="button" onClick={() => excluir(a)} title="Excluir" style={{ padding: '0.5rem', border: '1px solid #fecaca', borderRadius: '10px', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {editando && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
                    <div style={{ background: '#f8fafc', borderRadius: '18px', width: '100%', maxWidth: '900px', maxHeight: '92vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', background: 'white', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 1 }}>
                            <h3 style={{ margin: 0, color: '#1e293b' }}>{editando.id ? 'Editar área arrendada' : 'Nova área arrendada'}</h3>
                            <button type="button" onClick={() => setEditando(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={22} /></button>
                        </div>

                        <div style={{ padding: '1.5rem' }}>
                            <div style={card}>
                                <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b', fontSize: '0.95rem' }}>
                                    <Landmark size={18} color="#3b82f6" /> Identificação
                                </h4>
                                <div style={grade}>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={rotulo}>Nome da área *</label>
                                        <input style={campo} value={editando.nome} onChange={e => setCampo('nome', e.target.value)} placeholder="Ex.: Vista Bom Jesus" />
                                    </div>
                                    <div><label style={rotulo}>Área (m²)</label><input style={campo} value={editando.area_m2} onChange={e => setCampo('area_m2', e.target.value)} /></div>
                                    <div><label style={rotulo}>Matrícula</label><input style={campo} value={editando.matricula} onChange={e => setCampo('matricula', e.target.value)} /></div>
                                    <div><label style={rotulo}>Cartório</label><input style={campo} value={editando.cartorio} onChange={e => setCampo('cartorio', e.target.value)} /></div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={rotulo}>Coordenadas</label>
                                        <input style={campo} value={editando.coordenadas} onChange={e => setCampo('coordenadas', e.target.value)} placeholder="-6.004922, -35.629455" />
                                    </div>
                                </div>
                            </div>

                            <div style={card}>
                                <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b', fontSize: '0.95rem' }}>
                                    <MapPin size={18} color="#3b82f6" /> Endereço do imóvel
                                </h4>
                                <div style={grade}>
                                    <div><label style={rotulo}>Rua</label><input style={campo} value={editando.endereco.rua} onChange={e => setEnd('rua', e.target.value)} /></div>
                                    <div><label style={rotulo}>Número</label><input style={campo} value={editando.endereco.numero} onChange={e => setEnd('numero', e.target.value)} /></div>
                                    <div><label style={rotulo}>Bairro</label><input style={campo} value={editando.endereco.bairro} onChange={e => setEnd('bairro', e.target.value)} /></div>
                                    <div><label style={rotulo}>Cidade</label><input style={campo} value={editando.endereco.cidade} onChange={e => setEnd('cidade', e.target.value)} /></div>
                                    <div><label style={rotulo}>UF</label><input style={campo} value={editando.endereco.uf} onChange={e => setEnd('uf', e.target.value)} /></div>
                                    <div><label style={rotulo}>CEP</label><input style={campo} value={editando.endereco.cep} onChange={e => setEnd('cep', e.target.value)} /></div>
                                    <div><label style={rotulo}>Comarca (foro)</label><input style={campo} value={editando.comarca} onChange={e => setCampo('comarca', e.target.value)} placeholder="Situação do imóvel" /></div>
                                </div>
                            </div>

                            <div style={card}>
                                <h4 style={{ margin: '0 0 1rem 0', color: '#1e293b', fontSize: '0.95rem' }}>Condições do arrendamento</h4>
                                <div style={grade}>
                                    <div>
                                        <label style={rotulo}>Aluguel mensal (R$)</label>
                                        <input style={campo} value={editando.valor_aluguel} onChange={e => setCampo('valor_aluguel', e.target.value)} placeholder="600,00" />
                                        <p style={ajuda}>Total cobrado de quem ocupa a área. É ele que se divide entre os beneficiários.</p>
                                    </div>
                                    <div><label style={rotulo}>Dia de pagamento</label><input style={campo} value={editando.dia_pagamento} onChange={e => setCampo('dia_pagamento', e.target.value)} /></div>
                                    <div><label style={rotulo}>Início do pagamento</label><input style={campo} value={editando.mes_inicio} onChange={e => setCampo('mes_inicio', e.target.value)} placeholder="Julho/2026" /></div>
                                    <div>
                                        <label style={rotulo}>Índice de reajuste</label>
                                        <select style={campo} value={editando.indice_reajuste} onChange={e => setCampo('indice_reajuste', e.target.value)}>
                                            <option value="IPCA">IPCA</option>
                                            <option value="IGPM">IGPM</option>
                                            <option value="IGPM limitado ao IPCA + 3 p.p.">IGPM com teto no IPCA + 3 p.p.</option>
                                        </select>
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={rotulo}>Observações</label>
                                        <textarea style={{ ...campo, minHeight: '70px', resize: 'vertical' }} value={editando.observacoes} onChange={e => setCampo('observacoes', e.target.value)} />
                                    </div>
                                </div>
                            </div>

                            <div style={card}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                    <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b', fontSize: '0.95rem' }}>
                                        <Users size={18} color="#3b82f6" /> Quem recebe
                                    </h4>
                                    <button type="button" onClick={addBenef} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.9rem', border: '1px solid #bfdbfe', borderRadius: '10px', background: 'white', color: '#3b82f6', fontWeight: 600, cursor: 'pointer', fontSize: '0.82rem' }}>
                                        <Plus size={15} /> Adicionar beneficiário
                                    </button>
                                </div>
                                <p style={{ ...ajuda, marginTop: 0, marginBottom: '1rem' }}>
                                    A forma de pagamento é de cada um, não da área: a mesma terra pode ter um dono recebendo por PIX e
                                    outro por boleto de imobiliária. O boleto em si não se cadastra aqui, porque a linha digitável muda
                                    todo mês e mora na fila de pagamentos.
                                </p>

                                {benefs.map((b, i) => (
                                    <div key={b.id || `novo-${i}`} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', marginBottom: '0.85rem', background: b.tipo === 'casa' ? '#f8fafc' : 'white' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem' }}>
                                            <strong style={{ fontSize: '0.85rem', color: '#334155' }}>{b.nome?.trim() || `Beneficiário ${i + 1}`}</strong>
                                            <button type="button" onClick={() => removerBenef(i)} title="Remover" style={{ padding: '0.35rem', border: '1px solid #fecaca', borderRadius: '8px', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}><Trash2 size={14} /></button>
                                        </div>

                                        <div style={grade}>
                                            <div style={{ gridColumn: '1 / -1' }}>
                                                <label style={rotulo}>Papel</label>
                                                <select style={campo} value={b.tipo} onChange={e => setBenef(i, 'tipo', e.target.value)}>
                                                    <option value="terceiro">{TIPO_ROTULO.terceiro}</option>
                                                    <option value="intermediario">{TIPO_ROTULO.intermediario}</option>
                                                    <option value="casa">{TIPO_ROTULO.casa}</option>
                                                </select>
                                                <p style={ajuda}>
                                                    {b.tipo === 'terceiro' && 'Recebe e assina o contrato como arrendante.'}
                                                    {b.tipo === 'intermediario' && 'Recebe no lugar do proprietário e não assina o contrato.'}
                                                    {b.tipo === 'casa' && 'A B2W é a arrendatária: retém a margem, não recebe repasse e não assina como arrendante.'}
                                                </p>
                                            </div>

                                            <div><label style={rotulo}>Nome</label><input style={campo} value={b.nome} onChange={e => setBenef(i, 'nome', e.target.value)} /></div>
                                            <div><label style={rotulo}>CPF/CNPJ</label><input style={campo} value={b.doc} onChange={e => setBenef(i, 'doc', e.target.value)} /></div>

                                            <div>
                                                <label style={rotulo}>Parte do aluguel</label>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <select
                                                        style={{ ...campo, width: '96px', flexShrink: 0, padding: '0.65rem 0.4rem' }}
                                                        value={b.rateio_tipo}
                                                        onChange={e => setBenef(i, 'rateio_tipo', e.target.value)}
                                                    >
                                                        <option value="percentual">%</option>
                                                        <option value="fixo">R$ fixo</option>
                                                    </select>
                                                    <input
                                                        style={campo}
                                                        value={b.rateio_valor}
                                                        onChange={e => setBenef(i, 'rateio_valor', e.target.value.replace(/[^\d.,]/g, ''))}
                                                        placeholder={b.rateio_tipo === 'fixo' ? '420,00' : '100'}
                                                    />
                                                </div>
                                            </div>

                                            {b.tipo !== 'casa' && (
                                                <div>
                                                    <label style={rotulo}>Forma de pagamento</label>
                                                    <select style={campo} value={b.forma_pagamento} onChange={e => setBenef(i, 'forma_pagamento', e.target.value)}>
                                                        <option value="">— não definida —</option>
                                                        <option value="pix">PIX</option>
                                                        <option value="boleto">Boleto</option>
                                                    </select>
                                                </div>
                                            )}

                                            {b.forma_pagamento === 'pix' && b.tipo !== 'casa' && (
                                                <>
                                                    <div>
                                                        <label style={rotulo}>Tipo da chave</label>
                                                        <select style={campo} value={b.pix_key_type} onChange={e => setBenef(i, 'pix_key_type', e.target.value)}>
                                                            <option value="CPF">CPF</option>
                                                            <option value="CNPJ">CNPJ</option>
                                                            <option value="EMAIL">E-mail</option>
                                                            <option value="TELEFONE">Telefone</option>
                                                            <option value="ALEATORIA">Aleatória</option>
                                                        </select>
                                                    </div>
                                                    <div><label style={rotulo}>Chave PIX</label><input style={campo} value={b.pix_key} onChange={e => setBenef(i, 'pix_key', e.target.value)} /></div>
                                                </>
                                            )}

                                            {b.forma_pagamento === 'boleto' && (
                                                <div style={{ gridColumn: '1 / -1' }}>
                                                    {b.id ? (
                                                        <BoletosDoBeneficiario
                                                            beneficiario={b}
                                                            aoMudar={() => carregarRepasses(editando.id)}
                                                        />
                                                    ) : (
                                                        <p style={{ ...ajuda, color: '#64748b' }}>
                                                            Salve a área primeiro. Depois você cola aqui os 12 boletos do ano de uma vez.
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            {b.tipo === 'terceiro' && (
                                                <>
                                                    <div><label style={rotulo}>Rua</label><input style={campo} value={b.endereco.rua} onChange={e => setBenefEnd(i, 'rua', e.target.value)} /></div>
                                                    <div><label style={rotulo}>Número</label><input style={campo} value={b.endereco.numero} onChange={e => setBenefEnd(i, 'numero', e.target.value)} /></div>
                                                    <div><label style={rotulo}>Bairro</label><input style={campo} value={b.endereco.bairro} onChange={e => setBenefEnd(i, 'bairro', e.target.value)} /></div>
                                                    <div><label style={rotulo}>Cidade</label><input style={campo} value={b.endereco.cidade} onChange={e => setBenefEnd(i, 'cidade', e.target.value)} /></div>
                                                    <div><label style={rotulo}>UF</label><input style={campo} value={b.endereco.uf} onChange={e => setBenefEnd(i, 'uf', e.target.value)} /></div>
                                                    <div><label style={rotulo}>CEP</label><input style={campo} value={b.endereco.cep} onChange={e => setBenefEnd(i, 'cep', e.target.value)} /></div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {previa && (
                                    <div style={{ padding: '0.9rem 1rem', borderRadius: '10px', background: previa.valido ? '#f0fdf4' : '#fffbeb', border: `1px solid ${previa.valido ? '#bbf7d0' : '#fde68a'}`, fontSize: '0.83rem', color: previa.valido ? '#166534' : '#92400e' }}>
                                        {previa.valido ? (
                                            <>
                                                <strong>O rateio fecha.</strong>{' '}
                                                {previa.parcelas.map(p => `${p.nome?.trim() || 'sem nome'} ${dinheiro(p.valor)}`).join(' · ')}
                                                {' '}de {dinheiro(editando.valor_aluguel)}.
                                            </>
                                        ) : (
                                            <>
                                                <strong style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                                                    <AlertTriangle size={15} /> Ainda não dá para salvar:
                                                </strong>
                                                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                                                    {previa.problemas.map((p, i) => <li key={i}>{p}</li>)}
                                                </ul>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {editando.id && (
                                <div style={card}>
                                    <h4 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b', fontSize: '0.95rem' }}>
                                        <Banknote size={18} color="#3b82f6" /> Repasses desta área
                                    </h4>
                                    <p style={{ ...ajuda, marginTop: 0, marginBottom: '1rem' }}>
                                        Cada competência é paga por beneficiário. A linha digitável do boleto se cola aqui,
                                        na competência certa, porque ela muda todo mês.
                                    </p>

                                    {repasses.length === 0 ? (
                                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
                                            Nenhum repasse reconhecido para esta área ainda. A obrigação nasce no fechamento
                                            da usina ou no reconhecimento de pré-operação.
                                        </p>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                                            {repasses.map(r => (
                                                <div key={r.id} style={{ border: '1px solid #f1f5f9', borderRadius: '10px', padding: '0.85rem', background: r.status === 'pago' ? '#f8fafc' : 'white' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
                                                        <span style={{ fontSize: '0.85rem', color: '#334155' }}>
                                                            <strong>{competenciaLegivel(r.competencia)}</strong> · {r.beneficiario?.nome}
                                                            {r.origem === 'b2w_pre_operacao' ? ' · custo da B2W' : ''}
                                                        </span>
                                                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: r.status === 'pago' ? '#166534' : '#1e293b' }}>
                                                            {dinheiro(r.valor)}{r.status === 'pago' ? ' · pago' : ''}
                                                        </span>
                                                    </div>
                                                    {r.status !== 'pago' && (
                                                        <div style={{ marginTop: '0.7rem', paddingTop: '0.7rem', borderTop: '1px dashed #e2e8f0' }}>
                                                            <RepasseAcoes
                                                                linha={r}
                                                                beneficiario={r.beneficiario}
                                                                usinaNome={r.usina?.name}
                                                                aoConcluir={() => carregarRepasses(editando.id)}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                                <button type="button" onClick={() => setEditando(null)} style={{ padding: '0.75rem 1.3rem', background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                                <button type="button" disabled={saving || !previa?.valido} onClick={salvar} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.4rem', background: (saving || !previa?.valido) ? '#94a3b8' : '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: (saving || !previa?.valido) ? 'not-allowed' : 'pointer' }}>
                                    <Save size={16} /> {saving ? 'Salvando…' : 'Salvar área'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
