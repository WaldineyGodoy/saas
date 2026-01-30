import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { X, Plus, Calendar, DollarSign, FileText } from 'lucide-react';
import PlantClosingModal from './PlantClosingModal';

export default function PlantClosingsHistoryModal({ usina, onClose }) {
    const { showAlert } = useUI();
    const [closings, setClosings] = useState([]);
    const [loading, setLoading] = useState(true);

    // Sub-modal state for creating/editing a closing
    const [selectedClosingId, setSelectedClosingId] = useState(null);
    const [isFormOpen, setIsFormOpen] = useState(false);

    useEffect(() => {
        if (usina) {
            fetchClosings();
        }
    }, [usina]);

    const fetchClosings = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('plant_closings')
            .select('*')
            .eq('usina_id', usina.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching closings', error);
        } else {
            setClosings(data || []);
        }
        setLoading(false);
    };

    const handleEdit = (id) => {
        setSelectedClosingId(id);
        setIsFormOpen(true);
    };

    const handleNew = () => {
        setSelectedClosingId(null);
        setIsFormOpen(true);
    };

    const handleFormSave = () => {
        fetchClosings(); // Refresh list
    };

    const formatCurrency = (val) => {
        return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1050
        }}>
            {/* If Form is Open, render it ON TOP or instead. To avoid nesting issues, we can render it conditionally */}
            {isFormOpen && (
                <PlantClosingModal
                    usina={usina}
                    closingId={selectedClosingId}
                    onClose={() => setIsFormOpen(false)}
                    onSave={handleFormSave}
                />
            )}

            <div style={{ background: 'white', borderRadius: '12px', width: '90%', maxWidth: '800px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>

                {/* Header */}
                <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b' }}>Fechamentos Mensais</h3>
                        <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Histórico financeiro da usina {usina.name}</p>
                    </div>
                    <button onClick={onClose}><X size={24} color="#94a3b8" /></button>
                </div>

                {/* Toolbar */}
                <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={handleNew}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            background: 'var(--color-blue)', color: 'white',
                            padding: '0.6rem 1.2rem', borderRadius: '6px',
                            border: 'none', fontWeight: 600, cursor: 'pointer'
                        }}
                    >
                        <Plus size={18} /> Novo Fechamento
                    </button>
                </div>

                {/* List */}
                <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, background: '#f1f5f9' }}>

                    {loading ? <p>Carregando...</p> : closings.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', background: 'white', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                            <FileText size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                            <p>Nenhum fechamento registrado para esta usina.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '1rem' }}>
                            {closings.map(closing => (
                                <div key={closing.id} style={{ background: 'white', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                                        <div style={{ background: '#eff6ff', padding: '0.8rem', borderRadius: '8px', textAlign: 'center', minWidth: '80px' }}>
                                            <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Mês/Ano</div>
                                            <div style={{ fontWeight: 'bold', color: '#1e40af' }}>{closing.ref_month}/{closing.ref_year}</div>
                                        </div>

                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                                                <span style={{
                                                    fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 'bold', padding: '0.2rem 0.5rem', borderRadius: '99px',
                                                    background: closing.status === 'fechado' ? '#dcfce7' : '#ffedd5',
                                                    color: closing.status === 'fechado' ? '#166534' : '#9a3412'
                                                }}>
                                                    {closing.status}
                                                </span>
                                                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Criado em {new Date(closing.created_at).toLocaleDateString()}</span>
                                            </div>
                                            <div style={{ fontSize: '0.9rem', color: '#475569' }}>
                                                Faturas: <strong>{formatCurrency(closing.faturas_pagas_base)}</strong> | Despesas: <strong>{formatCurrency(closing.total_despesas)}</strong>
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Saldo Líquido</div>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: closing.saldo_liquido < 0 ? '#ef4444' : '#166534' }}>
                                            {formatCurrency(closing.saldo_liquido)}
                                        </div>
                                        <button
                                            onClick={() => handleEdit(closing.id)}
                                            style={{ marginTop: '0.5rem', background: 'none', border: 'none', color: '#3b82f6', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
                                        >
                                            Ver Detalhes
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
