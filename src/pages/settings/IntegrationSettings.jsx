import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Save, Eye, EyeOff, Plus, Trash2, Server } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

export default function IntegrationSettings({ serviceName, title, description }) {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(false);
    const [showKey, setShowKey] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        endpoint_url: '',
        api_key: '',
        secret_key: '',
        variables: [] // Array of { key, value } for UI
    });

    useEffect(() => {
        fetchConfig();
    }, [serviceName]);

    const fetchConfig = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('integrations_config')
            .select('*')
            .eq('service_name', serviceName)
            .single();

        if (data) {
            // Convert JSONB object to array for UI
            const varsArray = data.variables
                ? Object.entries(data.variables).map(([k, v]) => ({ key: k, value: v }))
                : [];

            setFormData({
                endpoint_url: data.endpoint_url || '',
                api_key: data.api_key || '',
                secret_key: data.secret_key || '',
                variables: varsArray
            });
        } else if (error && error.code !== 'PGRST116') {
            console.error('Error fetching config:', error);
        }
        setLoading(false);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);

        // Convert array back to object
        const varsObject = formData.variables.reduce((acc, curr) => {
            if (curr.key) acc[curr.key] = curr.value;
            return acc;
        }, {});

        const payload = {
            service_name: serviceName,
            endpoint_url: formData.endpoint_url,
            api_key: formData.api_key,
            secret_key: formData.secret_key,
            variables: varsObject,
            updated_at: new Date().toISOString()
        };

        // Upsert based on service_name
        const { error } = await supabase
            .from('integrations_config')
            .upsert(payload, { onConflict: 'service_name' });

        setLoading(false);
        if (error) {
            showAlert('Erro ao salvar configurações: ' + error.message, 'error');
        } else {
            showAlert('Configurações salvas com sucesso!', 'success');
        }
    };

    // Variable Handlers
    const addVariable = () => {
        setFormData(prev => ({
            ...prev,
            variables: [...prev.variables, { key: '', value: '' }]
        }));
    };

    const removeVariable = (index) => {
        setFormData(prev => ({
            ...prev,
            variables: prev.variables.filter((_, i) => i !== index)
        }));
    };

    const updateVariable = (index, field, val) => {
        const newVars = [...formData.variables];
        newVars[index][field] = val;
        setFormData(prev => ({ ...prev, variables: newVars }));
    };

    // Test Area State
    const [testPhone, setTestPhone] = useState('');
    const [testMessage, setTestMessage] = useState('Teste de conexão Evolution API');
    const [testMediaUrl, setTestMediaUrl] = useState('');
    const [sendingTest, setSendingTest] = useState(false);

    const handleSendTest = async () => {
        if (!testPhone) {
            showAlert('Informe um número de telefone para teste.', 'error');
            return;
        }

        setSendingTest(true);
        try {
            const { data, error } = await supabase.functions.invoke('send-whatsapp', {
                body: {
                    text: testMessage,
                    phone: testPhone,
                    mediaUrl: testMediaUrl, // Pass mediaUrl if present
                    // We don't verify Instance Name here, the Function does it by reading DB config
                }
            });

            if (error) throw new Error(error.message);
            if (data?.error) throw new Error(data.error);

            showAlert('Mensagem de teste enviada com sucesso!', 'success');
        } catch (err) {
            console.error(err);
            showAlert('Falha no teste: ' + err.message, 'error');
        } finally {
            setSendingTest(false);
        }
    };

    return (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ padding: '0.5rem', background: '#fff', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        <Server size={20} color="#475569" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b' }}>{title}</h3>
                        <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>{description}</p>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSave} style={{ padding: '2rem' }}>
                {/* ... fields ... */}
                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>Endpoint URL</label>
                    <input
                        type="url"
                        placeholder="https://api.exemplo.com/v1"
                        value={formData.endpoint_url}
                        onChange={e => setFormData({ ...formData, endpoint_url: e.target.value })}
                        style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>API Key / Token</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showKey ? "text" : "password"}
                                value={formData.api_key}
                                onChange={e => setFormData({ ...formData, api_key: e.target.value })}
                                style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowKey(!showKey)}
                                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                            >
                                {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>Secret Key (Opcional)</label>
                        <input
                            type="password"
                            value={formData.secret_key}
                            onChange={e => setFormData({ ...formData, secret_key: e.target.value })}
                            style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                        />
                    </div>
                </div>

                {/* Specific Fields for Evolution API */}
                {serviceName === 'evolution_api' && (
                    <>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>Nome da Instância</label>
                            <input
                                placeholder="Nome da Instância (ex: minha-instancia)"
                                value={formData.variables.find(v => v.key === 'instance_name')?.value || ''}
                                onChange={e => {
                                    const val = e.target.value;
                                    setFormData(prev => {
                                        const exists = prev.variables.some(v => v.key === 'instance_name');
                                        let newVars;
                                        if (exists) {
                                            newVars = prev.variables.map(v => v.key === 'instance_name' ? { ...v, value: val } : v);
                                        } else {
                                            newVars = [...prev.variables, { key: 'instance_name', value: val }];
                                        }
                                        return { ...prev, variables: newVars };
                                    });
                                }}
                                style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                            />
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>Nome da instância criada na Evolution API.</p>
                        </div>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>URL da Mídia (Convite)</label>
                            <input
                                type="url"
                                placeholder="https://exemplo.com/imagem.png"
                                value={formData.variables.find(v => v.key === 'invite_media_url')?.value || ''}
                                onChange={e => {
                                    const val = e.target.value;
                                    setFormData(prev => {
                                        const exists = prev.variables.some(v => v.key === 'invite_media_url');
                                        let newVars;
                                        if (exists) {
                                            newVars = prev.variables.map(v => v.key === 'invite_media_url' ? { ...v, value: val } : v);
                                        } else {
                                            newVars = [...prev.variables, { key: 'invite_media_url', value: val }];
                                        }
                                        return { ...prev, variables: newVars };
                                    });
                                }}
                                style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                            />
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>Imagem enviada junto com o convite.</p>
                        </div>
                    </>
                )}

                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <label style={{ fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>Variáveis de Ambiente / Parâmetros Extras</label>
                        <button
                            type="button"
                            onClick={addVariable}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#2563eb', background: '#eff6ff', padding: '0.4rem 0.8rem', borderRadius: '99px', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                        >
                            <Plus size={14} /> Adicionar Variável
                        </button>
                    </div>

                    {formData.variables.length === 0 && (
                        <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '6px', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem', border: '1px dashed #cbd5e1' }}>
                            Nenhuma variável configurada.
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        {formData.variables.map((v, index) => {
                            // Hide explicit instance_name from generic list in Evolution API view to avoid redundancy
                            if (serviceName === 'evolution_api' && (v.key === 'instance_name' || v.key === 'invite_media_url')) return null;

                            return (
                                <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '1rem', alignItems: 'center' }}>
                                    <input
                                        placeholder="Nome da Variável (ex: instance_name)"
                                        value={v.key}
                                        onChange={e => updateVariable(index, 'key', e.target.value)}
                                        style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                                    />
                                    <input
                                        placeholder="Valor"
                                        value={v.value}
                                        onChange={e => updateVariable(index, 'value', e.target.value)}
                                        style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeVariable(index)}
                                        style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '0.4rem' }}
                                        title="Remover"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
                    <button
                        type="submit"
                        disabled={loading}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 2rem', background: '#0284c7', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(2, 132, 199, 0.2)' }}
                    >
                        {loading ? 'Salvando...' : <><Save size={18} /> Salvar Configurações</>}
                    </button>
                </div>

                {/* TEST AREA - Evolution API */}
                {serviceName === 'evolution_api' && (
                    <div style={{ borderTop: '2px dashed #cbd5e1', paddingTop: '2rem' }}>
                        <h4 style={{ margin: '0 0 1rem 0', color: '#334155' }}>Teste de Conexão</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: '1rem', alignItems: 'end' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: '#64748b' }}>Número (com DDI)</label>
                                <input
                                    placeholder="5511999999999"
                                    value={testPhone}
                                    onChange={e => setTestPhone(e.target.value.replace(/\D/g, ''))}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: '#64748b' }}>URL da Mídia (Opcional)</label>
                                <input
                                    placeholder="https://..."
                                    value={testMediaUrl}
                                    onChange={e => setTestMediaUrl(e.target.value)}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: '#64748b' }}>Mensagem / Legenda</label>
                                <input
                                    value={testMessage}
                                    onChange={e => setTestMessage(e.target.value)}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleSendTest}
                                disabled={sendingTest || !testPhone}
                                style={{ padding: '0.7rem 1.5rem', background: sendingTest ? '#94a3b8' : '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: sendingTest ? 'default' : 'pointer', fontWeight: 600 }}
                            >
                                {sendingTest ? 'Enviando...' : 'Enviar Teste'}
                            </button>
                        </div>
                    </div>
                )}

                {/* TEST AREA - Financial API (Asaas) */}
                {serviceName === 'financial_api' && (
                    <div style={{ borderTop: '2px dashed #cbd5e1', paddingTop: '2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h4 style={{ margin: '0 0 0.5rem 0', color: '#334155' }}>Teste de Conexão (Asaas)</h4>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Verifica se o endpoint e o token estão corretos.</p>
                            </div>
                            <button
                                type="button"
                                onClick={async () => {
                                    setLoading(true);
                                    try {
                                        const { data, error } = await supabase.functions.invoke('manage-asaas-customer', {
                                            body: { test: true }
                                        });
                                        if (error) throw error;
                                        if (data?.success) {
                                            showAlert(data.message || 'Conexão OK!', 'success');
                                        } else {
                                            throw new Error(data?.error || 'Erro desconhecido');
                                        }
                                    } catch (err) {
                                        console.error(err);
                                        showAlert('Falha na conexão: ' + err.message, 'error');
                                    } finally {
                                        setLoading(false);
                                    }
                                }}
                                disabled={loading || !formData.api_key || !formData.endpoint_url}
                                style={{ padding: '0.7rem 1.5rem', background: loading ? '#94a3b8' : '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: loading ? 'default' : 'pointer', fontWeight: 600 }}
                            >
                                {loading ? 'Testando...' : 'Testar Conexão'}
                            </button>
                        </div>
                    </div>
                )}
            </form>
        </div>
    );
}
