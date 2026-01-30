import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import { ChevronDown, ChevronUp } from 'lucide-react'; // Import icons for collapsible

import { useUI } from '../contexts/UIContext';

// Collapsible Section Component
const CollapsibleSection = ({ title, children, defaultOpen = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div style={{
            gridColumn: '1 / -1',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            marginBottom: '1rem'
        }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    background: 'var(--color-bg-light)',
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontWeight: 600,
                    color: 'var(--color-text)'
                }}
            >
                <span>{title}</span>
                {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
            {isOpen && (
                <div style={{
                    padding: '1rem',
                    borderTop: '1px solid var(--color-border)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem'
                }}>
                    {children}
                </div>
            )}
        </div>
    );
};

export default function ConsumerUnitModal({ consumerUnit, onClose, onSave, onDelete }) {
    const { showAlert, showConfirm } = useUI();
    const [subscribers, setSubscribers] = useState([]);
    const [usinas, setUsinas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);

    // Helpers for Currency/Numbers
    const formatCurrency = (val) => {
        if (!val && val !== 0) return '';
        const number = Number(val);
        if (isNaN(number)) return '';
        return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4 });
    };

    const parseCurrency = (str) => {
        if (!str || typeof str !== 'string') return 0;
        const digits = str.replace(/\D/g, '');
        return Number(digits) / 10000; // 4 decimals for tariff
    };

    const handleCurrencyChange = (field, value) => {
        const digits = value.replace(/\D/g, '');
        const number = Number(digits) / 10000;
        const formatted = number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4 });
        setFormData(prev => ({ ...prev, [field]: formatted }));
    };

    // Helper for CEP Mask
    const maskCEP = (val) => {
        return val.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9);
    };

    // Status Options
    const statusOptions = [
        { value: 'em_ativacao', label: 'Em Ativação' },
        { value: 'aguardando_conexao', label: 'Aguardando Conexão' },
        { value: 'ativo', label: 'Ativo' },
        { value: 'sem_geracao', label: 'Sem Geração' },
        { value: 'em_atraso', label: 'Em Atraso' },
        { value: 'cancelado', label: 'Cancelado' },
        { value: 'cancelado_inadimplente', label: 'Cancelado (Inadimplente)' }
    ];

    const modalidadeOptions = [
        { value: 'auto_consumo_remoto', label: 'Auto Consumo Remoto' },
        { value: 'geracao_compartilhada', label: 'Geração Compartilhada' }
    ];

    const tipoLigacaoOptions = [
        { value: 'monofasico', label: 'Monofásico' },
        { value: 'bifasico', label: 'Bifásico' },
        { value: 'trifasico', label: 'Trifásico' }
    ];

    const vencimentoOptions = [1, 5, 10, 15, 20, 25, 30];

    const [formData, setFormData] = useState({
        subscriber_id: '',
        usina_id: '',
        status: 'em_ativacao',
        numero_uc: '',
        titular_conta: '',
        modalidade: 'geracao_compartilhada',
        concessionaria: '',
        tipo_ligacao: 'trifasico',
        franquia: '', // kWh
        tarifa_concessionaria: '', // String masked
        te: '', // New
        tusd: '', // New
        fio_b: '', // New
        tarifa_minima: '', // Calculated/Displayed
        desconto_assinante: '',
        dia_vencimento: 10,
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: ''
    });

    useEffect(() => {
        fetchSubscribers();
        fetchUsinas();
        if (consumerUnit) {
            setFormData({
                subscriber_id: consumerUnit.subscriber_id || '',
                usina_id: consumerUnit.usina_id || '',
                status: consumerUnit.status || 'em_ativacao',
                numero_uc: consumerUnit.numero_uc || '',
                titular_conta: consumerUnit.titular_conta || '',
                modalidade: consumerUnit.modalidade || 'geracao_compartilhada',
                concessionaria: consumerUnit.concessionaria || '',
                tipo_ligacao: consumerUnit.tipo_ligacao || 'trifasico',
                franquia: consumerUnit.franquia || '',
                tarifa_concessionaria: formatCurrency(consumerUnit.tarifa_concessionaria),
                te: formatCurrency(consumerUnit.te),
                tusd: formatCurrency(consumerUnit.tusd),
                fio_b: formatCurrency(consumerUnit.fio_b),
                tarifa_minima: '', // Recalculated on render
                desconto_assinante: consumerUnit.desconto_assinante || '',
                dia_vencimento: consumerUnit.dia_vencimento || 10,
                cep: maskCEP(consumerUnit.address?.cep || ''),
                rua: consumerUnit.address?.rua || '',
                numero: consumerUnit.address?.numero || '',
                complemento: consumerUnit.address?.complemento || '',
                bairro: consumerUnit.address?.bairro || '',
                cidade: consumerUnit.address?.cidade || '',
                uf: consumerUnit.address?.uf || ''
            });
        }
    }, [consumerUnit]);

    // Calculate Tarifa Minima automatically
    useEffect(() => {
        const tariff = parseCurrency(formData.tarifa_concessionaria);
        let multiplier = 30; // Monofasico default
        if (formData.tipo_ligacao === 'trifasico') multiplier = 100;
        else if (formData.tipo_ligacao === 'bifasico') multiplier = 50;

        const minTariff = tariff * multiplier;
        // Fix: Display with 2 decimal places as requested (R$ XX,XX)
        const formattedMin = minTariff.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

        setFormData(prev => ({
            ...prev,
            tarifa_minima: formattedMin
        }));
    }, [formData.tarifa_concessionaria, formData.tipo_ligacao]);

    const fetchSubscribers = async () => {
        const { data } = await supabase.from('subscribers').select('id, name, cpf_cnpj').order('name');
        setSubscribers(data || []);
    };

    const fetchUsinas = async () => {
        const { data } = await supabase.from('usinas').select('id, name').order('name');
        setUsinas(data || []);
    };

    const handleCepChange = (e) => {
        const masked = maskCEP(e.target.value);
        setFormData(prev => ({ ...prev, cep: masked }));
    };

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
                    uf: addr.uf || '',
                    concessionaria: prev.concessionaria || ''
                }));

                // Fetch Offers based on IBGE
                if (addr.ibge) {
                    const offer = await fetchOfferData(addr.ibge);
                    if (offer) {
                        // Handle Discount: If > 1, assume it's already %, else multiply by 100
                        let discountVal = offer['Desconto Assinante'] || 0;
                        if (discountVal > 1) {
                            // Already percentage (e.g. 20)
                        } else {
                            // Decimal (e.g. 0.2)
                            discountVal = discountVal * 100;
                        }

                        setFormData(prev => ({
                            ...prev,
                            rua: addr.rua || '',
                            bairro: addr.bairro || '',
                            cidade: addr.cidade || '',
                            uf: addr.uf || '',
                            concessionaria: offer.Concessionaria || prev.concessionaria,
                            tarifa_concessionaria: offer['Tarifa Concessionaria'] ? formatCurrency(offer['Tarifa Concessionaria']) : prev.tarifa_concessionaria,
                            te: offer['TE'] ? formatCurrency(offer['TE']) : prev.te,
                            tusd: offer['TUSD'] ? formatCurrency(offer['TUSD']) : prev.tusd,
                            fio_b: offer['Fio B'] ? formatCurrency(offer['Fio B']) : prev.fio_b,
                            desconto_assinante: discountVal.toFixed(2)
                        }));
                    }
                }

            } catch (error) {
                console.error('Erro CEP', error);
                showAlert('Erro ao buscar CEP/Ofertas: ' + (error.message || 'Não encontrado'), 'error');
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const payload = {
                subscriber_id: formData.subscriber_id || null,
                usina_id: formData.usina_id || null,
                status: formData.status,
                numero_uc: formData.numero_uc,
                titular_conta: formData.titular_conta,
                modalidade: formData.modalidade,
                concessionaria: formData.concessionaria,
                tipo_ligacao: formData.tipo_ligacao,
                franquia: Number(formData.franquia),
                tarifa_concessionaria: parseCurrency(formData.tarifa_concessionaria),
                te: parseCurrency(formData.te),
                tusd: parseCurrency(formData.tusd),
                fio_b: parseCurrency(formData.fio_b),
                desconto_assinante: Number(formData.desconto_assinante),
                dia_vencimento: Number(formData.dia_vencimento),
                address: {
                    cep: formData.cep.replace(/\D/g, ''),
                    rua: formData.rua,
                    numero: formData.numero,
                    complemento: formData.complemento,
                    bairro: formData.bairro,
                    cidade: formData.cidade,
                    uf: formData.uf
                }
            };

            if (!payload.subscriber_id) throw new Error('Assinante é obrigatório.');

            let result;
            if (consumerUnit?.id) {
                result = await supabase.from('consumer_units').update(payload).eq('id', consumerUnit.id).select().single();
            } else {
                result = await supabase.from('consumer_units').insert(payload).select().single();
            }

            if (result.error) throw result.error;
            onSave(result.data);
            onClose();
        } catch (error) {
            showAlert('Erro ao salvar UC: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        const confirm = await showConfirm('Excluir esta Unidade Consumidora?');
        if (!confirm) return;
        setLoading(true);
        try {
            const { error } = await supabase.from('consumer_units').delete().eq('id', consumerUnit.id);
            if (error) throw error;
            if (onDelete) onDelete(consumerUnit.id);
            onClose();
        } catch (error) {
            showAlert('Erro ao excluir: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    // Find subscriber name for header
    const subscriberName = subscribers.find(s => s.id === formData.subscriber_id)?.name || '';

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '900px' }}>
                <div className="modal-header">
                    <h3>
                        {consumerUnit ? (
                            subscriberName ? `Editar UC - ${subscriberName}` : 'Editar UC'
                        ) : 'Nova Unidade Consumidora'}
                    </h3>
                    <button onClick={onClose} className="modal-close">&times;</button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

                    {/* Status at Top */}
                    <div className="form-group" style={{ gridColumn: '1 / -1', background: 'var(--color-bg-light)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                        <label className="label">Status da Unidade</label>
                        <select
                            value={formData.status}
                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                            className="select"
                            style={{ maxWidth: '300px' }}
                        >
                            {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>

                    <CollapsibleSection title="Vínculos" defaultOpen={true}>
                        <div className="form-group">
                            <label className="label">Assinante <span style={{ color: 'var(--color-error)' }}>*</span></label>
                            <select
                                required
                                value={formData.subscriber_id}
                                onChange={e => setFormData({ ...formData, subscriber_id: e.target.value })}
                                className="select"
                            >
                                <option value="">Selecione...</option>
                                {subscribers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name} ({s.cpf_cnpj})</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="label">Usina (Opcional)</label>
                            <select
                                value={formData.usina_id}
                                onChange={e => setFormData({ ...formData, usina_id: e.target.value })}
                                className="select"
                            >
                                <option value="">Selecione...</option>
                                {usinas.map(u => (
                                    <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                            </select>
                        </div>
                    </CollapsibleSection>

                    <CollapsibleSection title="Endereço de Instalação" defaultOpen={true}>
                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem' }}>
                            <div style={{ width: '150px' }}>
                                <label className="label">CEP</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        value={formData.cep}
                                        onChange={handleCepChange}
                                        onBlur={handleCepBlur}
                                        placeholder="00000-000"
                                        maxLength={9}
                                        className="input"
                                    />
                                    {searchingCep && <span style={{ position: 'absolute', right: '10px', top: '10px', fontSize: '0.7rem', color: 'var(--color-text-light)' }}>...</span>}
                                </div>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="label">Concessionária (Auto)</label>
                                <input
                                    value={formData.concessionaria}
                                    onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                                    className="input"
                                    readOnly
                                    style={{ background: 'var(--color-bg-light)' }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', gridColumn: '1 / -1' }}>
                            <div style={{ flex: 1 }}>
                                <label className="label">Rua</label>
                                <input
                                    value={formData.rua}
                                    onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                    className="input"
                                />
                            </div>
                            <div style={{ width: '100px' }}>
                                <label className="label">Número</label>
                                <input
                                    value={formData.numero}
                                    onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                    className="input"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="label">Bairro</label>
                            <input
                                value={formData.bairro}
                                onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                className="input"
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Complemento</label>
                            <input
                                value={formData.complemento}
                                onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                className="input"
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Cidade</label>
                            <input
                                value={formData.cidade}
                                onChange={e => setFormData({ ...formData, cidade: e.target.value })}
                                className="input"
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">UF</label>
                            <input
                                value={formData.uf}
                                onChange={e => setFormData({ ...formData, uf: e.target.value })}
                                className="input"
                            />
                        </div>
                    </CollapsibleSection>

                    <CollapsibleSection title="Dados da Unidade" defaultOpen={true}>
                        <div className="form-group">
                            <label className="label">Número da UC <span style={{ color: 'var(--color-error)' }}>*</span></label>
                            <input
                                required
                                value={formData.numero_uc}
                                onChange={e => setFormData({ ...formData, numero_uc: e.target.value })}
                                placeholder="Ex: 7204400277"
                                className="input"
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Titular da Conta (Na Fatura)</label>
                            <input
                                required
                                value={formData.titular_conta}
                                onChange={e => setFormData({ ...formData, titular_conta: e.target.value })}
                                placeholder="Nome Completo / Razão Social"
                                className="input"
                            />
                        </div>
                    </CollapsibleSection>

                    <CollapsibleSection title="Dados Técnicos e Comerciais" defaultOpen={true}>
                        <div className="form-group">
                            <label className="label">Tipo de Ligação</label>
                            <select
                                value={formData.tipo_ligacao}
                                onChange={e => setFormData({ ...formData, tipo_ligacao: e.target.value })}
                                className="select"
                            >
                                {tipoLigacaoOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="label">Modalidade</label>
                            <select
                                value={formData.modalidade}
                                onChange={e => setFormData({ ...formData, modalidade: e.target.value })}
                                className="select"
                            >
                                {modalidadeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>

                        <div style={{ gridColumn: '1 / -1', background: '#e0f2fe', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid #bae6fd', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div style={{ gridColumn: '1 / -1', fontSize: '0.9rem', fontWeight: 'bold', color: '#0369a1', marginBottom: '0.5rem' }}>Componentes Tarifários</div>

                            <div className="form-group">
                                <label className="label" style={{ color: '#075985' }}>Tarifa Concessionária (R$/kWh)</label>
                                <input
                                    type="text"
                                    value={formData.tarifa_concessionaria}
                                    onChange={e => handleCurrencyChange('tarifa_concessionaria', e.target.value)}
                                    placeholder="R$ 0,0000"
                                    className="input"
                                    style={{ borderColor: '#7dd3fc' }}
                                />
                            </div>

                            <div className="form-group">
                                <label className="label" style={{ color: '#075985' }}>TE (Energia) - R$/kWh</label>
                                <input
                                    type="text"
                                    value={formData.te}
                                    onChange={e => handleCurrencyChange('te', e.target.value)}
                                    placeholder="R$ 0,0000"
                                    className="input"
                                    style={{ borderColor: '#7dd3fc' }}
                                />
                            </div>

                            <div className="form-group">
                                <label className="label" style={{ color: '#075985' }}>TUSD (Distribuição) - R$/kWh</label>
                                <input
                                    type="text"
                                    value={formData.tusd}
                                    onChange={e => handleCurrencyChange('tusd', e.target.value)}
                                    placeholder="R$ 0,0000"
                                    className="input"
                                    style={{ borderColor: '#7dd3fc' }}
                                />
                            </div>

                            <div className="form-group">
                                <label className="label" style={{ color: '#075985' }}>Fio B - R$/kWh</label>
                                <input
                                    type="text"
                                    value={formData.fio_b}
                                    onChange={e => handleCurrencyChange('fio_b', e.target.value)}
                                    placeholder="R$ 0,0000"
                                    className="input"
                                    style={{ borderColor: '#7dd3fc' }}
                                />
                            </div>
                        </div>

                        <div style={{ background: 'var(--color-warning-bg)', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-warning)' }}>
                            <label className="label" style={{ color: 'var(--color-warning)', fontWeight: 'bold' }}>Tarifa Mínima Estimada (R$)</label>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--color-warning)' }}>
                                {formData.tarifa_minima || 'R$ 0,00'}
                            </div>
                            <span style={{ fontSize: '0.7rem', color: 'var(--color-warning)' }}>
                                Baseada no Tipo de Ligação ({formData.tipo_ligacao}) x Tarifa.
                            </span>
                        </div>

                        <div className="form-group">
                            <label className="label">Desconto Assinante (%)</label>
                            <input
                                type="number" step="0.01"
                                value={formData.desconto_assinante}
                                onChange={e => setFormData({ ...formData, desconto_assinante: e.target.value })}
                                placeholder="%"
                                className="input"
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Franquia / Consumo Min (kWh)</label>
                            <input
                                type="number"
                                value={formData.franquia}
                                onChange={e => setFormData({ ...formData, franquia: e.target.value })}
                                className="input"
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Dia de Vencimento</label>
                            <select
                                value={formData.dia_vencimento}
                                onChange={e => setFormData({ ...formData, dia_vencimento: e.target.value })}
                                className="select"
                            >
                                {vencimentoOptions.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>
                    </CollapsibleSection>

                    <div className="modal-footer" style={{ gridColumn: '1 / -1' }}>
                        {consumerUnit && onDelete && (
                            <button type="button" onClick={handleDelete} className="btn btn-danger" style={{ marginRight: 'auto' }}>
                                Excluir UC
                            </button>
                        )}
                        <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
                        <button type="submit" disabled={loading} className="btn btn-primary">
                            {loading ? 'Salvando...' : 'Salvar UC'}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
