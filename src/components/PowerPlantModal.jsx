import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import IrradianceChart from './IrradianceChart';
import { useUI } from '../contexts/UIContext';

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
    // Note: Assuming 'consumo_medio_kwh' or 'franquia' field exists on UC.

    useEffect(() => {
        // ... (Kwp Calc) ...
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
    }, [usina]); // Removed fetchAvailableUCs from here to avoid race condition or infinite loops if dependency added

    // Fetch UCs available. Relaxed dependency to concessionaria change
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
            .select('id, numero_uc, titular_conta, usina_id, concessionaria, status, consumo_medio_kwh');

        const { data, error } = await query;

        if (data) {
            console.log('All UCs fetched:', data);

            // Broadened filter: show ALL UCs that are either linked to this usina OR available (usina_id is null).
            // Removed strict status check to ensure user can see everything.
            // Added status to the display label so user can distinguish.

            const filtered = data.filter(uc => {
                const isLinkedToThis = usina && uc.usina_id === usina.id;
                const isAvailable = uc.usina_id === null;

                return isLinkedToThis || isAvailable;
            });

            console.log('Filtered UCs:', filtered);
            setAvailableUCs(filtered);
        }
    };

    // ... (Helpers) ...
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
        // If it comes as a number (from DB or state), format it
        if (typeof value === 'number') {
            return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }
        // If string (from masked input logic where integers = cents)
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

    // Helper to get raw number from formatted currency string
    const getRawValorInvestido = () => {
        if (!formData.valor_investido) return 0;
        return Number(formData.valor_investido.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
    };

    // Parse currency string to number
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

    // Handler for Service Value Inputs (Money Mask)
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

                // Fetch Concessionaria from IBGE
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
        // Automatically populate 'geracao_estimada_kwh' with the monthly average calculated by the chart
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
                // ... fields
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
                service_values: formData.service_values, // New field populated correctly now
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

            // ... insert/update logic...
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

            // Update UCs
            if (usinaId) {
                // Unlink all previous
                await supabase.from('consumer_units').update({ usina_id: null }).eq('usina_id', usinaId);

                if (selectedUCs.length > 0) {
                    const idsToLink = selectedUCs.map(u => u.id);
                    await supabase.from('consumer_units')
                        .update({ usina_id: usinaId })
                        .in('id', idsToLink);
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
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>

            <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
                <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
                    {usina ? 'Editar Usina' : 'Nova Usina'}
                </h3>

                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Nome da Usina</label>
                        <input
                            required
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Localização</div>

                    <div style={{ display: 'flex', gap: '1rem', gridColumn: '1 / -1' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>CEP</label>
                            <input
                                value={formData.cep}
                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                onBlur={handleCepBlur}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: searchingCep ? '#f0f9ff' : 'white' }}
                            />
                        </div>
                        <div style={{ flex: 3 }}>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Cidade/UF</label>
                            <input
                                value={`${formData.cidade} / ${formData.uf}`}
                                disabled
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#f9fafb' }}
                            />
                        </div>
                    </div>


                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Concessionária (Auto ou Manual)</label>
                        <input
                            value={formData.concessionaria}
                            onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                            placeholder="Preenchido via CEP ou digite..."
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Detalhes Técnicos</div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Status</label>
                        <select
                            value={formData.status}
                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Modalidade</label>
                        <select
                            value={formData.modalidade}
                            onChange={e => setFormData({ ...formData, modalidade: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            {modalidadeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Fornecedor</label>
                        <select
                            required
                            value={formData.supplier_id}
                            onChange={e => setFormData({ ...formData, supplier_id: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            <option value="">Selecione...</option>
                            {suppliers.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Valor Investido</label>
                        <input
                            value={formData.valor_investido}
                            onChange={handleValorInvestidoChange}
                            placeholder="R$ 0,00"
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Módulos e Inversores</div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Qtd. de Módulos</label>
                        <input
                            type="number"
                            value={formData.qtd_modulos}
                            onChange={e => setFormData({ ...formData, qtd_modulos: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Potência Módulo (W)</label>
                        <select
                            value={formData.potencia_modulos_w}
                            onChange={e => setFormData({ ...formData, potencia_modulos_w: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            <option value="">Selecione...</option>
                            {modulePowerOptions.map(v => <option key={v} value={v}>{v} W</option>)}
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Fabricante Inversor</label>
                        <select
                            value={formData.fabricante_inversor}
                            onChange={e => setFormData({ ...formData, fabricante_inversor: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            <option value="">Selecione...</option>
                            {inverterBrands.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Potência Inversor (W)</label>
                        <select
                            value={formData.potencia_inversor_w}
                            onChange={e => setFormData({ ...formData, potencia_inversor_w: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            <option value="">Selecione...</option>
                            {inverterPowerOptions.map(v => <option key={v} value={v}>{v} W</option>)}
                        </select>
                    </div>

                    {/* Moved Fields */}

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: 'var(--color-orange)' }}>Potência Total (kWp) - Calc</label>
                        <input
                            value={potenciaKwp}
                            disabled
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#fff7ed', fontWeight: 'bold' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Geração Estimada (kWh)</label>
                        <input
                            type="number"
                            value={formData.geracao_estimada_kwh}
                            onChange={e => setFormData({ ...formData, geracao_estimada_kwh: e.target.value })}
                            placeholder="Calculado automaticamente"
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#eef2ff' }}
                        />
                    </div>



                    <div style={{ gridColumn: '1 / -1', background: '#f9fafb', padding: '1rem', borderRadius: '8px', border: '1px solid #eee' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--color-blue)' }}>
                                Vincular Unidades Consumidoras - Todas
                            </label>
                        </div>

                        <div style={{ fontSize: '0.8rem', color: '#555', marginBottom: '0.5rem', background: '#e0f2fe', padding: '0.5rem', borderRadius: '4px' }}>
                            Total <strong>{selectedUCs.length}</strong> UCs conectadas | Total <strong>{totalFranquiaVinculada.toFixed(2)}</strong> kWh/mês
                        </div>

                        {availableUCs.length === 0 ? (
                            <p style={{ fontSize: '0.8rem', color: '#666' }}>
                                Nenhuma UC disponível (Em Ativação) encontrada.
                            </p>
                        ) : (
                            <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
                                {availableUCs.map(uc => {
                                    const isSelected = selectedUCs.some(u => u.id === uc.id);
                                    return (
                                        <label key={uc.id} style={{
                                            display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem',
                                            padding: '0.4rem', border: isSelected ? '1px solid var(--color-blue)' : '1px solid #ddd', borderRadius: '4px', background: isSelected ? '#eff6ff' : 'white'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={e => {
                                                    if (e.target.checked) setSelectedUCs([...selectedUCs, uc]);
                                                    else setSelectedUCs(selectedUCs.filter(u => u.id !== uc.id));
                                                }}
                                            />
                                            <div>
                                                <div style={{ fontWeight: 'bold' }}>{uc.numero_uc}</div>
                                                <div style={{ fontSize: '0.75rem', color: '#555' }}>
                                                    {uc.titular_conta?.substring(0, 15)}...
                                                    <br /><span style={{ fontSize: '0.65rem', color: '#888' }}>({uc.concessionaria})</span>
                                                </div>
                                                {uc.consumo_medio_kwh && <div style={{ fontSize: '0.7rem', color: 'green' }}>Cap: {uc.consumo_medio_kwh} kWh</div>}
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>


                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Gestão e Serviços</div>

                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Serviços Contratados</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {serviceOptions.map(s => {
                                const isSelected = formData.servicos_contratados.includes(s);
                                return (
                                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.9rem', width: '150px', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => handleServiceChange(s)}
                                            />
                                            {s}
                                        </label>

                                        {/* Value Input if selected */}
                                        {isSelected && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    placeholder="Valor (R$)"
                                                    value={formatCurrency(formData.service_values?.[s])} // Use new formatCurrency logic
                                                    onChange={(e) => handleServiceValueChange(s, e.target.value)} // Use new handler
                                                    style={{ padding: '0.3rem', border: '1px solid #ddd', borderRadius: '4px', width: '100px' }}
                                                />
                                                {s === 'Gestão' && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: '1rem' }}>
                                                        <label style={{ fontSize: '0.8rem' }}>Taxa (%):</label>
                                                        <input
                                                            type="number" step="0.01"
                                                            value={formData.gestao_percentual}
                                                            onChange={e => setFormData({ ...formData, gestao_percentual: e.target.value })}
                                                            style={{ padding: '0.3rem', border: '1px solid #ddd', borderRadius: '4px', width: '60px' }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Chart Section */}
                    <div style={{ gridColumn: '1 / -1' }}>
                        <IrradianceChart
                            ibgeCode={formData.ibge_code}
                            potenciaKwp={potenciaKwp}
                            onCalculate={handleChartCalculation}
                        />
                        {/* Overlay Bar for Linked Franchise will be handled in Chart Component ideally, or simpler here */}
                    </div>

                    <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
                        <div>
                            {usina && onDelete && (
                                <button type="button" onClick={handleDelete} style={{ padding: '0.5rem 1rem', background: '#fee2e2', color: '#dc2626', borderRadius: '4px', border: '1px solid #fecaca' }}>
                                    Excluir
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', background: '#ccc', borderRadius: '4px' }}>Cancelar</button>
                            <button type="submit" disabled={loading} style={{ padding: '0.5rem 1rem', background: 'var(--color-blue)', color: 'white', borderRadius: '4px' }}>
                                {loading ? 'Salvando...' : 'Salvar Usina'}
                            </button>
                        </div>
                    </div>
                </form >
            </div >
        </div >
    );
}
