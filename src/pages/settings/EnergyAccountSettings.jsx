import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Zap, Save } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

export default function EnergyAccountSettings() {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [autoPayment, setAutoPayment] = useState(false);

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('integrations_config')
                .select('*')
                .eq('service_name', 'energy_rules')
                .single();

            if (data && data.variables) {
                setAutoPayment(!!data.variables.auto_payment);
            }
        } catch (err) {
            console.error('Error fetching energy rules:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = () => {
        setAutoPayment(!autoPayment);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const { error } = await supabase
                .from('integrations_config')
                .upsert({
                    service_name: 'energy_rules',
                    variables: { auto_payment: autoPayment },
                    updated_at: new Date().toISOString()
                }, { onConflict: 'service_name' });

            if (error) throw error;
            showAlert('Configurações salvas com sucesso!', 'success');
        } catch (err) {
            console.error('Error saving energy rules:', err);
            showAlert('Erro ao salvar: ' + err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
            <div className="spinner-border spinner-border-sm me-2" role="status"></div>
            Carregando configurações...
        </div>
    );

    return (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', animation: 'fadeIn 0.3s ease-out' }}>
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
            
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ padding: '0.5rem', background: '#fff', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                    <Zap size={20} color="#eab308" />
                </div>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b' }}>Conta de Energia</h3>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>Configure as regras de processamento das contas de energia.</p>
                </div>
            </div>

            <div style={{ padding: '2rem' }}>
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    padding: '1.5rem', 
                    background: '#f8fafc', 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0',
                    marginBottom: '2rem'
                }}>
                    <div>
                        <h4 style={{ margin: '0 0 0.25rem 0', color: '#1e293b', fontWeight: 600 }}>Pagamento Automático</h4>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', maxWidth: '450px' }}>
                            Quando ativado, o sistema realizará o pagamento automático da conta de energia junto à concessionária assim que o pagamento da fatura do assinante for confirmado.
                        </p>
                    </div>

                    <button 
                        onClick={handleToggle}
                        style={{
                            width: '56px',
                            height: '28px',
                            borderRadius: '99px',
                            background: autoPayment ? '#10b981' : '#cbd5e1',
                            border: 'none',
                            position: 'relative',
                            cursor: 'pointer',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            padding: 0
                        }}
                        title={autoPayment ? "Desativar" : "Ativar"}
                    >
                        <div style={{
                            width: '22px',
                            height: '22px',
                            background: 'white',
                            borderRadius: '50%',
                            position: 'absolute',
                            top: '3px',
                            left: autoPayment ? '31px' : '3px',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }} />
                    </button>
                </div>

                <div style={{ 
                    padding: '1rem', 
                    background: '#fffbeb', 
                    borderRadius: '8px', 
                    border: '1px solid #fef3c7',
                    marginBottom: '2rem',
                    display: 'flex',
                    gap: '0.75rem',
                    alignItems: 'flex-start'
                }}>
                    <div style={{ color: '#d97706', marginTop: '2px' }}><Zap size={16} /></div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#92400e', lineHeight: '1.4' }}>
                        <strong>Nota:</strong> Esta funcionalidade requer saldo disponível na conta da integração financeira para ser executada com sucesso.
                    </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.8rem 2rem',
                            background: '#0284c7',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            boxShadow: '0 4px 6px -1px rgba(2, 132, 199, 0.2)',
                            transition: 'all 0.2s'
                        }}
                    >
                        {saving ? 'Salvando...' : <><Save size={18} /> Salvar Alterações</>}
                    </button>
                </div>
            </div>
        </div>
    );
}
