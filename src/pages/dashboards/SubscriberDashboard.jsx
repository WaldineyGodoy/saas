import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import InvoiceFormModal from '../../components/InvoiceFormModal';
import ConsumerUnitModal from '../../components/ConsumerUnitModal';

export default function SubscriberDashboard() {
    const { user, profile } = useAuth();
    const [ucs, setUcs] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeSubscriberId, setActiveSubscriberId] = useState(null);

    // Modal State
    const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState(null);
    const [isUCModalOpen, setIsUCModalOpen] = useState(false);

    // Permission Check
    const canManageInvoices = ['super_admin', 'admin', 'manager'].includes(profile?.role);

    useEffect(() => {
        if (user) {
            fetchData();
        }
    }, [user]);

    const fetchData = async () => {
        try {
            setLoading(true);
            let targetSubscriberId;

            // If admin/manager viewing the dashboard, they might want to see specific user data
            // For now, in this view (which is primarily the subscriber's view), we assume:
            // 1. If subscriber, show own data.
            // 2. If admin, we SHOULD probably have a way to pick which subscriber they are viewing.
            //    But for this "Subscriber View" in the sidebar, let's assume it shows data linked to the current user 
            //    OR if the user is an admin they need to select a subscriber.
            //    
            //    For Simplicity in this iteration: We fetch data linked to the current user account (if he has a subscriber profile)
            //    OR if we are testing as admin, we need to create a subscriber profile for the admin or link one.

            // To make it robust:
            const { data: subData } = await supabase.from('subscribers').select('id, name').eq('profile_id', user.id).single();

            if (subData) {
                targetSubscriberId = subData.id;
                setActiveSubscriberId(subData.id);
                // 2. Get UCs
                const { data: ucsData } = await supabase.from('consumer_units').select('*').eq('subscriber_id', targetSubscriberId);
                setUcs(ucsData || []);

                // 3. Get Invoices for these UCs
                if (ucsData && ucsData.length > 0) {
                    const ucIds = ucsData.map(uc => uc.id);
                    const { data: invData } = await supabase
                        .from('invoices')
                        .select('*')
                        .in('uc_id', ucIds)
                        .order('vencimento', { ascending: false });
                    setInvoices(invData || []);
                }
            } else if (canManageInvoices) {
                // Admin mode for managing invoices generally?
                // For now, let's just warn or show everything if no specific subscriber linked
                // Ideally, Admins go via "User Management" -> "View User" -> "Invoices".
                // But let's fetch ALL invoices for now if Admin has no personal subscriber profile, for testing.
                const { data: ucsData } = await supabase.from('consumer_units').select('*');
                setUcs(ucsData || []);
                if (ucsData && ucsData.length > 0) {
                    const { data: invData } = await supabase
                        .from('invoices')
                        .select('*')
                        .order('vencimento', { ascending: false })
                        .limit(50); // Limit for safety
                    setInvoices(invData || []);
                }
            }

        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleInvoiceSaved = (savedInvoice) => {
        // Refresh list logic or optimistic update
        const exists = invoices.find(i => i.id === savedInvoice.id);
        if (exists) {
            setInvoices(invoices.map(i => i.id === savedInvoice.id ? savedInvoice : i));
        } else {
            setInvoices([savedInvoice, ...invoices]);
        }
        alert('Fatura salva com sucesso!');
    };

    const totalEconomia = invoices.reduce((acc, inv) => acc + (inv.economia_reais || 0), 0);
    const ultimaFatura = invoices[0];

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Visão Geral do Assinante</h2>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    {canManageInvoices && (
                        <>
                            <button
                                onClick={() => setIsUCModalOpen(true)}
                                className="btn btn-secondary"
                            >
                                + Cadastrar UC
                            </button>
                            <button
                                onClick={() => { setEditingInvoice(null); setIsInvoiceModalOpen(true); }}
                                className="btn btn-primary"
                            >
                                + Nova Fatura
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                <div className="card">
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--color-text-medium)', marginBottom: '0.5rem' }}>Economia Acumulada</h3>
                    <p style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--color-success)' }}>R$ {totalEconomia.toFixed(2)}</p>
                </div>
                <div className="card">
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--color-text-medium)', marginBottom: '0.5rem' }}>Última Fatura</h3>
                    <p style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--color-blue)' }}>
                        {ultimaFatura ? `R$ ${ultimaFatura.valor_a_pagar?.toFixed(2)}` : '-'}
                    </p>
                    <small style={{ color: 'var(--color-text-light)' }}>{ultimaFatura ? new Date(ultimaFatura.vencimento).toLocaleDateString() : ''}</small>
                </div>
                <div className="card">
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--color-text-medium)', marginBottom: '0.5rem' }}>Unidades Consumidoras</h3>
                    <p style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--color-text-dark)' }}>{ucs.length}</p>
                </div>
            </div>

            <h3>Minhas Faturas</h3>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {invoices.length === 0 ? (
                    <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhuma fatura encontrada.</p>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg-light)', textAlign: 'left' }}>
                                <th style={{ padding: '1rem', color: 'var(--color-text-medium)', fontWeight: '600', fontSize: '0.85rem' }}>Vencimento</th>
                                <th style={{ padding: '1rem', color: 'var(--color-text-medium)', fontWeight: '600', fontSize: '0.85rem' }}>Consumo</th>
                                <th style={{ padding: '1rem', color: 'var(--color-text-medium)', fontWeight: '600', fontSize: '0.85rem' }}>Valor</th>
                                <th style={{ padding: '1rem', color: 'var(--color-text-medium)', fontWeight: '600', fontSize: '0.85rem' }}>Economia</th>
                                <th style={{ padding: '1rem', color: 'var(--color-text-medium)', fontWeight: '600', fontSize: '0.85rem' }}>Status</th>
                                <th style={{ padding: '1rem', color: 'var(--color-text-medium)', fontWeight: '600', fontSize: '0.85rem' }}>Ação</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map(inv => (
                                <tr key={inv.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '1rem', fontSize: '0.9rem' }}>{new Date(inv.vencimento).toLocaleDateString()}</td>
                                    <td style={{ padding: '1rem', fontSize: '0.9rem' }}>{inv.consumo_kwh} kWh</td>
                                    <td style={{ padding: '1rem', fontWeight: 'bold', fontSize: '0.9rem' }}>R$ {inv.valor_a_pagar?.toFixed(2)}</td>
                                    <td style={{ padding: '1rem', color: 'var(--color-success)', fontWeight: 'bold', fontSize: '0.9rem' }}>R$ {inv.economia_reais?.toFixed(2)}</td>
                                    <td style={{ padding: '1rem' }}>
                                        <span className={`badge ${inv.status === 'pago' ? 'badge-success' : 'badge-error'}`}>
                                            {inv.status === 'pago' ? 'Pago' : 'A Vencer'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        {canManageInvoices ? (
                                            <button
                                                onClick={() => { setEditingInvoice(inv); setIsInvoiceModalOpen(true); }}
                                                className="btn btn-secondary"
                                                style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                                            >
                                                Editar
                                            </button>
                                        ) : (
                                            <button
                                                className="btn btn-secondary"
                                                style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                                            >
                                                Ver Boleto
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {isInvoiceModalOpen && (
                <InvoiceFormModal
                    invoice={editingInvoice}
                    ucs={ucs}
                    onClose={() => setIsInvoiceModalOpen(false)}
                    onSave={handleInvoiceSaved}
                />
            )}

            {isUCModalOpen && (
                <ConsumerUnitModal
                    consumerUnit={{ subscriber_id: activeSubscriberId }}
                    onClose={() => setIsUCModalOpen(false)}
                    onSave={() => { fetchData(); setIsUCModalOpen(false); }}
                />
            )}
        </div>
    );
}

