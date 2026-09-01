import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import { MapPin, Plus, Save, X, Trash2, Search, Building2, Landmark } from 'lucide-react';

/**
 * Áreas arrendadas — cadastro em Configurações.
 *
 * A área é entidade própria, não campo da usina: tem dono, matrícula e
 * vida independente. Pode receber outra usina, pode ser vendida, e o
 * arrendante pode ser sócio do grupo ou terceiro. Daqui saem os dados do
 * Contrato de Arrendamento, e o vínculo com um fornecedor faz o aluguel
 * entrar no split de pagamentos como saída recorrente da usina.
 */

const VAZIO = {
    nome: '',
    arrendante_nome: '',
    arrendante_doc: '',
    arrendante_endereco: { cep: '', rua: '', numero: '', bairro: '', cidade: '', uf: '' },
    supplier_id: '',
    matricula: '',
    cartorio: '',
    endereco: { cep: '', rua: '', numero: '', bairro: '', cidade: '', uf: '' },
    coordenadas: '',
    area_m2: '',
    valor_aluguel: '',
    repasse_tipo: 'percentual',
    repasse_valor: '',
    dia_pagamento: 5,
    mes_inicio: '',
    indice_reajuste: 'IPCA',
    comarca: '',
    observacoes: ''
};

/**
 * Quanto do aluguel vai ao arrendante e quanto fica com o grupo.
 *
 * O aluguel é o que a Associação arrecada de quem ocupa a área (o
 * investidor). O repasse é o que sai no split para o dono da área. A
 * diferença remunera a intermediação — por isso repasse maior que o
 * aluguel é erro de digitação, não um negócio possível.
 */
const dinheiro = (v) => `R$ ${(Number(String(v ?? '').replace(',', '.')) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const calcularRepasse = (aluguel, tipo, valor) => {
    const base = Number(String(aluguel ?? '').replace(',', '.')) || 0;
    const bruto = valor === '' || valor === null || valor === undefined
        ? null
        : Number(String(valor).replace(',', '.'));

    if (bruto === null || !Number.isFinite(bruto)) {
        return { definido: false, repasse: 0, retido: base, percentual: 0 };
    }

    const repasse = tipo === 'fixo' ? bruto : base * (bruto / 100);
    return {
        definido: true,
        repasse,
        retido: base - repasse,
        percentual: base > 0 ? (repasse / base) * 100 : 0,
        excede: repasse > base + 0.005
    };
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

export default function LeasedAreasSettings() {
    const { showAlert, showConfirm } = useUI();
    const [areas, setAreas] = useState([]);
    const [fornecedores, setFornecedores] = useState([]);
    const [usinasPorArea, setUsinasPorArea] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busca, setBusca] = useState('');
    const [editando, setEditando] = useState(null);

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            const [{ data: as }, { data: fs }, { data: us }] = await Promise.all([
                supabase.from('leased_areas').select('*').order('nome'),
                supabase.from('suppliers').select('id, name').order('name'),
                supabase.from('usinas').select('id, name, leased_area_id').not('leased_area_id', 'is', null)
            ]);
            setAreas(as || []);
            setFornecedores(fs || []);

            // Quantas usinas cada área abriga — impede apagar área em uso.
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

    const abrir = (area) => setEditando(area ? {
        ...VAZIO, ...area,
        arrendante_endereco: { ...VAZIO.arrendante_endereco, ...(area.arrendante_endereco || {}) },
        endereco: { ...VAZIO.endereco, ...(area.endereco || {}) },
        supplier_id: area.supplier_id || ''
    } : { ...VAZIO });

    const salvar = async () => {
        if (!editando.nome?.trim()) {
            showAlert('Dê um nome à área para poder identificá-la depois.', 'warning');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                nome: editando.nome.trim(),
                arrendante_nome: editando.arrendante_nome || null,
                arrendante_doc: editando.arrendante_doc || null,
                arrendante_endereco: editando.arrendante_endereco,
                // String vazia num campo uuid é erro do Postgres, não "sem valor".
                supplier_id: editando.supplier_id || null,
                matricula: editando.matricula || null,
                cartorio: editando.cartorio || null,
                endereco: editando.endereco,
                coordenadas: editando.coordenadas || null,
                area_m2: editando.area_m2 === '' ? null : Number(editando.area_m2),
                valor_aluguel: editando.valor_aluguel === '' ? null : Number(String(editando.valor_aluguel).replace(',', '.')),
                repasse_tipo: editando.repasse_tipo === 'fixo' ? 'fixo' : 'percentual',
                // Nulo é "repasse ainda não definido", que é diferente de zero:
                // zero significa que nada vai ao arrendante.
                repasse_valor: editando.repasse_valor === '' || editando.repasse_valor === null ? null : Number(String(editando.repasse_valor).replace(',', '.')),
                dia_pagamento: editando.dia_pagamento === '' ? null : Number(editando.dia_pagamento),
                mes_inicio: editando.mes_inicio || null,
                indice_reajuste: editando.indice_reajuste || 'IPCA',
                comarca: editando.comarca || null,
                observacoes: editando.observacoes || null,
                updated_at: new Date().toISOString()
            };

            const { error } = editando.id
                ? await supabase.from('leased_areas').update(payload).eq('id', editando.id)
                : await supabase.from('leased_areas').insert(payload);

            if (error) throw error;

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
        return !t || [a.nome, a.arrendante_nome, a.matricula, a.endereco?.cidade].some(v => (v || '').toLowerCase().includes(t));
    });

    const setCampo = (chave, valor) => setEditando(prev => ({ ...prev, [chave]: valor }));
    const setEnd = (grupo, chave, valor) => setEditando(prev => ({ ...prev, [grupo]: { ...prev[grupo], [chave]: valor } }));

    return (
        <div>
            <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                        <MapPin size={20} color="#3b82f6" /> Áreas Arrendadas
                    </h3>
                    <p style={{ margin: '0.4rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                        Alimentam o Contrato de Arrendamento e, quando vinculadas a um fornecedor, o split de pagamentos da usina.
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
                        placeholder="Buscar por nome, arrendante, matrícula ou cidade"
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
                            return (
                                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '1rem', border: '1px solid #f1f5f9', borderRadius: '12px', flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, color: '#1e293b' }}>{a.nome}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
                                            {a.arrendante_nome || 'arrendante não informado'}
                                            {a.area_m2 ? ` · ${a.area_m2} m²` : ''}
                                            {a.valor_aluguel ? ` · ${dinheiro(a.valor_aluguel)}/mês` : ''}
                                            {a.repasse_valor !== null && a.repasse_valor !== undefined
                                                ? ` · repasse ${dinheiro(calcularRepasse(a.valor_aluguel, a.repasse_tipo, a.repasse_valor).repasse)}`
                                                : ''}
                                            {a.matricula ? ` · matrícula ${a.matricula}` : ''}
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: usinas.length ? '#166534' : '#94a3b8', marginTop: '0.2rem' }}>
                                            {usinas.length ? `Usina: ${usinas.join(', ')}` : 'Sem usina vinculada'}
                                        </div>
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
                                        <input style={campo} value={editando.nome} onChange={e => setCampo('nome', e.target.value)} placeholder="Ex.: Área Vista Bom Jesus" />
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
                                    <Building2 size={18} color="#3b82f6" /> Arrendante
                                </h4>
                                <div style={grade}>
                                    <div><label style={rotulo}>Nome</label><input style={campo} value={editando.arrendante_nome} onChange={e => setCampo('arrendante_nome', e.target.value)} /></div>
                                    <div><label style={rotulo}>CPF/CNPJ</label><input style={campo} value={editando.arrendante_doc} onChange={e => setCampo('arrendante_doc', e.target.value)} /></div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={rotulo}>Fornecedor vinculado (para o aluguel entrar no split)</label>
                                        <select style={campo} value={editando.supplier_id} onChange={e => setCampo('supplier_id', e.target.value)}>
                                            <option value="">— sem vínculo —</option>
                                            {fornecedores.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                        </select>
                                    </div>
                                    <div><label style={rotulo}>Rua</label><input style={campo} value={editando.arrendante_endereco.rua} onChange={e => setEnd('arrendante_endereco', 'rua', e.target.value)} /></div>
                                    <div><label style={rotulo}>Número</label><input style={campo} value={editando.arrendante_endereco.numero} onChange={e => setEnd('arrendante_endereco', 'numero', e.target.value)} /></div>
                                    <div><label style={rotulo}>Bairro</label><input style={campo} value={editando.arrendante_endereco.bairro} onChange={e => setEnd('arrendante_endereco', 'bairro', e.target.value)} /></div>
                                    <div><label style={rotulo}>Cidade</label><input style={campo} value={editando.arrendante_endereco.cidade} onChange={e => setEnd('arrendante_endereco', 'cidade', e.target.value)} /></div>
                                    <div><label style={rotulo}>UF</label><input style={campo} value={editando.arrendante_endereco.uf} onChange={e => setEnd('arrendante_endereco', 'uf', e.target.value)} /></div>
                                    <div><label style={rotulo}>CEP</label><input style={campo} value={editando.arrendante_endereco.cep} onChange={e => setEnd('arrendante_endereco', 'cep', e.target.value)} /></div>
                                </div>
                            </div>

                            <div style={card}>
                                <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b', fontSize: '0.95rem' }}>
                                    <MapPin size={18} color="#3b82f6" /> Endereço do imóvel
                                </h4>
                                <div style={grade}>
                                    <div><label style={rotulo}>Rua</label><input style={campo} value={editando.endereco.rua} onChange={e => setEnd('endereco', 'rua', e.target.value)} /></div>
                                    <div><label style={rotulo}>Número</label><input style={campo} value={editando.endereco.numero} onChange={e => setEnd('endereco', 'numero', e.target.value)} /></div>
                                    <div><label style={rotulo}>Bairro</label><input style={campo} value={editando.endereco.bairro} onChange={e => setEnd('endereco', 'bairro', e.target.value)} /></div>
                                    <div><label style={rotulo}>Cidade</label><input style={campo} value={editando.endereco.cidade} onChange={e => setEnd('endereco', 'cidade', e.target.value)} /></div>
                                    <div><label style={rotulo}>UF</label><input style={campo} value={editando.endereco.uf} onChange={e => setEnd('endereco', 'uf', e.target.value)} /></div>
                                    <div><label style={rotulo}>CEP</label><input style={campo} value={editando.endereco.cep} onChange={e => setEnd('endereco', 'cep', e.target.value)} /></div>
                                    <div><label style={rotulo}>Comarca (foro)</label><input style={campo} value={editando.comarca} onChange={e => setCampo('comarca', e.target.value)} placeholder="Situação do imóvel" /></div>
                                </div>
                            </div>

                            <div style={card}>
                                <h4 style={{ margin: '0 0 1rem 0', color: '#1e293b', fontSize: '0.95rem' }}>Condições do arrendamento</h4>
                                <div style={grade}>
                                    <div>
                                        <label style={rotulo}>Aluguel mensal (R$)</label>
                                        <input style={campo} value={editando.valor_aluguel} onChange={e => setCampo('valor_aluguel', e.target.value)} placeholder="600,00" />
                                        <p style={ajuda}>Cobrado de quem ocupa a área e arrecadado pela Associação.</p>
                                    </div>
                                    <div>
                                        <label style={rotulo}>Repasse ao arrendante</label>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <select
                                                style={{ ...campo, width: '96px', flexShrink: 0, padding: '0.65rem 0.4rem' }}
                                                value={editando.repasse_tipo || 'percentual'}
                                                onChange={e => setCampo('repasse_tipo', e.target.value)}
                                            >
                                                <option value="percentual">%</option>
                                                <option value="fixo">R$ fixo</option>
                                            </select>
                                            <input
                                                style={campo}
                                                value={editando.repasse_valor ?? ''}
                                                onChange={e => setCampo('repasse_valor', e.target.value.replace(/[^\d.,]/g, ''))}
                                                placeholder={editando.repasse_tipo === 'fixo' ? '420,00' : '70'}
                                            />
                                        </div>
                                        <p style={ajuda}>Sai no split para o dono da área. A diferença fica com o grupo pela intermediação.</p>
                                    </div>
                                    <div><label style={rotulo}>Dia de pagamento</label><input style={campo} value={editando.dia_pagamento} onChange={e => setCampo('dia_pagamento', e.target.value)} /></div>
                                    <div><label style={rotulo}>Início do pagamento</label><input style={campo} value={editando.mes_inicio} onChange={e => setCampo('mes_inicio', e.target.value)} placeholder="Março/2026" /></div>
                                    <div>
                                        <label style={rotulo}>Índice de reajuste</label>
                                        <select style={campo} value={editando.indice_reajuste} onChange={e => setCampo('indice_reajuste', e.target.value)}>
                                            <option value="IPCA">IPCA</option>
                                            <option value="IGPM">IGPM</option>
                                            <option value="IGPM limitado ao IPCA + 3 p.p.">IGPM com teto no IPCA + 3 p.p.</option>
                                        </select>
                                    </div>
                                    {(() => {
                                        const r = calcularRepasse(editando.valor_aluguel, editando.repasse_tipo, editando.repasse_valor);
                                        if (!r.definido) return null;
                                        return (
                                            <div style={{ gridColumn: '1 / -1', padding: '0.85rem 1rem', background: r.excede ? '#fffbeb' : '#f8fafc', border: `1px solid ${r.excede ? '#fde68a' : '#e2e8f0'}`, borderRadius: '10px', fontSize: '0.83rem', color: r.excede ? '#92400e' : '#475569' }}>
                                                {r.excede
                                                    ? `O repasse de ${dinheiro(r.repasse)} é maior que o aluguel de ${dinheiro(editando.valor_aluguel)}: o grupo pagaria ${dinheiro(-r.retido)} por mês para intermediar.`
                                                    : `Do aluguel de ${dinheiro(editando.valor_aluguel)}, vão ${dinheiro(r.repasse)} ao arrendante e ficam ${dinheiro(r.retido)} com o grupo${r.percentual ? ` (${(100 - r.percentual).toFixed(1).replace('.', ',')}% de intermediação)` : ''}.`}
                                            </div>
                                        );
                                    })()}

                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={rotulo}>Observações</label>
                                        <textarea style={{ ...campo, minHeight: '70px', resize: 'vertical' }} value={editando.observacoes} onChange={e => setCampo('observacoes', e.target.value)} />
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                                <button type="button" onClick={() => setEditando(null)} style={{ padding: '0.75rem 1.3rem', background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                                <button type="button" disabled={saving} onClick={salvar} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.4rem', background: saving ? '#94a3b8' : '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
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
