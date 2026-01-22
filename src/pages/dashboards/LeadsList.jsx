import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import LeadModal from '../../components/LeadModal';
import SubscriberModal from '../../components/SubscriberModal';

export default function LeadsList() {
    const { profile } = useAuth();
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubscriberModalOpen, setIsSubscriberModalOpen] = useState(false);
    const [editingLead, setEditingLead] = useState(null);
    const [leadToConvert, setLeadToConvert] = useState(null);
    const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban'
    const [searchTerm, setSearchTerm] = useState('');

    const filteredLeads = leads.filter(lead => {
        if (!searchTerm) return true;
        const lowerTerm = searchTerm.toLowerCase();
        return (
            lead.name?.toLowerCase().includes(lowerTerm) ||
            lead.email?.toLowerCase().includes(lowerTerm) ||
            lead.phone?.includes(lowerTerm)
        );
    });

    useEffect(() => {
        fetchLeads();
    }, []);

    const fetchLeads = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('leads')
                .select(`
                    *,
                    originator:originator_id (name)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setLeads(data || []);
        } catch (error) {
            console.error('Error fetching leads:', error);
            // alert('Erro ao buscar leads'); // Suppress for now if empty
        } finally {
            setLoading(false);
        }
    };

    const handleSave = (savedLead) => {
        const exists = leads.find(l => l.id === savedLead.id);
        if (exists) {
            setLeads(leads.map(l => l.id === savedLead.id ? { ...l, ...savedLead } : l)); // Optimistic-ish update
            fetchLeads(); // Refresh to get relationships if needed
        } else {
            setLeads([savedLead, ...leads]);
            fetchLeads();
        }
    };

    const handleDelete = (deletedLeadId) => {
        setLeads(leads.filter(l => l.id !== deletedLeadId));
    };

    const handleConvert = (lead) => {
        setLeadToConvert(lead);
        setIsSubscriberModalOpen(true);
    };

    const handleSubscriberSaved = async (newSubscriber) => {
        // Update lead status to 'em_negociacao' as requested
        try {
            await supabase.from('leads').update({ status: 'em_negociacao' }).eq('id', leadToConvert.id);
            fetchLeads();
            alert('Lead convertido em Assinante! Status atualizado para "Em Negociação".');
        } catch (e) {
            console.error('Erro ao atualizar status do lead', e);
        }
    };

    // Color mapping for Kanban statuses
    const statusColors = {
        simulacao: '#64748b', // Slate
        indicado: '#0ea5e9', // Sky Blue
        em_negociacao: '#eab308', // Yellow/Gold
        ativo: '#22c55e', // Green
        negocio_perdido: '#ef4444', // Red
        pago: '#8b5cf6' // Violet
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Gestão de Leads</h2>
                <button
                    onClick={() => { setEditingLead(null); setIsModalOpen(true); }}
                    className="btn btn-primary"
                >
                    + Novo Lead
                </button>
            </div>

            {/* Controls Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flex: 1, alignItems: 'center' }}>
                    <input
                        type="text"
                        placeholder="Buscar por nome, email ou telefone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input"
                        style={{ maxWidth: '350px' }}
                    />
                    <div className="btn-group" style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Lista
                        </button>
                        <button
                            onClick={() => setViewMode('kanban')}
                            className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Kanban
                        </button>
                    </div>
                </div>
            </div>

            {loading ? <p>Carregando...</p> : (
                <>
                    {viewMode === 'list' ? (
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div className="table-container">
                                {filteredLeads.length === 0 ? (
                                    <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhum lead encontrado.</p>
                                ) : (
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Nome</th>
                                                <th>Contato</th>
                                                <th>Status</th>
                                                <th>Originador</th>
                                                <th>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredLeads.map(lead => (
                                                <tr key={lead.id}>
                                                    <td style={{ fontWeight: 'bold' }}>{lead.name}</td>
                                                    <td>
                                                        <div style={{ fontSize: '0.9rem' }}>{lead.email}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)' }}>{lead.phone}</div>
                                                    </td>
                                                    <td>
                                                        <span style={{
                                                            padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: '500',
                                                            background: lead.status === 'simulacao' ? '#f1f5f9' :
                                                                lead.status === 'em_negociacao' ? '#fef9c3' :
                                                                    lead.status === 'ativo' ? '#dcfce7' : '#f1f5f9',
                                                            color: lead.status === 'simulacao' ? '#64748b' :
                                                                lead.status === 'em_negociacao' ? '#a16207' :
                                                                    lead.status === 'ativo' ? '#166534' : '#64748b'
                                                        }}>
                                                            {lead.status.toUpperCase().replace('_', ' ')}
                                                        </span>
                                                    </td>
                                                    <td>{lead.originator?.name || '-'}</td>
                                                    <td style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            onClick={() => { setEditingLead(lead); setIsModalOpen(true); }}
                                                            className="btn btn-secondary"
                                                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                                                        >
                                                            Editar
                                                        </button>
                                                        {lead.status !== 'convertido' && (
                                                            <button
                                                                onClick={() => handleConvert(lead)}
                                                                className="btn"
                                                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', border: '1px solid var(--color-success)', color: 'var(--color-success)', background: 'white' }}
                                                            >
                                                                Converter
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                            {['simulacao', 'indicado', 'em_negociacao', 'ativo', 'negocio_perdido', 'pago'].map(status => {
                                const leadsInStatus = filteredLeads.filter(l => l.status === status);
                                const statusColor = statusColors[status] || '#64748b';

                                return (
                                    <div key={status} style={{ minWidth: '280px', flex: 1, background: 'var(--color-bg-light)', borderRadius: 'var(--radius-md)', padding: '0.5rem', borderTop: `4px solid ${statusColor}`, boxShadow: 'var(--shadow-sm)' }}>
                                        <h4 style={{
                                            padding: '0.8rem', borderBottom: '1px solid var(--color-border)', background: 'white', borderRadius: 'var(--radius-sm)',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem',
                                            color: statusColor // Text color matches the border
                                        }}>
                                            <span style={{ textTransform: 'uppercase', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                {status.replace('_', ' ')}
                                            </span>
                                            <span style={{ fontSize: '0.8rem', background: statusColor, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                                                {leadsInStatus.length}
                                            </span>
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {leadsInStatus.map(lead => (
                                                <div
                                                    key={lead.id}
                                                    onClick={() => { setEditingLead(lead); setIsModalOpen(true); }}
                                                    style={{
                                                        background: 'white', padding: '1rem', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)',
                                                        cursor: 'pointer', border: '1px solid transparent', transition: '0.2s'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-blue)'}
                                                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                                                >
                                                    <div style={{ fontWeight: 'bold', marginBottom: '0.3rem', color: 'var(--color-text-dark)' }}>{lead.name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {lead.email}
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)', marginTop: '0.2rem' }}>
                                                        {lead.phone}
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.8rem', fontSize: '0.75rem', color: 'var(--color-text-light)' }}>
                                                        <span>{lead.originator?.name?.split(' ')[0]}</span>
                                                        <span>{new Date(lead.created_at).toLocaleDateString()}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {isModalOpen && (
                <LeadModal
                    lead={editingLead}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onConvert={handleConvert}
                />
            )}

            {isSubscriberModalOpen && (
                <SubscriberModal
                    subscriber={leadToConvert ? {
                        ...leadToConvert,
                        id: null, // New subscriber, don't pass Lead ID as Subscriber ID
                        status: 'ativacao', // Force valid subscriber status (fix enum error)
                        originator_id: leadToConvert.originator_id // Pass originator linkage
                    } : null}
                    onClose={() => setIsSubscriberModalOpen(false)}
                    onSave={handleSubscriberSaved}
                />
            )}
        </div>
    );
}
