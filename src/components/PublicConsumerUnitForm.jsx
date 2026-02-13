import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep } from '../lib/api';
import { useUI } from '../contexts/UIContext';
import { ChevronDown, ChevronUp } from 'lucide-react';

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

export default function PublicConsumerUnitForm({ consumerUnit, subscriberId, concessionariaDefault, onClose, onSave }) {
    const { showAlert, showConfirm } = useUI();
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);

    // Initial State
    const [formData, setFormData] = useState({
        subscriber_id: subscriberId || '',
        status: 'em_ativacao',
        numero_uc: '',
        titular_conta: '',
        concessionaria: concessionariaDefault || '',

        // Defaults for hidden fields
        modalidade: 'geracao_compartilhada',
        tipo_ligacao: 'monofasico',
        usina_id: null,

        // Address
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: ''
    });

    useEffect(() => {
        if (consumerUnit) {
            setFormData(prev => ({
                ...prev,
                ...consumerUnit,
                address: undefined, // flattened below
                cep: maskCEP(consumerUnit.address?.cep || ''),
                rua: consumerUnit.address?.rua || '',
                numero: consumerUnit.address?.numero || '',
                complemento: consumerUnit.address?.complemento || '',
                bairro: consumerUnit.address?.bairro || '',
                cidade: consumerUnit.address?.cidade || '',
                uf: consumerUnit.address?.uf || ''
            }));
        }
        if (concessionariaDefault) {
            setFormData(prev => ({ ...prev, concessionaria: concessionariaDefault }));
        }
    }, [consumerUnit, concessionariaDefault]);

    const maskCEP = (val) => {
        return val.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9);
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
                }));
            } catch (error) {
                console.error('Erro CEP', error);
                // Silent error or basic alert
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
                subscriber_id: formData.subscriber_id, // Must be passed from parent
                status: formData.status,
                numero_uc: formData.numero_uc,
                titular_conta: formData.titular_conta,
                concessionaria: formData.concessionaria,
                modalidade: formData.modalidade,
                tipo_ligacao: formData.tipo_ligacao,

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

            if (!payload.subscriber_id) throw new Error('Erro: Assinante não identificado.');
            if (!payload.numero_uc) throw new Error('Número da UC é obrigatório.');

            let result;
            if (consumerUnit?.id) {
                // Even if editing is not main flow, logic supports it
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

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <h3>{consumerUnit ? 'Editar Unidade Consumidora' : 'Nova Unidade Consumidora'}</h3>
                    <button onClick={onClose} className="modal-close">&times;</button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

                    {/* Unit Data - Top Priority */}
                    <div style={{ gridColumn: '1 / -1', background: '#f0f9ff', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid #bae6fd' }}>
                        <div style={{ marginBottom: '1rem' }}>
                            <label className="label">Número da UC <span style={{ color: 'var(--color-error)' }}>*</span></label>
                            <input
                                required
                                value={formData.numero_uc}
                                onChange={e => setFormData({ ...formData, numero_uc: e.target.value })}
                                placeholder="Ex: 7204400277"
                                className="input"
                                style={{ fontSize: '1.1rem', fontWeight: 'bold' }}
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label className="label">Titular da Conta (Conforme Fatura)</label>
                            <input
                                required
                                value={formData.titular_conta}
                                onChange={e => setFormData({ ...formData, titular_conta: e.target.value })}
                                placeholder="Nome Completo / Razão Social"
                                className="input"
                            />
                        </div>

                        <div>
                            <label className="label">Concessionária</label>
                            <input
                                value={formData.concessionaria}
                                readOnly
                                className="input"
                                style={{ background: '#e0e0e0', color: '#555' }}
                            />
                        </div>
                    </div>

                    {/* Address Section */}
                    <CollapsibleSection title="Endereço de Instalação" defaultOpen={true}>
                        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem' }}>
                            <div style={{ width: '140px' }}>
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
                                    {searchingCep && <span style={{ position: 'absolute', right: '10px', top: '10px', fontSize: '0.7rem' }}>...</span>}
                                </div>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="label">Rua</label>
                                <input
                                    value={formData.rua}
                                    onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                    className="input"
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', gridColumn: '1 / -1' }}>
                            <div style={{ width: '100px' }}>
                                <label className="label">Número</label>
                                <input
                                    value={formData.numero}
                                    onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                    className="input"
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="label">Bairro</label>
                                <input
                                    value={formData.bairro}
                                    onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                    className="input"
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', gridColumn: '1 / -1' }}>
                            <div style={{ flex: 1 }}>
                                <label className="label">Complemento</label>
                                <input
                                    value={formData.complemento}
                                    onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                    className="input"
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', gridColumn: '1 / -1' }}>
                            <div style={{ flex: 1 }}>
                                <label className="label">Cidade</label>
                                <input
                                    value={formData.cidade}
                                    readOnly
                                    className="input"
                                    style={{ background: '#f5f5f5' }}
                                />
                            </div>
                            <div style={{ width: '60px' }}>
                                <label className="label">UF</label>
                                <input
                                    value={formData.uf}
                                    readOnly
                                    className="input"
                                    style={{ background: '#f5f5f5' }}
                                />
                            </div>
                        </div>
                    </CollapsibleSection>

                    <div className="modal-footer" style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
                        <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
                        <button type="submit" disabled={loading} className="btn btn-primary" style={{ minWidth: '150px' }}>
                            {loading ? 'Adicionando...' : 'Adicionar UC'}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
