import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, Calculator, DollarSign, Zap, AlertCircle, Ban, CheckCircle, Plus, X, Loader2, Download } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { parseInvoice, createAsaasCharge } from '../lib/api';
import { useBranding } from '../contexts/BrandingContext';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export default function StandaloneAnalysisModal({ isOpen, ucs, onClose, onSave }) {
    if (!isOpen) return null;

    const { profile } = useAuth();
    const { branding } = useBranding();
    const { showAlert, showConfirm } = useUI();

    // Passos do Modal: 'upload' | 'sandbox'
    const [step, setStep] = useState('upload');
    const [selectedUcId, setSelectedUcId] = useState('');
    const [selectedUc, setSelectedUc] = useState(null);
    const [pdfFile, setPdfFile] = useState(null);
    
    // UCs completas (com todos os status) e estados de pesquisa
    const [allUcs, setAllUcs] = useState([]);
    const [isLoadingUcs, setIsLoadingUcs] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);

    // Carrega todas as UCs sem restrição de status
    useEffect(() => {
        const fetchAllUcs = async () => {
            setIsLoadingUcs(true);
            try {
                const { data, error } = await supabase
                    .from('consumer_units')
                    .select(`
                        id, numero_uc, concessionaria, titular_conta, status,
                        tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento,
                        subscribers!consumer_units_subscriber_id_fkey(name),
                        titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name)
                    `)
                    .order('titular_conta');
                if (error) throw error;
                setAllUcs(data || []);
            } catch (err) {
                console.error("Erro ao buscar todas as UCs no sandbox:", err);
                setAllUcs(ucs || []);
            } finally {
                setIsLoadingUcs(false);
            }
        };

        if (isOpen) {
            fetchAllUcs();
        }
    }, [isOpen, ucs]);

    // Fecha o dropdown ao clicar fora
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Limpa estados ao fechar o modal
    useEffect(() => {
        if (!isOpen) {
            handleReset();
        }
    }, [isOpen]);

    // Status e micro-interações do loader
    const [isParsing, setIsParsing] = useState(false);
    const [loaderMessage, setLoaderMessage] = useState('Processando PDF...');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form data no Sandbox (Auditada)
    const [formData, setFormData] = useState({
        mes_referencia: new Date().toISOString().substring(0, 7), // YYYY-MM
        vencimento: '',
        data_leitura: '',
        consumo_kwh: '',
        consumo_compensado: '',
        consumo_reais: '',
        iluminacao_publica: '',
        outros_lancamentos: '',
        linha_digitavel: '',
        pix_string: '',
        valor_concessionaria: '',
        desconto_aplicado: ''
    });

    // Simulações Calculadas
    const [simulation, setSimulation] = useState({
        tarifaEfetiva: 0,
        economiaGerada: 0,
        tarifaMinimaExcedentes: 0,
        energiaCompensadaReais: 0,
        valorAPagar: 0
    });

    // Helpers de Formatação
    const formatCurrency = (val) => {
        if (!val && val !== 0) return 'R$ 0,00';
        return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const parseCurrency = (str) => {
        if (!str) return 0;
        if (typeof str === 'number') return str;
        const isNegative = str.includes('-');
        const digits = str.replace(/\D/g, '');
        const value = Number(digits) / 100;
        return isNegative ? -value : value;
    };

    // Filtros e badge de status da pesquisa de UCs
    const filteredUcs = allUcs.filter(uc => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        
        const numeroUcMatches = uc.numero_uc?.toLowerCase().includes(term);
        const titularMatches = uc.titular_conta?.toLowerCase().includes(term);
        const subscriberMatches = uc.subscribers?.name?.toLowerCase().includes(term);
        const titularFaturaMatches = uc.titular_fatura?.name?.toLowerCase().includes(term);
        
        return numeroUcMatches || titularMatches || subscriberMatches || titularFaturaMatches;
    });

    const getStatusLabelAndColor = (status) => {
        switch (String(status).toLowerCase()) {
            case 'ativo':
                return { label: 'Ativo', bg: '#ecfdf5', color: '#059669' };
            case 'desconectado':
                return { label: 'Desconectado', bg: '#fef3c7', color: '#d97706' };
            case 'cancelado':
                return { label: 'Cancelado', bg: '#fef2f2', color: '#dc2626' };
            default:
                return { label: status || 'Outro', bg: '#f1f5f9', color: '#64748b' };
        }
    };

    const handleSelectUc = (uc) => {
        setSelectedUcId(uc.id);
        setSelectedUc(uc);
        setSearchTerm(`UC: ${uc.numero_uc} - ${uc.titular_conta}`);
        setIsDropdownOpen(false);
        setFormData(prev => ({
            ...prev,
            desconto_aplicado: uc.desconto_assinante || 0
        }));
    };

    // Atualiza a UC selecionada
    useEffect(() => {
        if (selectedUcId && allUcs) {
            const uc = allUcs.find(u => u.id === selectedUcId);
            setSelectedUc(uc);
            if (uc) {
                setFormData(prev => ({
                    ...prev,
                    desconto_aplicado: uc.desconto_assinante || 0
                }));
            }
        } else {
            setSelectedUc(null);
        }
    }, [selectedUcId, allUcs]);

    // Data automática de vencimento
    useEffect(() => {
        if (selectedUc && formData.mes_referencia && !formData.vencimento) {
            const [year, month] = formData.mes_referencia.split('-').map(Number);
            const dueDay = selectedUc.dia_vencimento;

            if (dueDay) {
                let nextMonth = month + 1;
                let nextYear = year;
                if (nextMonth > 12) {
                    nextMonth = 1;
                    nextYear++;
                }
                const dateObj = new Date(nextYear, nextMonth - 1, dueDay);
                const formattedDate = dateObj.toISOString().split('T')[0];
                setFormData(prev => ({ ...prev, vencimento: formattedDate }));
            }
        }
    }, [formData.mes_referencia, selectedUc]);

    // Recálculo dinâmico da simulação
    useEffect(() => {
        if (selectedUc) {
            const consumo = Number(formData.consumo_kwh) || 0;
            const compensado = Number(formData.consumo_compensado) || 0;
            const tarifaUC = Number(selectedUc.tarifa_concessionaria) || 0;

            const desconto = formData.desconto_aplicado !== '' 
                ? Number(formData.desconto_aplicado) 
                : Number(selectedUc.desconto_assinante || 0);

            const multiplier = desconto > 1 ? desconto / 100 : desconto;

            // Cálculos operacionais idênticos às regras de faturamento
            const tarifaMinimaExcedentes = Math.max(0, (consumo - compensado) * tarifaUC);
            const energiaCompensadaReais = compensado * tarifaUC * (1 - multiplier);
            const economiaGerada = compensado * tarifaUC * multiplier;

            const ip = typeof formData.iluminacao_publica === 'string' ? parseCurrency(formData.iluminacao_publica) : (Number(formData.iluminacao_publica) || 0);
            const outros = typeof formData.outros_lancamentos === 'string' ? parseCurrency(formData.outros_lancamentos) : (Number(formData.outros_lancamentos) || 0);
            const concessionariaVal = typeof formData.valor_concessionaria === 'string' ? parseCurrency(formData.valor_concessionaria) : (Number(formData.valor_concessionaria) || 0);

            let valorAPagar = 0;
            if (compensado > 0) {
                valorAPagar = energiaCompensadaReais + tarifaMinimaExcedentes + ip + outros;
            } else {
                valorAPagar = concessionariaVal;
            }

            // Tarifa Efetiva = Consumo em Reais / Consumo Kwh
            const consumoReaisVal = typeof formData.consumo_reais === 'string' ? parseCurrency(formData.consumo_reais) : (Number(formData.consumo_reais) || 0);
            const tarifaEfetiva = consumo > 0 ? (consumoReaisVal / consumo) : 0;

            setSimulation({
                tarifaEfetiva,
                economiaGerada,
                tarifaMinimaExcedentes,
                energiaCompensadaReais,
                valorAPagar
            });
        }
    }, [
        formData.consumo_kwh,
        formData.consumo_compensado,
        formData.consumo_reais,
        formData.iluminacao_publica,
        formData.outros_lancamentos,
        formData.valor_concessionaria,
        formData.desconto_aplicado,
        selectedUc
    ]);

    const handlePdfChange = (e) => {
        const file = e.target.files[0];
        if (file) setPdfFile(file);
    };

    const triggerUpload = async () => {
        if (!pdfFile || !selectedUcId) {
            showAlert('Por favor, selecione uma UC e faça o upload do PDF.', 'warning');
            return;
        }

        setIsParsing(true);
        setLoaderMessage('Enviando conta para processamento...');

        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = reader.result;
                try {
                    setLoaderMessage('Extraindo dados via IA/OCR...');
                    const parsedData = await parseInvoice(base64);

                    let extractedCompensado = parsedData.consumo_compensado;

                    // Fallback local se a Edge Function retornar compensado nulo/zero
                    if (!extractedCompensado) {
                        try {
                            setLoaderMessage('Executando validação de redundância...');
                            const pdf = await pdfjsLib.getDocument({ data: atob(base64.split(',')[1] || base64) }).promise;
                            let fullText = "";
                            for (let i = 1; i <= Math.min(pdf.numPages, 2); i++) {
                                const page = await pdf.getPage(i);
                                const textContent = await page.getTextContent();
                                fullText += textContent.items.map(s => s.str).join(" ") + "\n";
                            }
                            const cleanText = fullText.replace(/\s+/g, ' ');
                            const parseValue = (v) => v ? parseFloat(v.replace('.', '').replace(',', '.')) : 0;

                            const compensadoMatches = cleanText.match(/G\dComp\..*?\-TE\s+kWh\s+([\d,.]+)-/gi);
                            let totalCompensado = 0;
                            if (compensadoMatches) {
                                compensadoMatches.forEach(match => {
                                    const valMatch = match.match(/([\d,.]+)-/);
                                    if (valMatch) totalCompensado += parseValue(valMatch[1]);
                                });
                            } else {
                                const compensadoMatch = cleanText.match(/(?:Energia\sCompensada|GX\sCOMP|GXCOMP|Consumo\sCompensado).*?([\d,.]+)\s*kWh/i);
                                if (compensadoMatch) totalCompensado = parseValue(compensadoMatch[1]);
                            }

                            if (totalCompensado > 0) {
                                extractedCompensado = totalCompensado;
                            }
                        } catch (fallbackErr) {
                            console.warn('Erro ao rodar o fallback local:', fallbackErr);
                        }
                    }

                    // Preenche os dados extraídos no Passo B
                    setFormData(prev => ({
                        ...prev,
                        mes_referencia: parsedData.mes_referencia ? parsedData.mes_referencia.substring(0, 7) : prev.mes_referencia,
                        vencimento: parsedData.vencimento ? parsedData.vencimento.split('T')[0] : prev.vencimento,
                        data_leitura: parsedData.data_leitura ? parsedData.data_leitura.split('T')[0] : '',
                        valor_concessionaria: parsedData.valor_a_pagar !== undefined && parsedData.valor_a_pagar !== null ? formatCurrency(parsedData.valor_a_pagar) : (parsedData.valorTotal ? formatCurrency(parsedData.valorTotal) : ''),
                        consumo_kwh: parsedData.consumo_kwh !== undefined ? parsedData.consumo_kwh : '',
                        consumo_compensado: extractedCompensado !== undefined ? extractedCompensado : '',
                        consumo_reais: parsedData.consumo_reais !== undefined ? formatCurrency(parsedData.consumo_reais) : formatCurrency(parsedData.valorTotal || 0),
                        iluminacao_publica: parsedData.iluminacao_publica ? formatCurrency(parsedData.iluminacao_publica) : '',
                        outros_lancamentos: parsedData.outros_lancamentos ? formatCurrency(parsedData.outros_lancamentos) : '',
                        linha_digitavel: parsedData.linha_digitavel || '',
                        pix_string: parsedData.pix_string || '',
                        valor_concessionaria: parsedData.valorTotal || parsedData.valor_concessionaria || ''
                    }));

                    showAlert('Conta processada com sucesso!', 'success');
                    setStep('sandbox');
                } catch (err) {
                    console.error('Erro de OCR/Extração:', err);
                    showAlert('Falha na leitura automática: ' + err.message, 'error');
                } finally {
                    setIsParsing(false);
                }
            };
            reader.readAsDataURL(pdfFile);
        } catch (error) {
            console.error('Erro na leitura do arquivo:', error);
            setIsParsing(false);
            showAlert('Erro ao abrir arquivo selecionado.', 'error');
        }
    };

    const handleCurrencyInputChange = (field, value) => {
        const isNegative = value.includes('-');
        const digits = value.replace(/\D/g, '');
        let number = Number(digits) / 100;
        if (isNegative) number = -number;
        
        const formatted = number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        setFormData(prev => ({ ...prev, [field]: formatted }));
    };

    function handleReset() {
        setPdfFile(null);
        setSelectedUcId('');
        setSearchTerm('');
        setIsDropdownOpen(false);
        setStep('upload');
        setFormData({
            mes_referencia: new Date().toISOString().substring(0, 7),
            vencimento: '',
            data_leitura: '',
            consumo_kwh: '',
            consumo_compensado: '',
            consumo_reais: '',
            iluminacao_publica: '',
            outros_lancamentos: '',
            linha_digitavel: '',
            pix_string: '',
            valor_concessionaria: '',
            desconto_aplicado: ''
        });
    }

    // Persistência no Banco
    const saveInvoice = async (saveStatus) => {
        if (isSubmitting) return;
        setIsSubmitting(true);

        const ip = typeof formData.iluminacao_publica === 'string' ? parseCurrency(formData.iluminacao_publica) : (Number(formData.iluminacao_publica) || 0);
        const outros = typeof formData.outros_lancamentos === 'string' ? parseCurrency(formData.outros_lancamentos) : (Number(formData.outros_lancamentos) || 0);
        const concessionariaVal = typeof formData.valor_concessionaria === 'string' ? parseCurrency(formData.valor_concessionaria) : (Number(formData.valor_concessionaria) || Number(formData.consumo_reais) || 0);

        const payload = {
            uc_id: selectedUcId,
            mes_referencia: `${formData.mes_referencia}-01`,
            vencimento: formData.vencimento || null,
            data_leitura: formData.data_leitura || null,
            consumo_kwh: Number(formData.consumo_kwh) || 0,
            consumo_compensado: Number(formData.consumo_compensado) || 0,
            consumo_reais: simulation.energiaCompensadaReais + simulation.tarifaMinimaExcedentes,
            iluminacao_publica: ip,
            tarifa_minima: simulation.tarifaMinimaExcedentes,
            outros_lancamentos: outros,
            valor_a_pagar: simulation.valorAPagar,
            valor_concessionaria: concessionariaVal,
            economia_reais: simulation.economiaGerada,
            linha_digitavel: formData.linha_digitavel || null,
            pix_string: formData.pix_string || null,
            desconto_aplicado: formData.desconto_aplicado !== '' ? Number(formData.desconto_aplicado) : Number(selectedUc?.desconto_assinante || 0),
            energy_bill_status: saveStatus === 'sem_faturamento' ? 'pago' : 'pendente', // Operacional avulso pré-setado
            status: saveStatus
        };

        try {
            const { data, error } = await supabase.from('invoices').insert(payload).select().single();
            if (error) throw error;

            if (saveStatus === 'a_vencer' && data) {
                showAlert('Fatura ativa criada localmente! Gerando boleto de faturamento...', 'info');
                try {
                    await createAsaasCharge(data.id, 'invoice');
                    showAlert('Fatura cadastrada e boleto gerado no Asaas com sucesso!', 'success');
                } catch (asaasErr) {
                    console.error('Erro na emissão automática do Asaas:', asaasErr);
                    showAlert('Fatura cadastrada, mas houve uma falha ao gerar cobrança no gateway: ' + asaasErr.message, 'warning');
                }
            } else {
                showAlert('Conta registrada com sucesso (Operacional Sem Cobrança)!', 'success');
            }

            if (onSave) onSave();
            onClose();
        } catch (err) {
            console.error('Erro ao registrar no banco:', err);
            showAlert('Erro ao registrar fatura no banco de dados: ' + err.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Validador inteligente de Alertas
    const rendersAlerts = () => {
        const ip = typeof formData.iluminacao_publica === 'string' ? parseCurrency(formData.iluminacao_publica) : (Number(formData.iluminacao_publica) || 0);
        const outros = typeof formData.outros_lancamentos === 'string' ? parseCurrency(formData.outros_lancamentos) : (Number(formData.outros_lancamentos) || 0);
        const consumoReaisVal = typeof formData.consumo_reais === 'string' ? parseCurrency(formData.consumo_reais) : (Number(formData.consumo_reais) || 0);
        const totalFaturaVal = typeof formData.valor_concessionaria === 'string' ? parseCurrency(formData.valor_concessionaria) : (Number(formData.valor_concessionaria) || 0);

        const calculatedConcessionariaSum = consumoReaisVal + ip + outros;
        const diffSum = Math.abs(calculatedConcessionariaSum - totalFaturaVal);

        const diffTariff = selectedUc ? Math.abs(simulation.tarifaEfetiva - Number(selectedUc.tarifa_concessionaria)) : 0;

        const consumo = Number(formData.consumo_kwh) || 0;
        const compensado = Number(formData.consumo_compensado) || 0;

        const alerts = [];

        if (compensado === 0) {
            alerts.push({
                type: 'compensation',
                message: `Ausência de Compensação: A fatura não apresenta energia compensada. O boleto do assinante será gerado com o valor integral da concessionária.`
            });
        } else if (compensado < consumo) {
            alerts.push({
                type: 'compensation',
                message: `Compensação Parcial: A energia compensada (${compensado} kWh) é menor que o consumo total (${consumo} kWh).`
            });
        }

        if (selectedUc && diffTariff > 0.02) {
            alerts.push({
                type: 'tariff',
                message: `Divergência de Tarifa: A tarifa efetiva cobrada no PDF (${formatCurrency(simulation.tarifaEfetiva)}/kWh) difere da tarifa base configurada na UC (${formatCurrency(selectedUc.tarifa_concessionaria)}/kWh).`
            });
        }

        if (totalFaturaVal > 0 && diffSum > 0.50) {
            alerts.push({
                type: 'sum',
                message: `Divergência de Totais: O valor total informado na fatura (${formatCurrency(totalFaturaVal)}) diverge da soma dos lançamentos (Consumo + IP + Outros = ${formatCurrency(calculatedConcessionariaSum)}).`
            });
        }

        if (alerts.length === 0) return null;

        return (
            <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', padding: '1rem', borderRadius: '12px', marginTop: '1rem' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#b45309', fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    <AlertCircle size={16} /> Validador Inteligente (Alertas Sandbox)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {alerts.map((al, idx) => (
                        <div key={idx} style={{ fontSize: '0.8rem', color: '#b45309', fontWeight: 500, lineHeight: 1.4 }}>
                            • {al.message}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.65)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, backdropFilter: 'blur(6px)' }}>
            <div style={{ background: '#f8fafc', borderRadius: '24px', width: '95%', maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)', display: 'flex', flexDirection: 'column' }}>
                
                {/* Header */}
                <div style={{ padding: '1.5rem', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: '24px', borderTopRightRadius: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ background: 'var(--color-blue-light, #eff6ff)', color: 'var(--color-blue, #2563eb)', padding: '0.5rem', borderRadius: '12px' }}>
                            <Calculator size={24} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '1.2rem', color: '#0f172a', fontWeight: 800 }}>Sandbox de Análise Avulsa</h3>
                            <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>Simulador de faturamento e auditoria operacional de contas da concessionária</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', transition: 'color 0.2s' }}>
                        <X size={24} />
                    </button>
                </div>

                {/* Progress Animation Loading */}
                {isParsing && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', gap: '1.5rem', background: 'white' }}>
                        <Loader2 size={48} className="animate-spin" style={{ color: branding?.primary_color || '#2563eb' }} />
                        <div style={{ textAlign: 'center' }}>
                            <h4 style={{ fontWeight: 800, color: '#1e293b', fontSize: '1.1rem', marginBottom: '0.25rem' }}>Analisando Documento</h4>
                            <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>{loaderMessage}</p>
                        </div>
                    </div>
                )}

                {!isParsing && (
                    <>
                        {/* Passo A: Upload & Identificação */}
                        {step === 'upload' && (
                            <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div style={{ position: 'relative' }} ref={dropdownRef}>
                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                        Unidade Consumidora (UC) *
                                    </label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type="text"
                                            placeholder="Pesquise por Número da UC ou Nome do Assinante..."
                                            value={searchTerm}
                                            onChange={(e) => {
                                                setSearchTerm(e.target.value);
                                                setIsDropdownOpen(true);
                                                if (selectedUcId) {
                                                    setSelectedUcId('');
                                                }
                                            }}
                                            onFocus={() => setIsDropdownOpen(true)}
                                            style={{ 
                                                width: '100%', 
                                                padding: '0.85rem 2.5rem 0.85rem 0.85rem', 
                                                border: '1px solid #cbd5e1', 
                                                borderRadius: '12px', 
                                                fontSize: '0.95rem', 
                                                background: 'white',
                                                boxSizing: 'border-box'
                                            }}
                                        />
                                        {searchTerm && (
                                            <button 
                                                type="button"
                                                onClick={() => {
                                                    setSearchTerm('');
                                                    setSelectedUcId('');
                                                }}
                                                style={{ 
                                                    position: 'absolute', 
                                                    right: '12px', 
                                                    top: '50%', 
                                                    transform: 'translateY(-50%)', 
                                                    background: 'none', 
                                                    border: 'none', 
                                                    cursor: 'pointer',
                                                    color: '#94a3b8',
                                                    padding: 0,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                            >
                                                <X size={18} />
                                            </button>
                                        )}
                                    </div>
                                    
                                    {isDropdownOpen && (
                                        <div style={{ 
                                            position: 'absolute', 
                                            top: '100%', 
                                            left: 0, 
                                            right: 0, 
                                            background: 'white', 
                                            border: '1px solid #e2e8f0', 
                                            borderRadius: '12px', 
                                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)', 
                                            maxHeight: '220px', 
                                            overflowY: 'auto', 
                                            zIndex: 1000, 
                                            marginTop: '4px' 
                                        }}>
                                            {isLoadingUcs ? (
                                                <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.9rem', textAlign: 'center' }}>
                                                    Carregando UCs...
                                                </div>
                                            ) : filteredUcs.length === 0 ? (
                                                <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.9rem', textAlign: 'center' }}>
                                                    Nenhuma UC encontrada.
                                                </div>
                                            ) : (
                                                filteredUcs.map(uc => {
                                                    const subscriberName = uc.subscribers?.name || uc.titular_fatura?.name || '';
                                                    const statusBadge = getStatusLabelAndColor(uc.status);
                                                    return (
                                                        <div 
                                                            key={uc.id} 
                                                            onClick={() => handleSelectUc(uc)}
                                                            style={{ 
                                                                padding: '0.75rem 1rem', 
                                                                cursor: 'pointer', 
                                                                borderBottom: '1px solid #f1f5f9',
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '0.2rem',
                                                                background: selectedUcId === uc.id ? '#eff6ff' : 'white',
                                                                transition: 'background 0.2s',
                                                                textAlign: 'left'
                                                            }}
                                                            onMouseEnter={(e) => {
                                                                if (selectedUcId !== uc.id) {
                                                                    e.currentTarget.style.background = '#f8fafc';
                                                                }
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                if (selectedUcId !== uc.id) {
                                                                    e.currentTarget.style.background = 'white';
                                                                }
                                                            }}
                                                        >
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>
                                                                    UC: {uc.numero_uc}
                                                                </span>
                                                                <span style={{ 
                                                                    fontSize: '0.65rem', 
                                                                    fontWeight: 800, 
                                                                    padding: '0.1rem 0.4rem', 
                                                                    borderRadius: '99px',
                                                                    background: statusBadge.bg,
                                                                    color: statusBadge.color,
                                                                    textTransform: 'uppercase'
                                                                }}>
                                                                    {statusBadge.label}
                                                                </span>
                                                            </div>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b' }}>
                                                                <span>Titular: {uc.titular_conta}</span>
                                                                <span style={{ fontStyle: 'italic' }}>{uc.concessionaria}</span>
                                                            </div>
                                                            {subscriberName && (
                                                                <div style={{ fontSize: '0.7rem', color: '#2563eb', fontWeight: 600 }}>
                                                                    Assinante: {subscriberName}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div style={{ 
                                    border: '2px dashed #cbd5e1', 
                                    borderRadius: '16px', 
                                    padding: '3rem 2rem', 
                                    textAlign: 'center', 
                                    background: '#f8fafc',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                onClick={() => document.getElementById('sandbox-pdf-upload').click()}
                                >
                                    <input 
                                        id="sandbox-pdf-upload" 
                                        type="file" 
                                        accept="application/pdf" 
                                        onChange={handlePdfChange} 
                                        style={{ display: 'none' }} 
                                    />
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '50%', padding: '12px', color: '#64748b', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                            <Download size={32} />
                                        </div>
                                        {pdfFile ? (
                                            <div>
                                                <h4 style={{ fontWeight: 800, color: '#0f172a', margin: '0 0 0.25rem 0', fontSize: '0.95rem' }}>{pdfFile.name}</h4>
                                                <p style={{ color: '#2563eb', fontSize: '0.8rem', fontWeight: 600, margin: 0 }}>Clique para alterar o arquivo</p>
                                            </div>
                                        ) : (
                                            <div>
                                                <h4 style={{ fontWeight: 800, color: '#0f172a', margin: '0 0 0.25rem 0', fontSize: '0.95rem' }}>Upload da Conta da Concessionária</h4>
                                                <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>Clique ou arraste o arquivo PDF aqui para iniciar a extração automatizada</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                                    <button 
                                        onClick={onClose} 
                                        style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', color: '#64748b' }}
                                    >
                                        Cancelar
                                    </button>
                                    <button 
                                        onClick={triggerUpload}
                                        disabled={!pdfFile || !selectedUcId}
                                        style={{ 
                                            padding: '0.75rem 2rem', 
                                            borderRadius: '12px', 
                                            border: 'none', 
                                            background: (!pdfFile || !selectedUcId) ? '#94a3b8' : (branding?.primary_color || '#2563eb'), 
                                            color: 'white', 
                                            cursor: (!pdfFile || !selectedUcId) ? 'not-allowed' : 'pointer', 
                                            fontWeight: 800, 
                                            fontSize: '0.9rem',
                                            boxShadow: (!pdfFile || !selectedUcId) ? 'none' : '0 4px 10px rgba(37, 99, 235, 0.25)' 
                                        }}
                                    >
                                        Analisar Conta de Energia
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Passo B: Painel de Resultados */}
                        {step === 'sandbox' && (
                            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    
                                    {/* Coluna Concessionária */}
                                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem' }}>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b', fontWeight: 800, fontSize: '0.9rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                                            <FileText size={18} style={{ color: '#64748b' }} /> Concessionária (Valores Auditados)
                                        </h4>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Mês Referência</label>
                                                <input 
                                                    type="month" 
                                                    value={formData.mes_referencia} 
                                                    onChange={e => setFormData({ ...formData, mes_referencia: e.target.value })} 
                                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} 
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Vencimento</label>
                                                <input 
                                                    type="date" 
                                                    value={formData.vencimento} 
                                                    onChange={e => setFormData({ ...formData, vencimento: e.target.value })} 
                                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Consumo Total (kWh)</label>
                                                <input 
                                                    type="number" 
                                                    value={formData.consumo_kwh} 
                                                    onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })} 
                                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 'bold' }} 
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Energia Compensada (kWh)</label>
                                                <input 
                                                    type="number" 
                                                    value={formData.consumo_compensado} 
                                                    onChange={e => setFormData({ ...formData, consumo_compensado: e.target.value })} 
                                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 'bold' }} 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Consumo em Reais (R$)</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.consumo_reais} 
                                                    onChange={e => handleCurrencyInputChange('consumo_reais', e.target.value)} 
                                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} 
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Iluminação Pública</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.iluminacao_publica} 
                                                    onChange={e => handleCurrencyInputChange('iluminacao_publica', e.target.value)} 
                                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Taxa Mínima / Outros</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.outros_lancamentos} 
                                                    onChange={e => handleCurrencyInputChange('outros_lancamentos', e.target.value)} 
                                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} 
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Total Concessionária (Lido)</label>
                                                <input 
                                                    type="text" 
                                                    value={formatCurrency(formData.valor_concessionaria)} 
                                                    onChange={e => handleCurrencyInputChange('valor_concessionaria', e.target.value)} 
                                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 'bold', color: '#059669' }} 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '1rem', background: '#f8fafc', padding: '0.75rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                                                <span style={{ color: '#64748b', fontWeight: 600 }}>Tarifa Concessionária (Efetiva):</span>
                                                <span style={{ color: '#0f172a', fontWeight: 800 }}>{simulation.tarifaEfetiva.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4 })} / kWh</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                                                <span style={{ color: '#64748b', fontWeight: 600 }}>Tarifa Base da UC (Cadastro):</span>
                                                <span style={{ color: '#64748b', fontWeight: 600 }}>{formatCurrency(selectedUc?.tarifa_concessionaria || 0)} / kWh</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Coluna Simulação Assinante */}
                                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                        <div>
                                            <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b', fontWeight: 800, fontSize: '0.9rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                                                <Zap size={18} style={{ color: 'var(--color-orange, #f97316)' }} /> Assinante (Simulação Sandbox)
                                            </h4>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#faf5ff', border: '1px solid #f3e8ff', padding: '0.75rem 1rem', borderRadius: '12px' }}>
                                                    <div>
                                                        <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed' }}>Desconto Contratual</span>
                                                        <span style={{ fontSize: '0.85rem', color: '#6b21a8', fontWeight: 500 }}>Cadastrado na UC selecionada</span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <input 
                                                            type="number" 
                                                            value={formData.desconto_aplicado} 
                                                            onChange={e => setFormData({ ...formData, desconto_aplicado: e.target.value })}
                                                            style={{ width: '60px', padding: '0.35rem', borderRadius: '8px', border: '1px solid #d8b4fe', textAlign: 'center', fontWeight: 'bold', fontSize: '0.9rem' }} 
                                                        />
                                                        <span style={{ fontWeight: 800, color: '#7c3aed', fontSize: '1rem' }}>%</span>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ecfdf5', border: '1px solid #d1fae5', padding: '0.75rem 1rem', borderRadius: '12px' }}>
                                                    <div>
                                                        <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#059669' }}>Economia Gerada</span>
                                                        <span style={{ fontSize: '0.85rem', color: '#065f46', fontWeight: 500 }}>Valor poupado na conta</span>
                                                    </div>
                                                    <span style={{ fontWeight: 800, color: '#059669', fontSize: '1.2rem' }}>
                                                        {formatCurrency(simulation.economiaGerada)}
                                                    </span>
                                                </div>

                                                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b' }}>
                                                        <span>Custo Energia Compensada:</span>
                                                        <span>{formatCurrency(simulation.energiaCompensadaReais)}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b' }}>
                                                        <span>Tarifa Mínima/Excedente:</span>
                                                        <span>{formatCurrency(simulation.tarifaMinimaExcedentes)}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b' }}>
                                                        <span>Taxas Concessionária (IP/Outros):</span>
                                                        <span>{formatCurrency(parseCurrency(formData.iluminacao_publica) + parseCurrency(formData.outros_lancamentos))}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ 
                                            background: 'var(--color-orange-light, #fff7ed)', 
                                            border: '1.5px dashed var(--color-orange, #f97316)', 
                                            borderRadius: '16px', 
                                            padding: '1rem', 
                                            textAlign: 'center', 
                                            marginTop: '1.5rem'
                                        }}>
                                            <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-orange, #f97316)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Boleto Projetado do Assinante</span>
                                            <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-orange, #f97316)' }}>
                                                {formatCurrency(simulation.valorAPagar)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Seção de Alertas do Validador */}
                                {rendersAlerts()}

                                {/* Chaves de Pagamento */}
                                <div style={{ background: '#f1f5f9', padding: '1rem', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <h5 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Chaves de Pagamento da Concessionária</h5>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Linha Digitável</label>
                                            <input 
                                                type="text" 
                                                value={formData.linha_digitavel} 
                                                onChange={e => setFormData({ ...formData, linha_digitavel: e.target.value })} 
                                                placeholder="Código de barras da conta..." 
                                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} 
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>PIX Copia e Cola</label>
                                            <input 
                                                type="text" 
                                                value={formData.pix_string} 
                                                onChange={e => setFormData({ ...formData, pix_string: e.target.value })} 
                                                placeholder="PIX da conta..." 
                                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} 
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Passo C: Ações de Fechamento */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
                                    <button 
                                        onClick={handleReset} 
                                        disabled={isSubmitting}
                                        style={{ padding: '0.75rem 1.25rem', borderRadius: '12px', border: '1px solid #fecaca', background: '#fef2f2', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', color: '#dc2626', transition: 'all 0.2s' }}
                                    >
                                        Descartar Análise
                                    </button>

                                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                                        <button 
                                            onClick={() => saveInvoice('sem_faturamento')}
                                            disabled={isSubmitting}
                                            style={{ 
                                                padding: '0.75rem 1.25rem', 
                                                borderRadius: '12px', 
                                                border: '1px solid #bfdbfe', 
                                                background: '#eff6ff', 
                                                cursor: 'pointer', 
                                                fontWeight: 700, 
                                                fontSize: '0.9rem', 
                                                color: '#2563eb', 
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.4rem'
                                            }}
                                        >
                                            <Ban size={16} /> Registrar Operacional (Sem Faturamento)
                                        </button>
                                        <button 
                                            onClick={() => saveInvoice('a_vencer')}
                                            disabled={isSubmitting}
                                            style={{ 
                                                padding: '0.75rem 1.5rem', 
                                                borderRadius: '12px', 
                                                border: 'none', 
                                                background: branding?.primary_color || '#2563eb', 
                                                cursor: 'pointer', 
                                                fontWeight: 800, 
                                                fontSize: '0.9rem', 
                                                color: 'white', 
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.4rem',
                                                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
                                            }}
                                        >
                                            <CheckCircle size={16} /> Gerar Fatura Ativa (Com Cobrança)
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
