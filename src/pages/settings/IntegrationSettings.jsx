import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Save, Eye, EyeOff, Plus, Trash2, Server, HelpCircle, X, Zap } from 'lucide-react';
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
        sandbox_endpoint_url: '',
        sandbox_api_key: '',
        sandbox_secret_key: '',
        environment: 'production',
        variables: [] // Array of { key, value } for UI
    });
    const [allowAutoRedemption, setAllowAutoRedemption] = useState(false);
    const [autoPayment, setAutoPayment] = useState(false);

    // Custom Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: null,
        targetEnv: ''
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
                endpoint_url: data.endpoint_url || (serviceName === 'autentique_api' ? 'https://api.autentique.com.br/v2/graphql' : ''),
                api_key: data.api_key || '',
                secret_key: data.secret_key || '',
                sandbox_endpoint_url: data.sandbox_endpoint_url || (serviceName === 'autentique_api' ? 'https://api.autentique.com.br/v2/graphql' : ''),
                sandbox_api_key: data.sandbox_api_key || '',
                sandbox_secret_key: data.sandbox_secret_key || '',
                environment: data.environment || 'production',
                variables: varsArray
            });

            if (serviceName === 'financial_api') {
                setAllowAutoRedemption(!!data.variables?.allow_auto_redemption);
                setAutoPayment(!!data.variables?.auto_payment);
            }

            // Inicializa o telefone/email de teste se houver salvo nas variáveis
            const savedTestValue = varsArray.find(v => v.key === 'test_phone')?.value || '';
            if (savedTestValue) setTestPhone(savedTestValue);
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
            sandbox_endpoint_url: formData.sandbox_endpoint_url,
            sandbox_api_key: formData.sandbox_api_key,
            sandbox_secret_key: formData.sandbox_secret_key,
            environment: formData.environment,
            variables: varsObject,
            updated_at: new Date().toISOString()
        };

        if (serviceName === 'financial_api') {
            payload.variables.allow_auto_redemption = allowAutoRedemption;
            payload.variables.auto_payment = autoPayment;
        }

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
    const [testEmail, setTestEmail] = useState('');
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

            if (error) {
                let msg = error.message;
                // If it's a FunctionsHttpError, the body might be in error.context
                try {
                    const body = await error.context?.json();
                    if (body && (body.error || body.message)) msg = body.error || body.message;
                } catch (e) {}
                throw new Error(msg);
            }
            if (data?.error) throw new Error(data.error);

            showAlert('Mensagem de teste enviada com sucesso!', 'success');
        } catch (err) {
            console.error(err);
            showAlert('Falha no teste: ' + err.message, 'error');
        } finally {
            setSendingTest(false);
        }
    };

    const handleSendTestEmail = async () => {
        if (!testEmail) {
            showAlert('Informe um e-mail para teste.', 'error');
            return;
        }

        setSendingTest(true);
        try {
            const { data, error } = await supabase.functions.invoke('send-email', {
                body: {
                    to: testEmail,
                    subject: 'Teste de E-mail CRM - B2W Energia',
                    html: null,
                    variables: {
                        nome: 'Assinante de Teste',
                        valor: 'R$ 1.250,00',
                        vencimento: '10/04/2026',
                        mensagem: testMessage
                    }
                }
            });

            if (error) {
                let msg = error.message;
                try {
                    const body = await error.context?.json();
                    if (body && (body.error || body.message)) msg = body.error || body.message;
                } catch (e) {}
                throw new Error(msg);
            }
            if (data?.error) throw new Error(data.error);

            showAlert('E-mail de teste enviado com sucesso!', 'success');
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

                {(serviceName === 'financial_api' || serviceName === 'autentique_api') && (
                    <div style={{ display: 'flex', background: '#e2e8f0', padding: '4px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                        <button
                            type="button"
                            onClick={() => {
                                if (formData.environment === 'production') return;
                                setConfirmModal({
                                    isOpen: true,
                                    title: 'Alterar Ambiente',
                                    message: 'Deseja alterar o ambiente para Produção?',
                                    targetEnv: 'Produção',
                                    onConfirm: () => setFormData({ ...formData, environment: 'production' })
                                });
                            }}
                            style={{
                                flex: 1,
                                padding: '8px 16px',
                                borderRadius: '6px',
                                border: 'none',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                background: formData.environment === 'production' ? '#3b82f6' : 'transparent',
                                color: formData.environment === 'production' ? 'white' : '#64748b',
                                transition: 'all 0.2s'
                            }}
                        >
                            Api de Produção
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (formData.environment === 'sandbox') return;
                                setConfirmModal({
                                    isOpen: true,
                                    title: 'Alterar Ambiente',
                                    message: 'Deseja alterar o ambiente para Sandbox?',
                                    targetEnv: 'Sandbox',
                                    onConfirm: () => setFormData({ ...formData, environment: 'sandbox' })
                                });
                            }}
                            style={{
                                flex: 1,
                                padding: '8px 16px',
                                borderRadius: '6px',
                                border: 'none',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                background: formData.environment === 'sandbox' ? '#3b82f6' : 'transparent',
                                color: formData.environment === 'sandbox' ? 'white' : '#64748b',
                                transition: 'all 0.2s'
                            }}
                        >
                            Api sandBox
                        </button>
                    </div>
                )}
            </div>

            <form onSubmit={handleSave} style={{ padding: '2rem' }}>
                {(serviceName === 'financial_api' || serviceName === 'autentique_api') && formData.environment === 'sandbox' && (
                    <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#fffbeb', borderRadius: '8px', border: '1px solid #fde68a' }}>
                        <h4 style={{ margin: '0 0 1rem 0', color: '#92400e', fontSize: '0.95rem' }}>Configurações de Sandbox</h4>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#92400e', fontSize: '0.9rem' }}>Sandbox Endpoint URL</label>
                            <input
                                type="url"
                                placeholder={serviceName === 'autentique_api' ? "https://api.autentique.com.br/v2/graphql" : "https://sandbox.asaas.com/api/v3"}
                                value={formData.sandbox_endpoint_url}
                                onChange={e => setFormData({ ...formData, sandbox_endpoint_url: e.target.value })}
                                style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #fcd34d', fontSize: '0.95rem', background: '#fff' }}
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#92400e', fontSize: '0.9rem' }}>Sandbox API Key</label>
                                <input
                                    type="password"
                                    value={formData.sandbox_api_key}
                                    onChange={e => setFormData({ ...formData, sandbox_api_key: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #fcd34d', fontSize: '0.95rem', background: '#fff' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#92400e', fontSize: '0.9rem' }}>{serviceName === 'financial_api' ? 'Webhook Access Token' : 'Sandbox Secret Key (Opcional)'}</label>
                                <input
                                    type="password"
                                    value={formData.sandbox_secret_key}
                                    placeholder={serviceName === 'financial_api' ? 'Token definido no Webhook do Asaas' : ''}
                                    onChange={e => setFormData({ ...formData, sandbox_secret_key: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #fcd34d', fontSize: '0.95rem', background: '#fff' }}
                                />
                                {serviceName === 'financial_api' && <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.75rem', color: '#b45309' }}>Use este token se configurado no painel de Webhooks do Asaas.</p>}
                            </div>
                        </div>
                    </div>
                )}
                {/* Production Fields - Visible only in production mode or for other services */}
                {((serviceName !== 'financial_api' && serviceName !== 'autentique_api') || formData.environment === 'production') && (
                    <>
                        {serviceName !== 'resend_api' && (
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>Endpoint URL</label>
                                <input
                                    type="url"
                                    placeholder={serviceName === 'autentique_api' ? "https://api.autentique.com.br/v2/graphql" : "https://api.exemplo.com/v1"}
                                    value={formData.endpoint_url}
                                    onChange={e => setFormData({ ...formData, endpoint_url: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                                />
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: serviceName === 'resend_api' ? '1fr' : '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
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
                            {serviceName !== 'resend_api' && (
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>{serviceName === 'financial_api' ? 'Webhook Access Token' : 'Secret Key (Opcional)'}</label>
                                    <input
                                        type="password"
                                        value={formData.secret_key}
                                        placeholder={serviceName === 'financial_api' ? 'Token definido no Webhook do Asaas' : ''}
                                        onChange={e => setFormData({ ...formData, secret_key: e.target.value })}
                                        style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                                    />
                                    {serviceName === 'financial_api' && <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>Deve ser idêntico ao Token configurado no painel de Webhooks do Asaas.</p>}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* Specific Fields for Resend API */}
                {serviceName === 'resend_api' && (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>E-mail do Remetente</label>
                                <input
                                    placeholder="faturas@comunicacao.seusite.com.br"
                                    value={formData.variables.find(v => v.key === 'from_email')?.value || ''}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setFormData(prev => {
                                            const exists = prev.variables.some(v => v.key === 'from_email');
                                            let newVars;
                                            if (exists) {
                                                newVars = prev.variables.map(v => v.key === 'from_email' ? { ...v, value: val } : v);
                                            } else {
                                                newVars = [...prev.variables, { key: 'from_email', value: val }];
                                            }
                                            return { ...prev, variables: newVars };
                                        });
                                    }}
                                    style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                                />
                                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>Deve estar verificado no painel do Resend.</p>
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>Nome do Remetente</label>
                                <input
                                    placeholder="B2W Energia"
                                    value={formData.variables.find(v => v.key === 'from_name')?.value || ''}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setFormData(prev => {
                                            const exists = prev.variables.some(v => v.key === 'from_name');
                                            let newVars;
                                            if (exists) {
                                                newVars = prev.variables.map(v => v.key === 'from_name' ? { ...v, value: val } : v);
                                            } else {
                                                newVars = [...prev.variables, { key: 'from_name', value: val }];
                                            }
                                            return { ...prev, variables: newVars };
                                        });
                                    }}
                                    style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                                />
                                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>Ex: B2W Energia</p>
                            </div>
                        </div>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>E-mail de Teste (Redirecionamento Sandbox)</label>
                            <input
                                placeholder="seuemail@exemplo.com"
                                value={formData.variables.find(v => v.key === 'test_email')?.value || ''}
                                onChange={e => {
                                    const val = e.target.value;
                                    setTestEmail(val);
                                    setFormData(prev => {
                                        const exists = prev.variables.some(v => v.key === 'test_email');
                                        let newVars;
                                        if (exists) {
                                            newVars = prev.variables.map(v => v.key === 'test_email' ? { ...v, value: val } : v);
                                        } else {
                                            newVars = [...prev.variables, { key: 'test_email', value: val }];
                                        }
                                        return { ...prev, variables: newVars };
                                    });
                                }}
                                style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                            />
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>E-mail que recebe todos os disparos quando o modo Sandbox está ativo.</p>
                        </div>
                    </>
                ) // End Resend Specific Fields
                }

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

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>Telefone de Teste (WhatsApp)</label>
                            <input
                                placeholder="5511999999999"
                                value={formData.variables.find(v => v.key === 'test_phone')?.value || ''}
                                onChange={e => {
                                    const val = e.target.value.replace(/\D/g, '');
                                    setTestPhone(val);
                                    setFormData(prev => {
                                        const exists = prev.variables.some(v => v.key === 'test_phone');
                                        let newVars;
                                        if (exists) {
                                            newVars = prev.variables.map(v => v.key === 'test_phone' ? { ...v, value: val } : v);
                                        } else {
                                            newVars = [...prev.variables, { key: 'test_phone', value: val }];
                                        }
                                        return { ...prev, variables: newVars };
                                    });
                                }}
                                style={{ width: '100%', padding: '0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                            />
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>Número utilizado para disparos em modo Sandbox.</p>
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
                            if (serviceName === 'evolution_api' && (v.key === 'instance_name' || v.key === 'invite_media_url' || v.key === 'test_phone')) return null;

                            // Hide explicit Resend fields from generic list
                            if (serviceName === 'resend_api' && (v.key === 'from_email' || v.key === 'from_name' || v.key === 'test_email')) return null;

                            // Hide allow_auto_redemption from generic list
                            if (serviceName === 'financial_api' && v.key === 'allow_auto_redemption') return null;

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

                {/* Specific Fields for Financial API (Asaas) */}
                {serviceName === 'financial_api' && (
                    <div className="premium-card" style={{ marginBottom: '2.5rem', overflow: 'hidden', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                        <div style={{ padding: '1.25rem', borderBottom: '1px solid #e2e8f0', background: '#fff', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ padding: '0.4rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                                <Zap size={18} color="#eab308" />
                            </div>
                            <div>
                                <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b', fontWeight: 800 }}>Regras Gerais</h4>
                                <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Configure o comportamento automatizado do sistema.</p>
                            </div>
                        </div>

                        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {/* Pagamento Automático */}
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between', 
                                padding: '1rem', 
                                background: 'white', 
                                borderRadius: '12px', 
                                border: '1px solid #e2e8f0'
                            }}>
                                <div>
                                    <h4 style={{ margin: '0 0 0.15rem 0', color: '#1e293b', fontSize: '0.9rem', fontWeight: 700 }}>Pagamento Automático</h4>
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', maxWidth: '400px' }}>
                                        Liquidação automática da conta da concessionária após confirmação do pagamento do assinante.
                                    </p>
                                </div>

                                <button 
                                    type="button"
                                    onClick={() => setAutoPayment(!autoPayment)}
                                    style={{
                                        width: '48px',
                                        height: '24px',
                                        borderRadius: '99px',
                                        background: autoPayment ? '#10b981' : '#cbd5e1',
                                        border: 'none',
                                        position: 'relative',
                                        cursor: 'pointer',
                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        padding: 0
                                    }}
                                >
                                    <div style={{
                                        width: '18px',
                                        height: '18px',
                                        background: 'white',
                                        borderRadius: '50%',
                                        position: 'absolute',
                                        top: '3px',
                                        left: autoPayment ? '27px' : '3px',
                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                    }} />
                                </button>
                            </div>

                            {/* Permitir Resgate Automático */}
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between', 
                                padding: '1rem', 
                                background: 'white', 
                                borderRadius: '12px', 
                                border: '1px solid #e2e8f0'
                            }}>
                                <div>
                                    <h4 style={{ margin: '0 0 0.15rem 0', color: '#1e293b', fontSize: '0.9rem', fontWeight: 700 }}>Permitir resgate automático</h4>
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', maxWidth: '400px' }}>
                                        Quando ativado, habilita a função de resgate automático do saldo via PIX para fornecedores.
                                    </p>
                                </div>

                                <button 
                                    type="button"
                                    onClick={() => setAllowAutoRedemption(!allowAutoRedemption)}
                                    style={{
                                        width: '48px',
                                        height: '24px',
                                        borderRadius: '99px',
                                        background: allowAutoRedemption ? '#10b981' : '#cbd5e1',
                                        border: 'none',
                                        position: 'relative',
                                        cursor: 'pointer',
                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        padding: 0
                                    }}
                                >
                                    <div style={{
                                        width: '18px',
                                        height: '18px',
                                        background: 'white',
                                        borderRadius: '50%',
                                        position: 'absolute',
                                        top: '3px',
                                        left: allowAutoRedemption ? '27px' : '3px',
                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                    }} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

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
                                    onChange={e => {
                                        const val = e.target.value.replace(/\D/g, '');
                                        setTestPhone(val);
                                        // Sincroniza com as variáveis para permitir salvar
                                        setFormData(prev => {
                                            const exists = prev.variables.some(v => v.key === 'test_phone');
                                            let newVars;
                                            if (exists) {
                                                newVars = prev.variables.map(v => v.key === 'test_phone' ? { ...v, value: val } : v);
                                            } else {
                                                newVars = [...prev.variables, { key: 'test_phone', value: val }];
                                            }
                                            return { ...prev, variables: newVars };
                                        });
                                    }}
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

                                        if (error) {
                                            // Handle case where body contains { error: "..." }
                                            let errorMsg = error.message;
                                            try {
                                                const body = await error.context?.json();
                                                if (body && body.error) errorMsg = body.error;
                                            } catch (e) { }
                                            throw new Error(errorMsg);
                                        }

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
                {/* TEST AREA - Email Service (Resend) */}
                {serviceName === 'resend_api' && (
                    <div style={{ borderTop: '2px dashed #cbd5e1', paddingTop: '2rem' }}>
                        <h4 style={{ margin: '0 0 1rem 0', color: '#334155' }}>Teste de E-mail</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '1rem', alignItems: 'end' }}>
                            <div>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: '#64748b' }}>E-mail de Destino</label>
                                <input
                                    placeholder="exemplo@email.com"
                                    value={testEmail}
                                    onChange={e => {
                                        const val = e.target.value;
                                        setTestEmail(val);
                                        // Sincroniza com as variáveis para permitir salvar
                                        setFormData(prev => {
                                            const exists = prev.variables.some(v => v.key === 'test_email');
                                            let newVars;
                                            if (exists) {
                                                newVars = prev.variables.map(v => v.key === 'test_email' ? { ...v, value: val } : v);
                                            } else {
                                                newVars = [...prev.variables, { key: 'test_email', value: val }];
                                            }
                                            return { ...prev, variables: newVars };
                                        });
                                    }}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: '#64748b' }}>Mensagem</label>
                                <input
                                    value={testMessage}
                                    onChange={e => setTestMessage(e.target.value)}
                                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleSendTestEmail}
                                disabled={sendingTest || !testEmail}
                                style={{ padding: '0.7rem 1.5rem', background: sendingTest ? '#94a3b8' : '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: sendingTest ? 'default' : 'pointer', fontWeight: 600 }}
                            >
                                {sendingTest ? 'Enviando...' : 'Enviar Teste'}
                            </button>
                        </div>
                    </div>
                )}

                {/* TEST AREA - Autentique API */}
                {serviceName === 'autentique_api' && (
                    <div style={{ borderTop: '2px dashed #cbd5e1', paddingTop: '2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h4 style={{ margin: '0 0 0.5rem 0', color: '#334155' }}>Teste de Conexão (Autentique)</h4>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Verifica a validade do Token via query GraphQL simples.</p>
                            </div>
                            <button
                                type="button"
                                onClick={async () => {
                                    setLoading(true);
                                    try {
                                        const endpoint = formData.environment === 'sandbox' ? formData.sandbox_endpoint_url : formData.endpoint_url;
                                        const token = formData.environment === 'sandbox' ? formData.sandbox_api_key : formData.api_key;

                                        if (!token || !endpoint) throw new Error('Endpoint e Token são obrigatórios para o teste.');

                                        // Simple GraphQL query to list ourselves (check token validity)
                                        const query = `query { viewer { id email } }`;
                                        
                                        const response = await fetch(endpoint, {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': `Bearer ${token}`
                                            },
                                            body: JSON.stringify({ query })
                                        });

                                        const result = await response.json();

                                        if (result.errors) {
                                            throw new Error(result.errors[0].message);
                                        }

                                        if (result.data?.viewer) {
                                            showAlert(`Conexão OK! Autenticado como: ${result.data.viewer.email}`, 'success');
                                        } else {
                                            throw new Error('Falha ao obter dados do usuário. Verifique o token.');
                                        }
                                    } catch (err) {
                                        console.error(err);
                                        showAlert('Falha na conexão: ' + err.message, 'error');
                                    } finally {
                                        setLoading(false);
                                    }
                                }}
                                disabled={loading || (formData.environment === 'production' ? !formData.api_key : !formData.sandbox_api_key)}
                                style={{ padding: '0.7rem 1.5rem', background: loading ? '#94a3b8' : '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: loading ? 'default' : 'pointer', fontWeight: 600 }}
                            >
                                {loading ? 'Testando...' : 'Testar Conexão'}
                            </button>
                        </div>
                    </div>
                )}
            </form>

            {/* Custom Premium Confirmation Modal */}
            {confirmModal.isOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    backdropFilter: 'blur(4px)'
                }}>
                    <div style={{
                        background: 'white',
                        width: '100%',
                        maxWidth: '500px',
                        borderRadius: '24px',
                        padding: '2.5rem',
                        position: 'relative',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        animation: 'modalSlideUp 0.3s ease-out'
                    }}>
                        <style>{`
                            @keyframes modalSlideUp {
                                from { transform: translateY(20px); opacity: 0; }
                                to { transform: translateY(0); opacity: 1; }
                            }
                        `}</style>

                        <button
                            onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                            style={{ position: 'absolute', right: '2rem', top: '2rem', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                        >
                            <X size={24} />
                        </button>

                        <div style={{ display: 'flex', gap: '2rem', marginBottom: '2.5rem' }}>
                            <div style={{
                                width: '80px',
                                height: '80px',
                                background: '#FFF3E0',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    background: '#FFB74D',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <HelpCircle size={32} color="white" />
                                </div>
                            </div>

                            <div style={{ flex: 1 }}>
                                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.6rem', color: '#1e293b', fontWeight: 700, lineHeight: 1.2 }}>
                                    Deseja alterar o ambiente para {confirmModal.targetEnv}?
                                </h3>
                                <p style={{ margin: 0, fontSize: '1.1rem', color: '#64748b' }}>
                                    Alterar Modo?
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button
                                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                                style={{
                                    padding: '1rem 2.5rem',
                                    borderRadius: '12px',
                                    border: '1px solid #e2e8f0',
                                    background: '#f8fafc',
                                    color: '#64748b',
                                    fontSize: '1rem',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    confirmModal.onConfirm?.();
                                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                }}
                                style={{
                                    padding: '1rem 2.5rem',
                                    borderRadius: '12px',
                                    border: 'none',
                                    background: '#002D5E', // Navy Blue from Image
                                    color: 'white',
                                    fontSize: '1rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    boxShadow: '0 10px 15px -3px rgba(0, 45, 94, 0.3)'
                                }}
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
