import { 
    History, User, MapPin, Wallet, Link as LinkIcon, 
    X, Save, Trash2, CheckCircle, AlertCircle, Copy, ExternalLink 
} from 'lucide-react';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';

export default function OriginatorModal({ originator, onClose, onSave, onDelete }) {
    const { profile } = useAuth();
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [activeTab, setActiveTab] = useState('geral');

    const [formData, setFormData] = useState({
        name: '',
        cpf_cnpj: '',
        email: '',
        phone: '',
        pix_key: '',
        pix_key_type: 'cpf', // Default
        split_start: 0,
        split_recurrent: 0,
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: ''
    });

    useEffect(() => {
        if (originator) {
            setFormData({
                name: originator.name || '',
                cpf_cnpj: originator.cpf_cnpj || '',
                email: originator.email || '',
                phone: originator.phone || '',
                pix_key: originator.pix_key || '',
                pix_key_type: originator.pix_key_type || 'cpf',
                split_start: originator.split_commission?.start || 0,
                split_recurrent: originator.split_commission?.recurrent || 0,
                cep: originator.address?.cep || '',
                rua: originator.address?.rua || '',
                numero: originator.address?.numero || '',
                complemento: originator.address?.complemento || '',
                bairro: originator.address?.bairro || '',
                cidade: originator.address?.cidade || '',
                uf: originator.address?.uf || ''
            });
        }
    }, [originator]);

    const handleCepBlur = async () => {
        const rawCep = formData.cep.replace(/\D/g, '');
        if (rawCep.length === 8) {
            setSearchingCep(true);
            try {
                const addr = await fetchAddressByCep(rawCep);
                setFormData(prev => ({
                    ...prev,
                    rua: addr.rua || '',
                    bairro: addr.bairro || '',
                    cidade: addr.cidade || '',
                    uf: addr.uf || ''
                }));
            } catch (error) {
                console.error('Erro CEP', error);
                alert('Erro ao buscar CEP');
            } finally {
                setSearchingCep(false);
            }
        }
    };

    // Auto-sync Pix Key
    useEffect(() => {
        if (formData.pix_key_type === 'aleatoria') return; // Don't overwrite if random

        let newVal = '';
        if (formData.pix_key_type === 'cpf') newVal = formData.cpf_cnpj;
        else if (formData.pix_key_type === 'cnpj') newVal = formData.cpf_cnpj; // Assuming same field
        else if (formData.pix_key_type === 'email') newVal = formData.email;
        else if (formData.pix_key_type === 'telefone') newVal = formData.phone;

        if (newVal !== formData.pix_key) {
            setFormData(prev => ({ ...prev, pix_key: newVal }));
        }
    }, [formData.pix_key_type, formData.cpf_cnpj, formData.email, formData.phone]);

    const addHistory = async (type, id, action, details = {}, customContent = null) => {
        if (!id) return;
        try {
            await supabase.from('crm_history').insert({
                entity_type: type,
                entity_id: id,
                content: customContent || `${action}: ${details.type || ''}`,
                metadata: details,
                created_by: profile?.id
            });
        } catch (error) {
            console.error('Error adding history:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validations
        if (!validateDocument(formData.cpf_cnpj)) {
            alert('CPF ou CNPJ inválido! Verifique o número digitado.');
            return;
        }

        if (!validatePhone(formData.phone)) {
            alert('Telefone inválido! Digite o DDD + 9 dígitos. Ex: (11) 99999-9999');
            return;
        }

        setLoading(true);

        const payload = {
            name: formData.name,
            cpf_cnpj: formData.cpf_cnpj,
            email: formData.email,
            phone: formData.phone.replace(/\D/g, ''),
            pix_key: formData.pix_key,
            pix_key_type: formData.pix_key_type,
            split_commission: {
                start: Number(formData.split_start) || 0,
                recurrent: Number(formData.split_recurrent) || 0
            },
            address: {
                cep: formData.cep,
                rua: formData.rua,
                numero: formData.numero,
                complemento: formData.complemento,
                bairro: formData.bairro,
                cidade: formData.cidade,
                uf: formData.uf
            }
        };

        try {
            let result;
            if (originator?.id) {
                result = await supabase.from('originators_v2').update(payload).eq('id', originator.id).select().single();
                if (!result.error) {
                    await addHistory('originator', originator.id, 'originator_updated', {
                        name: formData.name,
                        status: 'updated'
                    }, 'Dados do originador atualizados');
                }
            } else {
                result = await supabase.from('originators_v2').insert(payload).select().single();
                if (!result.error && result.data) {
                    await addHistory('originator', result.data.id, 'originator_created', {
                        name: formData.name,
                        status: 'created'
                    }, 'Novo originador cadastrado');
                }
            }

            if (result.error) throw result.error;
            onSave(result.data);
            onClose();
        } catch (error) {
            alert('Erro ao salvar originador: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Excluir este originador?')) return;
        setLoading(true);
        try {
            const { error } = await supabase.from('originators_v2').delete().eq('id', originator.id);
            if (error) throw error;
            if (onDelete) onDelete(originator.id);
            onClose();
        } catch (error) {
            alert('Erro ao excluir: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const referralUrl = originator ? `https://b2wenergia.com.br/convite?name=${encodeURIComponent(originator.name)}&id=${originator.id}` : 'Salve para gerar URL';

    const inputStyle = {
        width: '100%',
        padding: '0.8rem 1rem',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        fontSize: '1rem',
        outline: 'none',
        transition: 'all 0.2s',
        background: 'white'
    };

    const labelStyle = {
        display: 'block',
        fontSize: '0.85rem',
        marginBottom: '0.5rem',
        color: '#475569',
        fontWeight: 600
    };

    return (
        <div className="modal-overlay" style={{ background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(8px)' }}>
            <div className="modal-content" style={{ maxWidth: '850px', padding: 0, overflow: 'hidden', border: 'none', borderRadius: '30px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
                {/* Header Premium */}
                <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', padding: '1.5rem 2rem', position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                        <div style={{ background: 'rgba(59, 130, 246, 0.2)', padding: '0.75rem', borderRadius: '16px', color: '#60a5fa' }}>
                            <User size={28} />
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'white', fontWeight: 800 }}>
                                {originator ? 'Perfil do Originador' : 'Novo Originador'}
                            </h2>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
                                {originator ? `Gerenciando dados de ${originator.name}` : 'Cadastre um novo parceiro de negócios'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '12px', padding: '0.5rem', cursor: 'pointer' }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Sub-menu Horizontal */}
                <div style={{ display: 'flex', gap: '1rem', padding: '1rem 2rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    {[
                        { id: 'geral', label: 'Dados Gerais', icon: User },
                        { id: 'endereco', label: 'Endereço', icon: MapPin },
                        { id: 'financeiro', label: 'Financeiro', icon: Wallet },
                        { id: 'indicacao', label: 'Indicação', icon: LinkIcon },
                        { id: 'historico', label: 'Histórico', icon: History }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1rem',
                                border: 'none', background: activeTab === tab.id ? 'white' : 'transparent',
                                color: activeTab === tab.id ? '#3b82f6' : '#64748b',
                                borderRadius: '12px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                                transition: 'all 0.2s',
                                boxShadow: activeTab === tab.id ? '0 4px 6px -1px rgba(0,0,0,0.1)' : 'none'
                            }}
                        >
                            <tab.icon size={16} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '2rem' }}>
                    <div style={{ minHeight: '400px' }}>
                        {/* Tab Content: Geral */}
                        {activeTab === 'geral' && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div style={{ gridColumn: '1 / -1', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #eff6ff', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ padding: '0.75rem', background: 'white', borderRadius: '10px', color: '#3b82f6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                            <User size={24} />
                                        </div>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Dados de Identificação</h4>
                                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Informações pessoais e de contato do parceiro</p>
                                        </div>
                                    </div>

                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={labelStyle}>Nome Completo</label>
                                        <input
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            style={inputStyle}
                                            required
                                            placeholder="Ex: João da Silva"
                                        />
                                    </div>

                                    <div>
                                        <label style={labelStyle}>CPF/CNPJ</label>
                                        <input
                                            value={formData.cpf_cnpj}
                                            onChange={e => setFormData({ ...formData, cpf_cnpj: maskCpfCnpj(e.target.value) })}
                                            placeholder="000.000.000-00"
                                            style={inputStyle}
                                        />
                                    </div>

                                    <div>
                                        <label style={labelStyle}>Email Principal</label>
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                                            style={inputStyle}
                                            placeholder="email@exemplo.com"
                                        />
                                    </div>

                                    <div>
                                        <label style={labelStyle}>Telefone / WhatsApp</label>
                                        <input
                                            value={formData.phone}
                                            onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                                            placeholder="(00) 00000-0000"
                                            style={inputStyle}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Tab Content: Endereço */}
                        {activeTab === 'endereco' && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                                    <div style={{ gridColumn: '1 / -1', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #eff6ff', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ padding: '0.75rem', background: 'white', borderRadius: '10px', color: '#3b82f6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                            <MapPin size={24} />
                                        </div>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Localização Residencial/Comercial</h4>
                                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Defina o endereço físico do originador</p>
                                        </div>
                                    </div>

                                    <div style={{ maxWidth: '300px' }}>
                                        <label style={labelStyle}>CEP</label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                value={formData.cep}
                                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                                onBlur={handleCepBlur}
                                                placeholder="00000-000"
                                                style={{ ...inputStyle, background: searchingCep ? '#f0f9ff' : 'white' }}
                                            />
                                            {searchingCep && <div style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="animate-spin text-blue-500">🌀</div>}
                                        </div>
                                    </div>

                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={labelStyle}>Rua / Logradouro</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '1rem' }}>
                                            <input
                                                value={formData.rua}
                                                onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                                style={inputStyle}
                                                placeholder="Nome da rua"
                                            />
                                            <input
                                                value={formData.numero}
                                                onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                                style={inputStyle}
                                                placeholder="Nº"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label style={labelStyle}>Complemento</label>
                                        <input
                                            value={formData.complemento}
                                            onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                            style={inputStyle}
                                            placeholder="Apt, Bloco, etc"
                                        />
                                    </div>

                                    <div>
                                        <label style={labelStyle}>Bairro</label>
                                        <input
                                            value={formData.bairro}
                                            onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                            style={inputStyle}
                                            placeholder="Bairro"
                                        />
                                    </div>

                                    <div>
                                        <label style={labelStyle}>Cidade / UF</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '4fr 1fr', gap: '1rem' }}>
                                            <input
                                                value={formData.cidade}
                                                onChange={e => setFormData({ ...formData, cidade: e.target.value })}
                                                style={inputStyle}
                                                placeholder="Cidade"
                                            />
                                            <input
                                                value={formData.uf}
                                                onChange={e => setFormData({ ...formData, uf: e.target.value })}
                                                style={inputStyle}
                                                placeholder="UF"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Tab Content: Financeiro */}
                        {activeTab === 'financeiro' && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div style={{ gridColumn: '1 / -1', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #eff6ff', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ padding: '0.75rem', background: 'white', borderRadius: '10px', color: '#3b82f6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                            <Wallet size={24} />
                                        </div>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Configurações de Pagamento</h4>
                                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Defina as regras de comissão e dados bancários</p>
                                        </div>
                                    </div>

                                    <div>
                                        <label style={labelStyle}>Tipo Chave PIX</label>
                                        <select
                                            value={formData.pix_key_type}
                                            onChange={e => setFormData({ ...formData, pix_key_type: e.target.value })}
                                            style={inputStyle}
                                        >
                                            <option value="cpf">CPF</option>
                                            <option value="cnpj">CNPJ</option>
                                            <option value="email">Email</option>
                                            <option value="telefone">Telefone</option>
                                            <option value="aleatoria">Aleatória</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label style={labelStyle}>Chave PIX</label>
                                        <input
                                            value={formData.pix_key}
                                            onChange={e => setFormData({ ...formData, pix_key: e.target.value })}
                                            style={inputStyle}
                                            placeholder="Insira a chave PIX"
                                        />
                                    </div>

                                    <div style={{ gridColumn: '1 / -1', height: '1px', background: '#f1f5f9', margin: '0.5rem 0' }}></div>

                                    <div style={{ background: '#ecfdf5', padding: '1.25rem', borderRadius: '20px', border: '1px solid #d1fae5' }}>
                                        <label style={{ ...labelStyle, color: '#065f46' }}>Comissão Start (%)</label>
                                        <div style={{ fontSize: '0.75rem', color: '#047857', marginBottom: '0.75rem' }}>Pago na primeira fatura do assinante</div>
                                        <input
                                            type="number" step="0.01"
                                            value={formData.split_start}
                                            onChange={e => setFormData({ ...formData, split_start: e.target.value })}
                                            style={{ ...inputStyle, border: '1px solid #a7f3d0' }}
                                        />
                                    </div>

                                    <div style={{ background: '#f0f9ff', padding: '1.25rem', borderRadius: '20px', border: '1px solid #d0e8ff' }}>
                                        <label style={{ ...labelStyle, color: '#075985' }}>Comissão Recorrente (%)</label>
                                        <div style={{ fontSize: '0.75rem', color: '#0369a1', marginBottom: '0.75rem' }}>Pago mensalmente sobre faturas liquidadas</div>
                                        <input
                                            type="number" step="0.01"
                                            value={formData.split_recurrent}
                                            onChange={e => setFormData({ ...formData, split_recurrent: e.target.value })}
                                            style={{ ...inputStyle, border: '1px solid #bae6fd' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Tab Content: Indicação */}
                        {activeTab === 'indicacao' && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #eff6ff', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ padding: '0.75rem', background: 'white', borderRadius: '10px', color: '#3b82f6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                            <LinkIcon size={24} />
                                        </div>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Link de Indicação</h4>
                                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Compartilhe este link para capturar novos leads sob este originador</p>
                                        </div>
                                    </div>

                                    {originator ? (
                                        <div style={{ background: 'white', padding: '2rem', borderRadius: '24px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                                            <div style={{ width: '64px', height: '64px', background: '#f0f9ff', borderRadius: '20px', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', color: '#3b82f6', marginBottom: '1.5rem' }}>
                                                <ExternalLink size={32} />
                                            </div>
                                            <h5 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', color: '#1e293b' }}>Seu Link Personalizado</h5>
                                            <p style={{ margin: '0 0 1.5rem', fontSize: '0.9rem', color: '#64748b' }}>Leads cadastrados através deste link serão vinculados automaticamente a você.</p>
                                            
                                            <div style={{ display: 'flex', gap: '0.5rem', background: '#f1f5f9', padding: '0.5rem', borderRadius: '16px' }}>
                                                <input
                                                    readOnly
                                                    value={referralUrl}
                                                    style={{ flex: 1, border: 'none', background: 'transparent', padding: '0.5rem 1rem', fontSize: '0.9rem', color: '#475569', fontWeight: 600, outline: 'none' }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(referralUrl);
                                                        alert('Link copiado!');
                                                    }}
                                                    style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '12px', padding: '0.6rem 1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                                                >
                                                    <Copy size={16} /> Copiar
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ padding: '3rem', textAlign: 'center', background: '#f8fafc', borderRadius: '24px', border: '2px dashed #e2e8f0' }}>
                                            <AlertCircle size={48} style={{ color: '#94a3b8', marginBottom: '1rem' }} />
                                            <h5 style={{ margin: 0, color: '#64748b' }}>Salve o originador primeiro para gerar o link de indicação.</h5>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Tab Content: Histórico */}
                        {activeTab === 'historico' && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                {originator ? (
                                    <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '24px', border: '1px solid #e2e8f0' }}>
                                        <HistoryTimeline 
                                            entityType="originator" 
                                            entityId={originator.id} 
                                            limit={20}
                                            showHeader={true}
                                            isInline={true}
                                        />
                                    </div>
                                ) : (
                                    <div style={{ padding: '3rem', textAlign: 'center', background: '#f8fafc', borderRadius: '24px', border: '2px dashed #e2e8f0' }}>
                                        <History size={48} style={{ color: '#94a3b8', marginBottom: '1rem' }} />
                                        <h5 style={{ margin: 0, color: '#64748b' }}>O histórico estará disponível após o primeiro salvamento.</h5>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer Premium */}
                    <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            {originator && (
                                <button type="button" onClick={handleDelete} style={{ background: 'transparent', border: 'none', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, cursor: 'pointer', padding: '0.5rem 1rem', borderRadius: '10px', transition: '0.2s' }} className="hover-danger">
                                    <Trash2 size={18} /> Excluir Originador
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={onClose} style={{ padding: '0.75rem 1.5rem', background: '#f1f5f9', border: 'none', borderRadius: '14px', color: '#475569', fontWeight: 700, cursor: 'pointer' }}>
                                Cancelar
                            </button>
                            <button type="submit" disabled={loading} style={{ 
                                padding: '0.75rem 2rem', background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', 
                                border: 'none', borderRadius: '14px', color: 'white', fontWeight: 800, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '0.75rem', boxShadow: '0 10px 15px -3px rgba(37, 99, 235, 0.3)'
                            }}>
                                {loading ? 'Processando...' : (
                                    <>
                                        <Save size={18} /> {originator ? 'Salvar Alterações' : 'Criar Originador'}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
