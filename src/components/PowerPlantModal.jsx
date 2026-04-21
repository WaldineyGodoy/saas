import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import IrradianceChart from './IrradianceChart';
import { useUI } from '../contexts/UIContext';
import { 
    ChevronDown, ChevronUp, MapPin, Zap, Settings, DollarSign, Users, BarChart, Trash2, Save, X, 
    GripVertical, Key, Eye, EyeOff, Download, FileText, Maximize2, Minimize2, 
    LayoutDashboard, Activity, Wallet2, Link, Globe, AlertCircle, Calendar, CheckCircle
} from 'lucide-react';
import {
    DndContext,
    closestCorners,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Global styles for the modal
const modalStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
    
    .power-plant-modal * {
        font-family: 'Manrope', sans-serif;
    }

    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    @keyframes slideDown {
        from { opacity: 0; transform: translateY(-20px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: #94a3b8;
    }
`;

// Sortable UC Item Component
const SortableUCItem = ({ uc, index, onToggle, geracaoEstimada, onPreview, subscribers, isFixed }) => {
    const percentage = geracaoEstimada > 0 ? ((uc.franquia / geracaoEstimada) * 100).toFixed(2) : null;
    const subscriber = subscribers?.find(s => s.id === uc.titular_fatura_id);
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: uc.id,
        disabled: isFixed
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        fontSize: '0.85rem',
        padding: '0.8rem',
        border: '1px solid #8b5cf6',
        borderRadius: '6px',
        background: 'white',
        cursor: 'default',
        boxShadow: isDragging ? '0 8px 16px rgba(139, 92, 246, 0.15)' : 'none',
        zIndex: isDragging ? 100 : 1,
        position: 'relative',
        marginBottom: '0.5rem'
    };

    return (
        <div ref={setNodeRef} style={style}>
            {!isFixed && (
                <div {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: '#94a3b8' }}>
                    <GripVertical size={18} />
                </div>
            )}
            {isFixed && (
                <div style={{ width: '18px', display: 'flex', alignItems: 'center', color: '#cbd5e1' }}>
                    {/* Empty space or fixed icon */}
                    <div style={{ width: '18px' }} />
                </div>
            )}

            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#7c3aed', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold' }}>
                {index + 1}
            </div>

            <input
                type="checkbox"
                checked={true}
                onChange={e => onToggle(e.target.checked)}
                style={{ transform: 'scale(1.1)', accentColor: '#7c3aed', cursor: 'pointer' }}
            />

            <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontWeight: 'bold', color: '#1e293b' }}>{uc.numero_uc}</div>
                    <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: uc.tipo_unidade === 'geradora' ? '#fef3c7' : '#e0f2fe', color: uc.tipo_unidade === 'geradora' ? '#92400e' : '#075985', fontWeight: 600, textTransform: 'capitalize' }}>
                        {uc.tipo_unidade || 'Beneficiária'}
                    </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {uc.titular_conta}
                </div>
                {subscriber && (
                    <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, marginTop: '0.2rem' }}>
                        Titular: {subscriber.name}
                    </div>
                )}
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                    CPF/CNPJ: {uc.cpf_cnpj_fatura || subscriber?.cpf_cnpj || 'Não inf.'}
                </div>
            </div>

            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div>
                    <span style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8' }}>{uc.concessionaria}</span>
                    <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 'bold' }}>
                        {uc.franquia ? `${Math.round(uc.franquia)} kWh` : '0 kWh'}
                    </div>
                    {percentage && (
                        <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 'bold' }}>
                            {percentage}%
                        </div>
                    )}
                    <div style={{ fontSize: '0.65rem', color: uc.saldo_remanescente ? '#dc2626' : '#94a3b8', fontWeight: uc.saldo_remanescente ? 'bold' : 'normal', marginTop: '0.1rem' }}>
                        Saldo R.: {uc.saldo_remanescente ? 'Sim' : 'Não'}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => onPreview(uc)}
                    style={{ background: '#f1f5f9', border: 'none', borderRadius: '4px', padding: '0.4rem', color: '#64748b', cursor: 'pointer' }}
                >
                    <Eye size={16} />
                </button>
            </div>
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
        concessionaria: '',
        unidade_geradora: '',
        cnpj_cpf: '',
        rateio_type: 'prioridade',
        portal_credentials: { url: '', login: '', password: '' }
    });

    const [availableUCs, setAvailableUCs] = useState([]);
    const [selectedUCs, setSelectedUCs] = useState([]); // Store full objects
    const [subscribers, setSubscribers] = useState([]);
    const [ucFilter, setUcFilter] = useState('linked'); // 'linked' or 'unlinked'
    const [previewUC, setPreviewUC] = useState(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [activeTab, setActiveTab] = useState('geral'); // 'geral' | 'endereco' | 'tecnico' | 'financeiro' | 'ucs' | 'portal'
    const [showExpandedUCs, setShowExpandedUCs] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

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
        fetchSubscribers();
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
                concessionaria: usina.concessionaria || '',
                unidade_geradora: usina.unidade_geradora || '',
                cnpj_cpf: usina.cnpj_cpf || '',
                rateio_type: usina.rateio_type || 'prioridade',
                portal_credentials: usina.portal_credentials || { url: '', login: '', password: '' }
            });
            fetchLinkedUCs(usina.id);
        }
    }, [usina]);

    useEffect(() => {
        fetchAvailableUCs();
    }, [usina?.id]);

    const fetchLinkedUCs = async (usinaId) => {
        const { data } = await supabase.from('consumer_units')
            .select('*')
            .eq('usina_id', usinaId)
            .order('prioridade', { ascending: true });
        if (data) {
            setSelectedUCs(data);
        }
    };

    const [loadingUCs, setLoadingUCs] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [activeFinanceTab, setActiveFinanceTab] = useState('lancamentos');
    const [referenceMonth, setReferenceMonth] = useState(new Date().toISOString().slice(0, 7));
    const [monthlyDetails, setMonthlyDetails] = useState(null);
    const [loadingMonthly, setLoadingMonthly] = useState(false);
    const [monthlyEstimates, setMonthlyEstimates] = useState([]);

    const handleChartCalculation = useCallback((avgGeneration, monthlyData) => {
        if (avgGeneration) {
            setFormData(prev => {
                if (avgGeneration !== Number(prev.geracao_estimada_kwh)) {
                    return { ...prev, geracao_estimada_kwh: avgGeneration };
                }
                return prev;
            });
        }
        if (monthlyData) {
            setMonthlyEstimates(monthlyData);
        }
    }, []);

    useEffect(() => {
        if (activeFinanceTab === 'lancamentos' && usina?.id) {
            fetchMonthlyDetails();
        }
    }, [activeFinanceTab, referenceMonth, usina?.id, selectedUCs, monthlyEstimates]);

    useEffect(() => {
        const fetchMonthlyEstimates = async () => {
            if (!formData.ibge_code || !potenciaKwp) return;
            
            try {
                const { data: result, error } = await supabase
                    .from('irradiancia')
                    .select('*')
                    .eq('"cod.ibge"', formData.ibge_code)
                    .single();

                if (error) throw error;
                if (!result) return;

                const months = [
                    { name: 'Jan', key: 'jan.khw' },
                    { name: 'Fev', key: 'fev.khw' },
                    { name: 'Mar', key: 'mar.kwh' },
                    { name: 'Abr', key: 'abr.kwh' },
                    { name: 'Mai', key: 'mai.kwh' },
                    { name: 'Jun', key: 'jun.kwh' },
                    { name: 'Jul', key: 'jul.kwh' },
                    { name: 'Ago', key: 'ago.kwh' },
                    { name: 'Set', key: 'set.kwh' },
                    { name: 'Out', key: 'out.kwh' },
                    { name: 'Nov', key: 'nov.kwh' },
                    { name: 'Dez', key: 'dez.khw' },
                ];

                const chartData = months.map(m => {
                    const factor = Number(result[m.key]);
                    const generation = factor ? (potenciaKwp * factor) : 0;
                    return {
                        name: m.name,
                        geracao: Math.round(generation),
                        factor
                    };
                });

                setMonthlyEstimates(chartData);
            } catch (err) {
                console.error('Error fetching monthly estimates:', err);
            }
        };

        fetchMonthlyEstimates();
    }, [formData.ibge_code, potenciaKwp]);

    const fetchMonthlyDetails = async () => {
        setLoadingMonthly(true);
        try {
            const firstDay = `${referenceMonth}-01`;
            
            // 1. Fetch sum of "Energia Compensada" from invoices for linked UCs
            let totalCompensada = 0;
            if (selectedUCs.length > 0) {
                const { data: energyData } = await supabase
                    .from('invoices')
                    .select('consumo_compensado')
                    .in('uc_id', selectedUCs.map(uc => uc.id))
                    .eq('mes_referencia', firstDay);
                
                totalCompensada = energyData?.reduce((acc, curr) => acc + (Number(curr.consumo_compensado) || 0), 0) || 0;
            }

            // 2. Get prediction for the specific month from chart data
            const monthIdx = parseInt(referenceMonth.split('-')[1]) - 1;
            const prediction = monthlyEstimates[monthIdx]?.geracao || 0;

            const { data, error } = await supabase
                .from('generation_production')
                .select('*')
                .eq('usina_id', usina.id)
                .eq('mes_referencia', firstDay)
                .maybeSingle();

            if (error) throw error;
            
            if (data) {
                setMonthlyDetails({
                    ...data,
                    details: data.service_details || {},
                    // Update calculated fields if they are 0/null in existing record? 
                    // Or keep what's in DB. User said "deve ser a soma...", so maybe default it.
                    energia_compensada: data.energia_compensada || totalCompensada,
                    geracao_prevista: data.geracao_prevista || prediction
                });
            } else {
                // Initialize placeholder from defaults
                const getVal = (key) => {
                    const val = formData.service_values?.[key];
                    return typeof val === 'number' ? val : parseCurrency(val);
                };

                // Create details only for selected services
                const defaultDetails = {};
                (formData.servicos_contratados || []).forEach(s => {
                    if (s !== 'Gestão') {
                        defaultDetails[s] = getVal(s);
                    }
                });
                
                setMonthlyDetails({
                    usina_id: usina.id,
                    mes_referencia: firstDay,
                    manutencao: getVal('Manutenção'),
                    arrendamento: getVal('Arrendamento'),
                    gestao_reais: (formData.servicos_contratados.includes('Gestão') ? getVal('Gestão') : 0),
                    details: defaultDetails,
                    servicos: Object.values(defaultDetails).reduce((acc, curr) => acc + curr, 0),
                    status: 'pendente',
                    geracao_mensal_kwh: 0,
                    geracao_prevista: prediction,
                    energia_compensada: totalCompensada,
                    faturamento_mensal: 0,
                    custo_disponibilidade: 0
                });
            }
        } catch (err) {
            console.error('Error fetching monthly details:', err);
        } finally {
            setLoadingMonthly(false);
        }
    };

    const handleFechamento = async () => {
        if (!monthlyDetails) return;

        setLoading(true);
        try {
            const firstDay = `${referenceMonth}-01`;
            const transactionId = crypto.randomUUID();
            
            // 1. Calculate the final values
            const maintenance = monthlyDetails.manutencao || 0;
            const rent = monthlyDetails.arrendamento || 0;
            const gestaoFixo = monthlyDetails.gestao_reais || 0;
            // Gestão Percentual calculation: (Faturamento - Concessionária) * %
            const faturamento = monthlyDetails.faturamento_mensal || 0;
            const concessionaria = monthlyDetails.details?.['Energia'] || monthlyDetails.custo_disponibilidade || 0;
            const gestaoVar = Math.max(0, (faturamento - concessionaria) * (Number(formData.gestao_percentual) / 100));
            const gestaoTotal = gestaoFixo + gestaoVar;
            const otherServices = monthlyDetails.servicos || 0;

            const totalDespesas = maintenance + rent + gestaoTotal + otherServices;

            // 2. Upsert generation_production
            const { details, ...mainData } = monthlyDetails;
            const { error: prodError } = await supabase
                .from('generation_production')
                .upsert({
                    ...mainData,
                    service_details: details || {},
                    custo_disponibilidade: concessionaria, // Ensure energy cost is mapped
                    gestao_reais: gestaoTotal,
                    total_despesas: totalDespesas,
                    fechamento: new Date().toISOString().split('T')[0],
                    status: 'liquidado'
                });

            if (prodError) throw prodError;

            // 3. Create Ledger Entries
            const entries = [];
            const supplierId = formData.supplier_id; // Reference for account 2.1.1
            
            // Helper to add entry pair (Debit Investor, Credit Revenue/Liability)
            const addPosting = (accountCode, amount, desc) => {
                if (amount <= 0) return;
                // Debit Investor (Positive) - Liability to Power Plant
                entries.push({
                    transaction_id: transactionId,
                    account_code: '2.1.1', // Obrigações Usinas
                    amount: amount,
                    description: `${desc} - ${referenceMonth}`,
                    reference_type: 'usina_month',
                    reference_id: supplierId,
                    is_sandbox: false
                });
                // Credit Revenue or Other Liability (Negative)
                entries.push({
                    transaction_id: transactionId,
                    account_code: accountCode,
                    amount: -amount,
                    description: `${desc} - ${referenceMonth}`,
                    reference_type: 'usina_month',
                    reference_id: supplierId,
                    is_sandbox: false
                });
            };

            // Gestão Fixa as "Despesa Extra" (2.1.4)
            if (gestaoFixo > 0) addPosting('2.1.4', gestaoFixo, 'Taxa Fixa Gestão B2W');
            // Gestão Variável as primary Management Fee (3.1.1)
            if (gestaoVar > 0) addPosting('3.1.1', gestaoVar, 'Taxa Variável Gestão B2W');
            
            if (maintenance > 0) addPosting('3.1.3', maintenance, 'Receita Manutenção Usina');
            if (rent > 0) addPosting('3.1.4', rent, 'Receita Arrendamento Usina');
            
            // Separate Ledger entries for detailed services
            if (details) {
                Object.entries(details).forEach(([name, val]) => {
                    if (val > 0) {
                        addPosting('2.1.4', val, `Serviço ${name}`);
                    }
                });
            }

            if (entries.length > 0) {
                const { data: accountsData } = await supabase.from('ledger_accounts').select('id, code');
                const accountMap = accountsData?.reduce((acc, curr) => ({ ...acc, [curr.code]: curr.id }), {}) || {};

                const finalEntries = entries.map(entry => {
                    const mappedId = accountMap[entry.account_code];
                    // Fallback logic for accounts that might not exist yet
                    let finalId = mappedId;
                    if (!finalId) {
                        if (entry.account_code.startsWith('3.')) finalId = accountMap['3.1.0'] || accountMap['3.0.0'];
                        if (entry.account_code.startsWith('2.1')) finalId = accountMap['2.1.0'] || accountMap['2.0.0'];
                    }
                    delete entry.account_code;
                    return { ...entry, account_id: finalId || entry.account_id };
                }).filter(e => e.account_id);

                if (finalEntries.length > 0) {
                    const { error: ledgerError } = await supabase.from('ledger_entries').insert(finalEntries);
                    if (ledgerError) throw ledgerError;
                }
            }

            showAlert('Fechamento realizado com sucesso!', 'success');
            fetchMonthlyDetails();
        } catch (err) {
            console.error('Error in fechamento:', err);
            showAlert('Erro ao realizar fechamento: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const fetchAvailableUCs = async () => {
        if (!usina?.id && !usina) {
            // New plant case: only show available ones
            const { data } = await supabase.from('consumer_units').select('*').is('usina_id', null);
            setAvailableUCs(data || []);
            return;
        }

        if (usina?.id) {
            setLoadingUCs(true);
            try {
                // Fetch linked and available in parallel for speed and reliability
                const [linkedRes, availableRes] = await Promise.all([
                    supabase.from('consumer_units').select('*').eq('usina_id', usina.id),
                    supabase.from('consumer_units').select('*').is('usina_id', null)
                ]);

                const combined = [
                    ...(linkedRes.data || []),
                    ...(availableRes.data || [])
                ];

                // De-duplicate just in case, though logically they should be distinct
                const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
                setAvailableUCs(unique);
            } catch (err) {
                console.error('Error fetching UCs:', err);
            } finally {
                setLoadingUCs(false);
            }
        }
    };

    const fetchSuppliers = async () => {
        const { data } = await supabase.from('suppliers').select('id, name').order('name');
        setSuppliers(data || []);
    };

    const fetchSubscribers = async () => {
        const { data } = await supabase.from('subscribers').select('id, name, cpf_cnpj');
        setSubscribers(data || []);
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

    const parseCurrency = (val) => {
        if (val === undefined || val === null) return 0;
        if (typeof val === 'number') return val;
        const clean = val.replace(/[^\d,]/g, '').replace(',', '.');
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

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (active.id !== over.id) {
            setSelectedUCs((items) => {
                const oldIndex = items.findIndex(i => i.id === active.id);
                const newIndex = items.findIndex(i => i.id === over.id);

                // If the item at index 0 is the Unidade Geradora, prevent others from moving to 0
                // and prevent it from moving elsewhere
                const isGeradoraAt0 = items[0]?.numero_uc === formData.unidade_geradora;
                if (isGeradoraAt0 && (oldIndex === 0 || newIndex === 0)) {
                    return items;
                }

                const newItems = [...items];
                const [movedItem] = newItems.splice(oldIndex, 1);
                newItems.splice(newIndex, 0, movedItem);

                return newItems;
            });
        }
    };

    const handleGenerateList = () => {
        if (selectedUCs.length === 0) {
            showAlert('Não há UCs vinculadas para gerar a lista.', 'warning');
            return;
        }

        // 1. Order: Unidade Geradora first, then the rest in their UI order
        // In the UI, Generator is already forced at index 0, so we just use selectedUCs directly.
        // We do a stable filter just to be absolutely sure the generator is at the top.
        const geradora = selectedUCs.find(u => u.tipo_unidade === 'geradora');
        const beneficiarias = selectedUCs.filter(u => u.tipo_unidade !== 'geradora');
        const sortedUCs = geradora ? [geradora, ...beneficiarias] : beneficiarias;

        const isPorcentagem = formData.rateio_type === 'porcentagem';
        let processedUCs = [];

        if (isPorcentagem) {
            let currentTotalPrc = 0;
            let saldoRemanescenteIndex = -1;
            const totalCapacity = Number(formData.geracao_estimada_kwh) || 1;

            // First pass: identify Saldo Remanescente target
            sortedUCs.forEach((uc, idx) => {
                if (uc.saldo_remanescente) {
                    saldoRemanescenteIndex = idx;
                }
            });

            // Fallback: If no beneficial UC is marked, use Geradora
            if (saldoRemanescenteIndex === -1) {
                const geradoraIdx = sortedUCs.findIndex(uc => uc.tipo_unidade === 'geradora');
                saldoRemanescenteIndex = geradoraIdx !== -1 ? geradoraIdx : 0;
            }

            // Second pass: Calculate percentages and Filter by 100% limit
            for (let i = 0; i < sortedUCs.length; i++) {
                const uc = { ...sortedUCs[i] };
                const kWhVal = Number(uc.franquia) || 0;
                const prcVal = (kWhVal / totalCapacity) * 100;

                if (currentTotalPrc + prcVal <= 100) {
                    currentTotalPrc += prcVal;
                    uc.calculatedPercentage = prcVal;
                    processedUCs.push(uc);
                } else if (currentTotalPrc < 100) {
                    // Truncate the last one to fit exactly 100%
                    uc.calculatedPercentage = 100 - currentTotalPrc;
                    currentTotalPrc = 100;
                    processedUCs.push(uc);
                    break;
                } else {
                    // Already at or exceeded 100%
                    break;
                }
            }

            // Third pass: If total < 100%, add difference to Saldo Remanescente UC
            if (currentTotalPrc < 100 && processedUCs.length > 0) {
                const targetId = sortedUCs[saldoRemanescenteIndex]?.id;
                const targetInProcessed = processedUCs.findIndex(u => u.id === targetId);

                if (targetInProcessed !== -1) {
                    processedUCs[targetInProcessed].calculatedPercentage = (processedUCs[targetInProcessed].calculatedPercentage || 0) + (100 - currentTotalPrc);
                } else {
                    processedUCs[0].calculatedPercentage = (processedUCs[0].calculatedPercentage || 0) + (100 - currentTotalPrc);
                }
            }
        } else {
            processedUCs = sortedUCs.map((uc, idx) => ({ ...uc, prioridade: idx + 1 }));
        }

        // CSV Generation
        const csvHeaders = ['tipoCompensacao', 'cpf/cnpj', 'Conta contrato', 'Prioridade', 'Porcentagem', 'Saldo Remanescente'];
        const csvRows = processedUCs.map(uc => {
            const sub = subscribers.find(s => s.id === uc.subscriber_id);
            const cpfCnpj = uc.cpf_cnpj_fatura || sub?.cpf_cnpj || '';
            const tipoComp = uc.tipo_unidade === 'geradora' ? 'Unidade Geradora' : 'Unidade consumidora';

            return [
                tipoComp,
                cpfCnpj,
                uc.numero_uc,
                !isPorcentagem ? uc.prioridade : '',
                isPorcentagem ? Number(uc.calculatedPercentage || 0).toFixed(2) : '',
                uc.saldo_remanescente ? 'x' : ''
            ].join(';');
        });

        const csvContent = [csvHeaders.join(';'), ...csvRows].join('\n');
        const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const csvUrl = URL.createObjectURL(csvBlob);
        const csvLink = document.createElement('a');
        csvLink.href = csvUrl;
        csvLink.download = `lista_ucs_${formData.name || 'usina'}.csv`;
        csvLink.click();

        // PDF Generation (Anexo IV)
        const doc = jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(56, 128, 56);
        const titleLines = [
            'ANEXO IV - LISTA DAS UNIDADES',
            'CONSUMIDORAS PARTICIPANTES DO SISTEMA',
            'DE COMPENSAÇÃO E INDICAÇÃO DO',
            'PERCENTUAL DE RATEIO DOS CRÉDITOS'
        ];
        let currentY = 20;
        titleLines.forEach(line => {
            doc.text(line, pageWidth / 2, currentY, { align: 'center' });
            currentY += 6;
        });

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        currentY += 10;
        const introText = "Declarar o percentual da energia excedente que será destinada a unidade principal (geradora) e a cada unidade consumidora participante do sistema de compensação de energia elétrica.";
        const splitText = doc.splitTextToSize(introText, pageWidth - 40);
        doc.text(splitText, 20, currentY);
        currentY += splitText.length * 5 + 10;

        const tableData = processedUCs.map(uc => {
            const sub = subscribers.find(s => s.id === uc.subscriber_id);
            return [
                uc.numero_uc,
                uc.cpf_cnpj_fatura || sub?.cpf_cnpj || '',
                uc.tipo_unidade === 'geradora' ? 'Principal(Gerador)' : 'Compensação',
                isPorcentagem ? `${Number(uc.calculatedPercentage || 0).toFixed(2)}%` : uc.prioridade
            ];
        });

        autoTable(doc, {
            startY: currentY,
            head: [['Conta Contato', 'CPF/CNPJ', 'Unidade Consumidora', isPorcentagem ? 'Percentual' : 'Prioridade']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: [100, 160, 60], textColor: [255, 255, 255], halign: 'center' },
            bodyStyles: { halign: 'center', fontSize: 9 },
            columnStyles: {
                2: { halign: 'left' }
            }
        });

        currentY = Math.max(doc.lastAutoTable.finalY + 30, 250);
        const today = new Date().toLocaleDateString('pt-BR');

        doc.line(20, currentY, 70, currentY);
        doc.text('Local: Natal RN', 20, currentY + 5);

        doc.line(pageWidth / 2 - 25, currentY, pageWidth / 2 + 25, currentY);
        doc.text(`Data: ${today}`, pageWidth / 2, currentY + 5, { align: 'center' });

        doc.line(pageWidth - 70, currentY, pageWidth - 20, currentY);
        doc.text('Assinatura', pageWidth - 45, currentY + 5, { align: 'center' });

        doc.save(`anexo_iv_${formData.name || 'usina'}.pdf`);
        showAlert('Arquivo CSV e PDF gerados com sucesso!', 'success');
    };

    const renderUCList = () => {
        const listToRender = ucFilter === 'linked'
            ? selectedUCs
            : availableUCs.filter(uc => !selectedUCs.some(s => s.id === uc.id));

        if (listToRender.length === 0) {
            return (
                <p style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', padding: '1rem' }}>
                    Nenhuma UC {ucFilter === 'linked' ? 'vinculada' : 'disponível'}.
                </p>
            );
        }

        if (ucFilter === 'linked') {
            return (
                <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
                    <SortableContext items={listToRender.map(i => i.id)} strategy={verticalListSortingStrategy}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {listToRender.map((uc, index) => (
                                <SortableUCItem
                                    key={uc.id}
                                    uc={uc}
                                    index={index}
                                    isSelected={true}
                                    geracaoEstimada={formData.geracao_estimada_kwh}
                                    subscribers={subscribers}
                                    isFixed={index === 0 && uc.numero_uc === formData.unidade_geradora}
                                    onPreview={() => {
                                        setPreviewUC(uc);
                                        setShowPreviewModal(true);
                                    }}
                                    onToggle={async (checked) => {
                                        if (index === 0 && uc.numero_uc === formData.unidade_geradora) {
                                            showAlert('A Unidade Geradora principal não pode ser removida por aqui. Altere na seção Identificação.', 'warning');
                                            return;
                                        }
                                        if (!checked) {
                                            const confirm = await showConfirm(
                                                'Remover Vínculo?',
                                                `Deseja realmente remover a UC ${uc.numero_uc} desta usina?`
                                            );
                                            if (confirm) {
                                                setSelectedUCs(selectedUCs.filter(u => u.id !== uc.id));
                                            }
                                        }
                                    }}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            );
        }

        return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.8rem' }}>
                {listToRender.map(uc => {
                    const isSelected = selectedUCs.some(u => u.id === uc.id);
                    return (
                        <div key={uc.id} style={{
                            display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.85rem',
                            padding: '0.8rem', border: isSelected ? '1px solid #8b5cf6' : '1px solid #ddd',
                            borderRadius: '6px', background: isSelected ? 'white' : 'rgba(255,255,255,0.6)',
                            transition: '0.2s', boxShadow: isSelected ? '0 2px 4px rgba(139, 92, 246, 0.1)' : 'none'
                        }}>
                            <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={async (e) => {
                                    const checked = e.target.checked;
                                    const action = checked ? 'vincular' : 'remover o vínculo da';
                                    const confirm = await showConfirm(
                                        `${checked ? 'Vincular' : 'Remover'} UC?`,
                                        `Deseja realmente ${action} UC ${uc.numero_uc}?`
                                    );
                                    if (confirm) {
                                        if (checked) setSelectedUCs([...selectedUCs, uc]);
                                        else setSelectedUCs(selectedUCs.filter(u => u.id !== uc.id));
                                    }
                                }}
                                style={{ transform: 'scale(1.1)', accentColor: '#7c3aed', cursor: 'pointer' }}
                            />
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <div style={{ fontWeight: 'bold', color: '#1e293b' }}>{uc.numero_uc}</div>
                                    <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: uc.tipo_unidade === 'geradora' ? '#fef3c7' : '#e0f2fe', color: uc.tipo_unidade === 'geradora' ? '#92400e' : '#075985', fontWeight: 600, textTransform: 'capitalize' }}>
                                        {uc.tipo_unidade || 'Beneficiária'}
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                    {uc.titular_conta}
                                </div>
                                {(() => {
                                    const sub = subscribers.find(s => s.id === uc.titular_fatura_id);
                                    return (
                                        <>
                                            {sub && (
                                                <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600, marginTop: '0.2rem' }}>
                                                    Titular: {sub.name}
                                                </div>
                                            )}
                                            <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                                                CPF/CNPJ: {uc.cpf_cnpj_fatura || sub?.cpf_cnpj || 'Não inf.'}
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                <div>
                                    <span style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8' }}>{uc.concessionaria}</span>
                                    <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 'bold' }}>
                                        {uc.franquia ? `${Math.round(uc.franquia)} kWh` : '0 kWh'}
                                    </div>
                                    {isSelected && formData.geracao_estimada_kwh > 0 && (
                                        <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 'bold' }}>
                                            {((uc.franquia / formData.geracao_estimada_kwh) * 100).toFixed(2)}%
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPreviewUC(uc);
                                        setShowPreviewModal(true);
                                    }}
                                    style={{ background: '#f1f5f9', border: 'none', borderRadius: '4px', padding: '0.4rem', color: '#64748b', cursor: 'pointer' }}
                                >
                                    <Eye size={16} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

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
                unidade_geradora: formData.unidade_geradora,
                cnpj_cpf: formData.cnpj_cpf,
                rateio_type: formData.rateio_type,
                portal_credentials: formData.portal_credentials,
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
                // Clear all links first (or handle intelligently)
                await supabase.from('consumer_units').update({ usina_id: null, prioridade: null }).eq('usina_id', usinaId);

                if (selectedUCs.length > 0) {
                    // Update each UC with usina_id and priority
                    const updatePromises = selectedUCs.map((uc, index) =>
                        supabase.from('consumer_units')
                            .update({
                                usina_id: usinaId,
                                prioridade: index + 1
                            })
                            .eq('id', uc.id)
                    );
                    await Promise.all(updatePromises);
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
        <div className="power-plant-modal" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
            backdropFilter: 'blur(4px)'
        }}>
            <style>{modalStyles}</style>
            <div className="custom-scrollbar" style={{
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
                            {usina ? (usina.name || formData.name) : 'Nova Usina'}
                        </h3>
                        <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.2rem' }}>Configure os dados técnicos e comerciais da usina</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '0.5rem' }}>
                        <X size={24} />
                    </button>
                </div>

                {/* Tab Navigation */}
                <div style={{ 
                    display: 'flex', 
                    overflowX: 'auto', 
                    background: 'white', 
                    borderBottom: '1px solid #e2e8f0',
                    padding: '0 0.5rem',
                    gap: '0.5rem',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none'
                }}>
                    {[
                        { id: 'geral', label: 'Geral', icon: LayoutDashboard },
                        { id: 'endereco', label: 'Localização', icon: MapPin },
                        { id: 'tecnico', label: 'Técnico', icon: Activity },
                        { id: 'financeiro', label: 'Financeiro', icon: Wallet2 },
                        { id: 'ucs', label: 'UCs & Rateio', icon: Link },
                        { id: 'portal', label: 'Portal', icon: Globe }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.6rem',
                                padding: '1rem 1.25rem',
                                border: 'none',
                                borderBottom: activeTab === tab.id ? '3px solid #3b82f6' : '3px solid transparent',
                                background: 'none',
                                color: activeTab === tab.id ? '#1d4ed8' : '#64748b',
                                fontWeight: activeTab === tab.id ? 700 : 500,
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            <tab.icon size={18} style={{ opacity: activeTab === tab.id ? 1 : 0.7 }} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '2rem', minHeight: '500px' }}>

                    {/* Floating Summary Card (Técnico e Financeiro) */}
                    {['tecnico', 'financeiro'].includes(activeTab) && (
                        <div style={{ 
                            background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', 
                            padding: '1.25rem', 
                            borderRadius: '16px', 
                            marginBottom: '2rem', 
                            border: '1px solid #bbf7d0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                            animation: 'slideDown 0.3s ease-out'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{ padding: '0.6rem', background: 'white', borderRadius: '10px', color: '#166534', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                    <Zap size={20} />
                                </div>
                                <div>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Geração Média Mensal</span>
                                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#14532d' }}>
                                        {formData.geracao_estimada_kwh ? `${Number(formData.geracao_estimada_kwh).toLocaleString()} kWh/mês` : 'Calcule na aba Técnico'}
                                    </div>
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Potência Instalada</span>
                                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#14532d' }}>{potenciaKwp} kWp</div>
                            </div>
                        </div>
                    )}

                    {/* Tab Content: Geral */}
                    {activeTab === 'geral' && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Nome da Usina</label>
                                    <input
                                        required
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', outline: 'none' }}
                                        placeholder="Ex: Usina Solar Norte 01"
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Fornecedor / Proprietário</label>
                                    <select
                                        required
                                        value={formData.supplier_id}
                                        onChange={e => setFormData({ ...formData, supplier_id: e.target.value })}
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', background: 'white', outline: 'none' }}
                                    >
                                        <option value="">Selecione...</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>CNPJ / CPF da Usina</label>
                                    <input
                                        value={formData.cnpj_cpf}
                                        onChange={e => setFormData({ ...formData, cnpj_cpf: e.target.value })}
                                        placeholder="00.000.000/0000-00"
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', outline: 'none' }}
                                    />
                                </div>

                                <div style={{ gridColumn: '1 / -1' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                        <label style={{ fontSize: '1rem', color: '#1e293b', fontWeight: 700 }}>Unidade Geradora Principal</label>
                                        {formData.unidade_geradora && (
                                            <span style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#92400e', padding: '0.2rem 0.6rem', borderRadius: '12px', fontWeight: 600 }}>
                                                Selecionada: {formData.unidade_geradora}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1rem', maxHeight: '350px', overflowY: 'auto', padding: '1rem', border: '1px solid #f1f5f9', borderRadius: '12px', background: '#f8fafc' }}>
                                        {(() => {
                                            const allUCs = [...availableUCs, ...selectedUCs];
                                            const uniqueUCs = Array.from(new Map(allUCs.map(uc => [uc.id, uc])).values());
                                            const geradoras = uniqueUCs.filter(uc => uc.tipo_unidade === 'geradora');
                                            if (geradoras.length === 0) return (
                                                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem' }}>
                                                    <AlertCircle size={32} color="#94a3b8" style={{ marginBottom: '0.5rem' }} />
                                                    <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Nenhuma UC do tipo "Geradora" encontrada.</p>
                                                </div>
                                            );

                                            return geradoras.map(uc => {
                                                const isSelected = formData.unidade_geradora === uc.numero_uc;
                                                const subscriber = subscribers.find(s => s.id === uc.titular_fatura_id);

                                                return (
                                                    <div
                                                        key={uc.id}
                                                        onClick={() => {
                                                            if (isSelected) {
                                                                setFormData({ ...formData, unidade_geradora: '', cnpj_cpf: '' });
                                                            } else {
                                                                setFormData({ ...formData, unidade_geradora: uc.numero_uc, cnpj_cpf: uc.cpf_cnpj_fatura || subscriber?.cpf_cnpj || '' });
                                                                setSelectedUCs(prev => [uc, ...prev.filter(u => u.id !== uc.id)]);
                                                            }
                                                        }}
                                                        style={{
                                                            padding: '1.25rem',
                                                            background: 'white',
                                                            border: isSelected ? '2.5px solid #3b82f6' : '1px solid #e2e8f0',
                                                            borderRadius: '12px',
                                                            cursor: 'pointer',
                                                            position: 'relative',
                                                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                            boxShadow: isSelected ? '0 10px 15px -3px rgba(59, 130, 246, 0.1)' : '0 1px 2px rgba(0,0,0,0.05)',
                                                            transform: isSelected ? 'scale(1.02)' : 'none'
                                                        }}
                                                    >
                                                        <div style={{ position: 'absolute', top: '1rem', right: '1rem' }}>
                                                            <div style={{
                                                                width: '20px', height: '20px', borderRadius: '50%',
                                                                border: isSelected ? '6px solid #3b82f6' : '2px solid #cbd5e1',
                                                                background: 'white', transition: '0.2s'
                                                            }} />
                                                        </div>
                                                        <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.1rem' }}>{uc.numero_uc}</div>
                                                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>{uc.titular_conta}</div>
                                                        {subscriber && <div style={{ fontSize: '0.85rem', color: '#3b82f6', fontWeight: 600, marginTop: '0.5rem' }}>{subscriber.name}</div>}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem' }}>
                                                            <span style={{ fontSize: '0.7rem', color: '#94a3b8', background: '#f8fafc', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>{uc.concessionaria}</span>
                                                            <span style={{ fontSize: '0.9rem', color: '#059669', fontWeight: 700 }}>{uc.franquia} kWh</span>
                                                        </div>
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab Content: Endereço */}
                    {activeTab === 'endereco' && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', gridColumn: '1 / -1', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #eff6ff' }}>
                                    <div style={{ padding: '0.75rem', background: 'white', borderRadius: '10px', color: '#3b82f6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                        <MapPin size={24} />
                                    </div>
                                    <div>
                                        <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Localização Geográfica</h4>
                                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Defina onde a usina está fisicamente instalada</p>
                                    </div>
                                </div>

                                <div style={{ maxWidth: '300px' }}>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>CEP</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            value={formData.cep}
                                            onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                            onBlur={handleCepBlur}
                                            placeholder="00000-000"
                                            style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', background: searchingCep ? '#f0f9ff' : 'white', outline: 'none' }}
                                        />
                                        {searchingCep && <div style={{ position: 'absolute', right: '1rem', top: '1rem' }} className="animate-spin text-blue-500">🌀</div>}
                                    </div>
                                </div>

                                <div style={{ gridColumn: 'span 1' }}>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Concessionária</label>
                                    <input
                                        value={formData.concessionaria}
                                        onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                                        placeholder="Ex: Cemig, Enel"
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', outline: 'none' }}
                                    />
                                </div>

                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Endereço Completo</label>
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                                        <input
                                            value={formData.rua || ''}
                                            onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                            placeholder="Rua / Logradouro"
                                            style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', outline: 'none' }}
                                        />
                                        <input
                                            value={formData.numero || ''}
                                            onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                            placeholder="Nº"
                                            style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', outline: 'none' }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Bairro</label>
                                    <input
                                        value={formData.bairro || ''}
                                        onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                        placeholder="Bairro"
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', outline: 'none' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Cidade / UF</label>
                                    <input
                                        value={formData.cidade && formData.uf ? `${formData.cidade} / ${formData.uf}` : ''}
                                        disabled
                                        placeholder="Preenchimento automático"
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #f1f5f9', borderRadius: '10px', fontSize: '1rem', color: '#64748b' }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab Content: Técnico */}
                    {activeTab === 'tecnico' && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Status Operacional</label>
                                    <select
                                        value={formData.status}
                                        onChange={e => setFormData({ ...formData, status: e.target.value })}
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', background: 'white', outline: 'none' }}
                                    >
                                        {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Modalidade</label>
                                    <select
                                        value={formData.modalidade}
                                        onChange={e => setFormData({ ...formData, modalidade: e.target.value })}
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', background: 'white', outline: 'none' }}
                                    >
                                        {modalidadeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>

                                <div style={{ height: '1px', background: '#f1f5f9', margin: '0.5rem 0', gridColumn: '1 / -1' }}></div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Qtd. Módulos</label>
                                    <input
                                        type="number"
                                        value={formData.qtd_modulos}
                                        onChange={e => setFormData({ ...formData, qtd_modulos: e.target.value })}
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', outline: 'none' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Potência Módulo (W)</label>
                                    <select
                                        value={formData.potencia_modulos_w}
                                        onChange={e => setFormData({ ...formData, potencia_modulos_w: e.target.value })}
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', background: 'white', outline: 'none' }}
                                    >
                                        <option value="">Selecione...</option>
                                        {modulePowerOptions.map(v => <option key={v} value={v}>{v} W</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Fabricante Inversor</label>
                                    <select
                                        value={formData.fabricante_inversor}
                                        onChange={e => setFormData({ ...formData, fabricante_inversor: e.target.value })}
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', background: 'white', outline: 'none' }}
                                    >
                                        <option value="">Selecione...</option>
                                        {inverterBrands.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Potência Inversor (W)</label>
                                    <select
                                        value={formData.potencia_inversor_w}
                                        onChange={e => setFormData({ ...formData, potencia_inversor_w: e.target.value })}
                                        style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', background: 'white', outline: 'none' }}
                                    >
                                        <option value="">Selecione...</option>
                                        {inverterPowerOptions.map(v => <option key={v} value={v}>{v} W</option>)}
                                    </select>
                                </div>

                                <div style={{ gridColumn: '1 / -1', marginTop: '1.5rem', border: '1px solid #f1f5f9', borderRadius: '16px', padding: '1.5rem', background: '#fff' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#166534', fontWeight: 700, marginBottom: '1rem' }}>
                                        <div style={{ padding: '0.5rem', background: '#f0fdf4', borderRadius: '8px' }}>
                                            <BarChart size={20} />
                                        </div>
                                        <span>Estimativa de Geração Acumulada</span>
                                    </div>
                                    <IrradianceChart
                                        ibgeCode={formData.ibge_code}
                                        potenciaKwp={potenciaKwp}
                                        onCalculate={handleChartCalculation}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab Content: Financeiro */}
                    {activeTab === 'financeiro' && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Valor Investido</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            value={formData.valor_investido}
                                            onChange={handleValorInvestidoChange}
                                            placeholder="R$ 0,00"
                                            style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', outline: 'none', fontWeight: 700, color: '#1e293b' }}
                                        />
                                    </div>
                                </div>

                            </div>

                            {/* Exclusive Gestão Block */}
                            <div style={{ 
                                marginTop: '1.5rem',
                                background: '#f0fdf4', 
                                padding: '1.5rem', 
                                borderRadius: '16px', 
                                border: '1px solid #bbf7d0',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '1rem',
                                animation: 'slideDown 0.3s ease-out'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{ padding: '0.5rem', background: 'white', borderRadius: '10px', color: '#16a34a', boxShadow: '0 2px 4px rgba(22,163,74,0.1)' }}>
                                            <Settings size={20} />
                                        </div>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#166534', fontWeight: 700 }}>Gestão e Operação B2W</h4>
                                            <p style={{ margin: 0, fontSize: '0.8rem', color: '#16a34a' }}>Defina a remuneração pela gestão da usina</p>
                                        </div>
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', background: 'white', padding: '0.4rem 0.8rem', borderRadius: '20px', border: '1px solid #bbf7d0' }}>
                                        <input
                                            type="checkbox"
                                            checked={formData.servicos_contratados.includes('Gestão')}
                                            onChange={() => handleServiceChange('Gestão')}
                                            style={{ width: '1.1rem', height: '1.1rem', accentColor: '#16a34a' }}
                                        />
                                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#166534' }}>Habilitar Gestão</span>
                                    </label>
                                </div>

                                {formData.servicos_contratados.includes('Gestão') && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', animation: 'fadeIn 0.2s' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Taxa Percentual (%)</label>
                                            <div style={{ position: 'relative', background: 'white', borderRadius: '10px', border: '1px solid #bbf7d0', padding: '0.6rem 1rem', display: 'flex', alignItems: 'center' }}>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={formData.gestao_percentual || ''}
                                                    onChange={e => setFormData({ ...formData, gestao_percentual: e.target.value })}
                                                    placeholder="0.00"
                                                    style={{ width: '100%', border: 'none', fontSize: '1.1rem', fontWeight: 700, color: '#166534', outline: 'none' }}
                                                />
                                                <span style={{ fontWeight: 800, color: '#16a34a', fontSize: '1.1rem' }}>%</span>
                                            </div>
                                            <p style={{ margin: '0.4rem 0 0', fontSize: '0.7rem', color: '#16a34a' }}>*Calculado sobre o valor liquido pago pelo assinante.</p>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Taxa Fixa Extra (R$)</label>
                                            <div style={{ position: 'relative', background: 'white', borderRadius: '10px', border: '1px solid #bbf7d0', padding: '0.6rem 1rem', display: 'flex', alignItems: 'center' }}>
                                                <span style={{ fontWeight: 600, color: '#16a34a', marginRight: '0.4rem' }}>R$</span>
                                                <input
                                                    value={formatCurrency(formData.service_values?.['Gestão']).replace('R$', '').trim()}
                                                    onChange={(e) => handleServiceValueChange('Gestão', e.target.value)}
                                                    placeholder="0,00"
                                                    style={{ width: '100%', border: 'none', fontSize: '1.1rem', fontWeight: 700, color: '#166534', outline: 'none' }}
                                                />
                                            </div>
                                            <p style={{ margin: '0.4rem 0 0', fontSize: '0.7rem', color: '#16a34a' }}>*Adicionado ao valor percentual no fechamento</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div style={{ marginTop: '1.5rem' }}>
                                {/* Sub-tabs for Financeiro */}
                                <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid #e2e8f0', marginBottom: '1.5rem', paddingBottom: '0.5rem' }}>
                                    <button 
                                        type="button" 
                                        onClick={() => setActiveFinanceTab('lancamentos')}
                                        style={{
                                            padding: '0.5rem 1rem', border: 'none', borderRadius: '8px', cursor: 'pointer',
                                            background: activeFinanceTab === 'lancamentos' ? '#eff6ff' : 'transparent',
                                            color: activeFinanceTab === 'lancamentos' ? '#2563eb' : '#64748b',
                                            fontWeight: 600, fontSize: '0.9rem', transition: '0.2s'
                                        }}
                                    >
                                        Extrato de Lançamentos
                                    </button>
                                    <button 
                                        type="button" 
                                        onClick={() => setActiveFinanceTab('servicos')}
                                        style={{
                                            padding: '0.5rem 1rem', border: 'none', borderRadius: '8px', cursor: 'pointer',
                                            background: activeFinanceTab === 'servicos' ? '#eff6ff' : 'transparent',
                                            color: activeFinanceTab === 'servicos' ? '#2563eb' : '#64748b',
                                            fontWeight: 600, fontSize: '0.9rem', transition: '0.2s'
                                        }}
                                    >
                                        Serviços Contratados
                                    </button>
                                </div>

                                {activeFinanceTab === 'servicos' && (
                                    <div style={{ animation: 'fadeIn 0.2s' }}>
                                        <label style={{ display: 'block', fontSize: '1rem', marginBottom: '1rem', color: '#1e293b', fontWeight: 700 }}>Parâmetros Mensais</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
                                            {serviceOptions.filter(s => s !== 'Gestão').map(s => {
                                                const isSelected = formData.servicos_contratados.includes(s);
                                                return (
                                                    <div key={s} style={{
                                                        border: isSelected ? '2px solid #16a34a' : '1px solid #e2e8f0',
                                                        borderRadius: '12px',
                                                        padding: '1rem',
                                                        background: isSelected ? '#f0fdf4' : 'white',
                                                        transition: 'all 0.2s',
                                                        boxShadow: isSelected ? '0 4px 6px -1px rgba(22, 163, 74, 0.1)' : 'none'
                                                    }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: isSelected ? '0.75rem' : '0' }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => handleServiceChange(s)}
                                                                style={{ width: '1.2rem', height: '1.2rem', accentColor: '#16a34a' }}
                                                            />
                                                            <span style={{ fontSize: '0.95rem', fontWeight: isSelected ? 700 : 500, color: isSelected ? '#166534' : '#64748b' }}>{s}</span>
                                                        </label>

                                                        {isSelected && (
                                                            <div style={{ animation: 'fadeIn 0.2s' }}>
                                                                <div style={{ position: 'relative' }}>
                                                                    <span style={{ position: 'absolute', left: '0.75rem', top: '0.6rem', fontSize: '0.8rem', color: '#166534', fontWeight: 600 }}>R$</span>
                                                                    <input
                                                                        placeholder="0,00"
                                                                        value={formatCurrency(formData.service_values?.[s]).replace('R$', '').trim()}
                                                                        onChange={(e) => handleServiceValueChange(s, e.target.value)}
                                                                        style={{ width: '100%', padding: '0.5rem 0.5rem 0.5rem 2rem', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none', background: 'white' }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {activeFinanceTab === 'lancamentos' && (
                                    <div style={{ animation: 'fadeIn 0.2s' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', background: '#f8fafc', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <button 
                                                        type="button"
                                                        onClick={() => {
                                                            const [year, month] = referenceMonth.split('-').map(Number);
                                                            const date = new Date(year, month - 2, 1);
                                                            setReferenceMonth(date.toISOString().slice(0, 7));
                                                        }}
                                                        style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer', color: '#64748b', transition: '0.2s' }}
                                                    >
                                                        <ChevronUp style={{ transform: 'rotate(-90deg)' }} size={18} />
                                                    </button>
                                                    
                                                    <div style={{ textAlign: 'center', minWidth: '180px' }}>
                                                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Mês de Referência</label>
                                                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', textTransform: 'capitalize' }}>
                                                            {new Date(referenceMonth + '-02').toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
                                                        </div>
                                                    </div>

                                                    <button 
                                                        type="button"
                                                        onClick={() => {
                                                            const [year, month] = referenceMonth.split('-').map(Number);
                                                            const date = new Date(year, month, 1);
                                                            setReferenceMonth(date.toISOString().slice(0, 7));
                                                        }}
                                                        style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer', color: '#64748b', transition: '0.2s' }}
                                                    >
                                                        <ChevronUp style={{ transform: 'rotate(90deg)' }} size={18} />
                                                    </button>
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Total de Serviços do Mês</span>
                                                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#166534' }}>
                                                    {formatCurrency(
                                                        (monthlyDetails?.manutencao || 0) + 
                                                        (monthlyDetails?.arrendamento || 0) + 
                                                        (monthlyDetails?.gestao_reais || 0) + 
                                                        (monthlyDetails?.servicos || 0)
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 1.5fr) 1fr', gap: '1.5rem', alignItems: 'start' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                                {/* Production Data Section */}
                                                <div style={{ background: 'white', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                                    <h4 style={{ margin: '0 0 1.25rem 0', fontSize: '1rem', color: '#1e293b', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                        <div style={{ padding: '0.5rem', background: '#f0fdf4', borderRadius: '10px', color: '#16a34a' }}>
                                                            <Activity size={20} />
                                                        </div>
                                                        Dados de Operação e Performance
                                                    </h4>
                                                    
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>Geração Mensal (kWh)</label>
                                                            <input 
                                                                type="number"
                                                                value={monthlyDetails?.geracao_mensal_kwh || ''}
                                                                onChange={e => setMonthlyDetails({...monthlyDetails, geracao_mensal_kwh: Number(e.target.value)})}
                                                                placeholder="0"
                                                                style={{ width: '100%', padding: '0.6rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, color: '#1e293b', outline: 'none' }}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>Geração Prevista (kWh)</label>
                                                            <input 
                                                                type="number"
                                                                value={monthlyDetails?.geracao_prevista || ''}
                                                                onChange={e => setMonthlyDetails({...monthlyDetails, geracao_prevista: Number(e.target.value)})}
                                                                placeholder="0"
                                                                style={{ width: '100%', padding: '0.6rem 1rem', border: '1px solid #dcfce7', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, color: '#166534', background: '#f0fdf4', outline: 'none' }}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>Energia Injetada (kWh)</label>
                                                            <input 
                                                                type="number"
                                                                value={monthlyDetails?.energia_compensada || ''}
                                                                onChange={e => setMonthlyDetails({...monthlyDetails, energia_compensada: Number(e.target.value)})}
                                                                placeholder="0"
                                                                style={{ width: '100%', padding: '0.6rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, color: '#1e293b', outline: 'none' }}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>Faturamento Bruto (R$)</label>
                                                            <input 
                                                                type="text"
                                                                value={formatCurrency(monthlyDetails?.faturamento_mensal).replace('R$', '').trim()}
                                                                onChange={e => setMonthlyDetails({...monthlyDetails, faturamento_mensal: parseCurrency(e.target.value)})}
                                                                placeholder="0,00"
                                                                style={{ width: '100%', padding: '0.6rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, color: '#1e293b', outline: 'none' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Extract: Detailed and Editable */}
                                                <div style={{ background: 'white', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                                        <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                            <div style={{ padding: '0.5rem', background: '#eff6ff', borderRadius: '10px', color: '#3b82f6' }}>
                                                                <FileText size={20} />
                                                            </div>
                                                            Extrato Detalhado de Lançamentos
                                                        </h4>
                                                    </div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                        {/* Row: Gestão */}
                                                        {(monthlyDetails?.gestao_reais > 0) && (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6' }} />
                                                                    <span style={{ fontWeight: 700, color: '#475569', fontSize: '0.9rem' }}>Gestão B2W</span>
                                                                </div>
                                                                <div style={{ position: 'relative', width: '120px' }}>
                                                                    <span style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: '#64748b', fontWeight: 700 }}>R$</span>
                                                                    <input 
                                                                        type="text"
                                                                        value={formatCurrency(monthlyDetails?.gestao_reais).replace('R$', '').trim()}
                                                                        onChange={e => setMonthlyDetails({...monthlyDetails, gestao_reais: parseCurrency(e.target.value)})}
                                                                        style={{ width: '100%', padding: '0.4rem 0.5rem 0.4rem 2.2rem', border: 'none', background: 'white', borderRadius: '8px', textAlign: 'right', fontWeight: 800, color: '#1e293b', outline: 'none' }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Row: Manutenção */}
                                                        {(monthlyDetails?.manutencao > 0) && (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
                                                                    <span style={{ fontWeight: 700, color: '#475569', fontSize: '0.9rem' }}>Manutenção</span>
                                                                </div>
                                                                <div style={{ position: 'relative', width: '120px' }}>
                                                                    <span style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: '#64748b', fontWeight: 700 }}>R$</span>
                                                                    <input 
                                                                        type="text"
                                                                        value={formatCurrency(monthlyDetails?.manutencao).replace('R$', '').trim()}
                                                                        onChange={e => setMonthlyDetails({...monthlyDetails, manutencao: parseCurrency(e.target.value)})}
                                                                        style={{ width: '100%', padding: '0.4rem 0.5rem 0.4rem 2.2rem', border: 'none', background: 'white', borderRadius: '8px', textAlign: 'right', fontWeight: 800, color: '#1e293b', outline: 'none' }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Row: Arrendamento */}
                                                        {(monthlyDetails?.arrendamento > 0) && (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }} />
                                                                    <span style={{ fontWeight: 700, color: '#475569', fontSize: '0.9rem' }}>Arrendamento</span>
                                                                </div>
                                                                <div style={{ position: 'relative', width: '120px' }}>
                                                                    <span style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: '#64748b', fontWeight: 700 }}>R$</span>
                                                                    <input 
                                                                        type="text"
                                                                        value={formatCurrency(monthlyDetails?.arrendamento).replace('R$', '').trim()}
                                                                        onChange={e => setMonthlyDetails({...monthlyDetails, arrendamento: parseCurrency(e.target.value)})}
                                                                        style={{ width: '100%', padding: '0.4rem 0.5rem 0.4rem 2.2rem', border: 'none', background: 'white', borderRadius: '8px', textAlign: 'right', fontWeight: 800, color: '#1e293b', outline: 'none' }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Individualized Services from Details JSONB */}
                                                        {Object.keys(monthlyDetails?.details || {}).map((serv) => {
                                                            const val = monthlyDetails?.details?.[serv] || 0;
                                                            if (val <= 0) return null;
                                                            return (
                                                                <div key={serv} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#64748b' }} />
                                                                        <span style={{ fontWeight: 700, color: '#475569', fontSize: '0.9rem' }}>
                                                                            {serv === 'Energia' ? 'Energia - Custo de Disponibilidade' : serv}
                                                                        </span>
                                                                    </div>
                                                                    <div style={{ position: 'relative', width: '120px' }}>
                                                                        <span style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: '#64748b', fontWeight: 700 }}>R$</span>
                                                                        <input 
                                                                            type="text"
                                                                            value={formatCurrency(val).replace('R$', '').trim()}
                                                                            onChange={e => {
                                                                                const newVal = parseCurrency(e.target.value);
                                                                                const newDetails = { ...(monthlyDetails?.details || {}), [serv]: newVal };
                                                                                // Recalculate 'servicos' as the sum of all other services
                                                                                const totalOthers = Object.values(newDetails).reduce((acc, curr) => acc + curr, 0);
                                                                                setMonthlyDetails({
                                                                                    ...monthlyDetails, 
                                                                                    details: newDetails,
                                                                                    servicos: totalOthers
                                                                                });
                                                                            }}
                                                                            style={{ width: '100%', padding: '0.4rem 0.5rem 0.4rem 2.2rem', border: 'none', background: 'white', borderRadius: '8px', textAlign: 'right', fontWeight: 800, color: '#1e293b', outline: 'none' }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Status and Action Sidebar */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                <div style={{ padding: '1.5rem', background: monthlyDetails?.status === 'liquidado' ? '#f0fdf4' : '#fff7ed', borderRadius: '20px', border: `1px solid ${monthlyDetails?.status === 'liquidado' ? '#bbf7d0' : '#ffedd5'}`, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: monthlyDetails?.status === 'liquidado' ? '#166534' : '#9a3412', fontSize: '0.85rem', fontWeight: 800, marginBottom: '1rem', textTransform: 'uppercase' }}>
                                                        {monthlyDetails?.status === 'liquidado' ? <CheckCircle size={20} /> : <AlertCircle size={20} />} 
                                                        Status do Mês
                                                    </div>
                                                    <div style={{ fontSize: '1.25rem', fontWeight: 900, lineHeight: 1.2, color: monthlyDetails?.status === 'liquidado' ? '#166534' : '#9a3412' }}>
                                                        {monthlyDetails?.status === 'liquidado' ? 'MÊS FECHADO' : 'PENDENTE DE FECHAMENTO'}
                                                    </div>
                                                    {monthlyDetails?.fechamento && (
                                                        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#166534', fontWeight: 600 }}>
                                                            Encerrado em: {new Date(monthlyDetails.fechamento).toLocaleDateString('pt-BR')}
                                                        </div>
                                                    )}
                                                </div>

                                                <button 
                                                    type="button"
                                                    onClick={handleFechamento}
                                                    disabled={monthlyDetails?.status === 'liquidado'}
                                                    style={{ 
                                                        width: '100%',
                                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', padding: '1.5rem', 
                                                        background: monthlyDetails?.status === 'liquidado' ? '#94a3b8' : '#16a34a', 
                                                        color: 'white', borderRadius: '20px', border: 'none', 
                                                        cursor: monthlyDetails?.status === 'liquidado' ? 'not-allowed' : 'pointer', 
                                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                        boxShadow: monthlyDetails?.status === 'liquidado' ? 'none' : '0 10px 15px -3px rgba(22, 163, 74, 0.3)'
                                                    }}>
                                                    <CheckCircle size={32} />
                                                    <div style={{ textAlign: 'center' }}>
                                                        <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>
                                                            {monthlyDetails?.status === 'liquidado' ? 'Mês Liquidado' : 'Efetuar Fechamento'}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', opacity: 0.9, marginTop: '0.2rem' }}>
                                                            Gravar lançamentos no Razão
                                                        </div>
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Tab Content: UCs */}
                    {activeTab === 'ucs' && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div style={{ background: '#f5f3ff', padding: '1.5rem', borderRadius: '16px', border: '1px solid #ede9fe' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#5b21b6' }}>Controle de Vínculos e Rateio</h4>
                                            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#7c3aed' }}>
                                                Comprometido: <strong>{totalFranquiaVinculada.toFixed(0)} kWh</strong> 
                                                {formData.geracao_estimada_kwh > 0 && ` (${Math.round((totalFranquiaVinculada / formData.geracao_estimada_kwh) * 100)}% da geração)`}
                                            </p>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                                            <button
                                                type="button"
                                                onClick={() => setShowExpandedUCs(true)}
                                                style={{ padding: '0.6rem 1rem', background: 'white', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}
                                            >
                                                <Maximize2 size={18} /> Expandir Gestor
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleGenerateList}
                                                style={{ padding: '0.6rem 1.25rem', background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 600, boxShadow: '0 4px 6px -1px rgba(124, 58, 237, 0.2)' }}
                                            >
                                                <Download size={18} /> Anexo IV
                                            </button>
                                        </div>
                                    </div>

                                    {/* Sub-Filters embedded */}
                                    <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem', padding: '1rem', background: 'white', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                            <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Visualizar</label>
                                            <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '8px' }}>
                                                <button type="button" onClick={() => setUcFilter('linked')} style={{ padding: '0.3rem 0.8rem', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, background: ucFilter === 'linked' ? 'white' : 'transparent', color: ucFilter === 'linked' ? '#7c3aed' : '#64748b', cursor: 'pointer' }}>Vinculadas</button>
                                                <button type="button" onClick={() => setUcFilter('unlinked')} style={{ padding: '0.3rem 0.8rem', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, background: ucFilter === 'unlinked' ? 'white' : 'transparent', color: ucFilter === 'unlinked' ? '#7c3aed' : '#64748b', cursor: 'pointer' }}>Disponíveis</button>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                            <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Regra de Rateio</label>
                                            <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '8px' }}>
                                                <button type="button" onClick={() => setFormData({...formData, rateio_type: 'prioridade'})} style={{ padding: '0.3rem 0.8rem', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, background: formData.rateio_type === 'prioridade' ? 'white' : 'transparent', color: formData.rateio_type === 'prioridade' ? '#7c3aed' : '#64748b', cursor: 'pointer' }}>Prioridade</button>
                                                <button type="button" onClick={() => setFormData({...formData, rateio_type: 'porcentagem'})} style={{ padding: '0.3rem 0.8rem', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, background: formData.rateio_type === 'porcentagem' ? 'white' : 'transparent', color: formData.rateio_type === 'porcentagem' ? '#7c3aed' : '#64748b', cursor: 'pointer' }}>Porcentagem</button>
                                            </div>
                                        </div>
                                    </div>

                                    {loadingUCs ? (
                                        <div style={{ textAlign: 'center', padding: '2rem' }}>Carregando...</div>
                                    ) : (
                                        <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                                            {renderUCList()}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tab Content: Portal */}
                    {activeTab === 'portal' && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ maxWidth: '500px', margin: '0 auto', background: '#fff7ed', padding: '2rem', borderRadius: '20px', border: '1px solid #ffedd5' }}>
                                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                                    <div style={{ width: '60px', height: '60px', background: 'white', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem', color: '#f97316', boxShadow: '0 4px 6px -1px rgba(249, 115, 22, 0.1)' }}>
                                        <Globe size={32} />
                                    </div>
                                    <h4 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#9a3412', margin: 0 }}>Portal da Concessionária</h4>
                                    <p style={{ fontSize: '0.9rem', color: '#c2410c', marginTop: '0.5rem' }}>Credenciais para automação e extração de dados</p>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#9a3412', marginBottom: '0.5rem' }}>URL do Portal</label>
                                        <input
                                            type="url"
                                            value={formData.portal_credentials?.url || ''}
                                            onChange={e => setFormData({
                                                ...formData,
                                                portal_credentials: { ...formData.portal_credentials, url: e.target.value }
                                            })}
                                            placeholder="https://seuportal.com.br"
                                            style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #fed7aa', borderRadius: '10px', fontSize: '1rem', outline: 'none' }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#9a3412', marginBottom: '0.5rem' }}>Usuário / Login</label>
                                        <input
                                            type="text"
                                            value={formData.portal_credentials?.login || ''}
                                            onChange={e => setFormData({
                                                ...formData,
                                                portal_credentials: { ...formData.portal_credentials, login: e.target.value }
                                            })}
                                            placeholder="Seu usuário"
                                            style={{ width: '100%', padding: '0.8rem 1rem', border: '1px solid #fed7aa', borderRadius: '10px', fontSize: '1rem', outline: 'none' }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#9a3412', marginBottom: '0.5rem' }}>Senha</label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type={showPassword ? "text" : "password"}
                                                value={formData.portal_credentials?.password || ''}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    portal_credentials: { ...formData.portal_credentials, password: e.target.value }
                                                })}
                                                placeholder="••••••••"
                                                style={{ width: '100%', padding: '0.8rem 1rem', paddingRight: '3rem', border: '1px solid #fed7aa', borderRadius: '10px', fontSize: '1rem', outline: 'none' }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#9a3412', cursor: 'pointer', opacity: 0.6 }}
                                            >
                                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Footer Actions */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '3rem',
                        paddingTop: '2rem',
                        borderTop: '1px solid #e2e8f0'
                    }}>
                        <div>
                            {usina && onDelete && (
                                <button type="button" onClick={handleDelete} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.8rem 1.5rem', background: '#fff1f1', color: '#e11d48', borderRadius: '10px', border: '1px solid #ffe4e6', fontWeight: 700, cursor: 'pointer', transition: '0.2s' }}>
                                    <Trash2 size={18} /> Excluir Usina
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={onClose} style={{ padding: '0.8rem 2rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', color: '#64748b', fontWeight: 600 }}>
                                Cancelar
                            </button>
                            <button type="submit" disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.8rem 2.5rem', background: '#2563eb', color: 'white', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: 800, boxShadow: '0 4px 14px 0 rgba(37, 99, 235, 0.39)', transition: '0.2s' }}>
                                {loading ? 'Salvando...' : <><Save size={20} /> Salvar Usina</>}
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            {/* UC Detail Preview Modal */}
            {showPreviewModal && previewUC && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1200,
                    animation: 'fadeIn 0.2s ease-out'
                }}>
                    <div style={{
                        background: 'white', borderRadius: '16px', width: '95%', maxWidth: '600px',
                        padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                        position: 'relative', maxHeight: '90vh', overflowY: 'auto'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                <div style={{ padding: '0.6rem', background: '#f5f3ff', color: '#7c3aed', borderRadius: '10px' }}>
                                    <Zap size={24} />
                                </div>
                                <div>
                                    <h4 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Detalhes da UC</h4>
                                    <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
                                        Visualização básica - <strong>{subscribers.find(s => s.id === previewUC.subscriber_id)?.name || 'N/A'}</strong>
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setShowPreviewModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                                <X size={24} />
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Número da UC</label>
                                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>{previewUC.numero_uc}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Status</label>
                                <span style={{ fontSize: '0.85rem', padding: '0.2rem 0.6rem', borderRadius: '20px', background: '#f0fdf4', color: '#166534', fontWeight: 600 }}>
                                    {previewUC.status?.replace('_', ' ').toUpperCase()}
                                </span>
                            </div>
                            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Identificação da Fatura</label>
                                    <div style={{ fontSize: '1rem', color: '#1e293b' }}>{previewUC.titular_conta}</div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Vencimento</label>
                                    <div style={{ fontSize: '1rem', color: '#1e293b', fontWeight: 600 }}>Dia {previewUC.dia_vencimento || 'N/A'}</div>
                                </div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Titular da Fatura</label>
                                <div style={{ fontSize: '0.9rem', color: '#475569' }}>
                                    {subscribers.find(s => s.id === previewUC.titular_fatura_id)?.name || 'N/A'}
                                </div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>CPF/CNPJ do Titular</label>
                                <div style={{ fontSize: '0.9rem', color: '#475569' }}>{previewUC.cpf_cnpj_fatura || 'N/A'}</div>
                            </div>
                            <div style={{ height: '1px', background: '#f1f5f9', gridColumn: '1 / -1' }}></div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Tipo de Unidade</label>
                                <div style={{ fontSize: '0.9rem', color: '#475569', textTransform: 'capitalize' }}>{previewUC.tipo_unidade || 'Beneficiária'}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Concessionária</label>
                                <div style={{ fontSize: '0.9rem', color: '#475569' }}>{previewUC.concessionaria}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Franquia (kWh)</label>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#059669' }}>{previewUC.franquia} kWh</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Dia de Leitura</label>
                                <div style={{ fontSize: '0.9rem', color: '#475569' }}>{previewUC.dia_leitura || 'N/A'}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Saldo Remanescente</label>
                                <div style={{ fontSize: '1rem', fontWeight: 'bold', color: previewUC.saldo_remanescente ? '#dc2626' : '#475569' }}>
                                    {previewUC.saldo_remanescente ? 'Sim' : 'Não'}
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowPreviewModal(false)}
                                style={{ padding: '0.7rem 2rem', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Expanded UC List Modal */}
            {showExpandedUCs && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1200,
                    padding: '2rem'
                }}>
                    <div style={{
                        background: '#f8fafc', borderRadius: '16px', width: '95%', maxWidth: '1000px',
                        height: '90vh', display: 'flex', flexDirection: 'column',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        overflow: 'hidden', animation: 'fadeIn 0.2s ease-out'
                    }}>
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', background: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Gerenciamento de Unidades Consumidoras</h3>
                                <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>Ordene e gerencie as UCs vinculadas à usina</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowExpandedUCs(false)}
                                style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '0.5rem', color: '#64748b', cursor: 'pointer', transition: '0.2s' }}
                            >
                                <X size={24} />
                            </button>
                        </div>

                        <div style={{ padding: '1.5rem', background: '#fdfcfe', borderBottom: '1px solid #ede9fe', display: 'flex', gap: '2rem', alignItems: 'center' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Filtro de Exibição</label>
                                <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '8px' }}>
                                    <button
                                        type="button"
                                        onClick={() => setUcFilter('linked')}
                                        style={{
                                            padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600,
                                            background: ucFilter === 'linked' ? 'white' : 'transparent',
                                            color: ucFilter === 'linked' ? '#7c3aed' : '#64748b',
                                            boxShadow: ucFilter === 'linked' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                                            cursor: 'pointer'
                                        }}
                                    >Vinculadas</button>
                                    <button
                                        type="button"
                                        onClick={() => setUcFilter('unlinked')}
                                        style={{
                                            padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600,
                                            background: ucFilter === 'unlinked' ? 'white' : 'transparent',
                                            color: ucFilter === 'unlinked' ? '#7c3aed' : '#64748b',
                                            boxShadow: ucFilter === 'unlinked' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                                            cursor: 'pointer'
                                        }}
                                    >Não Vinculadas</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Tipo de Rateio</label>
                                <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '8px' }}>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            const confirm = await showConfirm(
                                                'Alterar Rateio?',
                                                'Deseja alterar o tipo de rateio para Prioridade? A ordem das UCs será preservada.'
                                            );
                                            if (confirm) setFormData({ ...formData, rateio_type: 'prioridade' });
                                        }}
                                        style={{
                                            padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600,
                                            background: formData.rateio_type === 'prioridade' ? 'white' : 'transparent',
                                            color: formData.rateio_type === 'prioridade' ? '#7c3aed' : '#64748b',
                                            boxShadow: formData.rateio_type === 'prioridade' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                                            cursor: 'pointer'
                                        }}
                                    >Prioridade</button>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            const confirm = await showConfirm(
                                                'Alterar Rateio?',
                                                'Deseja alterar o tipo de rateio para Porcentagem?'
                                            );
                                            if (confirm) setFormData({ ...formData, rateio_type: 'porcentagem' });
                                        }}
                                        style={{
                                            padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600,
                                            background: formData.rateio_type === 'porcentagem' ? 'white' : 'transparent',
                                            color: formData.rateio_type === 'porcentagem' ? '#7c3aed' : '#64748b',
                                            boxShadow: formData.rateio_type === 'porcentagem' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                                            cursor: 'pointer'
                                        }}
                                    >Porcentagem</button>
                                </div>
                            </div>

                            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '1.5rem' }}>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Comprometido</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#5b21b6' }}>{totalFranquiaVinculada.toFixed(0)} kWh</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Total de UCs</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#059669' }}>{selectedUCs.length}</div>
                                </div>
                            </div>
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', background: '#f8fafc' }}>
                            {renderUCList()}
                        </div>

                        <div style={{ padding: '1.5rem', background: 'white', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => setShowExpandedUCs(false)}
                                style={{ padding: '0.8rem 2.5rem', background: 'var(--color-blue)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}
                            >
                                Concluir Gerenciamento
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
