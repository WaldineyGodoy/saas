import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { fetchCpfCnpjData, fetchAddressByCep } from '../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone, cleanDigits } from '../lib/validators';
import { 
    History, User, MapPin, Wallet, X, Save, Trash2, 
    CheckCircle, AlertCircle, Search, ArrowUpDown, ArrowUpRight, ArrowDownLeft, Copy
} from 'lucide-react';
import HistoryTimeline from './HistoryTimeline';

export default function SupplierModal({ supplier, onClose, onSave, onDelete }) {
    const { profile } = useAuth();
    const { showAlert, showConfirm } = useUI();
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);
    const [activeTab, setActiveTab] = useState('geral');
    const [usinas, setUsinas] = useState([]);
    const [ledgerEntries, setLedgerEntries] = useState([]);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [expandedTx, setExpandedTx] = useState(null);
    const [txDetails, setTxDetails] = useState([]);
    const [txLoading, setTxLoading] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        cnpj: '',
        email: '',
        phone: '',
        status: 'ativacao',
        legal_partner_name: '',
        legal_partner_cpf: '',
        pix_key: '',
        pix_key_type: 'cpf', // Default
        // Address fields
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: ''
    });

    useEffect(() => {
        if (supplier) {
            setFormData({
                name: supplier.name || '',
                cnpj: supplier.cnpj || '',
                email: supplier.email || '',
                phone: supplier.phone || '',
                status: supplier.status || 'ativacao',
                legal_partner_name: supplier.legal_partner_name || '',
                legal_partner_cpf: supplier.legal_partner_cpf || '',
                pix_key: supplier.pix_key || '',
                pix_key_type: supplier.pix_key_type || 'cpf',
                cep: supplier.address?.cep || '',
                rua: supplier.address?.logradouro || supplier.address?.rua || '',
                numero: supplier.address?.numero || '',
                complemento: supplier.address?.complemento || '',
                bairro: supplier.address?.bairro || '',
                cidade: supplier.address?.municipio || supplier.address?.cidade || '',
                uf: supplier.address?.uf || ''
            });

            fetchLinkedUsinas(supplier.id);
            fetchLedgerStatement();
        }
    }, [supplier]);

    const fetchLinkedUsinas = async (supplierId) => {
        const { data } = await supabase.from('usinas').select('id, name, status').eq('supplier_id', supplierId);
        setUsinas(data || []);
    };

    const fetchLedgerStatement = async () => {
        if (!supplier?.id) return;
        setLedgerLoading(true);
        try {
            // Fetch entries where the supplier is the reference_id and account is 2.1.1
            const { data, error } = await supabase
                .from('view_ledger_enriched')
                .select('*')
                .eq('account_code', '2.1.1')
                .eq('reference_id', supplier.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setLedgerEntries(data || []);
        } catch (err) {
            console.error('Error fetching ledger:', err);
        } finally {
            setLedgerLoading(false);
        }
    };

    const fetchTransactionDetails = async (transactionId) => {
        if (expandedTx === transactionId) {
            setExpandedTx(null);
            return;
        }

        setExpandedTx(transactionId);
        setTxLoading(true);
        try {
            const { data, error } = await supabase
                .from('view_ledger_enriched')
                .select('*')
                .eq('transaction_id', transactionId)
                .order('amount', { ascending: false });

            if (error) throw error;
            setTxDetails(data || []);
        } catch (err) {
            console.error('Error fetching tx details:', err);
        } finally {
            setTxLoading(false);
        }
    };

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

    const handleCnpjBlur = async () => {
        const cleanDoc = formData.cnpj.replace(/\D/g, '');
        if (cleanDoc.length === 14) {
            setLoading(true);
            try {
                const data = await fetchCpfCnpjData(cleanDoc);
                if (data) {
                    setFormData(prev => ({
                        ...prev,
                        name: data.nome || prev.name,
                        email: data.email || prev.email,
                        phone: data.telefone || prev.phone,
                        legal_partner_name: data.legal_partner?.nome || prev.legal_partner_name,
                        legal_partner_cpf: data.legal_partner?.cpf || prev.legal_partner_cpf,
                        cep: data.address?.cep || prev.cep,
                        rua: data.address?.logradouro || prev.rua,
                        numero: data.address?.numero || prev.numero,
                        complemento: data.address?.complemento || prev.complemento,
                        bairro: data.address?.bairro || prev.bairro,
                        cidade: data.address?.municipio || prev.cidade,
                        uf: data.address?.uf || prev.uf
                    }));
                }
            } catch (e) {
                console.error('Erro CNPJ', e);
                showAlert('Erro ao buscar CNPJ. Verifique se o número está correto.', 'error');
            } finally {
                setLoading(false);
            }
        }
    };

    const handleCepBlur = async () => {
        const cep = cleanDigits(formData.cep);
        if (cep.length === 8) {
            setSearchingCep(true);
            try {
                const data = await fetchAddressByCep(cep);
                if (data && !data.erro) {
                    setFormData(prev => ({
                        ...prev,
                        rua: data.logradouro || prev.rua,
                        bairro: data.bairro || prev.bairro,
                        cidade: data.localidade || prev.cidade,
                        uf: data.uf || prev.uf
                    }));
                }
            } catch (error) {
                console.error('Erro CEP:', error);
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handlePixTypeChange = (e) => {
        const type = e.target.value;
        let autoValue = formData.pix_key;

        switch (type) {
            case 'telefone':
                autoValue = formData.phone;
                break;
            case 'email':
                autoValue = formData.email;
                break;
            case 'cnpj':
                autoValue = formData.cnpj;
                break;
            case 'cpf':
                if (formData.legal_partner_cpf) autoValue = formData.legal_partner_cpf;
                break;
            default:
                break;
        }

        setFormData(prev => ({
            ...prev,
            pix_key_type: type,
            pix_key: autoValue
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (formData.cnpj && !validateDocument(formData.cnpj)) {
            showAlert('CNPJ inválido!', 'warning');
            return;
        }
        if (formData.phone && !validatePhone(formData.phone)) {
            showAlert('Telefone inválido!', 'warning');
            return;
        }

        setLoading(true);

        try {
            const payload = {
                name: formData.name,
                cnpj: formData.cnpj,
                email: formData.email,
                phone: formData.phone ? formData.phone.replace(/\D/g, '') : '',
                status: formData.status,
                legal_partner_name: formData.legal_partner_name,
                legal_partner_cpf: formData.legal_partner_cpf,
                pix_key: formData.pix_key,
                pix_key_type: formData.pix_key_type,
                address: {
                    cep: formData.cep,
                    logradouro: formData.rua,
                    rua: formData.rua,
                    numero: formData.numero,
                    complemento: formData.complemento,
                    bairro: formData.bairro,
                    municipio: formData.cidade,
                    cidade: formData.cidade,
                    uf: formData.uf
                }
            };

            let result;
            if (supplier?.id) {
                result = await supabase.from('suppliers').update(payload).eq('id', supplier.id).select().single();
            } else {
                result = await supabase.from('suppliers').insert(payload).select().single();
            }

            if (result.error) throw result.error;

            if (supplier?.id) {
                await addHistory('supplier', supplier.id, 'supplier_updated', {
                    name: formData.name,
                    status: 'updated'
                }, 'Dados do fornecedor atualizados');
            } else if (result.data) {
                await addHistory('supplier', result.data.id, 'supplier_created', {
                    name: formData.name,
                    status: 'created'
                }, 'Novo fornecedor cadastrado');
            }

            onSave(result.data);
            onClose();
        } catch (error) {
            console.error('Save error details:', error);
            const msg = error.message || JSON.stringify(error);
            if (msg.includes('JWT expired')) {
                showAlert('Sua sessão expirou. Por favor, faça login novamente.', 'error');
                await supabase.auth.signOut();
                window.location.href = '/login';
            } else {
                showAlert('Erro ao salvar fornecedor: ' + msg, 'error');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (usinas.length > 0) {
            showAlert('Não é possível excluir fornecedor com usinas vinculadas.', 'warning');
            return;
        }
        const confirm = await showConfirm('Excluir este fornecedor?');
        if (!confirm) return;

        setLoading(true);
        try {
            const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id);
            if (error) throw error;
            if (onDelete) onDelete(supplier.id);
            onClose();
        } catch (error) {
            showAlert('Erro ao excluir: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const inputStyle = {
        width: '100%',
        padding: '0.8rem 1rem',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        fontSize: '0.95rem',
        transition: 'all 0.2s',
        backgroundColor: '#f8fafc',
        outline: 'none'
    };

    const labelStyle = {
        display: 'block',
        fontSize: '0.85rem',
        fontWeight: '700',
        color: '#64748b',
        marginBottom: '0.5rem',
        textTransform: 'uppercase',
        letterSpacing: '0.025em'
    };

    const sectionStyle = {
        background: 'white',
        padding: '1.5rem',
        borderRadius: '20px',
        border: '1px solid #f1f5f9',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        marginBottom: '1.5rem'
    };

    const formatCurrency = (val) => {
        return Math.abs(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    const ledgerBalance = ledgerEntries.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(8px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ 
                background: '#f8fafc', 
                borderRadius: '30px', 
                width: '95%', 
                maxWidth: '850px', 
                maxHeight: '90vh', 
                overflow: 'hidden',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Premium Header */}
                <div style={{
                    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                    padding: '1.5rem 2rem',
                    color: 'white',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.025em' }}>
                            {supplier ? 'Editar Fornecedor' : 'Novo Fornecedor'}
                        </h3>
                        <p style={{ margin: 0, opacity: 0.8, fontSize: '0.9rem' }}>
                            Gestão de parceiros e infraestrutura energética
                        </p>
                    </div>
                    <button 
                        onClick={onClose}
                        style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: 'none',
                            color: 'white',
                            padding: '0.5rem',
                            borderRadius: '12px',
                            cursor: 'pointer'
                        }}
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Horizontal Navigation */}
                <div style={{
                    display: 'flex',
                    gap: '1rem',
                    padding: '0.75rem 2rem',
                    background: 'white',
                    borderBottom: '1px solid #e2e8f0',
                    overflowX: 'auto'
                }}>
                    {[
                        { id: 'geral', label: 'Geral', icon: User },
                        { id: 'endereco', label: 'Endereço', icon: MapPin },
                        { id: 'financeiro', label: 'Financeiro', icon: Wallet },
                        { id: 'extrato', label: 'Extrato', icon: ArrowUpDown },
                        { id: 'historico', label: 'Histórico', icon: History }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.6rem',
                                padding: '0.6rem 1.2rem',
                                borderRadius: '14px',
                                border: 'none',
                                background: activeTab === tab.id ? '#eff6ff' : 'transparent',
                                color: activeTab === tab.id ? '#3b82f6' : '#64748b',
                                fontWeight: activeTab === tab.id ? '700' : '500',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            <tab.icon size={18} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div style={{ padding: '2rem', overflowY: 'auto', flex: 1 }}>
                    <form onSubmit={handleSubmit}>
                        
                        {activeTab === 'geral' && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                <div style={sectionStyle}>
                                    <h4 style={{ margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                        <User size={20} color="#3b82f6" /> Dados da Empresa
                                    </h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={labelStyle}>CNPJ (Busca Automática)</label>
                                            <input
                                                style={{ ...inputStyle, borderStyle: 'dashed', borderWidth: '2px' }}
                                                value={formData.cnpj}
                                                onChange={e => setFormData({ ...formData, cnpj: maskCpfCnpj(e.target.value) })}
                                                onBlur={handleCnpjBlur}
                                                placeholder="00.000.000/0000-00"
                                            />
                                        </div>
                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={labelStyle}>Razão Social / Nome Fantasia *</label>
                                            <input
                                                style={inputStyle}
                                                required
                                                value={formData.name}
                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div style={sectionStyle}>
                                    <h4 style={{ margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                        <CheckCircle size={20} color="#34d399" /> Sócio Administrador
                                    </h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        <div>
                                            <label style={labelStyle}>Nome Completo</label>
                                            <input
                                                style={inputStyle}
                                                value={formData.legal_partner_name}
                                                onChange={e => setFormData({ ...formData, legal_partner_name: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>CPF</label>
                                            <input
                                                style={inputStyle}
                                                value={formData.legal_partner_cpf}
                                                onChange={e => setFormData({ ...formData, legal_partner_cpf: maskCpfCnpj(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div style={sectionStyle}>
                                    <h4 style={{ margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                        <Search size={20} color="#3b82f6" /> Informações de Contato
                                    </h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        <div>
                                            <label style={labelStyle}>Email</label>
                                            <input
                                                style={inputStyle}
                                                type="email"
                                                value={formData.email}
                                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Telefone</label>
                                            <input
                                                style={inputStyle}
                                                value={formData.phone}
                                                onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'endereco' && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                <div style={sectionStyle}>
                                    <h4 style={{ margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                        <MapPin size={20} color="#ef4444" /> Localização
                                    </h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem' }}>
                                            <div>
                                                <label style={labelStyle}>CEP</label>
                                                <input
                                                    style={inputStyle}
                                                    value={formData.cep}
                                                    onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                                    onBlur={handleCepBlur}
                                                />
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Logradouro / Rua</label>
                                                <input
                                                    style={inputStyle}
                                                    value={formData.rua}
                                                    onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Número</label>
                                            <input
                                                style={inputStyle}
                                                value={formData.numero}
                                                onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Bairro</label>
                                            <input
                                                style={inputStyle}
                                                value={formData.bairro}
                                                onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                            />
                                        </div>
                                        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
                                            <div>
                                                <label style={labelStyle}>Cidade</label>
                                                <input
                                                    style={inputStyle}
                                                    value={formData.cidade}
                                                    onChange={e => setFormData({ ...formData, cidade: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label style={labelStyle}>UF</label>
                                                <input
                                                    style={inputStyle}
                                                    value={formData.uf}
                                                    onChange={e => setFormData({ ...formData, uf: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'financeiro' && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                <div style={sectionStyle}>
                                    <h4 style={{ margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                        <Wallet size={20} color="#f59e0b" /> Dados Bancários e PIX
                                    </h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        <div style={{ position: 'relative' }}>
                                            <label style={labelStyle}>Chave PIX</label>
                                            <div style={{ position: 'relative' }}>
                                                <input
                                                    style={{ ...inputStyle, paddingRight: '3.5rem' }}
                                                    value={formData.pix_key}
                                                    onChange={e => setFormData({ ...formData, pix_key: e.target.value })}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(formData.pix_key);
                                                        showAlert('Chave PIX copiada!', 'success');
                                                    }}
                                                    style={{
                                                        position: 'absolute',
                                                        right: '8px',
                                                        top: '50%',
                                                        transform: 'translateY(-50%)',
                                                        background: 'white',
                                                        border: '1px solid #e2e8f0',
                                                        borderRadius: '8px',
                                                        padding: '0.4rem',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: '#64748b'
                                                    }}
                                                    title="Copiar Chave PIX"
                                                >
                                                    <Copy size={16} />
                                                </button>
                                            </div>
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Tipo de Chave</label>
                                            <select
                                                style={inputStyle}
                                                value={formData.pix_key_type}
                                                onChange={handlePixTypeChange}
                                            >
                                                <option value="cpf">CPF</option>
                                                <option value="cnpj">CNPJ</option>
                                                <option value="email">Email</option>
                                                <option value="telefone">Telefone</option>
                                                <option value="aleatoria">Aleatória</option>
                                            </select>
                                        </div>
                                        <div style={{ 
                                            gridColumn: '1 / -1', 
                                            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                                            padding: '1.25rem',
                                            borderRadius: '16px',
                                            border: '1px solid #e2e8f0',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: '0.5rem'
                                        }}>
                                            <div>
                                                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Saldo Acumulado</div>
                                                <div style={{ fontSize: '1.5rem', fontWeight: '800', color: ledgerBalance >= 0 ? '#10b981' : '#ef4444' }}>
                                                    {formatCurrency(ledgerBalance)}
                                                </div>
                                            </div>
                                            <button 
                                                type="button"
                                                onClick={() => setActiveTab('extrato')}
                                                style={{
                                                    background: 'white',
                                                    border: '1px solid #e2e8f0',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '10px',
                                                    fontSize: '0.8rem',
                                                    fontWeight: '600',
                                                    color: '#3b82f6',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                Ver Detalhes
                                            </button>
                                        </div>

                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={labelStyle}>Status Operacional</label>
                                            <select
                                                style={{ ...inputStyle, fontWeight: 'bold' }}
                                                value={formData.status}
                                                onChange={e => setFormData({ ...formData, status: e.target.value })}
                                            >
                                                <option value="ativacao">🟠 Em Ativação</option>
                                                <option value="ativo">🟢 Ativo</option>
                                                <option value="inativo">🔴 Inativo</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {supplier && usinas.length > 0 && (
                                    <div style={{ ...sectionStyle, background: '#f0f9ff', border: '1px solid #bae6fd' }}>
                                        <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#0369a1' }}>Usinas Vinculadas</h4>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                                            {usinas.map(u => (
                                                <div key={u.id} style={{
                                                    background: 'white',
                                                    padding: '0.6rem 1rem',
                                                    borderRadius: '12px',
                                                    fontSize: '0.85rem',
                                                    border: '1px solid #e0f2fe',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem'
                                                }}>
                                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: u.status === 'ativo' ? '#10b981' : '#f59e0b' }}></div>
                                                    <strong>{u.name}</strong>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'extrato' && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                {/* Balance Card */}
                                <div style={{
                                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                                    padding: '2rem',
                                    borderRadius: '24px',
                                    color: 'white',
                                    marginBottom: '2rem',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    boxShadow: '0 10px 15px -3px rgba(37, 99, 235, 0.4)'
                                }}>
                                    <div>
                                        <div style={{ fontSize: '0.9rem', opacity: 0.9, fontWeight: '500' }}>Saldo Acumulado</div>
                                        <div style={{ fontSize: '2.5rem', fontWeight: 900 }}>{formatCurrency(ledgerBalance)}</div>
                                    </div>
                                    <div style={{ background: 'rgba(255,255,255,0.2)', padding: '1rem', borderRadius: '20px' }}>
                                        <ArrowUpDown size={32} />
                                    </div>
                                </div>

                                <div style={sectionStyle}>
                                    <h4 style={{ margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                        <Search size={20} color="#3b82f6" /> Lançamentos Recentes
                                    </h4>
                                    
                                    {ledgerLoading ? (
                                        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Carregando extrato...</div>
                                    ) : ledgerEntries.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', border: '1px dashed #e2e8f0', borderRadius: '16px' }}>
                                            Nenhum lançamento encontrado para este fornecedor.
                                        </div>
                                    ) : (
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '2px solid #f1f5f9', textAlign: 'left' }}>
                                                        <th style={{ padding: '1rem 0.5rem', color: '#64748b' }}>Data</th>
                                                        <th style={{ padding: '1rem 0.5rem', color: '#64748b' }}>Descrição</th>
                                                        <th style={{ padding: '1rem 0.5rem', color: '#64748b', textAlign: 'right' }}>Valor</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {ledgerEntries.map(entry => {
                                                        // In the vision of the Supplier (Account 2.1.1 - Liability):
                                                        // Credit (Negative amount) = Money they have to receive (Revenue/Positive for them)
                                                        // Debit (Positive amount) = Money deducted from them (Expense/Negative for them)
                                                        const isRevenue = entry.amount < 0;

                                                        return (
                                                            <React.Fragment key={entry.id}>
                                                                <tr 
                                                                    onClick={() => fetchTransactionDetails(entry.transaction_id)}
                                                                    style={{ 
                                                                        borderBottom: '1px solid #f1f5f9', 
                                                                        cursor: 'pointer',
                                                                        transition: 'background 0.2s'
                                                                    }}
                                                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                                >
                                                                    <td style={{ padding: '1.25rem 0.5rem', whiteSpace: 'nowrap' }}>
                                                                        <div style={{ color: '#64748b', fontWeight: '500' }}>{formatDate(entry.created_at)}</div>
                                                                    </td>
                                                                    <td style={{ padding: '1.25rem 0.5rem' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                            <div style={{
                                                                                width: '32px',
                                                                                height: '32px',
                                                                                borderRadius: '10px',
                                                                                background: isRevenue ? '#f0fdf4' : '#fef2f2',
                                                                                color: isRevenue ? '#10b981' : '#ef4444',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                justifyContent: 'center'
                                                                            }}>
                                                                                {isRevenue ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                                                                            </div>
                                                                            <div>
                                                                                <div style={{ fontWeight: '700', color: '#1e293b', fontSize: '0.95rem' }}>
                                                                                    {entry.description}
                                                                                </div>
                                                                                <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.025em' }}>
                                                                                    {isRevenue ? 'Crédito / Receita' : 'Débito / Desconto'}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    <td style={{ padding: '1.25rem 0.5rem', textAlign: 'right' }}>
                                                                        <div style={{
                                                                            fontWeight: '800',
                                                                            fontSize: '1.05rem',
                                                                            color: isRevenue ? '#10b981' : '#ef4444'
                                                                        }}>
                                                                            {isRevenue ? '+' : '-'}{formatCurrency(entry.amount)}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                                
                                                                {expandedTx === entry.transaction_id && (
                                                                    <tr>
                                                                        <td colSpan={3} style={{ padding: '0 0.5rem 1rem 0.5rem' }}>
                                                                            <div style={{ 
                                                                                background: '#f8fafc', 
                                                                                borderRadius: '16px', 
                                                                                padding: '1.5rem',
                                                                                border: '1px solid #e2e8f0',
                                                                                animation: 'fadeIn 0.2s ease-out'
                                                                            }}>
                                                                                <div style={{ fontSize: '0.75rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '0.05em' }}>
                                                                                    Composição do Lançamento
                                                                                </div>
                                                                                {txLoading ? (
                                                                                    <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Carregando detalhes...</div>
                                                                                ) : (
                                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                                                        {txDetails.map(detail => {
                                                                                            return (
                                                                                                <div key={detail.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px dashed #e2e8f0' }}>
                                                                                                    <div>
                                                                                                        <div style={{ fontWeight: '600', color: '#334155', fontSize: '0.85rem' }}>{detail.entity_name || detail.account_name}</div>
                                                                                                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{detail.description}</div>
                                                                                                    </div>
                                                                                                    <div style={{ fontWeight: '700', color: detail.amount > 0 ? '#10b981' : '#ef4444' }}>
                                                                                                        {detail.amount > 0 ? '+' : ''}{formatCurrency(detail.amount)}
                                                                                                    </div>
                                                                                                </div>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'historico' && supplier && (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                <div style={sectionStyle}>
                                    <h4 style={{ margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                        <History size={20} color="#3b82f6" /> Timeline de Auditoria
                                    </h4>
                                    <HistoryTimeline 
                                        entityType="supplier" 
                                        entityId={supplier.id} 
                                        limit={20}
                                        showHeader={false}
                                        isInline={true}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Modal Footer Actions */}
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginTop: '2rem',
                            paddingTop: '2rem',
                            borderTop: '1px solid #e2e8f0'
                        }}>
                            <div>
                                {supplier && (
                                    <button 
                                        type="button" 
                                        onClick={handleDelete}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            padding: '0.75rem 1.25rem',
                                            background: '#fee2e2',
                                            color: '#dc2626',
                                            border: 'none',
                                            borderRadius: '14px',
                                            fontWeight: '700',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        <Trash2 size={18} /> Excluir
                                    </button>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <button 
                                    type="button" 
                                    onClick={onClose}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: 'white',
                                        color: '#64748b',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '14px',
                                        fontWeight: '700',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Cancelar
                                </button>
                                <button 
                                    type="submit" 
                                    disabled={loading}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.75rem 2rem',
                                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '14px',
                                        fontWeight: '800',
                                        cursor: 'pointer',
                                        boxShadow: '0 10px 15px -3px rgba(37, 99, 235, 0.3)',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    {loading ? (
                                        'Processando...'
                                    ) : (
                                        <><Save size={18} /> Salvar Alterações</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
