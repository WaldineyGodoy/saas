import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Zap, Save, Search, Edit2, X, Building2, MapPin, Percent, DollarSign, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

export default function EnergyAccountSettings() {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [autoPayment, setAutoPayment] = useState(false);
    
    // Concessionarias States
    const [concessionarias, setConcessionarias] = useState([]);
    const [loadingCons, setLoadingCons] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCity, setFilterCity] = useState('');
    const [filterUF, setFilterUF] = useState('');
    const [selectedCons, setSelectedCons] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalData, setModalData] = useState({
        te: 0,
        tusd: 0,
        fio_b: 0,
        tarifa_concessionaria: 0,
        desconto_assinante: 0
    });

    useEffect(() => {
        fetchConfig();
        fetchConcessionarias();
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

    const fetchConcessionarias = async () => {
        setLoadingCons(true);
        try {
            console.log('Iniciando busca de concessionárias via View...');
            const { data, error } = await supabase
                .from('view_concessionarias_resumo')
                .select('*')
                .order('Concessionaria', { ascending: true });

            if (error) {
                console.error('Erro Supabase:', error);
                throw error;
            }

            console.log('Dados recebidos da View:', data?.length);

            if (!data || data.length === 0) {
                setConcessionarias([]);
                return;
            }

            // Map Municipios_str back to array for filtering
            const result = data.map(item => ({
                ...item,
                Municipios: item.Municipios_str ? item.Municipios_str.toLowerCase().split(', ') : []
            }));

            setConcessionarias(result);
        } catch (err) {
            console.error('Erro ao buscar concessionárias:', err);
            showAlert('Erro ao carregar concessionárias: ' + (err.message || 'Erro desconhecido'), 'error');
        } finally {
            setLoadingCons(false);
        }
    };

    const handleModalInputChange = (field, value) => {
        setModalData(prev => {
            const newData = { ...prev, [field]: value };
            if (field === 'te' || field === 'tusd') {
                newData.tarifa_concessionaria = Number((newData.te + newData.tusd).toFixed(4));
            }
            return newData;
        });
    };

    const filteredCons = useMemo(() => {
        return concessionarias.filter(c => {
            const matchCons = !searchTerm || c.Concessionaria?.toLowerCase().includes(searchTerm.toLowerCase());
            const matchUF = !filterUF || c.UF?.toLowerCase().includes(filterUF.toLowerCase());
            const matchCity = !filterCity || c.Municipios?.some(m => m.includes(filterCity.toLowerCase()));
            return matchCons && matchUF && matchCity;
        });
    }, [concessionarias, searchTerm, filterUF, filterCity]);

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

    const openEditModal = (cons) => {
        setSelectedCons(cons);
        setModalData({
            te: cons.TE || 0,
            tusd: cons.TUSD || 0,
            fio_b: cons["Fio B"] || 0,
            tarifa_concessionaria: cons["Tarifa Concessionaria"] || 0,
            desconto_assinante: cons["Desconto Assinante"] || 0
        });
        setIsModalOpen(true);
    };

    const handleUpdateTariffs = async () => {
        setSaving(true);
        try {
            const { error } = await supabase
                .from('Concessionaria')
                .update({
                    "TE": modalData.te,
                    "TUSD": modalData.tusd,
                    "Fio B": modalData.fio_b,
                    "Tarifa Concessionaria": modalData.tarifa_concessionaria,
                    "Desconto Assinante": modalData.desconto_assinante
                })
                .eq('Concessionaria', selectedCons.Concessionaria)
                .eq('UF', selectedCons.UF);

            if (error) throw error;

            showAlert(`Tarifas da ${selectedCons.Concessionaria} atualizadas!`, 'success');
            setIsModalOpen(false);
            fetchConcessionarias();
        } catch (err) {
            console.error('Error updating tariffs:', err);
            showAlert('Erro ao atualizar tarifas: ' + err.message, 'error');
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
        <div style={{ paddingBottom: '4rem' }}>
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .premium-card {
                    background: white;
                    border-radius: 20px;
                    border: 1px solid #e2e8f0;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    transition: all 0.3s ease;
                }
                .premium-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 12px 20px -5px rgba(0,0,0,0.1);
                    border-color: #3b82f6;
                }
                .modal-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(15, 23, 42, 0.6);
                    backdrop-filter: blur(8px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                    padding: 1rem;
                }
                .modal-content {
                    background: white;
                    border-radius: 30px;
                    width: 100%;
                    max-width: 600px;
                    max-height: 90vh;
                    overflow-y: auto;
                    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
                    animation: modalSlideUp 0.3s ease-out;
                }
                @keyframes modalSlideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>

            {/* General Rules Section */}
            <div className="premium-card" style={{ marginBottom: '2.5rem', overflow: 'hidden' }}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ padding: '0.5rem', background: '#fff', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                        <Zap size={20} color="#eab308" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b', fontWeight: 800 }}>Regras Gerais</h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Configure o comportamento automatizado do sistema.</p>
                    </div>
                </div>

                <div style={{ padding: '2rem' }}>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between', 
                        padding: '1.5rem', 
                        background: '#f8fafc', 
                        borderRadius: '16px', 
                        border: '1px solid #e2e8f0',
                        marginBottom: '1.5rem'
                    }}>
                        <div>
                            <h4 style={{ margin: '0 0 0.25rem 0', color: '#1e293b', fontWeight: 700 }}>Pagamento Automático</h4>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', maxWidth: '450px' }}>
                                Liquidação automática da conta da concessionária após confirmação do pagamento do assinante.
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

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.75rem 1.8rem',
                                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '12px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                boxShadow: '0 4px 6px -1px rgba(2, 132, 199, 0.3)',
                                transition: 'all 0.2s'
                            }}
                        >
                            {saving ? 'Salvando...' : <><Save size={18} /> Salvar Regras</>}
                        </button>
                    </div>
                </div>
            </div>

            {/* Tariffs Section */}
            <div>
                <div style={{ marginBottom: '2.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <div>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a', marginBottom: '0.2rem' }}>Tarifas Concessionárias</h2>
                            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Gerencie as tarifas e descontos por distribuidora de energia.</p>
                        </div>
                    </div>

                    <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                        gap: '1rem',
                        background: 'white',
                        padding: '1.2rem',
                        borderRadius: '18px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                            <input
                                type="text"
                                placeholder="Concessionária..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.7rem 1rem 0.7rem 2.5rem',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    fontSize: '0.85rem',
                                    outline: 'none',
                                    background: '#f8fafc'
                                }}
                            />
                        </div>
                        <div style={{ position: 'relative' }}>
                            <MapPin size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                            <input
                                type="text"
                                placeholder="Cidade / Município..."
                                value={filterCity}
                                onChange={(e) => setFilterCity(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.7rem 1rem 0.7rem 2.5rem',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    fontSize: '0.85rem',
                                    outline: 'none',
                                    background: '#f8fafc'
                                }}
                            />
                        </div>
                        <div style={{ position: 'relative' }}>
                            <Building2 size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                            <input
                                type="text"
                                placeholder="Estado (UF)..."
                                value={filterUF}
                                onChange={(e) => setFilterUF(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.7rem 1rem 0.7rem 2.5rem',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '12px',
                                    fontSize: '0.85rem',
                                    outline: 'none',
                                    background: '#f8fafc'
                                }}
                            />
                        </div>
                    </div>
                </div>

                {loadingCons ? (
                    <div style={{ padding: '4rem', textAlign: 'center', color: '#94a3b8' }}>
                        <RefreshCw size={32} className="spin" style={{ marginBottom: '1rem' }} />
                        <p>Carregando concessionárias...</p>
                    </div>
                ) : (
                    <>
                        {filteredCons.length === 0 ? (
                            <div style={{ padding: '4rem', textAlign: 'center', color: '#94a3b8', background: 'white', borderRadius: '20px', border: '1px dashed #cbd5e1' }}>
                                <Building2 size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                                <p style={{ fontWeight: 600 }}>Nenhuma concessionária encontrada.</p>
                                <p style={{ fontSize: '0.85rem' }}>Tente ajustar os filtros de busca.</p>
                            </div>
                        ) : (
                            <div style={{ 
                                display: 'grid', 
                                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
                                gap: '1.5rem' 
                            }}>
                                {filteredCons.map((cons, index) => (
                                    <div 
                                        key={index} 
                                        className="premium-card" 
                                        style={{ padding: '1.5rem', position: 'relative' }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <div style={{ padding: '0.5rem', background: '#f1f5f9', borderRadius: '10px' }}>
                                                    <Building2 size={20} color="#64748b" />
                                                </div>
                                                <div>
                                                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b' }}>{cons.Concessionaria}</h4>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#64748b', fontSize: '0.75rem' }}>
                                                        <MapPin size={12} /> {cons.UF}
                                                    </div>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => openEditModal(cons)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: '0.4rem' }}
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div style={{ background: '#f8fafc', padding: '0.8rem', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Tarifa Conces.</div>
                                                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                                                    R$ {(Number(cons.TE || 0) + Number(cons.TUSD || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}
                                                </div>
                                            </div>
                                            <div style={{ background: '#f0fdf4', padding: '0.8rem', borderRadius: '12px', border: '1px solid #dcfce7' }}>
                                                <div style={{ fontSize: '0.65rem', color: '#166534', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Desconto Assin.</div>
                                                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#166534' }}>
                                                    {Number(cons["Desconto Assinante"] || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Edit Modal */}
            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '2rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ width: '48px', height: '48px', background: '#3b82f6', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 16px -4px rgba(59, 130, 246, 0.4)' }}>
                                    <Building2 size={24} color="white" />
                                </div>
                                <div>
                                    <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 900, color: '#0f172a' }}>{selectedCons.Concessionaria}</h2>
                                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>Ajuste de tarifas para o estado de {selectedCons.UF}</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setIsModalOpen(false)}
                                style={{ background: '#f1f5f9', border: 'none', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '2rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.5rem' }}>T.E. (Tarifa de Energia)</label>
                                    <div style={{ position: 'relative' }}>
                                        <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}>R$</div>
                                        <input 
                                            type="number"
                                            step="0.0001"
                                            value={modalData.te}
                                            onChange={e => handleModalInputChange('te', parseFloat(e.target.value) || 0)}
                                            style={{ width: '100%', padding: '0.8rem 1rem 0.8rem 2.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', fontWeight: 600, outline: 'none' }}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.5rem' }}>TUSD (Distribuição)</label>
                                    <div style={{ position: 'relative' }}>
                                        <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}>R$</div>
                                        <input 
                                            type="number"
                                            step="0.0001"
                                            value={modalData.tusd}
                                            onChange={e => handleModalInputChange('tusd', parseFloat(e.target.value) || 0)}
                                            style={{ width: '100%', padding: '0.8rem 1rem 0.8rem 2.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', fontWeight: 600, outline: 'none' }}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.5rem' }}>Fio B</label>
                                    <div style={{ position: 'relative' }}>
                                        <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}>R$</div>
                                        <input 
                                            type="number"
                                            step="0.0001"
                                            value={modalData.fio_b}
                                            onChange={e => handleModalInputChange('fio_b', parseFloat(e.target.value) || 0)}
                                            style={{ width: '100%', padding: '0.8rem 1rem 0.8rem 2.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', fontWeight: 600, outline: 'none' }}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.5rem' }}>Tarifa Final (Soma Automática)</label>
                                    <div style={{ position: 'relative' }}>
                                        <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}>R$</div>
                                        <input 
                                            type="number"
                                            step="0.0001"
                                            value={modalData.tarifa_concessionaria}
                                            readOnly
                                            style={{ width: '100%', padding: '0.8rem 1rem 0.8rem 2.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', fontWeight: 800, outline: 'none', background: '#f1f5f9', color: '#1e293b' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={{ background: '#f0fdf4', padding: '1.5rem', borderRadius: '20px', border: '1px solid #dcfce7', marginBottom: '2rem' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#166534', marginBottom: '0.75rem' }}>Desconto Padrão Assinante (%)</label>
                                <div style={{ position: 'relative' }}>
                                    <div style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', color: '#166534', fontWeight: 800 }}><Percent size={20} /></div>
                                    <input 
                                        type="number"
                                        value={modalData.desconto_assinante}
                                        onChange={e => setModalData({...modalData, desconto_assinante: parseFloat(e.target.value)})}
                                        style={{ width: '100%', padding: '1rem 3rem 1rem 1.2rem', borderRadius: '15px', border: '2px solid #bbf7d0', fontSize: '1.2rem', fontWeight: 800, color: '#166534', outline: 'none' }}
                                    />
                                </div>
                                <p style={{ margin: '0.75rem 0 0 0', fontSize: '0.75rem', color: '#166534', opacity: 0.8 }}>
                                    Este percentual será sugerido automaticamente em novas propostas vinculadas a esta concessionária.
                                </p>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <button 
                                    onClick={() => setIsModalOpen(false)}
                                    style={{ flex: 1, padding: '1rem', borderRadius: '15px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 700, cursor: 'pointer' }}
                                >
                                    Cancelar
                                </button>
                                <button 
                                    onClick={handleUpdateTariffs}
                                    disabled={saving}
                                    style={{ 
                                        flex: 2, 
                                        padding: '1rem', 
                                        borderRadius: '15px', 
                                        border: 'none', 
                                        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', 
                                        color: 'white', 
                                        fontWeight: 800, 
                                        cursor: 'pointer',
                                        boxShadow: '0 10px 15px -3px rgba(37, 99, 235, 0.4)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    {saving ? 'Atualizando...' : <><Save size={20} /> Atualizar Tarifas</>}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
