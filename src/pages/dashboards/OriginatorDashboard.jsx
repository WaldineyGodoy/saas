import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

export default function OriginatorDashboard() {
    const { user, profile } = useAuth();
    const [leads, setLeads] = useState([]);
    const [commissions, setCommissions] = useState([]);

    // Logic to generate unique link
    const uniqueLink = `${window.location.origin}/simulacao?id=${profile?.id}`;

    useEffect(() => {
        async function fetchData() {
            // Find originator by user_id linked to auth


            // Wait! If I am ADMIN visiting this dashboard, 'user.id' is MY admin ID.
            // If I am Admin, I am not in 'originators_v2' linked to my profile.
            // BUT OriginatorDashboard is usually for the logged in user.
            // If Admin visits, how do they see *this specific originator's* dashboard?
            // They don't. They use 'OriginatorList'.
            // The user said "Opção B: Adicionar uma seção dentro do `OriginatorDashboard.jsx`".
            // AND "botão... só deve ser processado por admin".
            // Maybe the user logs in as Admin and goes to /originator_dashboard? No.

            // IF the user means "The Originator sees the statement, but ONLY the Admin can click the button",
            // that implies the Admin *sees* this dashboard.
            // OR the user is confused about where the Admin operates.
            // OR Option B implies "Put it in the dashboard view, I (Admin) will login as Originator to test? No."

            // I'll stick to: Add logic. If I am Admin, I see button.
            // But HOW does Admin see this dashboard?
            // Maybe I should add a way for Admin to "view as" originator?
            // Or maybe the user plans to put this Component in `OriginatorList` later?

            // I will implement it as requested.
            // Fetch:
            const { data: origData } = await supabase.from('originators_v2').select('id, name, pix_key, pix_key_type').eq('user_id', user.id).single();

            if (origData) {
                // Fetch Leads
                const { data: leadsData } = await supabase.from('leads').select('*').eq('originator_id', origData.id);
                setLeads(leadsData || []);

                // Fetch Commissions
                // Assuming 'commissions' table exists. If not, it will be empty or error (catch?).
                const { data: commData, error } = await supabase
                    .from('commissions')
                    .select('*')
                    .eq('originator_id', origData.id)
                    .order('reference_month', { ascending: false });

                if (!error) setCommissions(commData || []);
            }
        }
        if (user) fetchData();
    }, [user]);

    const copyLink = () => {
        navigator.clipboard.writeText(uniqueLink);
        alert('Link copiado!');
    };

    const handlePayCommission = async (commission) => {
        if (commission.status === 'paid') return;

        // Check for Admin Role
        if (profile?.role !== 'admin' && profile?.role !== 'super_admin') {
            alert('Apenas administradores podem realizar pagamentos.');
            return;
        }

        // We need the originator's pix key.
        // We can get it from the state we fetched inside useEffect? we didn't save it to state.
        // Let's refactor to save originator to state OR fetch properly.
        // I'll fetch it again or store it.

        const { data: orig, error } = await supabase.from('originators_v2').select('pix_key, pix_key_type, name').eq('id', commission.originator_id).single();
        if (error || !orig) {
            alert('Erro ao buscar dados do originador.');
            return;
        }

        if (!orig.pix_key) {
            alert('Originador sem Chave Pix cadastrada.');
            return;
        }

        if (!confirm(`Confirmar pagamento de ${Number(commission.total_value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} via PIX para ${orig.name}?`)) return;

        try {
            const { data, error } = await supabase.functions.invoke('transfer-asaas-pix', {
                body: {
                    value: commission.total_value,
                    pix_key: orig.pix_key,
                    pix_key_type: orig.pix_key_type,
                    description: `Comissão - ${new Date(commission.reference_month).toLocaleDateString()}`,
                    operationType: 'PIX'
                }
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error || 'Erro no pagamento');

            alert('Pagamento enviado! ID: ' + data.data?.id);

            // Update Commission Status
            await supabase.from('commissions').update({
                status: 'paid',
                payment_id: data.data.id,
                payment_date: new Date()
            }).eq('id', commission.id);

            // Refresh? Trigger fetch?
            window.location.reload(); // Simple refresh for now or move fetch to function
        } catch (error) {
            console.error(error);
            alert('Erro: ' + error.message);
        }
    };

    return (
        <div>
            <h2>Painel do Originador</h2>

            <div className="card" style={{ marginBottom: '2rem' }}>
                <h3 style={{ color: 'var(--color-text-dark)', fontSize: '1.1rem' }}>Seu Link de Indicação</h3>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                    <input
                        value={uniqueLink}
                        readOnly
                        className="input"
                        style={{ background: 'var(--color-bg-light)', color: 'var(--color-text-medium)' }}
                    />
                    <button onClick={copyLink} className="btn btn-accent">Copiar</button>
                </div>
            </div>

            <h3 style={{ marginBottom: '1rem' }}>Meus Leads</h3>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>Status</th>
                                <th>Data</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leads.map(lead => (
                                <tr key={lead.id}>
                                    <td>{lead.name}</td>
                                    <td>
                                        <span className="badge badge-neutral">{lead.status}</span>
                                    </td>
                                    <td>{new Date(lead.created_at).toLocaleDateString()}</td>
                                </tr>
                            ))}
                            {leads.length === 0 && (
                                <tr>
                                    <td colSpan="3" style={{ textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhum lead encontrado.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <h3 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Extrato Financeiro (Comissões)</h3>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Mês Ref.</th>
                                <th>Faturas Proc.</th>
                                <th>Valor (R$)</th>
                                <th>Status</th>
                                <th>Data Pagt.</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {commissions.length === 0 ? (
                                <tr>
                                    <td colSpan="6" style={{ textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhuma comissão registrada.</td>
                                </tr>
                            ) : (
                                commissions.map(c => (
                                    <tr key={c.id}>
                                        <td>{new Date(c.reference_month).toLocaleDateString()}</td>
                                        <td>{c.total_invoices}</td>
                                        <td style={{ fontWeight: 'bold', color: 'var(--color-success)' }}>
                                            {Number(c.total_value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </td>
                                        <td>
                                            <span className={`badge ${c.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>
                                                {c.status === 'paid' ? 'Pago' : 'Pendente'}
                                            </span>
                                        </td>
                                        <td>
                                            {c.payment_date ? new Date(c.payment_date).toLocaleDateString() : '-'}
                                        </td>
                                        <td>
                                            {c.status !== 'paid' && (profile?.role === 'admin' || profile?.role === 'super_admin') && (
                                                <button
                                                    onClick={() => handlePayCommission(c)}
                                                    className="btn"
                                                    style={{ background: 'var(--color-success)', color: 'white', padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                                                >
                                                    Pagar
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div >
    );
}
