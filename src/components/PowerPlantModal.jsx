import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import IrradianceChart from './IrradianceChart';
import { useUI } from '../contexts/UIContext';
import { ChevronDown, ChevronUp, MapPin, Zap, Settings, DollarSign, Users, BarChart, Trash2, Save, X } from 'lucide-react';

// Collapsible Section Component
const CollapsibleSection = ({ title, icon: Icon, children, defaultOpen = false, color = 'var(--color-blue)' }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div style={{ marginBottom: '1rem', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', background: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '1rem',
                    background: isOpen ? `${color}10` : 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: isOpen ? '1px solid #e2e8f0' : 'none',
                    transition: 'background 0.2s'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', fontWeight: 'bold', color: color }}>
                    {Icon && <Icon size={20} />}
                    <span style={{ fontSize: '1rem' }}>{title}</span>
                </div>
                {isOpen ? <ChevronUp size={20} color="#64748b" /> : <ChevronDown size={20} color="#64748b" />}
            </div>

            {isOpen && (
                <div style={{ padding: '1.5rem', animation: 'fadeIn 0.3s ease-in-out' }}>
                    {children}
                </div>
            )}
        </div>
    );
};

export default function PowerPlantModal({ usina, onClose, onSave, onDelete }) {
    const { showAlert, showConfirm } = useUI();
    const [suppliers, setSuppliers] = useState([]);
    const [inverterBrands, setInverterBrands] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);

    // Options Lists
    const statusOptions = [
        { value: 'gerando', label: 'Gerando' },
        { value: 'em_conexao', label: 'Em Conexão' },
        { value: 'manutencao', label: 'Manutenção' },
        { value: 'inativa', label: 'Inativa' },
        { value: 'cancelada', label: 'Cancelada' }
    ];

    const modalidadeOptions = [
        { value: 'gd1', label: 'GD I' },
        { value: 'gd2', label: 'GD II' },
        { value: 'gd3', label: 'GD III' }
    ];

    const serviceOptions = [
        'Internet', 'Segurança', 'Manutenção', 'Arrendamento', 'Água', 'Energia', 'Gestão'
    ];

    // Generator Functions for Number Lists
    const generateRange = (start, end, step) => {
        let arr = [];
        for (let i = start; i <= end; i += step) arr.push(i);
        return arr;
    };

    const modulePowerOptions = generateRange(460, 800, 5);

    const inverterPowerOptions = [
        ...generateRange(1000, 7000, 1000),
        7500, 9000, 10000, 12500,
        ...generateRange(15000, 75000, 5000),
        ...generateRange(100000, 300000, 25000)
    ];

    const [formData, setFormData] = useState({
        supplier_id: '',
        name: '',
        status: 'em_conexao',
        modalidade: 'gd1',
        valor_investido: '', // Stored as string for formatting
        qtd_modulos: '',
        potencia_modulos_w: '',
        fabricante_inversor: '',
        potencia_inversor_w: '',
        geracao_estimada_kwh: '',
        servicos_contratados: [],
        service_values: {}, // JSONB for values
        gestao_percentual: '',
        cep: '',
        rua: '',
        numero: '',
        bairro: '',
        cidade: '',
        uf: '',
        ibge_code: '',
        concessionaria: ''
    });

    const [availableUCs, setAvailableUCs] = useState([]);
    const [selectedUCs, setSelectedUCs] = useState([]); // Store full objects

    // Calculated Field: Potencia Kwp
    const [potenciaKwp, setPotenciaKwp] = useState(0);

    // Calc Total Franchise
    const totalFranquiaVinculada = selectedUCs.reduce((acc, uc) => acc + (Number(uc.consumo_medio_kwh) || Number(uc.franquia) || 0), 0);

    useEffect(() => {
        const mods = Number(formData.qtd_modulos) || 0;
        const potW = Number(formData.potencia_modulos_w) || 0;
        const kwp = (mods * potW) / 1000;
        setPotenciaKwp(Number(kwp.toFixed(2)));
    }, [formData.qtd_modulos, formData.potencia_modulos_w]);


    useEffect(() => {
        fetchSuppliers();
        fetchInverterBrands();
        if (usina) {
            setFormData({
                supplier_id: usina.supplier_id || '',
                name: usina.name || '',
                status: usina.status || 'em_conexao',
                modalidade: usina.modalidade || 'gd1',
                valor_investido: usina.valor_investido ? formatCurrency(usina.valor_investido) : '',
                qtd_modulos: usina.qtd_modulos || '',
                potencia_modulos_w: usina.potencia_modulos_w || '',
                fabricante_inversor: usina.fabricante_inversor || '',
                potencia_inversor_w: usina.potencia_inversor_w || '',
                geracao_estimada_kwh: usina.geracao_estimada_kwh || '',
                servicos_contratados: usina.servicos_contratados || [],
                service_values: usina.service_values || {},
                gestao_percentual: usina.gestao_percentual || '',
                cep: usina.address?.cep || '',
                rua: usina.address?.rua || '',
                numero: usina.address?.numero || '',
                bairro: usina.address?.bairro || '',
                cidade: usina.address?.cidade || '',
                uf: usina.address?.uf || '',
                ibge_code: usina.ibge_code || usina.address?.ibge || '',
                concessionaria: usina.concessionaria || ''
            });
            fetchLinkedUCs(usina.id);
        }
    }, [usina]);

    useEffect(() => {
        fetchAvailableUCs();
    }, [usina?.id]);

    const fetchLinkedUCs = async (usinaId) => {
        const { data } = await supabase.from('consumer_units').select('*').eq('usina_id', usinaId);
        if (data) {
            setSelectedUCs(data);
        }
    };

    const fetchAvailableUCs = async () => {
        let query = supabase
            .from('consumer_units')
            .select('id, numero_uc, titular_conta, usina_id, concessionaria, status, consumo_medio_kwh, franquia');

        const { data, error } = await query;

        if (data) {
            const filtered = data.filter(uc => {
                const isLinkedToThis = usina && String(uc.usina_id) === String(usina.id);
                const isAvailable = uc.usina_id === null;
                return isLinkedToThis || isAvailable;
            });
            setAvailableUCs(filtered);
        }
    };

    const fetchSuppliers = async () => {
        const { data } = await supabase.from('suppliers').select('id, name').order('name');
        setSuppliers(data || []);
    };

    const fetchInverterBrands = async () => {
        const { data } = await supabase.from('inverter_brands').select('name').order('name');
        setInverterBrands(data || []);
    };

    const formatCurrency = (value) => {
        if (value === '' || value === undefined || value === null) return '';
        if (typeof value === 'number') {
            return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }
        const number = Number(value.toString().replace(/\D/g, '')) / 100;
        return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const handleValorInvestidoChange = (e) => {
        const raw = e.target.value.replace(/\D/g, '');
        if (!raw) {
            setFormData({ ...formData, valor_investido: '' });
            return;
        }
        const number = Number(raw) / 100;
        const formatted = number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        setFormData({ ...formData, valor_investido: formatted });
    };

    const parseCurrency = (str) => {
        if (!str) return 0;
        const clean = str.replace(/[^\d,]/g, '').replace(',', '.');
        return Number(clean) || 0;
    };

    const handleServiceChange = (service) => {
        setFormData(prev => {
            const current = prev.servicos_contratados || [];
            if (current.includes(service)) {
                return { ...prev, servicos_contratados: current.filter(s => s !== service) };
            } else {
                return { ...prev, servicos_contratados: [...current, service] };
            }
        });
    };

    const handleServiceValueChange = (service, rawValue) => {
        const numericValue = rawValue.replace(/\D/g, '');
        const number = Number(numericValue) / 100;

        setFormData(prev => ({
            ...prev,
            service_values: { ...prev.service_values, [service]: number }
        }));
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
                    ibge_code: addr.ibge || ''
                }));

                if (addr.ibge) {
                    const offer = await fetchOfferData(addr.ibge);
                    if (offer && offer.Concessionaria) {
                        setFormData(prev => ({ ...prev, concessionaria: offer.Concessionaria }));
                    }
                }
            } catch (e) {
                console.error('Erro CEP', e);
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handleChartCalculation = useCallback((avgGeneration) => {
        if (avgGeneration) {
            setFormData(prev => {
                if (avgGeneration !== Number(prev.geracao_estimada_kwh)) {
                    return { ...prev, geracao_estimada_kwh: avgGeneration };
                }
                return prev;
            });
        }
    }, []);

    const handleDelete = async () => {
        const confirmed = await showConfirm('Excluir esta usina?', 'Esta ação não pode ser desfeita.');
        if (!confirmed) return;

        setLoading(true);
        try {
            const { error } = await supabase.from('usinas').delete().eq('id', usina.id);
            if (error) throw error;
            if (onDelete) onDelete(usina.id);
            onClose();
        } catch (error) {
            showAlert('Erro ao excluir: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const valorInvestidoNum = parseCurrency(formData.valor_investido);

            const payload = {
                supplier_id: formData.supplier_id || null,
                name: formData.name,
                concessionaria: formData.concessionaria,
                status: formData.status,
                modalidade: formData.modalidade,
                valor_investido: valorInvestidoNum,
                potencia_kwp: Number(potenciaKwp),
                qtd_modulos: Number(formData.qtd_modulos),
                potencia_modulos_w: Number(formData.potencia_modulos_w),
                fabricante_inversor: formData.fabricante_inversor,
                potencia_inversor_w: Number(formData.potencia_inversor_w),
                geracao_estimada_kwh: Number(formData.geracao_estimada_kwh),
                servicos_contratados: formData.servicos_contratados,
                service_values: formData.service_values,
                gestao_percentual: Number(formData.gestao_percentual),
                ibge_code: formData.ibge_code,
                address: {
                    cep: formData.cep,
                    rua: formData.rua,
                    numero: formData.numero,
                    bairro: formData.bairro,
                    cidade: formData.cidade,
                    uf: formData.uf,
                    ibge: formData.ibge_code
                }
            };

            let usinaId = usina?.id;
            let operationError = null;

            if (usina?.id) {
                const { data, error } = await supabase.from('usinas').update(payload).eq('id', usina.id).select().single();
                if (error) operationError = error;
                else if (data) usinaId = data.id;
            } else {
                const { data, error } = await supabase.from('usinas').insert(payload).select().single();
                if (error) operationError = error;
                else if (data) usinaId = data.id;
            }

            if (operationError) throw operationError;

            if (usinaId) {
                await supabase.from('consumer_units').update({ usina_id: null }).eq('usina_id', usinaId);
                if (selectedUCs.length > 0) {
                    const idsToLink = selectedUCs.map(u => u.id);
                    await supabase.from('consumer_units').update({ usina_id: usinaId }).in('id', idsToLink);
                }
            }

            onSave({ id: usinaId });
            onClose();
            showAlert('Usina salva com sucesso!', 'success');
        } catch (error) {
            console.error('Save error:', error);
            showAlert('Erro ao salvar usina: ' + (error.message || JSON.stringify(error)), 'error');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
            backdropFilter: 'blur(4px)'
        }}>
            <div style={{
                background: '#f8fafc',
                borderRadius: '12px',
                width: '95%',
                maxWidth: '850px',
                maxHeight: '95vh',
                overflowY: 'auto',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.5rem',
                    background: 'white',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTopLeftRadius: '12px',
                    borderTopRightRadius: '12px'
                }}>
                    <div>
                        <h3 style={{ fontSize: '1.5rem', color: '#1e293b', fontWeight: 'bold' }}>
                            {usina ? formData.name : 'Nova Usina'}
                        </h3>
                        <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.2rem' }}>Configure os dados técnicos e comerciais da usina</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '0.5rem' }}>
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>

                    {/* Section 1: Identificação e Localização */}
                    <CollapsibleSection title="Identificação e Localização" icon={MapPin} defaultOpen={true} color="#2563eb">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Nome da Usina</label>
                                <input
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                                    placeholder="Ex: Usina Solar Norte 01"
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Fornecedor / Proprietário</label>
                                <select
                                    required
                                    value={formData.supplier_id}
                                    onChange={e => setFormData({ ...formData, supplier_id: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: 'white' }}
                                >
                                    <option value="">Selecione...</option>
                                    {suppliers.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>CEP</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        value={formData.cep}
                                        onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                        onBlur={handleCepBlur}
                                        placeholder="00000-000"
                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: searchingCep ? '#f0f9ff' : 'white' }}
                                    />
                                    {searchingCep && <span style={{ position: 'absolute', right: '10px', top: '12px', fontSize: '0.8rem', color: '#3b82f6' }}>...</span>}
                                </div>
                            </div>

                            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Cidade / UF</label>
                                    <input
                                        value={formData.cidade && formData.uf ? `${formData.cidade} / ${formData.uf}` : ''}
                                        disabled
                                        placeholder="Preenchimento automático"
                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f1f5f9', color: '#64748b' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Concessionária</label>
                                    <input
                                        value={formData.concessionaria}
                                        onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                                        placeholder="Ex: Cemig"
                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                                    />
                                </div>
                            </div>
                        </div>
                    </CollapsibleSection>

                    {/* Section 2: Características Técnicas */}
                    <CollapsibleSection title="Características Técnicas" icon={Settings} defaultOpen={true} color="#ea580c">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Status Operacional</label>
                                <select
                                    value={formData.status}
                                    onChange={e => setFormData({ ...formData, status: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: 'white' }}
                                >
                                    {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Modalidade</label>
                                <select
                                    value={formData.modalidade}
                                    onChange={e => setFormData({ ...formData, modalidade: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: 'white' }}
                                >
                                    {modalidadeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>

                            <div style={{ height: '1px', background: '#e2e8f0', margin: '0.5rem 0', gridColumn: '1 / -1' }}></div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Qtd. Módulos</label>
                                <input
                                    type="number"
                                    value={formData.qtd_modulos}
                                    onChange={e => setFormData({ ...formData, qtd_modulos: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Potência Módulo (W)</label>
                                <select
                                    value={formData.potencia_modulos_w}
                                    onChange={e => setFormData({ ...formData, potencia_modulos_w: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: 'white' }}
                                >
                                    <option value="">Selecione...</option>
                                    {modulePowerOptions.map(v => <option key={v} value={v}>{v} W</option>)}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Fabricante Inversor</label>
                                <select
                                    value={formData.fabricante_inversor}
                                    onChange={e => setFormData({ ...formData, fabricante_inversor: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: 'white' }}
                                >
                                    <option value="">Selecione...</option>
                                    {inverterBrands.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Potência Inversor (W)</label>
                                <select
                                    value={formData.potencia_inversor_w}
                                    onChange={e => setFormData({ ...formData, potencia_inversor_w: e.target.value })}
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: 'white' }}
                                >
                                    <option value="">Selecione...</option>
                                    {inverterPowerOptions.map(v => <option key={v} value={v}>{v} W</option>)}
                                </select>
                            </div>

                            <div style={{ gridColumn: '1 / -1', marginTop: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#fff7ed', padding: '1rem', borderRadius: '8px', border: '1px solid #ffedd5' }}>
                                    <div style={{ background: '#ea580c', color: 'white', padding: '0.5rem', borderRadius: '50%' }}><Zap size={20} /></div>
                                    <div>
                                        <div style={{ fontSize: '0.8rem', color: '#ea580c', fontWeight: 600, textTransform: 'uppercase' }}>Potência Total do Sistema (Calculada)</div>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#9a3412' }}>{potenciaKwp} kWp</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CollapsibleSection>

                    {/* Section 3: Geração e Financeiro */}
                    <CollapsibleSection title="Geração e Financeiro" icon={DollarSign} color="#16a34a">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Valor Investido</label>
                                <input
                                    value={formData.valor_investido}
                                    onChange={handleValorInvestidoChange}
                                    placeholder="R$ 0,00"
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Geração Estimada (Média Mensal)</label>
                                <input
                                    type="number"
                                    value={formData.geracao_estimada_kwh}
                                    onChange={e => setFormData({ ...formData, geracao_estimada_kwh: e.target.value })}
                                    placeholder="Use o gráfico para calcular"
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f0fdf4' }}
                                />
                            </div>

                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Serviços Contratados</label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.8rem' }}>
                                    {serviceOptions.map(s => {
                                        const isSelected = formData.servicos_contratados.includes(s);
                                        return (
                                            <div key={s} style={{
                                                border: isSelected ? '1px solid #16a34a' : '1px solid #e2e8f0',
                                                borderRadius: '6px',
                                                padding: '0.5rem',
                                                background: isSelected ? '#f0fdf4' : 'white',
                                                transition: '0.2s'
                                            }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: isSelected ? '0.5rem' : '0' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleServiceChange(s)}
                                                    />
                                                    <span style={{ fontSize: '0.9rem', fontWeight: isSelected ? 600 : 400, color: isSelected ? '#166534' : '#64748b' }}>{s}</span>
                                                </label>

                                                {isSelected && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', animation: 'fadeIn 0.2s' }}>
                                                        <input
                                                            placeholder="Valor (R$)"
                                                            value={formatCurrency(formData.service_values?.[s])}
                                                            onChange={(e) => handleServiceValueChange(s, e.target.value)}
                                                            style={{ width: '100%', padding: '0.3rem', border: '1px solid #bbf7d0', borderRadius: '4px', fontSize: '0.8rem' }}
                                                        />
                                                    </div>
                                                )}
                                                {isSelected && s === 'Gestão' && (
                                                    <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <input
                                                            type="number" step="0.01"
                                                            placeholder="%"
                                                            value={formData.gestao_percentual}
                                                            onChange={e => setFormData({ ...formData, gestao_percentual: e.target.value })}
                                                            style={{ width: '100%', padding: '0.3rem', border: '1px solid #bbf7d0', borderRadius: '4px', fontSize: '0.8rem' }}
                                                        />
                                                        <span style={{ fontSize: '0.8rem', color: '#166534' }}>%</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#059669', fontWeight: 600, marginBottom: '0.5rem' }}>
                                <BarChart size={18} />
                                <span>Estimativa de Geração (Irradiância)</span>
                            </div>
                            <IrradianceChart
                                ibgeCode={formData.ibge_code}
                                potenciaKwp={potenciaKwp}
                                onCalculate={handleChartCalculation}
                            />
                        </div>
                    </CollapsibleSection>

                    {/* Section 4: Unidades Consumidoras */}
                    <CollapsibleSection title="Vínculos com UCs" icon={Users} color="#7c3aed">
                        <div style={{ background: '#f5f3ff', padding: '1rem', borderRadius: '8px', border: '1px solid #ede9fe' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                                <div style={{ fontSize: '0.9rem', color: '#5b21b6' }}>
                                    Capacidade Comprometida: <strong>{totalFranquiaVinculada.toFixed(2)} kWh</strong>
                                    {formData.geracao_estimada_kwh > 0 && (
                                        <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: totalFranquiaVinculada > formData.geracao_estimada_kwh ? '#ef4444' : '#166534' }}>
                                            ({Math.round((totalFranquiaVinculada / formData.geracao_estimada_kwh) * 100)}% da Geração)
                                        </span>
                                    )}
                                </div>
                            </div>

                            {availableUCs.length === 0 ? (
                                <p style={{ fontSize: '0.8rem', color: '#666', textAlign: 'center', padding: '1rem' }}>
                                    Nenhuma UC disponível encontrada.
                                </p>
                            ) : (
                                <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.8rem' }}>
                                    {availableUCs.map(uc => {
                                        const isSelected = selectedUCs.some(u => u.id === uc.id);
                                        return (
                                            <label key={uc.id} style={{
                                                display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.85rem',
                                                padding: '0.8rem', border: isSelected ? '1px solid #8b5cf6' : '1px solid #ddd',
                                                borderRadius: '6px', background: isSelected ? 'white' : 'rgba(255,255,255,0.6)',
                                                cursor: 'pointer', transition: '0.2s', boxShadow: isSelected ? '0 2px 4px rgba(139, 92, 246, 0.1)' : 'none'
                                            }}>
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={e => {
                                                        if (e.target.checked) setSelectedUCs([...selectedUCs, uc]);
                                                        else setSelectedUCs(selectedUCs.filter(u => u.id !== uc.id));
                                                    }}
                                                    style={{ transform: 'scale(1.1)', accentColor: '#7c3aed' }}
                                                />
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 'bold', color: '#1e293b' }}>{uc.numero_uc}</div>
                                                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                                        {uc.titular_conta?.substring(0, 20)}
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <span style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8' }}>{uc.concessionaria}</span>
                                                    <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 'bold' }}>
                                                        {uc.franquia ? `${Math.round(uc.franquia)} kWh (Frq)` : (uc.consumo_medio_kwh ? `${Math.round(uc.consumo_medio_kwh)} kWh (Cons)` : '0 kWh')}
                                                    </div>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </CollapsibleSection>

                    {/* Footer Actions */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '2rem',
                        paddingTop: '1.5rem',
                        borderTop: '1px solid #e2e8f0'
                    }}>
                        <div>
                            {usina && onDelete && (
                                <button type="button" onClick={handleDelete} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.2rem', background: '#fee2e2', color: '#dc2626', borderRadius: '6px', border: '1px solid #fecaca', fontWeight: 600, cursor: 'pointer' }}>
                                    <Trash2 size={18} /> Excluir Usina
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={onClose} style={{ padding: '0.8rem 1.5rem', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', color: '#475569', fontWeight: 600 }}>
                                Cancelar
                            </button>
                            <button type="submit" disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 2rem', background: 'var(--color-blue)', color: 'white', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}>
                                {loading ? 'Salvando...' : <><Save size={18} /> Salvar Usina</>}
                            </button>
                        </div>
                    </div>

                </form>
            </div>
        </div>
    );
}
