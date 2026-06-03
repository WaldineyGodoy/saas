import { useState, useEffect, useCallback } from 'react';
import { addMonths, subMonths, endOfMonth, format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData, sendWhatsapp } from '../lib/api';
import IrradianceChart from './IrradianceChart';
import { useUI } from '../contexts/UIContext';
import { 
    ChevronDown, ChevronUp, MapPin, Zap, Settings, DollarSign, Users, BarChart, Trash2, Save, X, 
    GripVertical, Key, Eye, EyeOff, Download, FileText, Maximize2, Minimize2, 
    LayoutDashboard, Activity, Wallet2, Link, Globe, AlertCircle, Calendar, CheckCircle, RefreshCcw, MessageSquare,
    Paperclip, Send, Loader2, Info, History, Clock, User, Mail, Smartphone, Search, CreditCard,
    Percent, SlidersHorizontal, ArrowUpDown, Check
} from 'lucide-react';
import HistoryTimeline from './HistoryTimeline';
import { useAuth } from '../contexts/AuthContext';
import { useBranding } from '../contexts/BrandingContext';
import {
    DndContext,
    closestCorners,
    PointerSensor,
    useSensor,
    useSensors,
    useSensors as useDndSensors,
    useDroppable,
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
import UCInvoicesModal from './UCInvoicesModal';
import ConsumerUnitModal from './ConsumerUnitModal';
import SupplierModal from './SupplierModal';

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

// Droppable Column Component for Drag and Drop between columns
const DroppableColumn = ({ id, children, style, className }) => {
    const { setNodeRef, isOver } = useDroppable({ id });
    return (
        <div 
            ref={setNodeRef} 
            style={{
                ...style,
                backgroundColor: isOver ? '#f1f5f9' : style.backgroundColor,
                borderColor: isOver ? '#cbd5e1' : style.borderColor,
                transition: 'all 0.2s ease'
            }}
            className={className}
        >
            {children}
        </div>
    );
};

// Sortable UC Item Component
const SortableUCItem = ({ uc, index, onToggle, geracaoEstimada, onPreview, subscribers, isFixed, isAvailable = false }) => {
    const { branding } = useBranding();
    const isDisconnected = uc.status === 'desconectado' || uc.status === 'cancelado';
    const percentage = (geracaoEstimada > 0 && !isDisconnected) ? ((uc.franquia / geracaoEstimada) * 100).toFixed(2) : (isDisconnected ? '0.00' : null);
    const subscriber = subscribers?.find(s => s.id === uc.titular_fatura_id || s.id === uc.subscriber_id);
    
    const getStatusStyle = (status) => {
        const map = {
            'ativo': { color: '#059669', bg: '#ecfdf5', label: 'Ativo' },
            'desconectado': { color: '#e11d48', bg: '#fff1f2', label: 'Desconectado' },
            'em_ativacao': { color: '#2563eb', bg: '#eff6ff', label: 'Em Ativação' },
            'vinculado': { color: '#4f46e5', bg: '#e0e7ff', label: 'Vinculado a Usina' },
            'ativacao': { color: '#2563eb', bg: '#eff6ff', label: 'Ativação' },
            'em_atraso': { color: '#d97706', bg: '#fffbeb', label: 'Em Atraso' },
            'cancelado': { color: '#475569', bg: '#f1f5f9', label: 'Cancelado' },
            'cancelado_inadimplente': { color: '#475569', bg: '#f1f5f9', label: 'Cancelado Inad.' },
            'aguardando_conexao': { color: branding?.primary_color || '#3b82f6', bg: (branding?.primary_color || '#3b82f6') + '10', label: 'Ag. Conexão' },
            'sem_geracao': { color: '#64748b', bg: '#f8fafc', label: 'Sem Geração' },
            'em_transf_titularidade': { color: '#0ea5e9', bg: '#f0f9ff', label: 'Transf. Titularidade' },
        };
        return map[status] || { color: '#64748b', bg: '#f8fafc', label: status?.replace(/_/g, ' ') || 'N/A' };
    };

    const statusStyle = getStatusStyle(uc.status);

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
        gap: '1rem',
        padding: '1rem',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        background: 'white',
        cursor: 'default',
        boxShadow: isDragging ? `0 10px 25px ${(branding?.primary_color || '#3b82f6')}33` : '0 2px 4px rgba(0,0,0,0.02)',
        zIndex: isDragging ? 100 : 1,
        position: 'relative',
        marginBottom: '0.75rem',
        opacity: (uc.status === 'desconectado' || uc.status === 'cancelado') ? 0.7 : 1,
        borderStyle: (uc.status === 'desconectado' || uc.status === 'cancelado') ? 'dashed' : 'solid',
        backgroundColor: (uc.status === 'desconectado' || uc.status === 'cancelado') ? '#f8fafc' : 'white'
    };

    const isGeradora = uc.tipo_unidade === 'geradora';

    return (
        <div 
            ref={setNodeRef} 
            style={style}
            className="uc-card-hover"
        >
            <style>{`
                .uc-card-hover:hover {
                    border-color: ${branding?.primary_color || '#3b82f6'} !important;
                    box-shadow: 0 4px 12px ${(branding?.primary_color || '#3b82f6')}15 !important;
                }
            `}</style>
            
            {!isFixed && (
                <div {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: '#94a3b8' }}>
                    <GripVertical size={20} />
                </div>
            )}
            
            {isFixed && (
                <div style={{ width: '20px' }} />
            )}

            {!isAvailable ? (
                <div style={{ 
                    width: '32px', 
                    height: '32px', 
                    borderRadius: '10px', 
                    background: isGeradora ? '#fef3c7' : (branding?.primary_color || '#3b82f6') + '15', 
                    color: isGeradora ? '#92400e' : (branding?.primary_color || '#3b82f6'), 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontSize: '0.85rem', 
                    fontWeight: '800',
                    border: `1px solid ${isGeradora ? '#fcd34d' : (branding?.primary_color || '#3b82f6') + '30'}`
                }}>
                    {index + 1}
                </div>
            ) : (
                <div style={{ 
                    width: '32px', 
                    height: '32px', 
                    borderRadius: '10px', 
                    background: '#f1f5f9', 
                    color: '#64748b', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontSize: '0.85rem', 
                    fontWeight: '800',
                    border: '1px solid #cbd5e1'
                }}>
                    <Zap size={16} />
                </div>
            )}

            <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                    <div style={{ fontWeight: '800', color: '#1e293b', fontSize: '1rem', letterSpacing: '-0.01em' }}>{uc.numero_uc}</div>
                    <span style={{ 
                        fontSize: '0.65rem', 
                        padding: '0.15rem 0.5rem', 
                        borderRadius: '6px', 
                        background: isGeradora ? '#fef3c7' : '#e0f2fe', 
                        color: isGeradora ? '#92400e' : '#075985', 
                        fontWeight: 800, 
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em'
                    }}>
                        {uc.tipo_unidade || 'Beneficiária'}
                    </span>
                    <span style={{ 
                        fontSize: '0.65rem', 
                        padding: '0.15rem 0.5rem', 
                        borderRadius: '6px', 
                        background: statusStyle.bg, 
                        color: statusStyle.color, 
                        fontWeight: 800, 
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                        border: `1px solid ${statusStyle.color}20`
                    }}>
                        {statusStyle.label}
                    </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                    {uc.titular_conta}
                </div>
                {subscriber && (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.1rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Users size={12} /> {subscriber.name}
                    </div>
                )}
            </div>

            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ minWidth: '100px' }}>
                    <span style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.1rem' }}>
                        {uc.concessionaria}
                    </span>
                    <div style={{ fontSize: '1.1rem', color: '#059669', fontWeight: '900' }}>
                        {uc.franquia ? `${Math.round(uc.franquia)}` : '0'} <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>kWh</span>
                    </div>
                    {percentage && (
                        <div style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 700, marginTop: '-0.1rem' }}>
                            {percentage}%
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                        type="button"
                        onClick={() => onPreview(uc)}
                        style={{ 
                            background: '#f8fafc', 
                            border: '1px solid #e2e8f0', 
                            borderRadius: '8px', 
                            padding: '0.5rem', 
                            color: '#64748b', 
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = branding?.primary_color || '#3b82f6'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#64748b'; }}
                    >
                        <Eye size={18} />
                    </button>
                    <input
                        type="checkbox"
                        checked={!isAvailable}
                        onChange={e => onToggle(e.target.checked)}
                        style={{ transform: 'scale(1.1)', accentColor: branding?.primary_color || '#3b82f6', cursor: 'pointer' }}
                    />
                </div>
            </div>
        </div>
    );
};

export default function PowerPlantModal({ usina, onClose, onSave, onDelete }) {
    const { profile } = useAuth();
    const { branding } = useBranding();
    const { showAlert, showConfirm } = useUI();
    const [suppliers, setSuppliers] = useState([]);
    const [inverterBrands, setInverterBrands] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);
    const [supplierSearchTerm, setSupplierSearchTerm] = useState('');
    const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
    const [activeSupplierForModal, setActiveSupplierForModal] = useState(null);

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
        dia_leitura: '',
        rateio_type: 'prioridade',
        portal_credentials: { url: '', login: '', password: '' }
    });

    const [availableUCs, setAvailableUCs] = useState([]);
    const [selectedUCs, setSelectedUCs] = useState([]); // Store full objects
    const [subscribers, setSubscribers] = useState([]);
    const [previewUC, setPreviewUC] = useState(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [activeTab, setActiveTab] = useState('geral'); // 'geral' | 'endereco' | 'tecnico' | 'financeiro' | 'ucs' | 'portal' | 'comunicacao'
    const [manualMessage, setManualMessage] = useState('');
    const [manualFile, setManualFile] = useState(null);
    const [isSendingManualWA, setIsSendingManualWA] = useState(false);
    const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
    const [isUCsModified, setIsUCsModified] = useState(!usina);

    const addHistory = async (type, id, action, details = {}, customContent = null) => {
        if (!id) return;
        try {
            const { error } = await supabase.from('crm_history').insert({
                entity_type: type,
                entity_id: id,
                content: customContent || `${action}: ${details.type || ''}`,
                metadata: details,
                created_by: profile?.id
            });
            if (error) throw error;
            setHistoryRefreshKey(prev => prev + 1);
        } catch (error) {
            console.error('Error adding history:', error);
        }
    };

    const handleSendManualWhatsApp = async () => {
        if (!manualMessage.trim() && !manualFile) {
            showAlert('Por favor, digite uma mensagem ou anexe um arquivo.', 'warning');
            return;
        }

        // Determinar destinatário: Supplier vinculado
        const supplier = suppliers.find(s => s.id === formData.supplier_id);
        const targetPhone = supplier?.phone;
        const targetName = supplier?.name || formData.name;

        if (!targetPhone) {
            showAlert('Telefone do proprietário/fornecedor não encontrado.', 'error');
            return;
        }

        const confirmed = await showConfirm(
            `Deseja enviar esta mensagem para ${targetName}?`,
            'Confirmar Envio',
            'Sim, Enviar',
            'Cancelar'
        );
        if (!confirmed) return;

        setIsSendingManualWA(true);
        try {
            let mediaBase64 = null;
            let fileName = null;

            if (manualFile) {
                const reader = new FileReader();
                const filePromise = new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                });
                reader.readAsDataURL(manualFile);
                mediaBase64 = await filePromise;
                fileName = manualFile.name;
            }

            // Normalização extra de DDI
            let phoneToQuery = targetPhone.replace(/\D/g, '');
            if (phoneToQuery.length >= 10 && phoneToQuery.length <= 11 && !phoneToQuery.startsWith('55')) {
                phoneToQuery = `55${phoneToQuery}`;
            }

            const response = await sendWhatsapp(
                phoneToQuery,
                manualMessage,
                null,
                mediaBase64,
                fileName
            );

            if (response.error) throw new Error(response.error);

            showAlert('Mensagem enviada com sucesso!', 'success');
            
            await addHistory('usina', usina?.id, 'whatsapp_manual', {
                message: manualMessage,
                file: fileName,
                phone: phoneToQuery,
                status: 'sent'
            }, `Comunicado WhatsApp: ${manualMessage.substring(0, 50)}${manualMessage.length > 50 ? '...' : ''}`);

            setManualMessage('');
            setManualFile(null);
        } catch (error) {
            console.error('Error sending manual WhatsApp:', error);
            showAlert('Erro ao enviar mensagem: ' + error.message, 'error');
        } finally {
            setIsSendingManualWA(false);
        }
    };
    const [showExpandedUCs, setShowExpandedUCs] = useState(false);
    const [showInvoicesModal, setShowInvoicesModal] = useState(false);
    const [ucForInvoices, setUcForInvoices] = useState(null);
    const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
    const [editingUC, setEditingUC] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    // Calculated Field: Potencia Kwp
    const [potenciaKwp, setPotenciaKwp] = useState(0);

    // Calc Total Franchise - Exclude disconnected/canceled units from commitment
    const totalFranquiaVinculada = selectedUCs
        .filter(uc => uc.status !== 'desconectado' && uc.status !== 'cancelado')
        .reduce((acc, uc) => acc + (Number(uc.consumo_medio_kwh) || Number(uc.franquia) || 0), 0);
    
    const ucStats = {
        total: selectedUCs.length,
        ativos: selectedUCs.filter(u => u.status === 'ativo').length,
        ativosKwh: selectedUCs
            .filter(u => u.status === 'ativo')
            .reduce((acc, uc) => acc + (Number(uc.consumo_medio_kwh) || Number(uc.franquia) || 0), 0),
        pendentes: selectedUCs.filter(u => ['em_ativacao', 'vinculado', 'aguardando_conexao', 'ativacao', 'em_transf_titularidade'].includes(u.status)).length,
        pendentesKwh: selectedUCs
            .filter(u => ['em_ativacao', 'vinculado', 'aguardando_conexao', 'ativacao', 'em_transf_titularidade'].includes(u.status))
            .reduce((acc, uc) => acc + (Number(uc.consumo_medio_kwh) || Number(uc.franquia) || 0), 0)
    };

    const geracaoDisponivel = Math.max(0, (Number(formData.geracao_estimada_kwh) || 0) - totalFranquiaVinculada);

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
                dia_leitura: usina.dia_leitura || '',
                rateio_type: usina.rateio_type || 'prioridade',
                portal_credentials: usina.portal_credentials || { url: '', login: '', password: '' }
            });
            fetchLinkedUCs(usina.id);
        }
    }, [usina?.id]);

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
    }, [activeFinanceTab, referenceMonth, usina?.id]);

    useEffect(() => {
        if (activeTab === 'ucs' && usina?.id) {
            fetchLinkedUCs(usina.id);
        }
    }, [activeTab, usina?.id]);

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

    // Update only the predicted generation when chart estimates arrive
    useEffect(() => {
        if (monthlyEstimates.length > 0 && monthlyDetails) {
            const monthIdx = parseInt(referenceMonth.split('-')[1]) - 1;
            const estimateObj = monthlyEstimates[monthIdx] || {};
            const prediction = estimateObj.geracao || estimateObj.estimativa || 0;
            
            if (prediction !== monthlyDetails.geracao_prevista) {
                setMonthlyDetails(prev => prev ? { ...prev, geracao_prevista: prediction } : prev);
            }
        }
    }, [monthlyEstimates, referenceMonth]);

    const fetchMonthlyDetails = async () => {
        setLoadingMonthly(true);
        try {
            const firstDay = `${referenceMonth}-01`;
            const [year, month] = referenceMonth.split('-');
            let y = parseInt(year);
            let m = parseInt(month) + 1;
            if (m > 12) {
                m = 1;
                y++;
            }
            const nextMonthStr = `${y}-${String(m).padStart(2, '0')}-01`;
            
            // 1. Fetch sum of "Energia Compensada" and "Faturamento" from invoices for linked UCs
            let totalCompensada = 0;
            let totalFaturamento = 0;
            let faturamentoPago = 0;
            let faturamentoAVencer = 0;
            let faturamentoSemFaturamento = 0;
            let faturamentoAtrasado = 0;
            let totalContasEnergia = 0;
            let prodData = null;
            let prodError = null;

            if (selectedUCs.length > 0) {
                const ucIds = selectedUCs.map(uc => uc.id);

                const mainUG = selectedUCs.find(uc => uc.numero_uc === formData.unidade_geradora) || availableUCs.find(uc => uc.numero_uc === formData.unidade_geradora);
                const diaLeitura = mainUG?.dia_leitura;
                
                let startD, endD;
                if (!diaLeitura) {
                    const [year, month] = referenceMonth.split('-');
                    let y = parseInt(year);
                    let m = parseInt(month) + 1;
                    if (m > 12) {
                        m = 1;
                        y++;
                    }
                    startD = firstDay;
                    endD = `${y}-${String(m).padStart(2, '0')}-01`;
                } else {
                    const baseDate = parseISO(firstDay);
                    const day = parseInt(diaLeitura);
                    const startDateObj = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, day + 1);
                    const endDateObj = new Date(baseDate.getFullYear(), baseDate.getMonth(), day);
                    // Add 1 day to end date to make it exclusive like lt() requires if using time
                    const nextDayObj = new Date(endDateObj);
                    nextDayObj.setDate(nextDayObj.getDate() + 1);
                    
                    startD = format(startDateObj, 'yyyy-MM-dd');
                    endD = format(nextDayObj, 'yyyy-MM-dd');
                }

                const [energyRes, faturamentoRes, prodRes] = await Promise.all([
                    supabase.from('invoices').select('consumo_compensado').in('uc_id', ucIds).eq('mes_referencia', firstDay).neq('status', 'cancelado'),
                    supabase.from('invoices').select('valor_a_pagar, status, valor_concessionaria').in('uc_id', ucIds).gte('vencimento', firstDay).lt('vencimento', nextMonthStr).neq('status', 'cancelado'),
                    supabase.from('generation_production').select('*').eq('usina_id', usina.id).eq('mes_referencia', firstDay).order('created_at', { ascending: false }).limit(1).maybeSingle()
                ]);

                if (energyRes.error) console.error('Energy Fetch Error:', energyRes.error);
                if (faturamentoRes.error) console.error('Faturamento Fetch Error:', faturamentoRes.error);
                if (prodRes.error) console.error('Production Fetch Error:', prodRes.error);

                totalCompensada = energyRes.data?.reduce((acc, curr) => acc + (Number(curr.consumo_compensado) || 0), 0) || 0;
                totalFaturamento = faturamentoRes.data?.reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0) || 0;

                if (faturamentoRes.data) {
                    faturamentoRes.data.forEach(inv => {
                        const val = Number(inv.valor_a_pagar) || 0;
                        const concessionariaVal = Number(inv.valor_concessionaria) || 0;
                        totalContasEnergia += concessionariaVal;

                        if (inv.status === 'pago') {
                            faturamentoPago += val;
                        } else if (inv.status === 'a_vencer' || inv.status === 'ag_emissao_boleto' || inv.status === 'confirmado') {
                            faturamentoAVencer += val;
                        } else if (inv.status === 'sem_faturamento') {
                            faturamentoSemFaturamento += val;
                        } else if (inv.status === 'atrasado') {
                            faturamentoAtrasado += val;
                        }
                    });
                }

                prodData = prodRes.data;
                prodError = prodRes.error;
            } else {
                const prodRes = await supabase.from('generation_production').select('*').eq('usina_id', usina.id).eq('mes_referencia', firstDay).order('created_at', { ascending: false }).limit(1).maybeSingle();
                prodData = prodRes.data;
                prodError = prodRes.error;
            }

            // 1.1. Buscar a Unidade Geradora (UG) correspondente e sua energia injetada na fatura do mês
            let ugId = null;
            if (formData.unidade_geradora) {
                const mainUG = selectedUCs.find(uc => uc.numero_uc === formData.unidade_geradora) || 
                               availableUCs.find(uc => uc.numero_uc === formData.unidade_geradora);
                ugId = mainUG?.id;
                
                if (!ugId) {
                    try {
                        const { data: ugData } = await supabase
                            .from('consumer_units')
                            .select('id')
                            .eq('numero_uc', formData.unidade_geradora)
                            .maybeSingle();
                        ugId = ugData?.id;
                    } catch (ugErr) {
                        console.error('Erro ao buscar ID da UG:', ugErr);
                    }
                }
            }

            let injectedEnergy = 0;
            if (ugId) {
                try {
                    const { data: ugInvoice } = await supabase
                        .from('invoices')
                        .select('energia_injetada')
                        .eq('uc_id', ugId)
                        .eq('mes_referencia', firstDay)
                        .neq('status', 'cancelado')
                        .maybeSingle();
                    
                    if (ugInvoice?.energia_injetada) {
                        injectedEnergy = Number(ugInvoice.energia_injetada);
                        console.log(`Energia injetada encontrada para a UG (${formData.unidade_geradora}):`, injectedEnergy);
                    }
                } catch (invoiceErr) {
                    console.error('Erro ao buscar fatura da UG:', invoiceErr);
                }
            }

            // 2. Get prediction for the specific month from chart data
            const monthIdx = parseInt(referenceMonth.split('-')[1]) - 1;
            const estimateObj = monthlyEstimates[monthIdx] || {};
            const prediction = estimateObj.geracao || estimateObj.estimativa || 0;

            // Don't throw if only the production record is missing, but log it
            if (prodError && prodError.code !== 'PGRST116') {
                console.warn('Non-critical production fetch error:', prodError);
            }
            
            if (prodData) {
                setMonthlyDetails({
                    ...prodData,
                    details: prodData.service_details || {},
                    geracao_mensal_kwh: injectedEnergy || Number(prodData.geracao_mensal_kwh) || 0,
                    energia_compensada: totalCompensada || Number(prodData.energia_compensada) || 0,
                    faturamento_mensal: totalFaturamento,
                    faturamento_pago: faturamentoPago,
                    faturamento_a_vencer: faturamentoAVencer,
                    faturamento_sem_faturamento: faturamentoSemFaturamento,
                    faturamento_atrasado: faturamentoAtrasado,
                    custo_disponibilidade: totalContasEnergia,
                    geracao_prevista: prediction // Sempre usar a previsão dinâmica do gráfico
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
                    if (!['Gestão', 'Manutenção', 'Arrendamento'].includes(s)) {
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
                    status: 'em_producao',
                    geracao_mensal_kwh: injectedEnergy || 0,
                    geracao_prevista: prediction,
                    energia_compensada: totalCompensada || 0,
                    faturamento_mensal: totalFaturamento,
                    faturamento_pago: faturamentoPago,
                    faturamento_a_vencer: faturamentoAVencer,
                    faturamento_sem_faturamento: faturamentoSemFaturamento,
                    faturamento_atrasado: faturamentoAtrasado,
                    custo_disponibilidade: totalContasEnergia
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
            const faturamentoPago = monthlyDetails.faturamento_pago || 0;
            const concessionaria = monthlyDetails.custo_disponibilidade || 0;
            
            const subtotal = faturamentoPago - concessionaria;
            const gestaoTotal = subtotal * (Number(formData.gestao_percentual) / 100);
            const otherServices = monthlyDetails.servicos || 0;

            const totalDespesas = maintenance + rent + gestaoTotal + otherServices;
            const saldoReceber = subtotal - totalDespesas;

            // 2. Upsert generation_production
            const { 
                details, 
                id: prodId, 
                created_at, 
                geracao_real, 
                updated_at, 
                faturamento_pago,
                faturamento_a_vencer,
                faturamento_sem_faturamento,
                faturamento_atrasado,
                ...mainData 
            } = monthlyDetails;
            const upsertData = {
                ...mainData,
                service_details: details || {},
                custo_disponibilidade: concessionaria, // Ensure energy cost is mapped
                faturas_pagas: faturamentoPago,
                gestao_reais: gestaoTotal,
                total_despesas: totalDespesas,
                saldo_receber: saldoReceber,
                fechamento: new Date().toISOString().split('T')[0],
                status: 'liquidado'
            };
            
            if (prodId) {
                upsertData.id = prodId;
            }

            const { error: prodError } = await supabase
                .from('generation_production')
                .upsert(upsertData);

            if (prodError) throw prodError;

            const periodString = (() => {
                const baseDate = parseISO(`${referenceMonth}-01`);
                const mainUG = selectedUCs.find(uc => uc.numero_uc === formData.unidade_geradora) || availableUCs.find(uc => uc.numero_uc === formData.unidade_geradora);
                const diaLeitura = mainUG?.dia_leitura;
                
                if (!diaLeitura) {
                    return `01/${format(baseDate, 'MM/yyyy')} a ${format(endOfMonth(baseDate), 'dd/MM/yyyy')}`;
                }
                const day = parseInt(diaLeitura);
                const endD = new Date(baseDate.getFullYear(), baseDate.getMonth(), day);
                const startD = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, day + 1);
                return `${format(startD, 'dd/MM/yyyy')} a ${format(endD, 'dd/MM/yyyy')}`;
            })();

            // 3. Create Ledger Entries
            const entries = [];
            const supplierId = formData.supplier_id; // Reference for account 2.1.1
            
            // 0. Gross Faturamento - Increases Liability to Usina (Credit)
            if (faturamento > 0) {
                entries.push({
                    transaction_id: transactionId,
                    account_code: '2.1.1',
                    amount: -faturamento, // Credit (Increases liability)
                    description: `Faturamento Mensal - ${usina.name} - ${referenceMonth} (${periodString})`,
                    reference_type: 'supplier',
                    reference_id: supplierId,
                    is_sandbox: false
                });
                // Balancing entry: Debit to Revenue (reducing B2W's gross revenue by the part that belongs to the plant)
                entries.push({
                    transaction_id: transactionId,
                    account_code: '3.1.0', 
                    amount: faturamento, // Debit
                    description: `Provisão Repasse Usina - ${usina.name} - ${referenceMonth} (${periodString})`,
                    reference_type: 'supplier',
                    reference_id: supplierId,
                    is_sandbox: false
                });
            }

            // Helper to add entry pair (Debit Investor, Credit Revenue/Liability)
            const addPosting = (accountCode, amount, desc) => {
                if (amount <= 0) return;
                // Debit Investor (Positive) - Liability to Power Plant
                entries.push({
                    transaction_id: transactionId,
                    account_code: '2.1.1', // Obrigações Usinas
                    amount: amount,
                    description: `${desc} - ${referenceMonth} (${periodString})`,
                    reference_type: 'supplier',
                    reference_id: supplierId,
                    is_sandbox: false
                });
                // Credit Revenue or Other Liability (Negative)
                entries.push({
                    transaction_id: transactionId,
                    account_code: accountCode,
                    amount: -amount,
                    description: `${desc} - ${referenceMonth} (${periodString})`,
                    reference_type: 'supplier',
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
        const { data } = await supabase.from('suppliers').select('id, name, phone, cnpj, email').order('name');
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

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        if (!over) return;

        const activeId = active.id;
        const overId = over.id;

        // 1. Find if active item is linked or available
        const activeItemLinked = selectedUCs.find(uc => uc.id === activeId);
        
        // Filter out canceled statuses for Available UCs
        const filteredAvailable = availableUCs.filter(uc => 
            !selectedUCs.some(s => s.id === uc.id) &&
            uc.status !== 'cancelado' &&
            uc.status !== 'cancelado_inadimplente'
        );
        const activeItemAvailable = filteredAvailable.find(uc => uc.id === activeId);
        
        const isActiveLinked = !!activeItemLinked;
        const isActiveAvailable = !!activeItemAvailable;

        // 2. Find if over target belongs to linked or available column
        const isOverLinked = selectedUCs.some(uc => uc.id === overId) || overId === 'linked-column';
        const isOverAvailable = filteredAvailable.some(uc => uc.id === overId) || overId === 'available-column';

        // 3. Prevent dragging the Unidade Geradora principal if it's currently selected
        if (isActiveLinked && activeItemLinked?.numero_uc === formData.unidade_geradora) {
            // Unidade geradora must be at index 0 of Linked column and cannot be removed
            if (isOverAvailable) {
                showAlert('A Unidade Geradora principal não pode ser removida por aqui. Altere na seção Geral.', 'warning');
                return;
            }
            // If sorting within linked, prevent it from moving from index 0
            const oldIndex = selectedUCs.findIndex(uc => uc.id === activeId);
            const newIndex = selectedUCs.findIndex(uc => uc.id === overId);
            if (oldIndex === 0 || newIndex === 0) {
                return;
            }
        }

        // Case A: Sorting within Linked column
        if (isActiveLinked && isOverLinked) {
            if (activeId !== overId) {
                setSelectedUCs((items) => {
                    const oldIndex = items.findIndex(i => i.id === activeId);
                    const newIndex = items.findIndex(i => i.id === overId);

                    // Re-enforce Unidade Geradora principal constraint at index 0
                    const isGeradoraAt0 = items[0]?.numero_uc === formData.unidade_geradora;
                    if (isGeradoraAt0 && (oldIndex === 0 || newIndex === 0)) {
                        return items;
                    }

                    const newItems = [...items];
                    const [movedItem] = newItems.splice(oldIndex, 1);
                    newItems.splice(newIndex, 0, movedItem);

                    return newItems;
                });
                setIsUCsModified(true);
            }
            return;
        }

        // Case B: Moving from Available to Linked (Vincular)
        if (isActiveAvailable && isOverLinked) {
            const activeUc = activeItemAvailable;
            if (activeUc) {
                // Safety Pop-up
                const confirm = await showConfirm(
                    'Confirmar Vínculo',
                    `Deseja realmente vincular a UC ${activeUc.numero_uc} a esta usina?`,
                    'Sim, Vincular',
                    'Cancelar'
                );
                if (confirm) {
                    setSelectedUCs(prev => {
                        // Insert at specific dropped position if possible, otherwise append
                        const index = prev.findIndex(u => u.id === overId);
                        const newSelected = [...prev];
                        if (index !== -1) {
                            newSelected.splice(index, 0, activeUc);
                        } else {
                            newSelected.push(activeUc);
                        }
                        return newSelected;
                    });
                    setIsUCsModified(true);
                }
            }
            return;
        }

        // Case C: Moving from Linked to Available (Remover Vínculo)
        if (isActiveLinked && isOverAvailable) {
            const activeUc = activeItemLinked;
            if (activeUc) {
                // Safety Pop-up
                const confirm = await showConfirm(
                    'Remover Vínculo',
                    `Deseja realmente remover a UC ${activeUc.numero_uc} desta usina?`,
                    'Sim, Remover',
                    'Cancelar'
                );
                if (confirm) {
                    setSelectedUCs(prev => prev.filter(u => u.id !== activeId));
                    setIsUCsModified(true);
                }
            }
            return;
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

    const handleCreateRateioCard = async () => {
        if (!usina?.id) {
            showAlert('Salve a usina antes de criar uma Lista de Rateio.', 'warning');
            return;
        }
        if (selectedUCs.length === 0) {
            showAlert('Não há UCs vinculadas para criar a lista de rateio.', 'warning');
            return;
        }

        const confirmed = await showConfirm(
            'Criar Lista de Rateio',
            `Criar um card de Lista de Rateio para a usina "${formData.name}" com ${selectedUCs.length} UC(s) vinculada(s)?`,
            'Sim, Criar',
            'Cancelar'
        );
        if (!confirmed) return;

        // Build the same processedUCs logic as handleGenerateList
        const geradora = selectedUCs.find(u => u.tipo_unidade === 'geradora');
        const beneficiarias = selectedUCs.filter(u => u.tipo_unidade !== 'geradora');
        const sortedUCs = geradora ? [geradora, ...beneficiarias] : beneficiarias;
        const isPorcentagem = formData.rateio_type === 'porcentagem';
        let processedUCs = [];

        if (isPorcentagem) {
            let currentTotalPrc = 0;
            let saldoRemanescenteIndex = -1;
            const totalCapacity = Number(formData.geracao_estimada_kwh) || 1;

            sortedUCs.forEach((uc, idx) => {
                if (uc.saldo_remanescente) saldoRemanescenteIndex = idx;
            });
            if (saldoRemanescenteIndex === -1) {
                const geradoraIdx = sortedUCs.findIndex(uc => uc.tipo_unidade === 'geradora');
                saldoRemanescenteIndex = geradoraIdx !== -1 ? geradoraIdx : 0;
            }

            for (let i = 0; i < sortedUCs.length; i++) {
                const uc = { ...sortedUCs[i] };
                const kWhVal = Number(uc.franquia) || 0;
                const prcVal = (kWhVal / totalCapacity) * 100;
                if (currentTotalPrc + prcVal <= 100) {
                    currentTotalPrc += prcVal;
                    uc.calculatedPercentage = prcVal;
                    processedUCs.push(uc);
                } else if (currentTotalPrc < 100) {
                    uc.calculatedPercentage = 100 - currentTotalPrc;
                    currentTotalPrc = 100;
                    processedUCs.push(uc);
                    break;
                } else break;
            }
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

        // Build snapshot with relevant fields only
        const ucsSnapshot = processedUCs.map(uc => {
            const sub = subscribers.find(s => s.id === uc.subscriber_id);
            return {
                id: uc.id,
                numero_uc: uc.numero_uc,
                tipo_unidade: uc.tipo_unidade,
                status: uc.status,
                franquia: uc.franquia,
                consumo_medio_kwh: uc.consumo_medio_kwh,
                cpf_cnpj: uc.cpf_cnpj_fatura || sub?.cpf_cnpj || '',
                saldo_remanescente: uc.saldo_remanescente,
                prioridade: uc.prioridade,
                calculatedPercentage: uc.calculatedPercentage
            };
        });

        try {
            const now = new Date().toISOString();
            const { error } = await supabase.from('rateio_lists').insert({
                usina_id: usina.id,
                usina_name: formData.name,
                concessionaria: formData.concessionaria,
                unidade_geradora: formData.unidade_geradora,
                qtd_ucs: processedUCs.length,
                ucs_snapshot: ucsSnapshot,
                rateio_type: formData.rateio_type,
                status: 'criada',
                status_dates: { criada_at: now }
            });

            if (error) throw error;
            showAlert(`Lista de Rateio criada com ${processedUCs.length} UC(s)! Acesse o menu "Lista de Rateio" para acompanhar.`, 'success');
        } catch (err) {
            console.error('Error creating rateio card:', err);
            showAlert('Erro ao criar Lista de Rateio: ' + err.message, 'error');
        }
    };


    const getCommitmentStyle = (percentage) => {
        if (percentage < 30) return { 
            gradient: 'linear-gradient(90deg, #22c55e, #10b981)', 
            color: '#166534'
        };
        if (percentage < 60) return { 
            gradient: 'linear-gradient(90deg, #eab308, #f97316)', 
            color: '#854d0e'
        };
        if (percentage < 85) return { 
            gradient: 'linear-gradient(90deg, #f97316, #ef4444)', 
            color: '#9a3412'
        };
        return { 
            gradient: 'linear-gradient(90deg, #ef4444, #991b1b)', 
            color: '#7f1d1d'
        };
    };

    const renderUCList = () => {
        // Filter out selected UCs AND cancelled statuses for Available UCs
        const filteredAvailable = availableUCs.filter(uc => 
            !selectedUCs.some(s => s.id === uc.id) &&
            uc.status !== 'cancelado' &&
            uc.status !== 'cancelado_inadimplente'
        );

        return (
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '0.5rem' }}>
                    
                    {/* Column 1: Vinculadas (Linked) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem', padding: '0 0.5rem' }}>
                            <h5 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b', fontWeight: 800 }}>Vinculadas</h5>
                            <span style={{ fontSize: '0.75rem', color: '#0f766e', fontWeight: 800, padding: '0.2rem 0.6rem', background: '#ccfbf1', borderRadius: '6px', border: '1px solid #99f6e4' }}>
                                {selectedUCs.length} UCs
                            </span>
                        </div>
                        
                        <DroppableColumn 
                            id="linked-column" 
                            style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                gap: '0.5rem', 
                                padding: '1rem', 
                                background: '#f8fafc', 
                                borderRadius: '16px', 
                                border: '1px dashed #cbd5e1',
                                minHeight: '300px',
                                maxHeight: '600px',
                                overflowY: 'auto'
                            }}
                            className="custom-scrollbar"
                        >
                            <SortableContext items={selectedUCs.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                {selectedUCs.length === 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, height: '100%', minHeight: '260px', color: '#94a3b8', textAlign: 'center', padding: '1.5rem' }}>
                                        <Link size={24} style={{ marginBottom: '0.5rem', opacity: 0.6 }} />
                                        <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600 }}>Nenhuma UC vinculada.</p>
                                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.72rem', opacity: 0.8 }}>Arraste UCs aqui para vinculá-las.</p>
                                    </div>
                                ) : (
                                    selectedUCs.map((uc, index) => (
                                        <SortableUCItem
                                            key={uc.id}
                                            uc={uc}
                                            index={index}
                                            isAvailable={false}
                                            geracaoEstimada={formData.geracao_estimada_kwh}
                                            subscribers={subscribers}
                                            isFixed={index === 0 && uc.numero_uc === formData.unidade_geradora}
                                            onPreview={async () => {
                                                const { data } = await supabase.from('consumer_units').select('*, subscribers:subscribers!consumer_units_subscriber_id_fkey(name, phone)').eq('id', uc.id).single();
                                                setPreviewUC(data || uc);
                                                setShowPreviewModal(true);
                                            }}
                                            onToggle={async (checked) => {
                                                if (index === 0 && uc.numero_uc === formData.unidade_geradora) {
                                                    showAlert('A Unidade Geradora principal não pode ser removida por aqui. Altere na seção Geral.', 'warning');
                                                    return;
                                                }
                                                // unchecked -> remove link
                                                const confirm = await showConfirm(
                                                    'Remover Vínculo?',
                                                    `Deseja realmente remover a UC ${uc.numero_uc} desta usina?`,
                                                    'Sim, Remover',
                                                    'Cancelar'
                                                );
                                                if (confirm) {
                                                    setSelectedUCs(selectedUCs.filter(u => u.id !== uc.id));
                                                    setIsUCsModified(true);
                                                }
                                            }}
                                        />
                                    ))
                                )}
                            </SortableContext>
                        </DroppableColumn>
                    </div>

                    {/* Column 2: Disponíveis (Available) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem', padding: '0 0.5rem' }}>
                            <h5 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b', fontWeight: 800 }}>Disponíveis</h5>
                            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 800, padding: '0.2rem 0.6rem', background: '#f1f5f9', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                {filteredAvailable.length} UCs
                            </span>
                        </div>

                        <DroppableColumn 
                            id="available-column" 
                            style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                gap: '0.5rem', 
                                padding: '1rem', 
                                background: '#f8fafc', 
                                borderRadius: '16px', 
                                border: '1px dashed #cbd5e1',
                                minHeight: '300px',
                                maxHeight: '600px',
                                overflowY: 'auto'
                            }}
                            className="custom-scrollbar"
                        >
                            <SortableContext items={filteredAvailable.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                {filteredAvailable.length === 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, height: '100%', minHeight: '260px', color: '#94a3b8', textAlign: 'center', padding: '1.5rem' }}>
                                        <Zap size={24} style={{ marginBottom: '0.5rem', opacity: 0.6 }} />
                                        <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600 }}>Nenhuma UC disponível.</p>
                                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.72rem', opacity: 0.8 }}>Todas as UCs elegíveis já estão vinculadas.</p>
                                    </div>
                                ) : (
                                    filteredAvailable.map((uc, index) => (
                                        <SortableUCItem
                                            key={uc.id}
                                            uc={uc}
                                            index={index}
                                            isAvailable={true}
                                            geracaoEstimada={formData.geracao_estimada_kwh}
                                            subscribers={subscribers}
                                            isFixed={false}
                                            onPreview={async () => {
                                                const { data } = await supabase.from('consumer_units').select('*, subscribers:subscribers!consumer_units_subscriber_id_fkey(name, phone)').eq('id', uc.id).single();
                                                setPreviewUC(data || uc);
                                                setShowPreviewModal(true);
                                            }}
                                            onToggle={async (checked) => {
                                                // checked -> bind link
                                                const confirm = await showConfirm(
                                                    'Confirmar Vínculo',
                                                    `Deseja realmente vincular a UC ${uc.numero_uc} a esta usina?`,
                                                    'Sim, Vincular',
                                                    'Cancelar'
                                                );
                                                if (confirm) {
                                                    setSelectedUCs([...selectedUCs, uc]);
                                                    setIsUCsModified(true);
                                                }
                                            }}
                                        />
                                    ))
                                )}
                            </SortableContext>
                        </DroppableColumn>
                    </div>

                </div>
            </DndContext>
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

            if (usinaId && isUCsModified) {
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

                // If monthly details are populated, save them to generation_production
                if (monthlyDetails) {
                    const { details, id: prodId, created_at, geracao_real, updated_at, ...mainData } = monthlyDetails;
                    const upsertData = {
                        ...mainData,
                        usina_id: usinaId,
                        mes_referencia: `${referenceMonth}-01`,
                        service_details: details || {},
                        status: mainData.status === 'pendente' || !mainData.status ? 'em_producao' : mainData.status
                    };
                    
                    if (prodId) {
                        upsertData.id = prodId;
                    }

                    const { error: prodError } = await supabase.from('generation_production')
                        .upsert(upsertData);
                    
                    if (prodError) throw prodError;
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
                width: '98%',
                maxWidth: '1350px',
                maxHeight: '96vh',
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
                    padding: '0 1rem',
                    gap: '1rem',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none'
                }}>
                    {[
                        { id: 'geral', label: 'Geral', icon: LayoutDashboard },
                        { id: 'endereco', label: 'Localização', icon: MapPin },
                        { id: 'tecnico', label: 'Técnico', icon: Activity },
                        { id: 'financeiro', label: 'Financeiro', icon: Wallet2 },
                        { id: 'ucs', label: 'UCs & Rateio', icon: Link },
                        { id: 'portal', label: 'Portal', icon: Globe },
                        { id: 'comunicacao', label: 'Comunicados', icon: MessageSquare }
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

                <form onSubmit={handleSubmit} style={{ padding: '2rem', minHeight: '750px' }}>

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
                            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                <div>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Potência Instalada</span>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#14532d' }}>{potenciaKwp} kWp</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                                    style={{
                                        background: 'white',
                                        border: '1px solid #bbf7d0',
                                        borderRadius: '50%',
                                        width: '40px',
                                        height: '40px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#166534',
                                        cursor: 'pointer',
                                        transition: '0.2s',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                                    }}
                                    title={showTechnicalDetails ? "Ocultar Detalhes" : "Mostrar Detalhes"}
                                >
                                    {showTechnicalDetails ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                </button>
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

                                <div style={{ position: 'relative' }}>
                                     <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>Fornecedor / Proprietário</label>
                                     <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                         <div style={{ position: 'relative', flex: 1 }}>
                                             <input
                                                 type="text"
                                                 required={!formData.supplier_id}
                                                 value={supplierSearchTerm}
                                                 onFocus={() => setShowSupplierDropdown(true)}
                                                 onBlur={() => setTimeout(() => setShowSupplierDropdown(false), 250)}
                                                 onChange={e => {
                                                     setSupplierSearchTerm(e.target.value);
                                                     setShowSupplierDropdown(true);
                                                 }}
                                                 placeholder={
                                                     formData.supplier_id 
                                                         ? suppliers.find(s => s.id === formData.supplier_id)?.name || "Buscar para trocar fornecedor..." 
                                                         : "Buscar fornecedor por nome, CNPJ..."
                                                 }
                                                 style={{ 
                                                     width: '100%', 
                                                     padding: '0.8rem 2.5rem 0.8rem 1rem', 
                                                     border: '1px solid #e2e8f0', 
                                                     borderRadius: '10px', 
                                                     outline: 'none',
                                                     fontSize: '1rem',
                                                     transition: 'border-color 0.2s',
                                                     borderColor: showSupplierDropdown ? 'var(--color-blue)' : '#e2e8f0',
                                                     background: 'white'
                                                 }}
                                             />
                                             <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                                                 <Search size={18} />
                                             </div>
                                         </div>
                                         {formData.supplier_id && (
                                             <button
                                                 type="button"
                                                 onClick={() => {
                                                     setFormData(prev => ({ ...prev, supplier_id: '' }));
                                                     setSupplierSearchTerm('');
                                                 }}
                                                 style={{
                                                     padding: '0.8rem 1rem',
                                                     background: '#ef4444',
                                                     color: 'white',
                                                     border: 'none',
                                                     borderRadius: '10px',
                                                     cursor: 'pointer',
                                                     fontSize: '0.9rem',
                                                     fontWeight: 500,
                                                     display: 'flex',
                                                     alignItems: 'center',
                                                     gap: '0.25rem',
                                                     boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)'
                                                 }}
                                             >
                                                 Desvincular
                                             </button>
                                         )}
                                     </div>

                                     {/* Dropdown de Resultados da Busca */}
                                     {showSupplierDropdown && (
                                         <div className="custom-scrollbar" style={{
                                             position: 'absolute',
                                             top: '100%',
                                             left: 0,
                                             right: 0,
                                             background: 'white',
                                             border: '1px solid #e2e8f0',
                                             borderRadius: '10px',
                                             boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                                             maxHeight: '200px',
                                             overflowY: 'auto',
                                             zIndex: 100,
                                             marginTop: '4px'
                                         }}>
                                             {suppliers
                                                 .filter(s => {
                                                     const term = supplierSearchTerm.toLowerCase().trim();
                                                     if (!term) return true;
                                                     return (
                                                         s.name?.toLowerCase().includes(term) ||
                                                         s.cnpj?.toLowerCase().includes(term) ||
                                                         s.email?.toLowerCase().includes(term) ||
                                                         s.phone?.toLowerCase().includes(term)
                                                     );
                                                 })
                                                 .map(s => (
                                                     <div
                                                         key={s.id}
                                                         onMouseDown={() => {
                                                             setFormData(prev => ({ ...prev, supplier_id: s.id }));
                                                             setSupplierSearchTerm('');
                                                             setShowSupplierDropdown(false);
                                                         }}
                                                         style={{
                                                             padding: '0.75rem 1rem',
                                                             cursor: 'pointer',
                                                             borderBottom: '1px solid #f1f5f9',
                                                             transition: 'background 0.15s'
                                                         }}
                                                         onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                                         onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                     >
                                                         <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.875rem' }}>{s.name}</div>
                                                         <div style={{ display: 'flex', gap: '1rem', color: '#64748b', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                                                             {s.cnpj && <span>CNPJ: {s.cnpj}</span>}
                                                             {s.email && <span>E-mail: {s.email}</span>}
                                                         </div>
                                                     </div>
                                                 ))
                                             }
                                             {suppliers.filter(s => {
                                                 const term = supplierSearchTerm.toLowerCase().trim();
                                                 if (!term) return true;
                                                 return (
                                                     s.name?.toLowerCase().includes(term) ||
                                                     s.cnpj?.toLowerCase().includes(term) ||
                                                     s.email?.toLowerCase().includes(term) ||
                                                     s.phone?.toLowerCase().includes(term)
                                                 );
                                             }).length === 0 && (
                                                 <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>
                                                     Nenhum fornecedor encontrado.
                                                 </div>
                                             )}
                                         </div>
                                     )}
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
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '1rem', maxHeight: '500px', overflowY: 'auto', padding: '1rem', border: '1px solid #f1f5f9', borderRadius: '12px', background: '#f8fafc' }}>
                                        {(() => {
                                            const allUCs = [...availableUCs, ...selectedUCs];
                                            const uniqueUCs = Array.from(new Map(allUCs.map(uc => [uc.id, uc])).values());
                                            const geradoras = uniqueUCs.filter(uc => uc.tipo_unidade === 'geradora');
                                            const selectedSupplier = suppliers.find(s => s.id === formData.supplier_id);

                                            return (
                                                <>
                                                    {selectedSupplier && (
                                                        <div
                                                            onClick={() => setActiveSupplierForModal(selectedSupplier)}
                                                            style={{
                                                                padding: '1.25rem',
                                                                background: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)',
                                                                border: '1.5px solid #bfdbfe',
                                                                borderRadius: '12px',
                                                                cursor: 'pointer',
                                                                position: 'relative',
                                                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '0.75rem',
                                                                overflow: 'hidden'
                                                            }}
                                                            onMouseEnter={e => {
                                                                e.currentTarget.style.transform = 'scale(1.02) translateY(-2px)';
                                                                e.currentTarget.style.borderColor = 'var(--color-blue)';
                                                                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(37, 99, 235, 0.1)';
                                                            }}
                                                            onMouseLeave={e => {
                                                                e.currentTarget.style.transform = 'none';
                                                                e.currentTarget.style.borderColor = '#bfdbfe';
                                                                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05)';
                                                            }}
                                                        >
                                                            {/* Background accent line */}
                                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--color-blue)' }}></div>
                                                            
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '0.25rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                    <User size={18} color="var(--color-blue)" style={{ minWidth: '18px' }} />
                                                                    <h5 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>{selectedSupplier.name}</h5>
                                                                </div>
                                                                <span style={{
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: 600,
                                                                    background: '#dbeafe',
                                                                    color: 'var(--color-blue)',
                                                                    padding: '0.2rem 0.6rem',
                                                                    borderRadius: '20px',
                                                                    textTransform: 'uppercase',
                                                                    letterSpacing: '0.05em'
                                                                }}>
                                                                    Ver Cadastro
                                                                </span>
                                                            </div>

                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.6rem', fontSize: '0.8rem', color: '#475569', borderTop: '1px dashed #e2e8f0', paddingTop: '0.75rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <CreditCard size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span style={{ fontWeight: 500 }}>CNPJ: {selectedSupplier.cnpj || 'Sem CNPJ'}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <Smartphone size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span>Tel: {selectedSupplier.phone || 'Sem Telefone'}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <Mail size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{selectedSupplier.email || 'Sem E-mail'}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {geradoras.length === 0 ? (
                                                        <div style={{ gridColumn: selectedSupplier ? 'auto' : '1 / -1', textAlign: 'center', padding: '2rem' }}>
                                                            <AlertCircle size={32} color="#94a3b8" style={{ marginBottom: '0.5rem' }} />
                                                            <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Nenhuma UC do tipo "Geradora" encontrada.</p>
                                                        </div>
                                                    ) : (
                                                        geradoras.map(uc => {
                                                            const isSelected = formData.unidade_geradora === uc.numero_uc;
                                                            const subscriber = subscribers.find(s => s.id === uc.titular_fatura_id);

                                                            return (
                                                                <div
                                                                    key={uc.id}
                                                                    onClick={() => {
                                                                        if (isSelected) {
                                                                            setFormData({ ...formData, unidade_geradora: '', cnpj_cpf: '' });
                                                                            setIsUCsModified(true);
                                                                        } else {
                                                                            setFormData({ ...formData, unidade_geradora: uc.numero_uc, cnpj_cpf: uc.cpf_cnpj_fatura || subscriber?.cpf_cnpj || '' });
                                                                            setSelectedUCs(prev => [uc, ...prev.filter(u => u.id !== uc.id)]);
                                                                            setIsUCsModified(true);
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
                                                                    <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setEditingUC(uc);
                                                                            }}
                                                                            style={{
                                                                                background: '#f8fafc', 
                                                                                border: '1px solid #e2e8f0', 
                                                                                borderRadius: '8px', 
                                                                                padding: '0.4rem', 
                                                                                color: '#64748b', 
                                                                                cursor: 'pointer',
                                                                                transition: 'all 0.2s',
                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                                            }}
                                                                            onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#3b82f6'; }}
                                                                            onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#64748b'; }}
                                                                            title="Visualizar Detalhes"
                                                                        >
                                                                            <Eye size={16} />
                                                                        </button>
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
                                                        })
                                                    )}
                                                </>
                                            );
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
                            {showTechnicalDetails && (
                                <div style={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
                                    gap: '1.5rem',
                                    animation: 'slideDown 0.3s ease-out',
                                    marginBottom: '2rem',
                                    padding: '1.5rem',
                                    background: '#f8fafc',
                                    borderRadius: '16px',
                                    border: '1px solid #e2e8f0'
                                }}>
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
                            </div>
                        )}

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
                                        usinaId={usina?.id}
                                        selectedUCs={selectedUCs}
                                        onCalculate={handleChartCalculation}
                                    />
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
                                        {(() => {
                                            const faturamentoPago = monthlyDetails?.faturamento_pago || 0;
                                            const totalContasEnergia = monthlyDetails?.custo_disponibilidade || 0;
                                            const subtotal = faturamentoPago - totalContasEnergia;
                                            const gestaoPercentual = Number(formData.gestao_percentual) || 0;
                                            const gestaoTaxa = subtotal * (gestaoPercentual / 100);
                                            const outrosServicos = (monthlyDetails?.manutencao || 0) + 
                                                                   (monthlyDetails?.arrendamento || 0) + 
                                                                   (monthlyDetails?.servicos || 0);
                                            const totalServicos = gestaoTaxa + outrosServicos;
                                            const saldoAReceber = subtotal - totalServicos;

                                            return (
                                                <>
                                                    {/* Header Row (Mês de Referência + Saldo a Receber) */}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', background: '#f8fafc', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
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
                                                                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.1rem', fontWeight: 600 }}>
                                                                    {(() => {
                                                                        const baseDate = parseISO(`${referenceMonth}-01`);
                                                                        const mainUG = selectedUCs.find(uc => uc.numero_uc === formData.unidade_geradora) || availableUCs.find(uc => uc.numero_uc === formData.unidade_geradora);
                                                                        const diaLeitura = formData.dia_leitura || mainUG?.dia_leitura;

                                                                        if (!diaLeitura) {
                                                                            return `01/${format(baseDate, 'MM/yyyy')} a ${format(endOfMonth(baseDate), 'dd/MM/yyyy')}`;
                                                                        }
                                                                        const day = parseInt(diaLeitura);
                                                                        const endD = new Date(baseDate.getFullYear(), baseDate.getMonth(), day);
                                                                        const startD = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, day + 1);
                                                                        return `${format(startD, 'dd/MM/yyyy')} a ${format(endD, 'dd/MM/yyyy')}`;
                                                                    })()}
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

                                                        <div style={{ textAlign: 'right', padding: '0.5rem 1.25rem', background: '#eff6ff', borderRadius: '14px', border: '1px solid #bfdbfe', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                                                            <span style={{ fontSize: '0.72rem', color: '#1e3a8a', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>Saldo a Receber</span>
                                                            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                                {formatCurrency(saldoAReceber)}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Grid Row (2 columns: left is Operations + Status breakdown, right is Services + totalServicos in footer) */}
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem', alignItems: 'start', marginBottom: '1.5rem' }}>
                                                        {/* Coluna Esquerda: Dados de Operação + Detalhamento de Faturamento */}
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                                            {/* Card: Dados de Operação e Performance */}
                                                            <div style={{ background: 'white', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                                                <h4 style={{ margin: '0 0 1.25rem 0', fontSize: '1rem', color: '#1e293b', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                    <div style={{ padding: '0.5rem', background: '#f0fdf4', borderRadius: '10px', color: '#16a34a' }}>
                                                                        <Activity size={20} />
                                                                    </div>
                                                                    Dados de Operação e Performance
                                                                </h4>
                                                                
                                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                                                    <div>
                                                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>Geração Mensal - Energia Injetada (kWh)</label>
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
                                                                    <div style={{ gridColumn: 'span 2' }}>
                                                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>Energia Compensada nas UCs (kWh)</label>
                                                                        <input 
                                                                            type="number"
                                                                            value={monthlyDetails?.energia_compensada || ''}
                                                                            onChange={e => setMonthlyDetails({...monthlyDetails, energia_compensada: Number(e.target.value)})}
                                                                            placeholder="0"
                                                                            style={{ width: '100%', padding: '0.6rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, color: '#1e293b', outline: 'none' }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Card: Faturamento Bruto Total no Período */}
                                                            <div style={{ background: '#f0fdf4', borderRadius: '20px', border: '1.5px solid #bbf7d0', padding: '1.25rem 1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#166534' }}>Faturamento Bruto Total no Período:</span>
                                                                <span style={{ fontSize: '1.35rem', fontWeight: 900, color: '#166534' }}>{formatCurrency(monthlyDetails?.faturamento_mensal || 0)}</span>
                                                            </div>

                                                            {/* Card: Detalhamento do Faturamento por Status */}
                                                            <div style={{ background: 'white', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                                                <h4 style={{ margin: '0 0 1.25rem 0', fontSize: '1rem', color: '#1e293b', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                    <div style={{ padding: '0.5rem', background: '#fff7ed', borderRadius: '10px', color: '#ea580c' }}>
                                                                        <CreditCard size={20} />
                                                                    </div>
                                                                    Detalhamento de Receitas do Período
                                                                </h4>
                                                                
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                                    {/* Breakdown rows */}
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '10px', borderLeft: '4px solid #3b82f6' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6' }} />
                                                                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>Faturamento A Vencer:</span>
                                                                        </div>
                                                                        <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1e293b' }}>{formatCurrency(monthlyDetails?.faturamento_a_vencer || 0)}</span>
                                                                    </div>

                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '10px', borderLeft: '4px solid #16a34a' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a' }} />
                                                                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>Faturamento Pago:</span>
                                                                        </div>
                                                                        <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1e293b' }}>{formatCurrency(faturamentoPago)}</span>
                                                                    </div>

                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '10px', borderLeft: '4px solid #94a3b8' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94a3b8' }} />
                                                                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>Sem Faturamento:</span>
                                                                        </div>
                                                                        <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1e293b' }}>{formatCurrency(monthlyDetails?.faturamento_sem_faturamento || 0)}</span>
                                                                    </div>

                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '10px', borderLeft: '4px solid #dc2626' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#dc2626' }} />
                                                                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>Faturamento Atrasado:</span>
                                                                        </div>
                                                                        <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1e293b' }}>{formatCurrency(monthlyDetails?.faturamento_atrasado || 0)}</span>
                                                                    </div>

                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#fef2f2', borderRadius: '10px', border: '1px dashed #fca5a5' }}>
                                                                        <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#991b1b' }}>(-) Contas de Energia no Período:</span>
                                                                        <span style={{ fontSize: '0.95rem', fontWeight: 900, color: '#991b1b' }}>{formatCurrency(totalContasEnergia)}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Coluna Direita: Extrato Detalhado de Lançamentos */}
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                                            <div style={{ background: 'white', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', minHeight: '425px', justifyContent: 'space-between' }}>
                                                                <div>
                                                                    <h4 style={{ margin: '0 0 1.25rem 0', fontSize: '1rem', color: '#1e293b', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                        <div style={{ padding: '0.5rem', background: '#eff6ff', borderRadius: '10px', color: '#3b82f6' }}>
                                                                            <FileText size={20} />
                                                                        </div>
                                                                        Extrato Detalhado de Lançamentos
                                                                    </h4>

                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '300px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                                                                        {/* Row: Gestão */}
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6' }} />
                                                                                <span style={{ fontWeight: 700, color: '#475569', fontSize: '0.85rem' }}>Gestão B2W ({gestaoPercentual}%)</span>
                                                                            </div>
                                                                            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#1e293b' }}>{formatCurrency(gestaoTaxa)}</span>
                                                                        </div>

                                                                        {/* Row: Manutenção */}
                                                                        {(monthlyDetails?.manutencao > 0) && (
                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
                                                                                    <span style={{ fontWeight: 700, color: '#475569', fontSize: '0.85rem' }}>Manutenção</span>
                                                                                </div>
                                                                                <div style={{ position: 'relative', width: '100px' }}>
                                                                                    <span style={{ position: 'absolute', left: '0.4rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>R$</span>
                                                                                    <input 
                                                                                        type="text"
                                                                                        value={formatCurrency(monthlyDetails?.manutencao).replace('R$', '').trim()}
                                                                                        onChange={e => setMonthlyDetails({...monthlyDetails, manutencao: parseCurrency(e.target.value)})}
                                                                                        style={{ width: '100%', padding: '0.3rem 0.4rem 0.3rem 1.6rem', border: 'none', background: 'white', borderRadius: '6px', textAlign: 'right', fontWeight: 800, color: '#1e293b', fontSize: '0.85rem', outline: 'none' }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Row: Arrendamento */}
                                                                        {(monthlyDetails?.arrendamento > 0) && (
                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }} />
                                                                                    <span style={{ fontWeight: 700, color: '#475569', fontSize: '0.85rem' }}>Arrendamento</span>
                                                                                </div>
                                                                                <div style={{ position: 'relative', width: '100px' }}>
                                                                                    <span style={{ position: 'absolute', left: '0.4rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>R$</span>
                                                                                    <input 
                                                                                        type="text"
                                                                                        value={formatCurrency(monthlyDetails?.arrendamento).replace('R$', '').trim()}
                                                                                        onChange={e => setMonthlyDetails({...monthlyDetails, arrendamento: parseCurrency(e.target.value)})}
                                                                                        style={{ width: '100%', padding: '0.3rem 0.4rem 0.3rem 1.6rem', border: 'none', background: 'white', borderRadius: '6px', textAlign: 'right', fontWeight: 800, color: '#1e293b', fontSize: '0.85rem', outline: 'none' }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Individualized Services */}
                                                                        {Object.keys(monthlyDetails?.details || {}).map((serv) => {
                                                                            const val = monthlyDetails?.details?.[serv] || 0;
                                                                            if (val <= 0 || ['Manutenção', 'Arrendamento', 'Gestão'].includes(serv)) return null;
                                                                            return (
                                                                                <div key={serv} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#64748b' }} />
                                                                                        <span style={{ fontWeight: 700, color: '#475569', fontSize: '0.85rem' }}>
                                                                                            {serv === 'Energia' ? 'Energia - Custo de Disponibilidade' : serv}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div style={{ position: 'relative', width: '100px' }}>
                                                                                        <span style={{ position: 'absolute', left: '0.4rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>R$</span>
                                                                                        <input 
                                                                                            type="text"
                                                                                            value={formatCurrency(val).replace('R$', '').trim()}
                                                                                            onChange={e => {
                                                                                                const newVal = parseCurrency(e.target.value);
                                                                                                const newDetails = { ...(monthlyDetails?.details || {}), [serv]: newVal };
                                                                                                const totalOthers = Object.values(newDetails).reduce((acc, curr) => acc + curr, 0);
                                                                                                setMonthlyDetails({
                                                                                                    ...monthlyDetails, 
                                                                                                    details: newDetails,
                                                                                                    servicos: totalOthers
                                                                                                });
                                                                                            }}
                                                                                            style={{ width: '100%', padding: '0.3rem 0.4rem 0.3rem 1.6rem', border: 'none', background: 'white', borderRadius: '6px', textAlign: 'right', fontWeight: 800, color: '#1e293b', fontSize: '0.85rem', outline: 'none' }}
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>

                                                                {/* Footer: Total de Serviços do Mês */}
                                                                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                                                                    <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Total de Serviços do Mês</span>
                                                                    <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#166534' }}>
                                                                        {formatCurrency(totalServicos)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Status and Action centered at the bottom of the page */}
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginTop: '2rem', width: '100%' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', width: '100%', maxWidth: '600px', padding: '1.25rem 2rem', background: monthlyDetails?.status === 'liquidado' ? '#f0fdf4' : '#fff7ed', borderRadius: '20px', border: `1px solid ${monthlyDetails?.status === 'liquidado' ? '#bbf7d0' : '#ffedd5'}`, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', justifyContent: 'space-between' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: monthlyDetails?.status === 'liquidado' ? '#166534' : '#9a3412', fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase' }}>
                                                                {monthlyDetails?.status === 'liquidado' ? <CheckCircle size={22} /> : <AlertCircle size={22} />} 
                                                                Status do Mês:
                                                            </div>
                                                            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: monthlyDetails?.status === 'liquidado' ? '#166534' : '#9a3412' }}>
                                                                {monthlyDetails?.status === 'liquidado' ? 'MÊS FECHADO' : 'PENDENTE DE FECHAMENTO'}
                                                            </div>
                                                            {monthlyDetails?.fechamento && (
                                                                <div style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 700 }}>
                                                                    Encerrado em: {new Date(monthlyDetails.fechamento).toLocaleDateString('pt-BR')}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <button 
                                                            type="button"
                                                            onClick={handleFechamento}
                                                            disabled={loading}
                                                            style={{ 
                                                                width: '100%',
                                                                maxWidth: '600px',
                                                                display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1.25rem 2rem', 
                                                                background: monthlyDetails?.status === 'liquidado' ? '#3b82f6' : '#16a34a', 
                                                                color: 'white', borderRadius: '20px', border: 'none', 
                                                                cursor: 'pointer', 
                                                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                                                opacity: loading ? 0.7 : 1
                                                            }}>
                                                            {monthlyDetails?.status === 'liquidado' ? <RefreshCcw size={28} /> : <CheckCircle size={28} />}
                                                            <div style={{ textAlign: 'left' }}>
                                                                <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>
                                                                    {monthlyDetails?.status === 'liquidado' ? 'Reenviar Lançamentos' : 'Efetuar Fechamento'}
                                                                </div>
                                                                <div style={{ fontSize: '0.75rem', opacity: 0.9, marginTop: '0.1rem' }}>
                                                                    Gravar lançamentos no Razão
                                                                </div>
                                                            </div>
                                                        </button>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Tab Content: UCs */}
                    {activeTab === 'ucs' && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                            <div style={{ padding: '0.6rem', background: (branding?.primary_color || '#3b82f6') + '10', borderRadius: '12px', color: branding?.primary_color || '#3b82f6' }}>
                                                <Link size={24} />
                                            </div>
                                            <h4 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b', fontWeight: 800 }}>Dashboard de Rateio</h4>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                                            <button
                                                type="button"
                                                onClick={() => setShowExpandedUCs(true)}
                                                style={{ 
                                                    padding: '0.6rem 1rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', 
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569'
                                                }}
                                            >
                                                <Maximize2 size={16} /> Gestor
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleCreateRateioCard}
                                                style={{ 
                                                    padding: '0.6rem 1.25rem', background: branding?.primary_color || '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', 
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', fontWeight: 700
                                                }}
                                            >
                                                <FileText size={16} /> Criar Lista de Rateio
                                            </button>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                                        {/* Card 1: Geração Comprometida */}
                                        <div style={{ gridColumn: 'span 2', background: '#f8fafc', padding: '1.25rem', borderRadius: '20px', border: '1px solid #f1f5f9' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', fontSize: '0.85rem', fontWeight: 800 }}>
                                                <span style={{ color: '#64748b' }}>Geração Comprometida</span>
                                                {(() => {
                                                    const pct = Math.min(100, (totalFranquiaVinculada / (formData.geracao_estimada_kwh || 1)) * 100);
                                                    const style = getCommitmentStyle(pct);
                                                    return (
                                                        <span style={{ color: style.color }}>{totalFranquiaVinculada.toFixed(0)} / {formData.geracao_estimada_kwh || 0} kWh</span>
                                                    );
                                                })()}
                                            </div>
                                            <div style={{ width: '100%', height: '10px', background: '#e2e8f0', borderRadius: '10px', overflow: 'hidden', display: 'flex', marginBottom: '0.75rem' }}>
                                                {(() => {
                                                    const pct = Math.min(100, (totalFranquiaVinculada / (formData.geracao_estimada_kwh || 1)) * 100);
                                                    const style = getCommitmentStyle(pct);
                                                    return (
                                                        <div style={{ 
                                                            width: `${pct}%`, height: '100%', background: style.gradient, borderRadius: '10px', transition: 'all 0.5s ease-out'
                                                        }} />
                                                    );
                                                })()}
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>
                                                    {formData.geracao_estimada_kwh > 0 ? 
                                                        `${((totalFranquiaVinculada / formData.geracao_estimada_kwh) * 100).toFixed(1)}% do potencial` : 
                                                        'Defina a geração estimada'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Card 2: Status Detalhado das UCs */}
                                        <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '20px', border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                <Users size={16} color="#64748b" />
                                                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Resumo de Unidades</span>
                                            </div>
                                            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#1e293b' }}>
                                                <span style={{ color: '#64748b', fontSize: '1rem', fontWeight: 600 }}>Unidades : </span> {ucStats.total}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.75rem' }}>
                                                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#166534', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }}></div>
                                                    {ucStats.ativos} Ativas - {ucStats.ativosKwh.toFixed(0)} kWh
                                                </div>
                                                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3b82f6' }}></div>
                                                    {ucStats.pendentes} Ag. Conexão - {ucStats.pendentesKwh.toFixed(0)} kWh
                                                </div>
                                                <div style={{ 
                                                    marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0', 
                                                    fontSize: '0.85rem', fontWeight: 800, color: branding?.primary_color || '#3b82f6',
                                                    display: 'flex', alignItems: 'center', gap: '0.4rem'
                                                }}>
                                                    <Zap size={14} /> DISPONÍVEL : {geracaoDisponivel.toFixed(0)} kWh
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Regra de Rateio Premium Selector */}
                                    <div style={{ 
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '1rem', 
                                        marginBottom: '2rem', 
                                        padding: '1.5rem', 
                                        background: '#f8fafc', 
                                        borderRadius: '24px', 
                                        border: '1px solid #e2e8f0',
                                        boxShadow: '0 4px 18px -4px rgba(0,0,0,0.03)'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <SlidersHorizontal size={18} color={branding?.primary_color || '#3b82f6'} />
                                                <span style={{ fontSize: '0.8rem', color: '#1e293b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Regra de Distribuição de Rateio</span>
                                            </div>
                                            <span style={{ fontSize: '0.72rem', color: branding?.primary_color || '#3b82f6', fontWeight: 700, background: `${branding?.primary_color || '#3b82f6'}15`, padding: '0.2rem 0.6rem', borderRadius: '20px' }}>
                                                {formData.rateio_type === 'prioridade' ? 'Modo Prioridade' : 'Modo Porcentagem'}
                                            </span>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.25rem' }}>
                                            {/* Option 1: Prioridade */}
                                            <div 
                                                onClick={() => setFormData({...formData, rateio_type: 'prioridade'})}
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '0.75rem',
                                                    padding: '1.25rem',
                                                    borderRadius: '16px',
                                                    border: `2px solid ${formData.rateio_type === 'prioridade' ? (branding?.primary_color || '#3b82f6') : '#e2e8f0'}`,
                                                    background: formData.rateio_type === 'prioridade' ? 'white' : 'transparent',
                                                    boxShadow: formData.rateio_type === 'prioridade' ? '0 10px 15px -3px rgba(0,0,0,0.05)' : 'none',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                                    position: 'relative',
                                                    overflow: 'hidden'
                                                }}
                                            >
                                                {formData.rateio_type === 'prioridade' && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        top: 0,
                                                        right: 0,
                                                        width: '24px',
                                                        height: '24px',
                                                        background: branding?.primary_color || '#3b82f6',
                                                        borderBottomLeftRadius: '12px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: 'white'
                                                    }}>
                                                        <Check size={12} strokeWidth={3} />
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <div style={{
                                                        width: '36px',
                                                        height: '36px',
                                                        borderRadius: '10px',
                                                        background: formData.rateio_type === 'prioridade' ? `${branding?.primary_color || '#3b82f6'}15` : '#f1f5f9',
                                                        color: formData.rateio_type === 'prioridade' ? (branding?.primary_color || '#3b82f6') : '#64748b',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        transition: 'all 0.2s'
                                                    }}>
                                                        <ArrowUpDown size={18} />
                                                    </div>
                                                    <div>
                                                        <h5 style={{ margin: 0, fontSize: '0.9rem', color: formData.rateio_type === 'prioridade' ? '#0f172a' : '#475569', fontWeight: 800 }}>Prioridade</h5>
                                                        <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>Sequencial Ordenado</span>
                                                    </div>
                                                </div>
                                                <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', lineHeight: '1.4', fontWeight: 500 }}>
                                                    Os créditos abastecem as UCs na ordem da lista. A próxima UC só recebe créditos se sobrar saldo da anterior.
                                                </p>
                                            </div>

                                            {/* Option 2: Porcentagem */}
                                            <div 
                                                onClick={() => setFormData({...formData, rateio_type: 'porcentagem'})}
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '0.75rem',
                                                    padding: '1.25rem',
                                                    borderRadius: '16px',
                                                    border: `2px solid ${formData.rateio_type === 'porcentagem' ? (branding?.primary_color || '#3b82f6') : '#e2e8f0'}`,
                                                    background: formData.rateio_type === 'porcentagem' ? 'white' : 'transparent',
                                                    boxShadow: formData.rateio_type === 'porcentagem' ? '0 10px 15px -3px rgba(0,0,0,0.05)' : 'none',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                                    position: 'relative',
                                                    overflow: 'hidden'
                                                }}
                                            >
                                                {formData.rateio_type === 'porcentagem' && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        top: 0,
                                                        right: 0,
                                                        width: '24px',
                                                        height: '24px',
                                                        background: branding?.primary_color || '#3b82f6',
                                                        borderBottomLeftRadius: '12px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: 'white'
                                                    }}>
                                                        <Check size={12} strokeWidth={3} />
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <div style={{
                                                        width: '36px',
                                                        height: '36px',
                                                        borderRadius: '10px',
                                                        background: formData.rateio_type === 'porcentagem' ? `${branding?.primary_color || '#3b82f6'}15` : '#f1f5f9',
                                                        color: formData.rateio_type === 'porcentagem' ? (branding?.primary_color || '#3b82f6') : '#64748b',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        transition: 'all 0.2s'
                                                    }}>
                                                        <Percent size={18} />
                                                    </div>
                                                    <div>
                                                        <h5 style={{ margin: 0, fontSize: '0.9rem', color: formData.rateio_type === 'porcentagem' ? '#0f172a' : '#475569', fontWeight: 800 }}>Porcentagem</h5>
                                                        <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>Proporcional Fixo</span>
                                                    </div>
                                                </div>
                                                <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', lineHeight: '1.4', fontWeight: 500 }}>
                                                    Cada UC recebe uma fatia fixa da geração (ex: 20%). Ideal para sócios ou parceiros com participações fixas definidas.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {loadingUCs ? (
                                        <div style={{ textAlign: 'center', padding: '4rem' }}>
                                            <RefreshCcw className="animate-spin" size={32} color={branding?.primary_color || '#3b82f6'} />
                                            <p style={{ marginTop: '1rem', color: '#64748b', fontWeight: 600 }}>Sincronizando unidades...</p>
                                        </div>
                                    ) : (
                                        <div style={{ maxHeight: '500px', overflowY: 'auto', paddingRight: '0.75rem' }} className="custom-scrollbar">
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

                    {/* Tab Content: Comunicados / Histórico */}
                    {activeTab === 'comunicacao' && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
                                {/* Send New Communication Section */}
                                <div style={{ 
                                    background: 'white', 
                                    padding: '2rem', 
                                    borderRadius: '16px', 
                                    border: '1px solid #e2e8f0',
                                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                                }}>
                                    <h4 style={{ margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#1e293b', fontSize: '1.1rem' }}>
                                        <MessageSquare size={20} color="#25D366" />
                                        Enviar Novo Comunicado (WhatsApp)
                                    </h4>

                                    <textarea
                                        value={manualMessage}
                                        onChange={(e) => setManualMessage(e.target.value)}
                                        placeholder="Digite a mensagem para o proprietário da usina..."
                                        style={{
                                            width: '100%',
                                            height: '140px',
                                            padding: '1rem',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '12px',
                                            fontSize: '0.95rem',
                                            outline: 'none',
                                            resize: 'vertical',
                                            marginBottom: '1.25rem',
                                            fontFamily: 'inherit',
                                            transition: 'border-color 0.2s'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#25D366'}
                                        onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                    />

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <label style={{ 
                                                display: 'flex', alignItems: 'center', gap: '0.5rem', 
                                                padding: '0.6rem 1.25rem', background: '#f1f5f9', 
                                                borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem',
                                                color: '#475569', fontWeight: 600, border: '1px solid #e2e8f0',
                                                transition: 'all 0.2s'
                                            }}>
                                                <Paperclip size={18} />
                                                {manualFile ? 'Alterar Arquivo' : 'Anexar Documento'}
                                                <input 
                                                    type="file" 
                                                    style={{ display: 'none' }} 
                                                    onChange={(e) => setManualFile(e.target.files[0])}
                                                />
                                            </label>
                                            {manualFile && (
                                                <div style={{ 
                                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                    fontSize: '0.85rem', color: '#0369a1', background: '#f0f9ff',
                                                    padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid #bae6fd'
                                                }}>
                                                    <span style={{ fontWeight: 600, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {manualFile.name}
                                                    </span>
                                                    <span style={{ opacity: 0.7 }}>({(manualFile.size / 1024).toFixed(0)} KB)</span>
                                                    <button 
                                                        type="button"
                                                        onClick={() => setManualFile(null)}
                                                        style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', padding: '2px' }}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={handleSendManualWhatsApp}
                                            disabled={isSendingManualWA || (!manualMessage.trim() && !manualFile)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '0.75rem',
                                                background: '#25D366', color: 'white', border: 'none',
                                                padding: '0.75rem 2rem', borderRadius: '10px',
                                                fontWeight: 800, cursor: (isSendingManualWA || (!manualMessage.trim() && !manualFile)) ? 'not-allowed' : 'pointer',
                                                opacity: (isSendingManualWA || (!manualMessage.trim() && !manualFile)) ? 0.7 : 1,
                                                boxShadow: '0 4px 12px rgba(37, 211, 102, 0.3)',
                                                transition: 'all 0.2s',
                                                fontSize: '1rem'
                                            }}
                                        >
                                            {isSendingManualWA ? <Loader2 size={20} className="spin-animation" /> : <Send size={20} />}
                                            {isSendingManualWA ? 'Enviando...' : 'Enviar Mensagem'}
                                        </button>
                                    </div>
                                    
                                    <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Info size={14} />
                                            Esta mensagem será enviada para o telefone cadastrado no proprietário da usina.
                                        </p>
                                    </div>
                                </div>

                                {/* History Section */}
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', paddingLeft: '0.5rem' }}>
                                        <History size={20} color="#64748b" />
                                        <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                                            Histórico de Comunicados e Eventos
                                        </h4>
                                    </div>
                                    <HistoryTimeline 
                                        entityType="usina"
                                        entityId={usina?.id}
                                        entityName={formData.name || usina?.name}
                                        isInline={true}
                                        refreshTrigger={historyRefreshKey}
                                    />
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
                                <div style={{ padding: '0.6rem', background: (branding?.primary_color || '#3b82f6') + '10', color: branding?.primary_color || '#3b82f6', borderRadius: '10px' }}>
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
                                {(() => {
                                    const map = {
                                        'ativo': { color: '#059669', bg: '#ecfdf5', label: 'Ativo' },
                                        'desconectado': { color: '#e11d48', bg: '#fff1f2', label: 'Desconectado' },
                                        'em_ativacao': { color: '#2563eb', bg: '#eff6ff', label: 'Em Ativação' },
                                        'vinculado': { color: '#4f46e5', bg: '#e0e7ff', label: 'Vinculado a Usina' },
                                        'ativacao': { color: '#2563eb', bg: '#eff6ff', label: 'Ativação' },
                                        'em_atraso': { color: '#d97706', bg: '#fffbeb', label: 'Em Atraso' },
                                        'cancelado': { color: '#475569', bg: '#f1f5f9', label: 'Cancelado' },
                                        'cancelado_inadimplente': { color: '#475569', bg: '#f1f5f9', label: 'Cancelado Inad.' },
                                        'aguardando_conexao': { color: branding?.primary_color || '#3b82f6', bg: (branding?.primary_color || '#3b82f6') + '10', label: 'Ag. Conexão' },
                                        'sem_geracao': { color: '#64748b', bg: '#f8fafc', label: 'Sem Geração' },
                                        'em_transf_titularidade': { color: '#0ea5e9', bg: '#f0f9ff', label: 'Transf. Titularidade' },
                                    };
                                    const s = map[previewUC.status] || { color: '#64748b', bg: '#f8fafc', label: previewUC.status?.replace(/_/g, ' ').toUpperCase() || 'N/A' };
                                    return (
                                        <span style={{ fontSize: '0.85rem', padding: '0.2rem 0.6rem', borderRadius: '20px', background: s.bg, color: s.color, fontWeight: 700 }}>
                                            {s.label.toUpperCase()}
                                        </span>
                                    );
                                })()}
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

                        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button
                                onClick={() => {
                                    setUcForInvoices(previewUC);
                                    setShowInvoicesModal(true);
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.5rem', background: (branding?.primary_color || '#3b82f6') + '10', color: branding?.primary_color || '#3b82f6', border: `1px solid ${branding?.primary_color || '#3b82f6'}`, borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                            >
                                <FileText size={18} /> Ver Faturas
                            </button>
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
                                            color: formData.rateio_type === 'prioridade' ? (branding?.primary_color || '#3b82f6') : '#64748b',
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
                                            color: formData.rateio_type === 'porcentagem' ? (branding?.primary_color || '#3b82f6') : '#64748b',
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
                                    <div style={{ fontSize: '0.7rem', color: '#059669', textTransform: 'uppercase', fontWeight: 700 }}>Disponível</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10b981' }}>{geracaoDisponivel.toFixed(0)} kWh</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Total de UCs</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#059669' }}>
                                        {selectedUCs.filter(u => u.status === 'ativo').length} / {selectedUCs.length}
                                    </div>
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

            {showInvoicesModal && ucForInvoices && (
                <UCInvoicesModal 
                    uc={ucForInvoices} 
                    onClose={() => setShowInvoicesModal(false)} 
                />
            )}

            {editingUC && (
                <ConsumerUnitModal
                    consumerUnit={editingUC}
                    onClose={() => setEditingUC(null)}
                    onSave={() => {
                        fetchLinkedUCs(usina.id);
                        fetchAvailableUCs();
                        setEditingUC(null);
                    }}
                    onDelete={() => {
                        fetchLinkedUCs(usina.id);
                        fetchAvailableUCs();
                        setEditingUC(null);
                    }}
                />
            )}

            {activeSupplierForModal && (
                <SupplierModal
                    supplier={activeSupplierForModal}
                    onClose={() => setActiveSupplierForModal(null)}
                    onSave={(updatedSupplier) => {
                        fetchSuppliers();
                        setActiveSupplierForModal(null);
                    }}
                    onDelete={(deletedId) => {
                        fetchSuppliers();
                        setFormData(prev => ({ ...prev, supplier_id: '' }));
                        setActiveSupplierForModal(null);
                    }}
                />
            )}
        </div>
    );
}
