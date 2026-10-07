import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useUI } from '../../contexts/UIContext';
import { ehPapelInterno } from '../../lib/papeis';
import EletropostoModal from '../../components/EletropostoModal';
import { STATUS_ELETROPOSTO, statusConfig, filtrarEletropostos, usinaDoEletroposto } from '../../lib/eletropostos';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    closestCorners,
    DragOverlay,
    useDroppable
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const SELECT_ELETROPOSTO = `
    *,
    consumer_unit:consumer_unit_id (id, numero_uc, status, usina:usina_id (id, name, status)),
    originator:originator_id (id, name),
    plano:plano_id (id, nome),
    fornecedores:eletroposto_fornecedores (id, supplier_id, percentual, ativo, supplier:supplier_id (id, name))
`;

const buscarEletropostos = () =>
    supabase.from('eletropostos').select(SELECT_ELETROPOSTO).order('created_at', { ascending: false });

const FILTROS_VAZIOS ={ busca: '', status: '', usinaId: '', supplierId: '', originatorId: '' };

const nomesFornecedores = (e) =>
    (e.fornecedores || [])
        .filter(f => f.ativo)
        .map(f => `${f.supplier?.name || 'Fornecedor'} (${Number(f.percentual)}%)`)
        .join(', ');

function StatusBadge({ status }) {
    const cfg = statusConfig(status);
    return (
        <span style={{
            display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '99px',
            fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase',
            background: cfg.bg, color: cfg.color
        }}>
            {cfg.label}
        </span>
    );
}

function KanbanCard({ eletroposto, onClick, isOverlay, podeArrastar }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: eletroposto.id, disabled: !!isOverlay || !podeArrastar });
    const usina = usinaDoEletroposto(eletroposto);
    const socios = nomesFornecedores(eletroposto);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        zIndex: isDragging ? 1000 : 1,
        position: 'relative',
        width: isOverlay ? '300px' : 'auto'
    };

    return (
        <div
            ref={setNodeRef}
            className="kanban-card"
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(eletroposto)}
        >
            <div style={{ marginBottom: '0.5rem' }}><StatusBadge status={eletroposto.status} /></div>
            <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)', lineHeight: 1.2, marginBottom: '0.5rem' }}>
                {eletroposto.nome}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-blue)', background: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    UC {eletroposto.consumer_unit?.numero_uc || '—'}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#166534', background: '#dcfce7', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {usina?.name || 'Sem usina'}
                </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '0.3rem' }}>
                {socios || 'Sem fornecedor'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{eletroposto.endereco?.cidade ? `${eletroposto.endereco.cidade}/${eletroposto.endereco.uf || ''}` : '—'}</span>
                <span>{eletroposto.originator?.name || ''}</span>
            </div>
        </div>
    );
}

function KanbanColumn({ status, label, color, itens, onCardClick, podeArrastar }) {
    const { setNodeRef, isOver } = useDroppable({ id: status });
    return (
        <div
            ref={setNodeRef}
            className="kanban-column"
            style={{ borderTop: `4px solid ${color}`, background: isOver ? '#e2e8f0' : '#f8fafc', transition: 'background 0.2s ease' }}
        >
            <div className="kanban-column-header" style={{ color }}>
                <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>{label}</span>
                <span style={{ fontSize: '0.8rem', background: color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                    {itens.length}
                </span>
            </div>
            <div className="kanban-column-content">
                <SortableContext items={itens.map(e => e.id)} strategy={verticalListSortingStrategy}>
                    {itens.map(e => (
                        <KanbanCard key={e.id} eletroposto={e} onClick={onCardClick} podeArrastar={podeArrastar} />
                    ))}
                </SortableContext>
            </div>
        </div>
    );
}

export default function EletropostoList() {
    const { profile } = useAuth();
    const { showAlert } = useUI();
    const podeEditar = ehPapelInterno(profile?.role);

    const [eletropostos, setEletropostos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState(null);
    const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
    const [viewMode, setViewMode] = useState('kanban');
    const [activeId, setActiveId] = useState(null);
    const [modalAberto, setModalAberto] = useState(false);
    const [emEdicao, setEmEdicao] = useState(null);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

    // O "Carregando..." so aparece na primeira carga; recarregar depois de
    // salvar troca os dados sem piscar a tela.
    const aplicar = useCallback(({ data, error }) => {
        setErro(error ? error.message : null);
        setEletropostos(data || []);
        setLoading(false);
    }, []);

    const carregar = useCallback(async () => aplicar(await buscarEletropostos()), [aplicar]);

    useEffect(() => {
        let vivo = true;
        buscarEletropostos().then(r => { if (vivo) aplicar(r); });
        return () => { vivo = false; };
    }, [aplicar]);

    const filtrados = useMemo(() => filtrarEletropostos(eletropostos, filtros), [eletropostos, filtros]);

    // Opcoes dos filtros saem do que foi carregado: so aparece o que existe.
    const opcoes = useMemo(() => {
        const usinas = new Map();
        const fornecedores = new Map();
        const originadores = new Map();
        for (const e of eletropostos) {
            const u = usinaDoEletroposto(e);
            if (u) usinas.set(u.id, u.name);
            for (const f of e.fornecedores || []) if (f.supplier) fornecedores.set(f.supplier_id, f.supplier.name);
            if (e.originator) originadores.set(e.originator_id, e.originator.name);
        }
        const ordenar = (m) => [...m.entries()]
            .map(([id, nome]) => ({ id, nome }))
            .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
        return { usinas: ordenar(usinas), fornecedores: ordenar(fornecedores), originadores: ordenar(originadores) };
    }, [eletropostos]);

    const filtro = (nome) => ({
        value: filtros[nome],
        onChange: (ev) => setFiltros(f => ({ ...f, [nome]: ev.target.value })),
    });

    const abrir = (e) => { setEmEdicao(e); setModalAberto(true); };

    const handleDragEnd = async ({ active, over }) => {
        setActiveId(null);
        if (!over || !podeEditar) return;

        const alvoEhColuna = STATUS_ELETROPOSTO.some(s => s.status === over.id);
        const novoStatus = alvoEhColuna ? over.id : eletropostos.find(e => e.id === over.id)?.status;
        const atual = eletropostos.find(e => e.id === active.id);
        if (!novoStatus || !atual || atual.status === novoStatus) return;

        setEletropostos(lista => lista.map(e => (e.id === active.id ? { ...e, status: novoStatus } : e)));
        const { data, error } = await supabase
            .from('eletropostos')
            .update({ status: novoStatus })
            .eq('id', active.id)
            .select('id');
        if (error || !data?.length) {
            showAlert('Não foi possível mudar o status: ' + (error?.message || 'sem permissão.'), 'error');
            carregar();
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Eletropostos</h2>
                {podeEditar && (
                    <button onClick={() => abrir(null)} className="btn btn-primary">+ Novo Eletroposto</button>
                )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                <input className="input" style={{ maxWidth: '320px' }} placeholder="Buscar por nome, UC ou cidade..." {...filtro('busca')} />
                <select className="input" style={{ maxWidth: '180px' }} {...filtro('status')}>
                    <option value="">Todos os status</option>
                    {STATUS_ELETROPOSTO.map(s => <option key={s.status} value={s.status}>{s.label}</option>)}
                </select>
                <select className="input" style={{ maxWidth: '200px' }} {...filtro('usinaId')}>
                    <option value="">Todas as usinas</option>
                    {opcoes.usinas.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
                <select className="input" style={{ maxWidth: '200px' }} {...filtro('supplierId')}>
                    <option value="">Todos os fornecedores</option>
                    {opcoes.fornecedores.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
                <select className="input" style={{ maxWidth: '200px' }} {...filtro('originatorId')}>
                    <option value="">Todos os originadores</option>
                    {opcoes.originadores.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
                <button type="button" className="btn btn-secondary" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar</button>
                <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <button onClick={() => setViewMode('list')} className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`} style={{ borderRadius: 0, border: 'none' }}>
                        Lista
                    </button>
                    <button onClick={() => setViewMode('kanban')} className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`} style={{ borderRadius: 0, border: 'none' }}>
                        Kanban
                    </button>
                </div>
            </div>

            {erro && <p style={{ color: '#991b1b' }}>Erro ao carregar eletropostos: {erro}</p>}

            {loading ? <p>Carregando...</p> : viewMode === 'list' ? (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="table-container">
                        {filtrados.length === 0 ? (
                            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhum eletroposto encontrado.</p>
                        ) : (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Nome / Cidade</th>
                                        <th>UC / Usina</th>
                                        <th>Fornecedores</th>
                                        <th>Originador</th>
                                        <th>Status</th>
                                        <th>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtrados.map(e => (
                                        <tr key={e.id}>
                                            <td>
                                                <div style={{ fontWeight: 'bold' }}>{e.nome}</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)' }}>
                                                    {e.endereco?.cidade ? `${e.endereco.cidade}/${e.endereco.uf || ''}` : '—'}
                                                </div>
                                            </td>
                                            <td>
                                                <div>{e.consumer_unit?.numero_uc || '—'}</div>
                                                <div style={{ fontSize: '0.85rem', color: '#166534' }}>{usinaDoEletroposto(e)?.name || 'Sem usina'}</div>
                                            </td>
                                            <td style={{ fontSize: '0.85rem' }}>{nomesFornecedores(e) || '—'}</td>
                                            <td>{e.originator?.name || '—'}</td>
                                            <td><StatusBadge status={e.status} /></td>
                                            <td>
                                                <button onClick={() => abrir(e)} className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
                                                    {podeEditar ? 'Editar' : 'Ver'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={({ active }) => setActiveId(active.id)}
                    onDragEnd={handleDragEnd}
                    onDragCancel={() => setActiveId(null)}
                >
                    <div className="kanban-box">
                        <div className="kanban-board">
                            {STATUS_ELETROPOSTO.map(({ status, label, color }) => (
                                <KanbanColumn
                                    key={status}
                                    status={status}
                                    label={label}
                                    color={color}
                                    itens={filtrados.filter(e => e.status === status)}
                                    onCardClick={abrir}
                                    podeArrastar={podeEditar}
                                />
                            ))}
                        </div>
                    </div>
                    <DragOverlay adjustScale={true}>
                        {activeId ? (
                            <KanbanCard eletroposto={eletropostos.find(e => e.id === activeId)} isOverlay={true} podeArrastar={false} />
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}

            {modalAberto && (
                <EletropostoModal
                    eletroposto={emEdicao}
                    somenteLeitura={!podeEditar}
                    onClose={() => setModalAberto(false)}
                    onSave={() => { setModalAberto(false); carregar(); }}
                    onDelete={(id) => { setModalAberto(false); setEletropostos(lista => lista.filter(e => e.id !== id)); }}
                />
            )}
        </div>
    );
}
