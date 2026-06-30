import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, Calculator, DollarSign, Zap, AlertCircle, Ban, CheckCircle, Plus, X, Loader2, Download, Info } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { parseInvoice, createAsaasCharge, mergePdf, sendCombinedNotification } from '../lib/api';
import { useBranding } from '../contexts/BrandingContext';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
    const [applyStamp, setApplyStamp] = useState(true);
    const [stampCoords, setStampCoords] = useState(null);
    const hiddenRef = useRef(null);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const [invoiceToDownload, setInvoiceToDownload] = useState(null);
    
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
                        tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento, subscriber_id,
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
        data_leitura_anterior: '',
        data_leitura: '',
        consumo_kwh: '',
        energia_injetada: '',
        saldo_kwh: '',
        consumo_compensado: '',
        consumo_reais: '',
        iluminacao_publica: '',
        outros_lancamentos: '',
        parcelamento: '',
        linha_digitavel: '',
        pix_string: '',
        desconto_aplicado: '',
        energy_bill_status: 'pendente',
        fio_b_vr_unit: '',
        fio_b_total: ''
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
        const fetchUcDataAndAddress = async () => {
            if (selectedUcId && allUcs) {
                let uc = allUcs.find(u => u.id === selectedUcId);
                
                // Fetch full UC details with address on-demand to guarantee we have it
                try {
                    const { data: fullUc } = await supabase
                        .from('consumer_units')
                        .select(`
                            *,
                            subscribers!consumer_units_subscriber_id_fkey(name),
                            titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name)
                        `)
                        .eq('id', selectedUcId)
                        .single();
                    if (fullUc) {
                        uc = fullUc;
                    }
                } catch (e) {
                    console.warn("Could not fetch full UC on-demand in StandaloneAnalysisModal, falling back to allUcs:", e);
                }

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
        };
        fetchUcDataAndAddress();
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

            // Tarifa Efetiva = Consumo em Reais / Consumo Kwh
            const consumoReaisVal = typeof formData.consumo_reais === 'string' ? parseCurrency(formData.consumo_reais) : (Number(formData.consumo_reais) || 0);
            const tarifaEfetiva = consumo > 0 ? (consumoReaisVal / consumo) : 0;

            // PRIORIDADE: Utilizar Tarifa Efetiva se for maior que zero, caso contrário usa a tarifa de cadastro da UC
            const tarifaFinal = tarifaEfetiva > 0 ? tarifaEfetiva : tarifaUC;

            const desconto = formData.desconto_aplicado !== '' 
                ? Number(formData.desconto_aplicado) 
                : Number(selectedUc.desconto_assinante || 0);

            const multiplier = desconto > 1 ? desconto / 100 : desconto;

            // Cálculos operacionais idênticos às regras de faturamento utilizando a tarifa final prioritária
            const tarifaMinimaExcedentes = Math.max(0, (consumo - compensado) * tarifaFinal);
            const energiaCompensadaReais = compensado * tarifaFinal * (1 - multiplier);
            const economiaGerada = compensado * tarifaFinal * multiplier;

            const ip = typeof formData.iluminacao_publica === 'string' ? parseCurrency(formData.iluminacao_publica) : (Number(formData.iluminacao_publica) || 0);
            const outros = typeof formData.outros_lancamentos === 'string' ? parseCurrency(formData.outros_lancamentos) : (Number(formData.outros_lancamentos) || 0);
            const concessionariaVal = typeof formData.valor_concessionaria === 'string' ? parseCurrency(formData.valor_concessionaria) : (Number(formData.valor_concessionaria) || 0);

            let valorAPagar = 0;
            if (compensado > 0) {
                // 'outros' removido da soma por ter apenas caráter informativo
                valorAPagar = energiaCompensadaReais + tarifaMinimaExcedentes + ip;
            } else {
                valorAPagar = concessionariaVal;
            }

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
        if (!pdfFile) {
            showAlert('Por favor, faça o upload do PDF.', 'warning');
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
                    let extractedInjetada = parsedData.energia_injetada;
                    let extractedSaldo = parsedData.saldo_kwh;
                    let cleanText = "";

                    // Fallback local redundante/completo para extração e robustez
                    try {
                        const pdf = await pdfjsLib.getDocument({ data: atob(base64.split(',')[1] || base64) }).promise;
                        let fullText = "";
                        let localStampCoords = null;
                        for (let i = 1; i <= Math.min(pdf.numPages, 2); i++) {
                            const page = await pdf.getPage(i);
                            const textContent = await page.getTextContent();
                            if (i === 1) {
                                const targetItem = textContent.items.find(item => 
                                    item.str.toUpperCase().includes('INFORMAÇÕES IMPORTANTES') || 
                                    item.str.toUpperCase().includes('AVISOS')
                                );
                                if (targetItem) {
                                    localStampCoords = { x: targetItem.transform[4], y: targetItem.transform[5] };
                                }
                            }
                            fullText += textContent.items.map(s => s.str).join(" ") + "\n";
                        }
                        if (localStampCoords) {
                            setStampCoords(localStampCoords);
                        }
                        cleanText = fullText.replace(/\s+/g, ' ');
                        const parseValue = (v) => v ? parseFloat(v.replace('.', '').replace(',', '.')) : 0;
                        const parseConsumption = (raw) => {
                            if (!raw) return 0;
                            let cleaned = raw.trim();
                            if (cleaned.includes(',')) {
                                cleaned = cleaned.split(',')[0];
                            }
                            cleaned = cleaned.replace(/\D/g, '');
                            const parsed = parseInt(cleaned, 10);
                            return isNaN(parsed) ? 0 : parsed;
                        };

                        // 1. Fallback local de Consumo Compensado se necessário
                        if (!extractedCompensado) {
                            const compensadoMatches = cleanText.match(/G\dComp\.{0,40}?\-TE\s+kWh\s+([\d,.]+)-/gi);
                            let totalCompensado = 0;
                            if (compensadoMatches) {
                                compensadoMatches.forEach(match => {
                                    const valMatch = match.match(/([\d,.]+)-/);
                                    if (valMatch) totalCompensado += parseValue(valMatch[1]);
                                });
                            } else {
                                const compensadoMatch = cleanText.match(/(?:Energia\sCompensada|GX\sCOMP|GXCOMP|Consumo\sCompensado).{0,40}?([\d,.]+)\s*kWh/i);
                                if (compensadoMatch) totalCompensado = parseValue(compensadoMatch[1]);
                            }

                            if (totalCompensado > 0) {
                                extractedCompensado = totalCompensado;
                            }
                        }

                        // 2. Fallback local de Energia Injetada se necessário
                        if (!extractedInjetada) {
                            let parsedEnergiaInjetada = 0;
                            const injetadaMatch = cleanText.match(/Energia\s+Ativa\s+Injetada\s+(?:[A-Za-zÀ-ÖØ-öø-ÿ]+\s+)?([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i);
                            if (injetadaMatch) {
                                parsedEnergiaInjetada = parseConsumption(injetadaMatch[4]);
                            } else {
                                const fallbackInjetada = cleanText.match(/Energia\s+Ativa\s+Injetada[\s\S]{1,50}?([\d.,]+)/i);
                                if (fallbackInjetada) {
                                    const idxOf = cleanText.indexOf(fallbackInjetada[0]);
                                    const context = cleanText.substring(idxOf, idxOf + 150);
                                    const allNumbers = context.match(/[\d.,]+/g);
                                    if (allNumbers && allNumbers.length >= 4) {
                                        parsedEnergiaInjetada = parseConsumption(allNumbers[3]);
                                    } else if (allNumbers && allNumbers.length > 0) {
                                        parsedEnergiaInjetada = parseConsumption(allNumbers[allNumbers.length - 1]);
                                    }
                                }
                            }

                            if (parsedEnergiaInjetada > 0) {
                                extractedInjetada = parsedEnergiaInjetada;
                            }
                        }

                        // 3. Fallback local de Saldo de Créditos se necessário
                        if (!extractedSaldo) {
                            const saldoMatch = cleanText.match(/Saldo\s+atualizado\s+de\s+cr[eé]ditos\s*=\s*([\d.,]+)/i);
                            if (saldoMatch) {
                                extractedSaldo = parseConsumption(saldoMatch[1]);
                            }
                        }

                        // 4. Extração de Fio B Vr Unit e Fio B Total
                        try {
                            let consumoTusdUnit = 0;
                            let compTusdUnit = 0;
                            let qtdCompTusd = 0;

                            const parseUnitValue = (v) => {
                                if (!v) return 0;
                                let cleaned = v.trim();
                                if (cleaned.includes(',')) {
                                    cleaned = cleaned.replace('.', '').replace(',', '.');
                                } else {
                                    cleaned = cleaned.replace(',', '.');
                                }
                                return parseFloat(cleaned) || 0;
                            };

                            const consumoTusdExato = cleanText.match(/Consumo\s+TUSD\s+kWh\s+[\d,.]+\s+([\d,]+)\s+[\d,.]+/i);
                            if (consumoTusdExato) {
                                consumoTusdUnit = parseUnitValue(consumoTusdExato[1]);
                            }

                            const compTusdExato = cleanText.match(/G\dComp.{0,40}?\-TUSD\s+kWh\s+([\d,.]+)\s+([\d,]+)\s+([\d,.]+)-?/i);
                            if (compTusdExato) {
                                qtdCompTusd = parseConsumption(compTusdExato[1]);
                                compTusdUnit = parseUnitValue(compTusdExato[2]);
                            } else {
                                const compGdMatch = cleanText.match(/(?:Energia\sCompensada|GX\sCOMP|GXCOMP).{0,40}?TUSD\s+kWh\s+([\d,.]+)\s+([\d,]+)\s+([\d,.]+)-?/i);
                                if (compGdMatch) {
                                    qtdCompTusd = parseConsumption(compGdMatch[1]);
                                    compTusdUnit = parseUnitValue(compGdMatch[2]);
                                }
                            }

                            if (consumoTusdUnit > 0 && compTusdUnit > 0) {
                                const diff = consumoTusdUnit - compTusdUnit;
                                parsedData.fio_b_vr_unit = diff;
                                parsedData.fio_b_total = diff * qtdCompTusd;
                            }
                        } catch (fioBErr) {
                            console.warn('Erro ao calcular Fio B localmente:', fioBErr);
                        }
                    } catch (fallbackErr) {
                        console.warn('Erro ao rodar o fallback local:', fallbackErr);
                    }

                    // Auto-vinculação da UC se não selecionada anteriormente no dropdown
                    let currentUcId = selectedUcId;
                    if (!currentUcId) {
                        setLoaderMessage('Buscando correspondência de UC via OCR...');
                        let extractedUcNumber = parsedData.numero_uc || parsedData.codigo_cliente || parsedData.conta_contrato;
                        
                        if (!extractedUcNumber && cleanText) {
                            const regexMatch = cleanText.match(/(?:Conta Contrato|C[óo]digo do Cliente|Instala[çc][ãa]o)[:\s]*(\d{9,11})/i) ||
                                               cleanText.match(/N[úu]mero da \w+[:\s]*(\d{9,11})/i) ||
                                               cleanText.match(/(\d{10})/);
                            if (regexMatch) {
                                extractedUcNumber = regexMatch[1] || regexMatch[0];
                            }
                        }

                        if (extractedUcNumber) {
                            const cleanUcNum = String(extractedUcNumber).trim();
                            console.log('Tentando vincular UC automaticamente com o número:', cleanUcNum);
                            
                            const { data: matchedUc, error: ucFindError } = await supabase
                                .from('consumer_units')
                                .select(`
                                    id, numero_uc, concessionaria, titular_conta, status,
                                    tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento, subscriber_id,
                                    subscribers!consumer_units_subscriber_id_fkey(name),
                                    titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name)
                                `)
                                .eq('numero_uc', cleanUcNum)
                                .maybeSingle();

                            if (matchedUc) {
                                currentUcId = matchedUc.id;
                                setSelectedUcId(matchedUc.id);
                                setSelectedUc(matchedUc);
                                setSearchTerm(`UC: ${matchedUc.numero_uc} - ${matchedUc.titular_conta}`);
                                showAlert(`UC ${matchedUc.numero_uc} vinculada automaticamente com sucesso!`, 'success');
                            } else {
                                // Tentar busca parcial caso haja zeros à esquerda ou outros formatos
                                const { data: matchedUcPartial } = await supabase
                                    .from('consumer_units')
                                    .select(`
                                        id, numero_uc, concessionaria, titular_conta, status,
                                        tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento, subscriber_id,
                                        subscribers!consumer_units_subscriber_id_fkey(name),
                                        titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name)
                                    `)
                                    .ilike('numero_uc', `%${cleanUcNum}%`)
                                    .limit(1);

                                if (matchedUcPartial && matchedUcPartial.length > 0) {
                                    const matched = matchedUcPartial[0];
                                    currentUcId = matched.id;
                                    setSelectedUcId(matched.id);
                                    setSelectedUc(matched);
                                    setSearchTerm(`UC: ${matched.numero_uc} - ${matched.titular_conta}`);
                                    showAlert(`UC ${matched.numero_uc} vinculada automaticamente por busca parcial!`, 'success');
                                } else {
                                    throw new Error(`Nenhuma Unidade Consumidora encontrada para o número extraído: ${cleanUcNum}. Selecione a UC manualmente.`);
                                }
                            }
                        } else {
                            throw new Error('Não foi possível identificar o número da UC no PDF automaticamente. Selecione a UC manualmente.');
                        }
                    }

                    // Preenche os dados extraídos no Passo B
                    setFormData(prev => ({
                        ...prev,
                        mes_referencia: parsedData.mes_referencia ? parsedData.mes_referencia.substring(0, 7) : prev.mes_referencia,
                        vencimento: parsedData.vencimento ? parsedData.vencimento.split('T')[0] : prev.vencimento,
                        data_leitura_anterior: parsedData.data_leitura_anterior ? parsedData.data_leitura_anterior.split('T')[0] : '',
                        data_leitura: parsedData.data_leitura ? parsedData.data_leitura.split('T')[0] : '',
                        valor_concessionaria: parsedData.valor_a_pagar !== undefined && parsedData.valor_a_pagar !== null ? formatCurrency(parsedData.valor_a_pagar) : (parsedData.valorTotal ? formatCurrency(parsedData.valorTotal) : ''),
                        consumo_kwh: parsedData.consumo_kwh !== undefined ? parsedData.consumo_kwh : '',
                        energia_injetada: extractedInjetada !== undefined && extractedInjetada !== null ? extractedInjetada : '',
                        saldo_kwh: extractedSaldo !== undefined && extractedSaldo !== null ? extractedSaldo : '',
                        consumo_compensado: extractedCompensado !== undefined ? extractedCompensado : '',
                        consumo_reais: parsedData.consumo_reais !== undefined ? formatCurrency(parsedData.consumo_reais) : formatCurrency(parsedData.valorTotal || 0),
                        iluminacao_publica: parsedData.iluminacao_publica ? formatCurrency(parsedData.iluminacao_publica) : '',
                        outros_lancamentos: parsedData.outros_lancamentos ? formatCurrency(parsedData.outros_lancamentos) : '',
                        parcelamento: parsedData.parcelamento ? formatCurrency(parsedData.parcelamento) : '',
                        linha_digitavel: parsedData.linha_digitavel || '',
                        pix_string: parsedData.pix_string || '',
                        fio_b_vr_unit: parsedData.fio_b_vr_unit !== undefined ? formatCurrency(parsedData.fio_b_vr_unit) : '',
                        fio_b_total: parsedData.fio_b_total !== undefined ? formatCurrency(parsedData.fio_b_total) : ''
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
        setApplyStamp(true);
        setStampCoords(null);
        setSelectedUcId('');
        setSearchTerm('');
        setIsDropdownOpen(false);
        setStep('upload');
        setFormData({
            mes_referencia: new Date().toISOString().substring(0, 7),
            vencimento: '',
            data_leitura: '',
            consumo_kwh: '',
            energia_injetada: '',
            saldo_kwh: '',
            consumo_compensado: '',
            consumo_reais: '',
            iluminacao_publica: '',
            outros_lancamentos: '',
            parcelamento: '',
            linha_digitavel: '',
            pix_string: '',
            valor_concessionaria: '',
            desconto_aplicado: '',
            fio_b_vr_unit: '',
            fio_b_total: '',
            observacoes_auditoria: ''
        });
    }

    // Persistência no Banco
    const saveInvoice = async (saveStatus) => {
        if (isSubmitting) return;
        setIsSubmitting(true);

        let publicUrl = null;
        if (pdfFile && selectedUc) {
            try {
                let fileToUpload = pdfFile;

                if (applyStamp) {
                    try {
                        const arrayBuffer = await pdfFile.arrayBuffer();
                        const pdfDoc = await PDFDocument.load(arrayBuffer);
                        const pages = pdfDoc.getPages();
                        
                        // Discard secondary pages
                        const initialCount = pages.length;
                        if (initialCount > 1) {
                            for (let i = initialCount - 1; i > 0; i--) {
                                pdfDoc.removePage(i);
                            }
                        }

                        const firstPage = pdfDoc.getPages()[0];
                        const { width, height } = firstPage.getSize();
                        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
                        
                        const stampText = "NÃO PAGUE ESSA CONTA - VIA DE CONFERÊNCIA";
                        const fontSize = 11;
                        const textWidth = font.widthOfTextAtSize(stampText, fontSize);

                        let stampX = 40;
                        let stampY = 50;

                        if (stampCoords) {
                            stampX = stampCoords.x;
                            stampY = Math.max(20, stampCoords.y - 15); // Just below the title
                        } else {
                            // Safe fallback area
                            stampY = 80; 
                        }

                        // Draw a highlight background
                        firstPage.drawRectangle({
                            x: stampX - 2,
                            y: stampY - 3,
                            width: textWidth + 10,
                            height: fontSize + 6,
                            color: rgb(1, 0.9, 0.9),
                            opacity: 0.9
                        });

                        // Draw the text
                        firstPage.drawText(stampText, {
                            x: stampX + 3,
                            y: stampY,
                            size: fontSize,
                            font: font,
                            color: rgb(0.8, 0, 0),
                        });

                        const pdfBytes = await pdfDoc.save();
                        fileToUpload = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
                        console.log("PDF trimmed and stamped successfully in StandaloneAnalysisModal.");
                    } catch (pdfErr) {
                        console.warn("Failed to apply stamp/trim in StandaloneAnalysisModal, using original file:", pdfErr);
                    }
                }

                const fileName = `manual_${Date.now()}.pdf`;
                const storagePath = `invoices/${selectedUc.numero_uc}/${fileName}`;
                
                // Upload to Supabase Storage
                const { error: uploadError } = await supabase.storage
                    .from('energy-bills')
                    .upload(storagePath, fileToUpload, {
                        contentType: 'application/pdf',
                        upsert: true
                    });

                if (uploadError) throw uploadError;

                // Get Public URL
                const { data: { publicUrl: url } } = supabase.storage
                    .from('energy-bills')
                    .getPublicUrl(storagePath);
                
                publicUrl = url;
            } catch (uploadErr) {
                console.error("Erro ao fazer upload do PDF:", uploadErr);
                showAlert("Erro ao salvar arquivo PDF na nuvem, mas tentando salvar dados: " + uploadErr.message, "warning");
            }
        }

        const ip = typeof formData.iluminacao_publica === 'string' ? parseCurrency(formData.iluminacao_publica) : (Number(formData.iluminacao_publica) || 0);
        const outros = typeof formData.outros_lancamentos === 'string' ? parseCurrency(formData.outros_lancamentos) : (Number(formData.outros_lancamentos) || 0);
        const parcelamentoVal = typeof formData.parcelamento === 'string' ? parseCurrency(formData.parcelamento) : (Number(formData.parcelamento) || 0);
        const concessionariaVal = typeof formData.valor_concessionaria === 'string' ? parseCurrency(formData.valor_concessionaria) : (Number(formData.valor_concessionaria) || Number(formData.consumo_reais) || 0);

        // Recalcular alertas automáticos para salvar no histórico
        const autoAlerts = [];
        const consumoVal = Number(formData.consumo_kwh) || 0;
        const compensadoVal = Number(formData.consumo_compensado) || 0;
        const tarifaUCVal = selectedUc ? Number(selectedUc.tarifa_concessionaria) : 0;
        let calcConcessionariaSum = (typeof formData.consumo_reais === 'string' ? parseCurrency(formData.consumo_reais) : (Number(formData.consumo_reais) || 0)) + ip + outros + parcelamentoVal;
        if (compensadoVal > 0 && selectedUc) {
            const consumoNaoCompensado = Math.max(0, consumoVal - compensadoVal);
            const custoNaoCompensado = consumoNaoCompensado * tarifaUCVal;
            const estimatedFioB = compensadoVal * (tarifaUCVal * 0.215);
            calcConcessionariaSum = custoNaoCompensado + estimatedFioB + ip + outros + parcelamentoVal;
        }
        const diffSumVal = Math.abs(calcConcessionariaSum - concessionariaVal);
        const diffSumLimitVal = compensadoVal > 0 ? 5.00 : 0.50;
        const baseTariffVal = selectedUc ? Number(selectedUc.tarifa_concessionaria) : 0;
        const diffTariffVal = selectedUc ? Math.abs(simulation.tarifaEfetiva - baseTariffVal) : 0;
        const percentDiffVal = baseTariffVal > 0 ? (diffTariffVal / baseTariffVal) : 0;

        if (compensadoVal === 0) {
            autoAlerts.push(`Ausência de Compensação: A fatura não apresenta energia compensada.`);
        } else if (compensadoVal < consumoVal) {
            autoAlerts.push(`Compensação Parcial: A energia compensada (${compensadoVal} kWh) é menor que o consumo total (${consumoVal} kWh).`);
        }
        if (selectedUc && percentDiffVal > 0.01) {
            autoAlerts.push(`Divergência de Tarifa: Difere em ${(percentDiffVal * 100).toFixed(2)}%.`);
        }
        if (concessionariaVal > 0 && diffSumVal > diffSumLimitVal) {
            autoAlerts.push(`Divergência de Totais: Valores divergem do esperado.`);
        }

        let historicoContent = '';
        if (autoAlerts.length > 0) {
            historicoContent += `Alertas Automáticos do Validador:\n- ${autoAlerts.join('\n- ')}\n\n`;
        }
        if (formData.observacoes_auditoria && formData.observacoes_auditoria.trim() !== '') {
            historicoContent += `Observações Manuais:\n${formData.observacoes_auditoria.trim()}`;
        }

        let finalEnergyBillStatus = formData.energy_bill_status || 'pendente';
        if (historicoContent !== '') {
            finalEnergyBillStatus = 'inconsistente';
        }

        const payload = {
            uc_id: selectedUcId,
            mes_referencia: `${formData.mes_referencia}-01`,
            vencimento: formData.vencimento || null,
            vencimento_concessionaria: formData.vencimento || null,
            data_leitura_anterior: formData.data_leitura_anterior || null,
            data_leitura: formData.data_leitura || null,
            consumo_kwh: Number(formData.consumo_kwh) || 0,
            energia_injetada: Number(formData.energia_injetada) || 0,
            saldo_kwh: Number(formData.saldo_kwh) || 0,
            consumo_compensado: Number(formData.consumo_compensado) || 0,
            consumo_reais: simulation.energiaCompensadaReais + simulation.tarifaMinimaExcedentes,
            iluminacao_publica: ip,
            tarifa_minima: simulation.tarifaMinimaExcedentes,
            outros_lancamentos: outros,
            parcelamento: parcelamentoVal,
            valor_a_pagar: simulation.valorAPagar,
            valor_concessionaria: concessionariaVal,
            economia_reais: simulation.economiaGerada,
            linha_digitavel: formData.linha_digitavel || null,
            pix_string: formData.pix_string || null,
            desconto_aplicado: formData.desconto_aplicado !== '' ? Number(formData.desconto_aplicado) : Number(selectedUc?.desconto_assinante || 0),
            energy_bill_status: finalEnergyBillStatus,
            status: saveStatus,
            concessionaria_pdf_url: publicUrl
        };

        try {
            const { data, error } = await supabase.from('invoices').insert(payload).select().single();
            if (error) {
                if (error.code === '23505' || error.message.includes('duplicate key value')) {
                    const confirmOverwrite = await showConfirm(
                        'Já existe uma conta de energia para essa unidade no mesmo período de referência. Deseja salvar assim mesmo (sobrescrevendo a anterior)?',
                        'Atenção: Conta Duplicada',
                        'Sobrescrever',
                        'Cancelar'
                    );
                    if (confirmOverwrite) {
                        const { data: upsertData, error: upsertError } = await supabase.from('invoices').upsert(payload, { onConflict: 'uc_id,mes_referencia' }).select().single();
                        if (upsertError) throw upsertError;
                        if (saveStatus === 'a_vencer' && upsertData) {
                            showAlert('Fatura ativa atualizada! Gerando boleto de faturamento...', 'info');
                            try {
                                const result = await createAsaasCharge(upsertData.id, 'invoice');
                                showAlert('Fatura atualizada e boleto gerado no Asaas com sucesso!', 'success');
                                await triggerActiveInvoiceNotification(upsertData, result.url);
                            } catch (asaasErr) {
                                console.error('Erro na emissão automática do Asaas:', asaasErr);
                                showAlert('Fatura atualizada, mas houve uma falha ao gerar cobrança no gateway: ' + asaasErr.message, 'warning');
                            }
                        } else {
                            showAlert('Conta atualizada com sucesso (Operacional Sem Cobrança)!', 'success');
                        }

                        // Salvar Observações de Auditoria no Histórico se existirem
                        const savedInvoiceId = upsertData?.id;
                        if (savedInvoiceId && historicoContent !== '') {
                            try {
                                const protocolPayload = {
                                    title: 'Auditoria: Inconsistência de Faturamento',
                                    description: historicoContent.trim(),
                                    status: 'gerar',
                                    linked_entity_type: 'conta_energia',
                                    linked_entity_id: savedInvoiceId,
                                    created_by: profile?.id,
                                    created_at: new Date().toISOString()
                                };
                                const { data: protocolData, error: protocolErr } = await supabase.from('protocols').insert(protocolPayload).select().single();
                                if (protocolErr) throw protocolErr;
                                await supabase.from('crm_history').insert({
                                    entity_type: 'protocol',
                                    entity_id: protocolData.id,
                                    content: `Protocolo criado automaticamente via Validador SandBox.\n\n${historicoContent.trim()}`,
                                    created_by: profile?.id
                                });
                                showAlert(`Protocolo de inconsistência gerado automaticamente!`, 'info');
                            } catch (historyErr) {
                                console.warn('Erro ao salvar protocolo de auditoria:', historyErr);
                            }
                        }

                        if (onSave) onSave();
                        onClose();
                        return;
                    } else {
                        setIsSubmitting(false);
                        return;
                    }
                } else {
                    throw error;
                }
            }

            if (saveStatus === 'a_vencer' && data) {
                showAlert('Fatura ativa criada localmente! Gerando boleto de faturamento...', 'info');
                try {
                    const result = await createAsaasCharge(data.id, 'invoice');
                    showAlert('Fatura cadastrada e boleto gerado no Asaas com sucesso!', 'success');
                    await triggerActiveInvoiceNotification(data, result.url);
                } catch (asaasErr) {
                    console.error('Erro na emissão automática do Asaas:', asaasErr);
                    showAlert('Fatura cadastrada, mas houve uma falha ao gerar cobrança no gateway: ' + asaasErr.message, 'warning');
                }
            } else {
                showAlert('Conta registrada com sucesso (Operacional Sem Cobrança)!', 'success');
            }

            // Salvar Observações de Auditoria no Histórico se existirem
            const savedInvoiceId = data?.id;
            if (savedInvoiceId && historicoContent !== '') {
                try {
                    // Criar Protocolo automaticamente
                    const protocolPayload = {
                        title: 'Auditoria: Inconsistência de Faturamento',
                        description: historicoContent.trim(),
                        status: 'gerar',
                        linked_entity_type: 'conta_energia',
                        linked_entity_id: savedInvoiceId,
                        created_by: profile?.id,
                        created_at: new Date().toISOString()
                    };

                    const { data: protocolData, error: protocolErr } = await supabase
                        .from('protocols')
                        .insert(protocolPayload)
                        .select()
                        .single();

                    if (protocolErr) throw protocolErr;

                    // Salvar no histórico do protocolo gerado
                    await supabase.from('crm_history').insert({
                        entity_type: 'protocol',
                        entity_id: protocolData.id,
                        content: `Protocolo criado automaticamente via Validador SandBox.\n\n${historicoContent.trim()}`,
                        created_by: profile?.id
                    });

                    showAlert(`Protocolo de inconsistência gerado automaticamente!`, 'info');

                } catch (historyErr) {
                    console.warn('Erro ao salvar protocolo de auditoria:', historyErr);
                }
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

    const triggerActiveInvoiceNotification = async (invoiceData, boletoUrl) => {
        try {
            let currentUc = selectedUc;
            if (!currentUc && invoiceData.uc_id) {
                const { data: ucData } = await supabase
                    .from('consumer_units')
                    .select(`
                        id, numero_uc, concessionaria, titular_conta, status,
                        tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento, subscriber_id,
                        subscribers!consumer_units_subscriber_id_fkey(name),
                        titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name)
                    `)
                    .eq('id', invoiceData.uc_id)
                    .single();
                if (ucData) {
                    currentUc = ucData;
                    setSelectedUc(ucData);
                    setSelectedUcId(ucData.id);
                }
            }

            const subId = currentUc?.subscriber_id;
            if (!subId) {
                console.warn("No subscriber ID found for UC");
                showAlert('Assinante não encontrado para esta unidade. Não foi possível enviar notificações.', 'warning');
                return;
            }

            const { data: subData, error: subFetchErr } = await supabase
                .from('subscribers')
                .select('*')
                .eq('id', subId)
                .single();
            
            if (subFetchErr) throw subFetchErr;

            if (subData) {
                showAlert('Gerando PDF para notificações...', 'info');
                const pdfBlob = await handleDownloadCombined(invoiceData, boletoUrl);
                
                if (pdfBlob) {
                    showAlert('Enviando notificações (E-mail/WhatsApp)...', 'info');
                    const monthYearStr = invoiceData.mes_referencia ? invoiceData.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
                    const cleanSubName = (subData.name || 'Cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
                    const ucNum = currentUc?.numero_uc || '';
                    const descriptiveFileName = `Fatura_${cleanSubName}_${ucNum}_${monthYearStr}.pdf`;

                    await sendCombinedNotification({
                        recipientEmail: subData.email,
                        recipientPhone: subData.phone,
                        subscriberName: subData.name,
                        dueDate: invoiceData.vencimento ? new Date(invoiceData.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '',
                        value: formatCurrency(invoiceData.valor_a_pagar),
                        pdfBlob,
                        fileName: descriptiveFileName,
                        subscriberId: subData.id,
                        ucId: currentUc?.id || invoiceData.uc_id,
                        profileId: profile?.id
                    });
                    showAlert('Notificações enviadas com sucesso!', 'success');
                }
            }
        } catch (notifyErr) {
            console.error('Erro no envio das notificações:', notifyErr);
            showAlert('Fatura ativa criada e boleto gerado, mas falhou ao enviar notificações: ' + notifyErr.message, 'warning');
        }
    };

    const handleDownloadCombined = async (invToUse, forcedBoletoUrl = null) => {
        const inv = invToUse;
        const currentBoletoUrl = forcedBoletoUrl;
        
        if (!inv || !currentBoletoUrl) {
            showAlert('Boleto não disponível para esta fatura.', 'warning');
            return;
        }

        setIsGeneratingPdf(true);
        setInvoiceToDownload(inv);
        console.log('Generating Combined PDF for invoice:', inv.id, 'Energy Bill URL:', inv.concessionaria_pdf_url);

        try {
            const monthYear = inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
            const cleanName = (selectedUc?.titular_conta || 'Fatura').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
            const ucNumber = selectedUc?.numero_uc || '';
            const fileName = `Fatura_${cleanName}_${ucNumber}_${monthYear}.pdf`;

            const isRawAsaas = inv.asaas_pdf_storage_url?.includes('bankSlipUrl') || 
                              inv.asaas_pdf_storage_url?.includes('invoiceUrl') ||
                              inv.asaas_pdf_storage_url?.includes('asaas.com');
            
            if (inv.asaas_pdf_storage_url && !isRawAsaas) {
                console.log("Obtendo URL assinada para PDF individual...");
                const { data: signedData, error: signedError } = await supabase.storage
                    .from('invoices_pdfs')
                    .createSignedUrl(`${inv.id}.pdf`, 60);

                if (!signedError && signedData?.signedUrl) {
                    const { data: fileBlob } = await supabase.storage.from('invoices_pdfs').download(`${inv.id}.pdf`);
                    return fileBlob;
                }
                console.warn("Falha ao obter URL assinada, gerando novo...", signedError);
            }

            // Wait for DOM with retry
            let element = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                element = hiddenRef.current;
                if (element && element.querySelector && element.innerHTML.length > 100) break;
                console.log(`Aguardando hiddenRef render (tentativa ${attempt + 1}/10)...`);
            }
            if (!element || element.innerHTML.length < 100) {
                console.error("Ref hiddenRef ainda é null após tentativas no StandaloneAnalysisModal.");
                throw new Error("Elemento de captura não encontrado no DOM.");
            }

            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                backgroundColor: "#f8fafc"
            });

            const imgData = canvas.toDataURL('image/png');
            const pdfSummary = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdfSummary.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdfSummary.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

            const summaryBase64 = pdfSummary.output('datauristring');
            const asaasUrl = currentBoletoUrl; 
            if (!asaasUrl && !inv.asaas_pdf_storage_url) throw new Error("URL do boleto não encontrada.");
            const mergedBlob = await mergePdf(summaryBase64, asaasUrl, fileName, inv.concessionaria_pdf_url, inv.asaas_pdf_storage_url);

            try {
                const storagePath = `${inv.id}.pdf`;
                console.log(`Subindo PDF individual para o Storage: ${storagePath}`);
                
                const { error: uploadError } = await supabase.storage
                    .from('invoices_pdfs')
                    .upload(storagePath, mergedBlob, {
                        upsert: true,
                        contentType: 'application/pdf'
                    });

                if (!uploadError) {
                    const { data: { publicUrl } } = supabase.storage
                        .from('invoices_pdfs')
                        .getPublicUrl(storagePath);
                    
                    const authenticatedUrl = publicUrl.replace('/public/', '/authenticated/');

                    await supabase
                        .from('invoices')
                        .update({ asaas_pdf_storage_url: authenticatedUrl })
                        .eq('id', inv.id);
                        
                    console.log("Storage e Banco de Dados atualizados para PDF Individual (Modal Fatura).");
                } else {
                    console.warn("Falha ao subir PDF para o Storage:", uploadError);
                }
            } catch (storageErr) {
                console.warn("Erro ao processar persistência no Storage:", storageErr);
            }

            console.log('PDF Merged successfully. Blob size:', mergedBlob.size);
            return mergedBlob;
        } catch (error) {
            console.error('Erro ao gerar PDF combinado:', error);
            showAlert('Erro ao gerar PDF combinado.', 'error');
            return null;
        } finally {
            setIsGeneratingPdf(false);
            setInvoiceToDownload(null);
        }
    };

    const renderHiddenInvoiceDetail = (inv) => {
        if (!inv) return null;
        const uc = selectedUc;
        const statusColorsPdf = {
            pago: { color: '#27ae60', label: 'PAGO' },
            a_vencer: { color: '#2563eb', label: 'A VENCER' },
            sem_faturamento: { color: '#2563eb', label: 'A VENCER' },
            atrasado: { color: '#dc2626', label: 'ATRASADO' },
            cancelado: { color: '#64748b', label: 'CANCELADO' }
        };
        const currentPdfStatus = statusColorsPdf[inv.status] || statusColorsPdf.a_vencer;
        const statusLabel = currentPdfStatus.label;
        const statusColor = currentPdfStatus.color;

        const rawConsumo = Number(inv.consumo_kwh) || 0;
        const rawCompensado = Number(inv.consumo_compensado) || 0;
        const rawTarifa = Number(uc?.tarifa_concessionaria) || 0;
        const discountSnapshot = inv.desconto_aplicado !== undefined ? Number(inv.desconto_aplicado) : (Number(uc?.desconto_assinante) || 0);
        const multiplier = discountSnapshot > 1 ? discountSnapshot / 100 : discountSnapshot;
        
        // Calculations
        const consumoTotalReais = rawConsumo * rawTarifa;
        const energiaCompensadaReais = rawCompensado * rawTarifa * (1 - multiplier);
        const ip = Number(inv.iluminacao_publica) || 0;
        const tarifaMinimaExcedentes = Math.max(0, (rawConsumo - rawCompensado) * rawTarifa);
        const outros = Number(inv.outros_lancamentos) || 0;
        const outrosTotal = tarifaMinimaExcedentes + outros;
        const totalCalculado = energiaCompensadaReais + ip + outrosTotal;

        const formatCurrency = (val) => {
            return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);
        };

        return (
            <div style={{
                width: '800px',
                minWidth: '800px',
                padding: '40px',
                background: '#f8fafc',
                boxSizing: 'border-box',
                fontFamily: "'Inter', 'Montserrat', 'Helvetica', 'Arial', sans-serif"
            }}>
                <div style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    overflow: 'hidden',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    width: '100%'
                }}>
                    <div style={{
                        padding: '16px 24px',
                        borderBottom: '1px solid #f1f5f9',
                        display: 'flex',
                        justifyContent: 'flex-start',
                        alignItems: 'center',
                        background: '#ffffff'
                    }}>
                        {branding?.logo_url ? (
                            <img src={branding.logo_url} alt={branding.company_name} style={{ maxHeight: '48px', maxWidth: '180px', objectFit: 'contain' }} />
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: '700', color: '#003366', fontSize: '1.1rem' }}>
                                <FileText size={24} color="#FF6600" />
                                <span>{branding?.company_name || 'B2W Energia'}</span>
                            </div>
                        )}
                    </div>
                    <div style={{
                        backgroundColor: branding?.primary_color || '#003366',
                        padding: '20px 24px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Info size={20} color="#ffffff" />
                            <h3 style={{ margin: 0, color: '#ffffff', fontSize: '1.1rem', fontWeight: 600 }}>Detalhamento da Fatura</h3>
                        </div>
                        <span style={{
                            padding: '6px 16px',
                            borderRadius: '30px',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            backgroundColor: statusColor
                        }}>
                            {statusLabel}
                        </span>
                    </div>
 
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1.2fr',
                        padding: '24px',
                        gap: '24px',
                        boxSizing: 'border-box',
                        width: '100%',
                        background: '#ffffff'
                    }}>
                        <div style={{
                            backgroundColor: '#f1f5f9',
                            padding: '24px',
                            borderRadius: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px',
                            boxSizing: 'border-box'
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>ASSINANTE</label>
                                <span style={{ fontSize: '0.95rem', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase' }}>{selectedUc?.subscribers?.name || selectedUc?.titular_conta || 'Assinante'}</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>NÚMERO DA UC</label>
                                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>{selectedUc?.numero_uc || 'N/A'}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>IDENTIFICAÇÃO (APELIDO)</label>
                                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>{selectedUc?.identification || selectedUc?.titular_conta || 'Unidade Consumidora'}</span>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>MÊS REFERÊNCIA</label>
                                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>{inv.mes_referencia ? `${inv.mes_referencia.split('-')[1]}/${inv.mes_referencia.split('-')[0]}` : 'N/A'}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>VENCIMENTO</label>
                                    <span style={{ fontSize: '0.95rem', fontWeight: '800', color: '#dc2626' }}>
                                        {inv.vencimento ? new Date(inv.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}
                                    </span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>ENDEREÇO DA UC</label>
                                <span style={{ fontSize: '0.8rem', color: '#1e293b', wordBreak: 'break-word', fontWeight: '500', lineHeight: '1.25' }}>
                                    {(() => {
                                        const addr = uc?.address;
                                        if (!addr) return 'Endereço não cadastrado';
                                        if (typeof addr === 'string') return addr;
                                        return [
                                            addr.rua,
                                            addr.numero ? `Nº ${addr.numero}` : '',
                                            addr.complemento,
                                            addr.bairro,
                                            addr.cidade ? `${addr.cidade}-${addr.uf}` : ''
                                        ].filter(Boolean).join(', ') || 'Endereço não cadastrado';
                                    })()}
                                </span>
                            </div>
                        </div>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '16px',
                            boxSizing: 'border-box'
                        }}>
                            <div style={{ width: '100%' }}>
                                <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', marginTop: 0, marginBottom: '8px', borderBottom: '2px solid #cbd5e1', paddingBottom: '4px' }}>
                                    Composição da Fatura
                                </h4>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid #cbd5e1', textAlign: 'left', color: '#64748b', fontWeight: 700 }}>
                                            <th style={{ padding: '6px 0', fontSize: '0.72rem', textTransform: 'uppercase' }}>Descrição do Lançamento</th>
                                            <th style={{ padding: '6px 0', textAlign: 'center', fontSize: '0.72rem', textTransform: 'uppercase' }}>Quantitativo</th>
                                            <th style={{ padding: '6px 0', textAlign: 'right', fontSize: '0.72rem', textTransform: 'uppercase' }}>Valores</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '8px 0' }}>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Consumo total</div>
                                                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>({rawConsumo} x R$ {rawTarifa.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })})</div>
                                            </td>
                                            <td style={{ padding: '8px 0', textAlign: 'center', color: '#1e293b', fontWeight: '600' }}>{rawConsumo} kwh</td>
                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(consumoTotalReais)}*</td>
                                        </tr>
                                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '8px 0' }}>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Energia Compensada Desc. {discountSnapshot}% -</div>
                                            </td>
                                            <td style={{ padding: '8px 0', textAlign: 'center', color: '#166534', fontWeight: '600' }}>- {rawCompensado} kwh</td>
                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#166534' }}>{formatCurrency(energiaCompensadaReais)}</td>
                                        </tr>
                                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '8px 0' }}>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Iluminação Pública</div>
                                            </td>
                                            <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(ip)}</td>
                                        </tr>
                                        {(tarifaMinimaExcedentes > 0 || (tarifaMinimaExcedentes === 0 && outros === 0 && parcelamento === 0)) && (
                                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '8px 0' }}>
                                                    <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Tarifa Mínima / Excedentes</div>
                                                </td>
                                                <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                                <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(tarifaMinimaExcedentes)}</td>
                                            </tr>
                                        )}
                                        {outros > 0 && (
                                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '8px 0' }}>
                                                    <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Multas / Juros / Bandeiras / Outros</div>
                                                </td>
                                                <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                                <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(outros)}</td>
                                            </tr>
                                        )}
                                        {parcelamento > 0 && (
                                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '8px 0' }}>
                                                    <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Parcelamento</div>
                                                </td>
                                                <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                                <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(parcelamento)}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontStyle: 'italic', marginTop: '6px', borderBottom: '1px solid #cbd5e1', paddingBottom: '6px' }}>
                                    * Valor calculado com base na tarifa cheia da concessionária.
                                </div>
                            </div>
 
                            <div style={{
                                marginTop: '8px',
                                padding: '12px 16px',
                                borderRadius: '12px',
                                background: '#eff6ff',
                                border: '1.5px solid #bfdbfe',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                boxSizing: 'border-box'
                            }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: '800', color: '#1e3a8a', letterSpacing: '0.05em' }}>
                                    VALOR DO ASSINANTE (BOLETO)
                                </span>
                                <span style={{ fontSize: '1.3rem', fontWeight: '900', color: '#1e3a8a' }}>
                                    {formatCurrency(totalCalculado)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // Validador inteligente de Alertas
    const rendersAlerts = () => {
        const ip = typeof formData.iluminacao_publica === 'string' ? parseCurrency(formData.iluminacao_publica) : (Number(formData.iluminacao_publica) || 0);
        const outros = typeof formData.outros_lancamentos === 'string' ? parseCurrency(formData.outros_lancamentos) : (Number(formData.outros_lancamentos) || 0);
        const consumoReaisVal = typeof formData.consumo_reais === 'string' ? parseCurrency(formData.consumo_reais) : (Number(formData.consumo_reais) || 0);
        const totalFaturaVal = typeof formData.valor_concessionaria === 'string' ? parseCurrency(formData.valor_concessionaria) : (Number(formData.valor_concessionaria) || 0);

        const consumo = Number(formData.consumo_kwh) || 0;
        const compensado = Number(formData.consumo_compensado) || 0;
        const tarifaUC = selectedUc ? Number(selectedUc.tarifa_concessionaria) : 0;

        // Se houver compensação de energia (GD), estimamos o custo líquido esperado cobrado
        // pela concessionária (Fio B não compensado + IP + consumo não compensado)
        let calculatedConcessionariaSum = consumoReaisVal + ip + outros;
        if (compensado > 0 && selectedUc) {
            const consumoNaoCompensado = Math.max(0, consumo - compensado);
            const custoNaoCompensado = consumoNaoCompensado * tarifaUC;
            
            // Fio B retido (TUSD não compensado) é tipicamente em torno de 21% a 23% da tarifa cheia da UC
            const estimatedFioB = compensado * (tarifaUC * 0.215);
            calculatedConcessionariaSum = custoNaoCompensado + estimatedFioB + ip + outros;
        }

        const diffSum = Math.abs(calculatedConcessionariaSum - totalFaturaVal);
        const diffSumLimit = compensado > 0 ? 5.00 : 0.50; // Limiar maior para GD devido a variações de Fio B por distribuidora

        const baseTariff = selectedUc ? Number(selectedUc.tarifa_concessionaria) : 0;
        const diffTariff = selectedUc ? Math.abs(simulation.tarifaEfetiva - baseTariff) : 0;
        const percentDiff = baseTariff > 0 ? (diffTariff / baseTariff) : 0;

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

        if (selectedUc && percentDiff > 0.01) {
            alerts.push({
                type: 'tariff',
                message: `Divergência de Tarifa (>1%): A tarifa efetiva (${simulation.tarifaEfetiva.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/kWh) difere da tarifa base cadastrada na UC (${baseTariff.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/kWh) em ${(percentDiff * 100).toFixed(2)}%.`
            });
        }

        if (totalFaturaVal > 0 && diffSum > diffSumLimit) {
            alerts.push({
                type: 'sum',
                message: `Divergência de Totais: O valor total informado na fatura (${formatCurrency(totalFaturaVal)}) diverge da soma dos lançamentos (Consumo Estimado Líquido + IP + Outros = ${formatCurrency(calculatedConcessionariaSum)}).`
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
                <style>{`
                    /* Premium Sandbox Modal Button System */
                    .sandbox-btn {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        gap: 0.5rem;
                        padding: 0.75rem 1.25rem;
                        height: 44px;
                        border-radius: 12px;
                        font-size: 0.85rem;
                        font-weight: 700;
                        cursor: pointer;
                        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                        box-sizing: border-box;
                        user-select: none;
                        white-space: nowrap;
                    }

                    .sandbox-btn-discard {
                        background-color: #fef2f2;
                        border: 1px solid #fee2e2;
                        color: #ef4444;
                    }

                    .sandbox-btn-discard:hover:not(:disabled) {
                        background-color: #fee2e2;
                        border-color: #fca5a5;
                        color: #dc2626;
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(220, 38, 38, 0.08);
                    }

                    .sandbox-btn-discard:active:not(:disabled) {
                        transform: translateY(0);
                    }

                    .sandbox-btn-neutral {
                        background-color: #ffffff;
                        border: 1px solid #cbd5e1;
                        color: #64748b;
                    }

                    .sandbox-btn-neutral:hover:not(:disabled) {
                        background-color: #f8fafc;
                        border-color: #94a3b8;
                        color: #334155;
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                    }

                    .sandbox-btn-neutral:active:not(:disabled) {
                        transform: translateY(0);
                    }

                    .sandbox-btn-secondary {
                        background-color: rgba(0, 51, 102, 0.04);
                        border: 1px solid var(--color-blue, #003366);
                        color: var(--color-blue, #003366);
                    }

                    .sandbox-btn-secondary:hover:not(:disabled) {
                        background-color: rgba(0, 51, 102, 0.08);
                        border-color: var(--color-blue-hover, #002244);
                        color: var(--color-blue-hover, #002244);
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(0, 51, 102, 0.08);
                    }

                    .sandbox-btn-secondary:active:not(:disabled) {
                        transform: translateY(0);
                    }

                    .sandbox-btn-primary {
                        background-color: var(--color-blue, #003366);
                        border: 1px solid var(--color-blue, #003366);
                        color: #ffffff;
                        box-shadow: 0 4px 12px rgba(0, 51, 102, 0.2);
                    }

                    .sandbox-btn-primary:hover:not(:disabled) {
                        background-color: var(--color-blue-hover, #002244);
                        border-color: var(--color-blue-hover, #002244);
                        transform: translateY(-1px);
                        box-shadow: 0 6px 16px rgba(0, 51, 102, 0.3);
                    }

                    .sandbox-btn-primary:active:not(:disabled) {
                        transform: translateY(0);
                    }

                    .sandbox-btn-accent {
                        background-color: var(--color-orange, #FF6600);
                        border: 1px solid var(--color-orange, #FF6600);
                        color: #ffffff;
                        box-shadow: 0 4px 12px rgba(255, 102, 0, 0.2);
                    }

                    .sandbox-btn-accent:hover:not(:disabled) {
                        background-color: var(--color-orange-hover, #e65c00);
                        border-color: var(--color-orange-hover, #e65c00);
                        transform: translateY(-1px);
                        box-shadow: 0 6px 16px rgba(255, 102, 0, 0.3);
                    }

                    .sandbox-btn-accent:active:not(:disabled) {
                        transform: translateY(0);
                    }

                    .sandbox-btn:disabled {
                        opacity: 0.65;
                        cursor: not-allowed;
                        transform: none !important;
                        box-shadow: none !important;
                    }

                    /* Sandbox Footer Layout */
                    .sandbox-footer {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-top: 1.5rem;
                        border-top: 1px solid #e2e8f0;
                        padding-top: 1.25rem;
                        gap: 0.75rem;
                    }

                    .sandbox-footer-end {
                        justify-content: flex-end;
                    }

                    .sandbox-footer-right {
                        display: flex;
                        gap: 0.75rem;
                        align-items: center;
                    }

                    @media (max-width: 768px) {
                        .sandbox-footer {
                            flex-direction: column-reverse;
                            align-items: stretch;
                            gap: 0.75rem;
                        }
                        
                        .sandbox-footer-right {
                            flex-direction: column;
                            align-items: stretch;
                            width: 100%;
                            gap: 0.75rem;
                        }

                        .sandbox-btn {
                            width: 100%;
                        }
                    }


                    /* Beautiful card container */
                    .sandbox-card {
                        background: #ffffff;
                        border: 1px solid #e2e8f0;
                        border-radius: 20px;
                        padding: 1.5rem;
                        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.03), 0 2px 4px -1px rgba(0, 0, 0, 0.02);
                        transition: all 0.2s ease-in-out;
                    }
                    .sandbox-card:hover {
                        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
                    }

                    .sandbox-close-btn {
                        background: none;
                        border: none;
                        cursor: pointer;
                        color: #94a3b8;
                        transition: all 0.2s ease-in-out;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 0.25rem;
                        border-radius: 50%;
                    }
                    .sandbox-close-btn:hover {
                        color: #475569;
                        background-color: #f1f5f9;
                        transform: rotate(90deg);
                    }

                    /* Premium input controls */
                    .sandbox-input {
                        width: 100%;
                        padding: 0.6rem 0.85rem;
                        border: 1px solid #cbd5e1;
                        border-radius: 10px;
                        font-size: 0.875rem;
                        background-color: #f8fafc;
                        color: #0f172a;
                        transition: all 0.2s ease-in-out;
                        box-sizing: border-box;
                    }

                    .sandbox-input:focus {
                        background-color: #ffffff;
                        border-color: var(--color-blue, #003366);
                        outline: none;
                        box-shadow: 0 0 0 3px rgba(0, 51, 102, 0.15);
                    }

                    .sandbox-input::placeholder {
                        color: #94a3b8;
                    }

                    .sandbox-label {
                        display: block;
                        font-size: 0.725rem;
                        font-weight: 700;
                        color: #475569;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                        margin-bottom: 0.35rem;
                    }
                `}</style>
                
                {/* Header */}
                <div style={{ padding: '1.5rem', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: '24px', borderTopRightRadius: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ background: 'var(--color-blue-light, #eff6ff)', color: 'var(--color-blue, #003366)', padding: '0.5rem', borderRadius: '12px' }}>
                            <Calculator size={24} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '1.2rem', color: '#0f172a', fontWeight: 800 }}>Sandbox de Análise Avulsa</h3>
                            <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>Simulador de faturamento e auditoria operacional de contas da concessionária</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="sandbox-close-btn">
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
                                        Unidade Consumidora (UC) (Opcional - Vinculação automática via OCR)
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

                                {pdfFile && (
                                    <div style={{ marginTop: '1.25rem', padding: '1rem', background: '#fff7ed', border: '1px solid #ffedd5', borderRadius: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                                            <input 
                                                type="checkbox" 
                                                id="applyStamp"
                                                checked={applyStamp}
                                                onChange={(e) => setApplyStamp(e.target.checked)}
                                                style={{ width: '18px', height: '18px', cursor: 'pointer', marginTop: '2px' }}
                                            />
                                            <label htmlFor="applyStamp" style={{ fontSize: '0.85rem', fontWeight: '600', color: '#9a3412', cursor: 'pointer', flex: 1 }}>
                                                Aviso para Não Pagar 
                                                <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'normal', color: '#c2410c', marginTop: '2px' }}>
                                                    (Quando ativo: descarta 2ª página e aplica carimbo de segurança no PDF)
                                                </span>
                                            </label>
                                        </div>
                                    </div>
                                )}

                                <div className="sandbox-footer sandbox-footer-end">
                                    <button 
                                        onClick={onClose} 
                                        className="sandbox-btn sandbox-btn-neutral"
                                    >
                                        <X size={16} /> Cancelar
                                    </button>
                                    <button 
                                        onClick={triggerUpload}
                                        disabled={!pdfFile}
                                        className="sandbox-btn sandbox-btn-primary"
                                    >
                                        <Calculator size={16} /> Analisar Conta de Energia
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Passo B: Painel de Resultados */}
                        {step === 'sandbox' && (
                            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
                                    
                                    {/* Coluna Concessionária */}
                                    <div className="sandbox-card" style={{ padding: '1.25rem' }}>
                                        <h4 className="sandbox-card-title" style={{ color: '#0f172a', fontWeight: 800, fontSize: '0.95rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem', marginBottom: '1.25rem', marginTop: 0 }}>
                                            <FileText size={18} style={{ color: '#64748b' }} /> Concessionária (Valores Auditados)
                                        </h4>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label className="sandbox-label">Mês Referência</label>
                                                <input 
                                                    type="month" 
                                                    value={formData.mes_referencia} 
                                                    onChange={e => setFormData({ ...formData, mes_referencia: e.target.value })} 
                                                    className="sandbox-input" 
                                                />
                                            </div>
                                            <div>
                                                <label className="sandbox-label">Vencimento</label>
                                                <input 
                                                    type="date" 
                                                    value={formData.vencimento} 
                                                    onChange={e => setFormData({ ...formData, vencimento: e.target.value })} 
                                                    className="sandbox-input" 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label className="sandbox-label">Leitura Anterior</label>
                                                <input 
                                                    type="date" 
                                                    value={formData.data_leitura_anterior} 
                                                    onChange={e => setFormData({ ...formData, data_leitura_anterior: e.target.value })} 
                                                    className="sandbox-input" 
                                                />
                                            </div>
                                            <div>
                                                <label className="sandbox-label">Leitura Atual</label>
                                                <input 
                                                    type="date" 
                                                    value={formData.data_leitura} 
                                                    onChange={e => setFormData({ ...formData, data_leitura: e.target.value })} 
                                                    className="sandbox-input" 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label className="sandbox-label">Consumo Total (kWh)</label>
                                                <input 
                                                    type="number" 
                                                    value={formData.consumo_kwh} 
                                                    onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })} 
                                                    className="sandbox-input"
                                                    style={{ fontWeight: 'bold' }} 
                                                />
                                            </div>
                                            <div>
                                                <label className="sandbox-label">Energia Injetada (kWh)</label>
                                                <input 
                                                    type="number" 
                                                    value={formData.energia_injetada} 
                                                    onChange={e => setFormData({ ...formData, energia_injetada: e.target.value })} 
                                                    className="sandbox-input"
                                                    style={{ fontWeight: 'bold', color: '#0284c7' }} 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label className="sandbox-label">Energia Compensada (kWh)</label>
                                                <input 
                                                    type="number" 
                                                    value={formData.consumo_compensado} 
                                                    onChange={e => setFormData({ ...formData, consumo_compensado: e.target.value })} 
                                                    className="sandbox-input"
                                                    style={{ fontWeight: 'bold' }} 
                                                />
                                            </div>
                                            <div>
                                                <label className="sandbox-label">Consumo em Reais (R$)</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.consumo_reais} 
                                                    onChange={e => handleCurrencyInputChange('consumo_reais', e.target.value)} 
                                                    className="sandbox-input" 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label className="sandbox-label">Iluminação Pública</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.iluminacao_publica} 
                                                    onChange={e => handleCurrencyInputChange('iluminacao_publica', e.target.value)} 
                                                    className="sandbox-input" 
                                                />
                                            </div>
                                            <div>
                                                <label className="sandbox-label">Outros</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.outros_lancamentos} 
                                                    onChange={e => handleCurrencyInputChange('outros_lancamentos', e.target.value)} 
                                                    className="sandbox-input" 
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label className="sandbox-label" title="Diferença unitária entre Consumo TUSD e Energia Compensada TUSD">Fio B (Vr Unit)</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.fio_b_vr_unit} 
                                                    onChange={e => handleCurrencyInputChange('fio_b_vr_unit', e.target.value)} 
                                                    className="sandbox-input" 
                                                    style={{ color: '#0f172a' }}
                                                />
                                            </div>
                                            <div>
                                                <label className="sandbox-label" title="Fio B Vr Unit * Qtd Compensada TUSD">Fio B (Total)</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.fio_b_total} 
                                                    onChange={e => handleCurrencyInputChange('fio_b_total', e.target.value)} 
                                                    className="sandbox-input" 
                                                    style={{ color: '#0f172a' }}
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div>
                                                <label className="sandbox-label" style={{ color: '#16a34a', fontWeight: 'bold' }}>Saldo kWh</label>
                                                <input 
                                                    type="number" 
                                                    value={formData.saldo_kwh} 
                                                    onChange={e => setFormData(prev => ({ ...prev, saldo_kwh: e.target.value }))} 
                                                    className="sandbox-input"
                                                    style={{ color: '#16a34a', fontWeight: 'bold', width: '100%' }} 
                                                    placeholder="0"
                                                />
                                            </div>
                                            <div>
                                                <label className="sandbox-label">Total Concessionária (Lido)</label>
                                                <input 
                                                    type="text" 
                                                    value={formData.valor_concessionaria} 
                                                    onChange={e => handleCurrencyInputChange('valor_concessionaria', e.target.value)} 
                                                    className="sandbox-input"
                                                    style={{ fontWeight: 'bold', color: '#059669', width: '100%' }} 
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
                                    <div className="sandbox-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                        <div>
                                            <h4 className="sandbox-card-title" style={{ color: '#0f172a', fontWeight: 800, fontSize: '0.95rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem', marginBottom: '1.25rem', marginTop: 0 }}>
                                                <Zap size={18} style={{ color: 'var(--color-orange, #FF6600)' }} /> Assinante (Simulação Sandbox)
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
                                                            style={{ width: '64px', padding: '0.4rem 0.5rem', borderRadius: '8px', border: '1px solid #d8b4fe', textAlign: 'center', fontWeight: 'bold', fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.2s', backgroundColor: 'white' }} 
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
                                                    {Number(formData.energia_injetada) > 0 && (
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', borderTop: '1px dashed #e2e8f0', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
                                                            <span style={{ color: '#64748b' }}>Energia Injetada:</span>
                                                            <span style={{ color: '#0284c7', fontWeight: 'bold' }}>{formData.energia_injetada} kWh</span>
                                                        </div>
                                                    )}
                                                    {Number(formData.saldo_kwh) > 0 && (
                                                        <div style={{ 
                                                            display: 'flex', 
                                                            justifyContent: 'space-between', 
                                                            fontSize: '0.8rem', 
                                                            borderTop: Number(formData.energia_injetada) > 0 ? 'none' : '1px dashed #e2e8f0', 
                                                            paddingTop: Number(formData.energia_injetada) > 0 ? '0' : '0.4rem', 
                                                            marginTop: Number(formData.energia_injetada) > 0 ? '0' : '0.2rem' 
                                                        }}>
                                                            <span style={{ color: '#64748b' }}>Saldo de Créditos:</span>
                                                            <span style={{ color: '#16a34a', fontWeight: 'bold' }}>{formData.saldo_kwh} kWh</span>
                                                        </div>
                                                    )}
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

                                {/* Campo para salvar observações da auditoria no histórico da fatura */}
                                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '16px', border: '1px solid #e2e8f0', marginTop: '1rem' }}>
                                    <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <FileText size={16} /> Observações da Auditoria
                                    </h5>
                                    <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>Esses avisos serão salvos no histórico da fatura e podem ser consultados depois.</p>
                                    <textarea
                                        className="sandbox-input"
                                        style={{ minHeight: '80px', resize: 'vertical' }}
                                        value={formData.observacoes_auditoria || ''}
                                        onChange={e => setFormData({ ...formData, observacoes_auditoria: e.target.value })}
                                        placeholder="Ex: Entrar em contato com a concessionária para ajustar compensação..."
                                    />
                                </div>

                                {/* Status da Conta de Energia (Concessionária) */}
                                <div style={{ background: 'white', padding: '1rem', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <h5 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Status de Pagamento (Concessionária)</h5>
                                    <div>
                                        <select 
                                            value={formData.energy_bill_status || 'pendente'}
                                            onChange={e => setFormData({ ...formData, energy_bill_status: e.target.value })}
                                            className="sandbox-input"
                                            style={{ cursor: 'pointer', fontWeight: 600, color: '#0f172a' }}
                                        >
                                            <option value="pendente">Pendente</option>
                                            <option value="inconsistente">Inconsistente</option>
                                            <option value="pago">Pago</option>
                                            <option value="vencida">Vencida</option>
                                            <option value="parcelada">Parcelada</option>
                                            <option value="contestada">Contestada</option>
                                        </select>
                                    </div>
                                </div>

                                 {/* Chaves de Pagamento */}
                                 <div style={{ background: '#f1f5f9', padding: '1rem', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <h5 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Chaves de Pagamento da Concessionária</h5>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                        <div>
                                            <label className="sandbox-label">Linha Digitável</label>
                                            <input 
                                                type="text" 
                                                value={formData.linha_digitavel} 
                                                onChange={e => setFormData({ ...formData, linha_digitavel: e.target.value })}
                                                placeholder="Código de barras da conta..." 
                                                className="sandbox-input" 
                                            />
                                        </div>
                                        <div>
                                            <label className="sandbox-label">PIX Copia e Cola</label>
                                            <input 
                                                type="text" 
                                                value={formData.pix_string} 
                                                onChange={e => setFormData({ ...formData, pix_string: e.target.value })}
                                                placeholder="PIX da conta..." 
                                                className="sandbox-input" 
                                            />
                                        </div>
                                    </div>
                                </div>



                                <div className="sandbox-footer">
                                    <button 
                                        onClick={handleReset} 
                                        disabled={isSubmitting}
                                        className="sandbox-btn sandbox-btn-discard"
                                    >
                                        <X size={16} /> Descartar Análise
                                    </button>

                                    <div className="sandbox-footer-right">
                                        <button 
                                            onClick={() => saveInvoice('sem_faturamento')}
                                            disabled={isSubmitting}
                                            className="sandbox-btn sandbox-btn-secondary"
                                        >
                                            <Ban size={16} /> Registrar Operacional (Sem Faturamento)
                                        </button>
                                        <button 
                                            onClick={() => saveInvoice('a_vencer')}
                                            disabled={isSubmitting}
                                            className="sandbox-btn sandbox-btn-accent"
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

            {/* Hidden wrapper for PDF capture */}
            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', pointerEvents: 'none' }}>
                <div ref={hiddenRef}>
                    {invoiceToDownload && renderHiddenInvoiceDetail(invoiceToDownload)}
                </div>
            </div>

            {isGeneratingPdf && (
                <div className="generation-overlay" style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(15, 23, 42, 0.85)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 1200,
                    backdropFilter: 'blur(8px)',
                    color: 'white'
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <Loader2 size={48} className="spin-animation" style={{ color: branding?.secondary_color || '#ff6600', animation: 'spin 1s linear infinite' }} />
                        <p style={{ marginTop: '1rem', fontWeight: 600, fontSize: '1.1rem', margin: 0 }}>Gerando PDF combinado...</p>
                        <p style={{ fontSize: '0.875rem', opacity: 0.8, margin: 0 }}>Mesclando Detalhamento com Boleto Asaas.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
