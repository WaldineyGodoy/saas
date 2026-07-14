import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { parseInvoice } from '../lib/api';
import { X, UploadCloud, Loader2, AlertCircle, FileText, CheckCircle2, Trash2, Save, ChevronDown, ChevronUp } from 'lucide-react';

// Necessário ter acesso ao pdfjs (mesma forma que o StandaloneAccountModal)
const getPdfJs = () => window.pdfjsLib;

export default function BatchInvoiceProcessor({ isOpen, onClose, usinaInfo, ucs, contas, profile, onSave }) {
    const [queue, setQueue] = useState([]); // Array of { id, file, status, data, ucInfo, alerts, error, selectedStatus, priorityVal }
    const [isDragging, setIsDragging] = useState(false);
    const [cycles, setCycles] = useState([]);
    const [ugContas, setUgContas] = useState([]);
    const fileInputRef = useRef(null);

    // Re-compute cycles when the modal opens or dependencies change
    useEffect(() => {
        if (!isOpen) return;

        // Identifica a UG
        const ug = ucs.find(u => u.tipo === 'ug');
        let sortedUgContas = [];
        
        if (ug) {
            sortedUgContas = contas
                .filter(c => c.uc_id === ug.id && c.data_leitura)
                .sort((a, b) => new Date(a.data_leitura) - new Date(b.data_leitura));
        }
        
        setUgContas(sortedUgContas);

        const getMonthFromRef = (ref) => {
            if (!ref) return null;
            const clean = ref.replace(/[^0-9]/g, '');
            if (clean.length === 6) {
                if (clean.startsWith('20')) return parseInt(clean.substring(4, 6), 10);
                return parseInt(clean.substring(0, 2), 10);
            }
            const parts = ref.split(/[-/.]/);
            if (parts.length >= 2) {
                if (parts[0].length === 4) return parseInt(parts[1], 10);
                return parseInt(parts[0], 10);
            }
            return null;
        };

        const computedCycles = Array.from({ length: 12 }, (_, i) => {
            const monthNumber = i + 1;
            
            // Cycle X starts with the UG reading in month X
            const ugConta = sortedUgContas.find(c => {
                const d = new Date(c.data_leitura);
                return (d.getUTCMonth() + 1) === monthNumber;
            });
            
            let startDate = null;
            let endDate = null;
            let label = 'Período sem lançamento de contas';

            if (ugConta) {
                // START date is this UG reading
                startDate = new Date(ugConta.data_leitura);
                
                // END date is the NEXT UG reading strictly greater than this one
                const idx = sortedUgContas.indexOf(ugConta);
                const nextConta = sortedUgContas.find((c, i) => i > idx && new Date(c.data_leitura) > new Date(ugConta.data_leitura));
                
                if (nextConta && nextConta.data_leitura) {
                    endDate = new Date(nextConta.data_leitura);
                } else {
                    // Fallback if no next reading exists yet
                    endDate = new Date(ugConta.data_leitura);
                    endDate.setDate(endDate.getDate() + 30);
                }

                label = `${startDate.toLocaleDateString('pt-BR')} até ${endDate.toLocaleDateString('pt-BR')}`;
            }

            return {
                id: `ciclo-${monthNumber}`,
                name: `Ciclo ${monthNumber}`,
                startDate,
                endDate,
                ugConta,
                label
            };
        });

        setCycles(computedCycles.reverse()); // Mais recentes primeiro
    }, [isOpen, ucs, contas]);

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
        addFilesToQueue(files);
    };

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
        addFilesToQueue(files);
    };

    const addFilesToQueue = (files) => {
        const newItems = files.map(file => ({
            id: Math.random().toString(36).substring(7),
            file,
            status: 'pending', // pending, processing, done, error, saved
            data: null,
            ucInfo: null, // { isNew, existingUc, tipo_compensacao_usina }
            alerts: [],
            error: null,
            selectedStatus: 'A Vencer',
            priorityVal: '', // Prioridade ou % para novas UCs
            isUg: false
        }));
        setQueue(prev => [...prev, ...newItems]);
    };

    // Processamento da Fila
    useEffect(() => {
        const processNext = async () => {
            const nextItemIndex = queue.findIndex(q => q.status === 'pending');
            if (nextItemIndex === -1) return;

            const item = queue[nextItemIndex];
            
            // Mark as processing
            setQueue(prev => {
                const newQ = [...prev];
                newQ[nextItemIndex] = { ...item, status: 'processing' };
                return newQ;
            });

            try {
                const reader = new FileReader();
                reader.readAsDataURL(item.file);
                
                reader.onload = async () => {
                    const base64 = reader.result;
                    try {
                        const parsedData = await parseInvoice(base64);
                        
                        let extractedCompensado = parsedData.consumo_compensado;
                        let extractedInjetada = parsedData.energia_injetada;
                        let extractedSaldo = parsedData.saldo_kwh;
                        let extractedUcNumber = parsedData.numero_uc || parsedData.codigo_cliente || parsedData.conta_contrato;
                        
                        let extractedCep = parsedData.cep || '';
                        let extractedClasse = parsedData.classe || '';
                        let extractedMunicipio = parsedData.municipio || '';

                        // Fallback Regex processing
                        const pdfjsLib = getPdfJs();
                        if (pdfjsLib) {
                            const pdf = await pdfjsLib.getDocument({ data: atob(base64.split(',')[1] || base64) }).promise;
                            let fullText = "";
                            for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
                                const page = await pdf.getPage(i);
                                const textContent = await page.getTextContent();
                                fullText += textContent.items.map(s => s.str).join(" ") + "\n";
                            }
                            const cleanText = fullText.replace(/\s+/g, ' ');

                            const parseValue = (v) => v ? parseFloat(v.replace('.', '').replace(',', '.')) : 0;
                            const parseConsumption = (raw) => {
                                if (!raw) return 0;
                                let cleaned = raw.trim();
                                if (cleaned.includes(',')) cleaned = cleaned.split(',')[0];
                                return parseInt(cleaned.replace(/\D/g, ''), 10) || 0;
                            };

                            if (!extractedCompensado) {
                                const compensadoMatch = cleanText.match(/(?:Energia\sCompensada|GX\sCOMP|GXCOMP|Consumo\sCompensado|G\dComp[^ ]*).{0,40}?(?:kWh|KWH)\s+([\d,.]+)/i);
                                if (compensadoMatch) extractedCompensado = parseValue(compensadoMatch[1]);
                            }

                            if (!extractedInjetada) {
                                const injetadaMatch = cleanText.match(/Energia\s+Ativa\s+Injetada\s+(?:[A-Za-zÀ-ÖØ-öø-ÿ]+\s+)?([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i);
                                if (injetadaMatch) extractedInjetada = parseConsumption(injetadaMatch[4]);
                            }

                            if (!extractedSaldo) {
                                const saldoMatch = cleanText.match(/Saldo\s+atualizado\s+de\s+cr[eé]ditos\s*=\s*([\d.,]+)/i);
                                if (saldoMatch) extractedSaldo = parseConsumption(saldoMatch[1]);
                            }

                            if (!extractedUcNumber) {
                                const regexMatch = cleanText.match(/(?:Conta Contrato|C[óo]digo do Cliente|Instala[çc][ãa]o)[:\s]*(\d{9,11})/i) ||
                                                   cleanText.match(/(\d{10})/);
                                if (regexMatch) extractedUcNumber = regexMatch[1] || regexMatch[0];
                            }
                            
                            // Check for Parcelamento that might have been lumped into outros_lancamentos by OCR
                            if (!parsedData.parcelamento) {
                                const parcMatch = cleanText.match(/((?:Parc|Acordo|Presta[çc][ãa]o)[^\d]*\d+[\s\/\-a-zA-Z]*\d*).*?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/i) || cleanText.match(/(Parcelamento|Acordo|Ref Negocia[çc][ãa]o)[^\d]*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/i);
                                if (parcMatch) {
                                    const pVal = parseValue(parcMatch[2]);
                                    if (pVal > 0) {
                                        parsedData.parcelamento = pVal;
                                        parsedData.parcelamento_descricao = parcMatch[1];
                                        // Adjust if OCR incorrectly grouped it in outros OR consumo
                                        if ((parsedData.outros_lancamentos || 0) >= pVal) {
                                            parsedData.outros_lancamentos -= pVal;
                                        } else if ((parsedData.consumo_reais || 0) > pVal + 50) {
                                            // Se o consumo faturado for muito grande e a API não subtraiu o parcelamento
                                            // Vamos deduzir do consumo_reais também, assumindo que foi agrupado lá
                                            parsedData.consumo_reais -= pVal;
                                        }
                                    }
                                } else {
                                    const debugParc = cleanText.match(/.{0,40}(?:Parc|Acordo).{0,40}/i);
                                    if (debugParc) {
                                        parsedData.alertas = parsedData.alertas || [];
                                        parsedData.alertas.push(`DEBUG TEXTO PARCELAMENTO: "${debugParc[0]}"`);
                                    }
                                }
                            }
                            
                            if (!extractedCep) {
                                const cepMatch = cleanText.match(/CEP[\s:-]*(\d{5}-?\d{3})/i) || cleanText.match(/\b(\d{5}-\d{3})\b/);
                                if (cepMatch) extractedCep = cepMatch[1];
                            }
                            
                            if (!extractedClasse) {
                                if (cleanText.match(/B1\s+Residencial/i)) extractedClasse = 'B1 Residencial';
                                else if (cleanText.match(/B3\s+Comercial/i)) extractedClasse = 'B3 Comercial';
                                else {
                                    const classeMatch = cleanText.match(/(?:Classe|Subclasse)[\s:-]*([A-Za-z0-9]+\s+[A-Za-z]+)/i);
                                    if (classeMatch) extractedClasse = classeMatch[1];
                                }
                            }
                        }
                        if (extractedCep && !extractedMunicipio) {
                            try {
                                const cleanCep = extractedCep.replace(/\D/g, '');
                                if (cleanCep.length === 8) {
                                    const viaCepRes = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
                                    if (viaCepRes.ok) {
                                        const viaCepData = await viaCepRes.json();
                                        if (viaCepData.localidade) {
                                            extractedMunicipio = viaCepData.localidade.toUpperCase();
                                        }
                                    }
                                }
                            } catch (e) {
                                console.log('Erro ao buscar CEP no ViaCEP:', e);
                            }
                        }

                        const autoAlerts = [];
                        
                        const extractedData = {
                            mes_referencia: parsedData.mes_referencia ? parsedData.mes_referencia.substring(0, 7) : '',
                            data_leitura: parsedData.data_leitura ? parsedData.data_leitura.split('T')[0] : '',
                            data_leitura_anterior: parsedData.data_leitura_anterior ? parsedData.data_leitura_anterior.split('T')[0] : '',
                            vencimento: parsedData.vencimento ? parsedData.vencimento.split('T')[0] : '',
                            consumo_kwh: parsedData.consumo_kwh || 0,
                            energia_injetada: extractedInjetada || 0,
                            energia_compensada: extractedCompensado || 0,
                            saldo_kwh: extractedSaldo || 0,
                            valor_concessionaria: parsedData.valor_a_pagar || parsedData.valorTotal || 0,
                            numero_uc: extractedUcNumber || '',
                            parcelamento: parsedData.parcelamento || 0,
                            parcelamento_descricao: parsedData.parcelamento_descricao || '',
                            consumo_reais: parsedData.consumo_reais || 0,
                            iluminacao_publica: parsedData.iluminacao_publica || 0,
                            outros_lancamentos: parsedData.outros_lancamentos || 0,
                            cep: extractedCep || '',
                            municipio: extractedMunicipio || '',
                            classe: extractedClasse || '',
                            pdfBase64: base64
                        };

                        let ucInfo = { isNew: true, existingUc: null };
                        
                        if (extractedUcNumber) {
                            const existingUc = ucs.find(u => u.numero_uc === extractedUcNumber);
                            if (existingUc) {
                                ucInfo = { isNew: false, existingUc };
                                
                                // Auditoria de Parcelamento (Alerta Fixo)
                                if (extractedData.parcelamento > 0) {
                                    autoAlerts.push(`Auditoria: Parcelamento identificado (${extractedData.parcelamento_descricao} - R$ ${extractedData.parcelamento}). Verifique se é devido.`);
                                }
                            }
                        } else {
                            autoAlerts.push('Não foi possível extrair a UC desta fatura.');
                        }

                        const isUg = extractedData.energia_injetada > 0;

                        setQueue(prev => {
                            const newQ = [...prev];
                            newQ[nextItemIndex] = { 
                                ...item, 
                                status: 'done', 
                                data: extractedData,
                                ucInfo,
                                alerts: autoAlerts,
                                isUg,
                                priorityVal: ucInfo.isNew ? '' : (usinaInfo.tipo_compensacao === 'porcentagem' ? ucInfo.existingUc.porcentagem : ucInfo.existingUc.prioridade)
                            };
                            return newQ;
                        });

                    } catch (err) {
                        setQueue(prev => {
                            const newQ = [...prev];
                            newQ[nextItemIndex] = { ...item, status: 'error', error: err.message };
                            return newQ;
                        });
                    }
                };
            } catch (err) {
                setQueue(prev => {
                    const newQ = [...prev];
                    newQ[nextItemIndex] = { ...item, status: 'error', error: err.message };
                    return newQ;
                });
            }
        };

        if (queue.some(q => q.status === 'pending') && !queue.some(q => q.status === 'processing')) {
            processNext();
        }
    }, [queue, ucs, usinaInfo]);


    const updateItemStatus = (id, newStatus) => {
        setQueue(prev => prev.map(q => q.id === id ? { ...q, selectedStatus: newStatus } : q));
    };

    const updateItemPriority = (id, val) => {
        setQueue(prev => prev.map(q => q.id === id ? { ...q, priorityVal: val } : q));
    };

    const removeItem = (id) => {
        setQueue(prev => prev.filter(q => q.id !== id));
    };

    const handleSaveItem = async (item) => {
        try {
            setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing' } : q));
            
            // 1. Create UC if new
            let ucId = item.ucInfo?.existingUc?.id;
            let tipo = item.isUg ? 'ug' : 'uc';

            if (item.ucInfo?.isNew && item.data?.numero_uc) {
                const { data: checkUc } = await supabase.from('standalone_ucs').select('id').eq('numero_uc', item.data.numero_uc).single();
                
                if (checkUc) {
                    ucId = checkUc.id;
                } else {
                    // Deduction limits check
                    if (profile && profile.role !== 'super_admin') {
                        const totalTokens = (profile.free_tokens || 0) + (profile.tokens || 0);
                        if (totalTokens < 10 && ucs.length >= 3) {
                            throw new Error('Limite Free excedido para novas UCs.');
                        }
                    }

                    const ucData = {
                        usina_id: usinaInfo.id,
                        numero_uc: item.data.numero_uc,
                        tipo: tipo,
                        prioridade: usinaInfo.tipo_compensacao === 'prioridade' ? (item.priorityVal || 2) : 1,
                        porcentagem: usinaInfo.tipo_compensacao === 'porcentagem' ? (item.priorityVal || 0) : 0,
                        conta_saldo: false,
                        cep: item.data.cep || null,
                        municipio: item.data.municipio || null,
                        classe: item.data.classe || null
                    };

                    const { data, error } = await supabase.from('standalone_ucs').insert(ucData).select().single();
                    if (error) throw error;
                    ucId = data.id;
                }
            }

            if (!ucId) throw new Error("ID da UC não definido ou falhou.");

            // 2. Token Deduction for Saving Conta
            if (profile && profile.role !== 'super_admin') {
                const { data: existingContas } = await supabase
                    .from('standalone_contas')
                    .select('id')
                    .eq('mes_referencia', item.data.mes_referencia)
                    .limit(3);
                
                if (existingContas && existingContas.length >= 3) {
                    const { data: pData } = await supabase.from('profiles').select('tokens, free_tokens').eq('id', profile.id).single();
                    let freeT = pData.free_tokens || 0;
                    let paidT = pData.tokens || 0;
                    if ((freeT + paidT) < 10) throw new Error('Sem tokens para salvar a análise.');

                    if (freeT >= 10) freeT -= 10;
                    else {
                        const rem = 10 - freeT;
                        freeT = 0;
                        paidT -= rem;
                    }

                    await supabase.from('profiles').update({ free_tokens: freeT, tokens: paidT }).eq('id', profile.id);
                    await supabase.from('token_transactions').insert({
                        profile_id: profile.id,
                        amount: -10,
                        type: 'usage',
                        status: 'completed',
                        description: `Processamento Lote - UC ${item.data.numero_uc}`
                    });
                }
            }

            // 3. Upload PDF
            let pdfUrl = '';
            if (item.file) {
                const fileExt = item.file.name.split('.').pop();
                const fileName = `${ucId}-${Date.now()}.${fileExt}`;
                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('invoices')
                    .upload(`standalone/${fileName}`, item.file);
                if (!uploadError && uploadData) {
                    const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(`standalone/${fileName}`);
                    pdfUrl = publicUrl;
                }
            }

            // 4. Save Invoice
            const invoiceData = {
                uc_id: ucId,
                mes_referencia: item.data.mes_referencia,
                data_leitura: item.data.data_leitura || null,
                data_leitura_anterior: item.data.data_leitura_anterior || null,
                vencimento: item.data.vencimento || null,
                consumo_kwh: item.data.consumo_kwh,
                energia_injetada: item.data.energia_injetada,
                energia_compensada: item.data.energia_compensada,
                saldo_kwh: item.data.saldo_kwh,
                valor_concessionaria: item.data.valor_concessionaria,
                parcelamento: item.data.parcelamento,
                
                // Valores cobrados
                consumo_reais: item.data.consumo_reais || 0,
                fio_b_total: item.data.fio_b_total || 0,
                fio_b_vr_unit: item.data.fio_b_vr_unit || 0,
                iluminacao_publica: item.data.iluminacao_publica || 0,
                outros_lancamentos: item.data.outros_lancamentos || 0,

                status_conta: item.selectedStatus,
                pdf_url: pdfUrl,
                alertas: item.alerts
            };

            const { error } = await supabase.from('standalone_contas').insert(invoiceData);
            if (error) throw error;

            setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'saved' } : q));
            if (onSave) onSave();

        } catch (err) {
            setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', error: err.message } : q));
        }
    };

    if (!isOpen) return null;

    // Group queue by Cycle
    const getInvoiceCycle = (data) => {
        if (!data) return "Desconhecido";
        
        let targetMonthNumber = null;

        if (data.data_leitura) {
            const lDate = new Date(data.data_leitura);
            
            // 1. Exact Contiguous Match
            const cycleMatch = cycles.find(cyc => cyc.startDate && cyc.endDate && lDate >= cyc.startDate && lDate < cyc.endDate);
            if (cycleMatch) return cycleMatch.name;

            // 2. Intelligent gap filling using threshold day
            let avgUgDay = 15;
            const validUgDates = cycles.filter(cyc => cyc.startDate).map(cyc => cyc.startDate.getUTCDate());
            if (validUgDates.length > 0) {
                avgUgDay = Math.round(validUgDates.reduce((a,b) => a+b, 0) / validUgDates.length);
            }

            let targetMonth = lDate.getUTCMonth() + 1;
            const ugDay = lDate.getUTCDate();
            
            const cycForMonth = cycles.find(c => parseInt(c.id.split('-')[1]) === targetMonth);
            let thresholdDay = avgUgDay;
            if (cycForMonth && cycForMonth.startDate) {
                thresholdDay = cycForMonth.startDate.getUTCDate();
            }
            
            if (ugDay < thresholdDay) {
                targetMonth = targetMonth - 1;
                if (targetMonth === 0) targetMonth = 12;
            }
            
            const matchedCyc = cycles.find(c => c.id === `ciclo-${targetMonth}`);
            if (matchedCyc) return matchedCyc.name;
        } 
        
        // Se não tinha data de leitura, tenta pelo mês de referência
        if (data.mes_referencia) {
            const m = getMonthFromRef(data.mes_referencia);
            const fallbackCycle = cycles.find(c => parseInt(c.id.split('-')[1], 10) === m);
            if (fallbackCycle) return fallbackCycle.name;
        }

        return `Mês Ref: ${data.mes_referencia || 'Desconhecido'}`;
    };

    const groupedQueue = queue.reduce((acc, item) => {
        const groupName = item.status === 'done' || item.status === 'saved' ? getInvoiceCycle(item.data) : 'Processando / Pendentes';
        if (!acc[groupName]) acc[groupName] = [];
        acc[groupName].push(item);
        return acc;
    }, {});


    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative bg-gray-50 rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
                
                {/* Header */}
                <div className="bg-white px-6 py-4 border-b border-gray-200 flex justify-between items-center shadow-sm z-10">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                            <UploadCloud className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800">Motor de Processamento em Lote</h2>
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Usina: {usinaInfo?.nome}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Dropzone */}
                <div 
                    className={`m-6 p-8 border-2 border-dashed rounded-xl transition-all flex flex-col items-center justify-center cursor-pointer ${isDragging ? 'border-emerald-500 bg-emerald-50 scale-[1.01]' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <UploadCloud className={`w-12 h-12 mb-3 ${isDragging ? 'text-emerald-500' : 'text-gray-400'}`} />
                    <p className="text-gray-600 font-medium text-lg">Arraste e solte os PDFs aqui</p>
                    <p className="text-gray-400 text-sm mt-1">ou clique para selecionar múltiplos arquivos</p>
                    <input type="file" multiple accept=".pdf" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
                </div>

                {/* Queue List */}
                <div className="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar">
                    {Object.keys(groupedQueue).length > 0 ? (
                        Object.entries(groupedQueue).sort((a,b) => a[0].localeCompare(b[0])).map(([groupName, items]) => (
                            <div key={groupName} className="mb-6">
                                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3 bg-gray-200/50 py-1.5 px-3 rounded-lg flex items-center">
                                    {groupName}
                                    <span className="ml-2 bg-gray-600 text-white text-[10px] px-2 py-0.5 rounded-full">{items.length} faturas</span>
                                </h3>
                                <div className="space-y-3">
                                    {items.map(item => (
                                        <div key={item.id} className={`bg-white border rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all ${item.status === 'saved' ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200 hover:border-gray-300'}`}>
                                            
                                            <div className="flex items-center flex-1">
                                                <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 mr-4">
                                                    {item.status === 'pending' && <FileText className="w-6 h-6 text-gray-400" />}
                                                    {item.status === 'processing' && <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />}
                                                    {item.status === 'done' && <CheckCircle2 className="w-6 h-6 text-blue-500" />}
                                                    {item.status === 'saved' && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
                                                    {item.status === 'error' && <AlertCircle className="w-6 h-6 text-red-500" />}
                                                </div>
                                                
                                                <div className="flex-1">
                                                    <h4 className="text-sm font-bold text-gray-800 line-clamp-1">{item.file.name}</h4>
                                                    
                                                    {item.status === 'done' && item.data && (
                                                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs font-medium text-gray-500">
                                                            <span className="bg-gray-100 px-2 py-0.5 rounded">UC: {item.data.numero_uc}</span>
                                                            <span className="bg-gray-100 px-2 py-0.5 rounded">Lida: {item.data.data_leitura || '---'}</span>
                                                            {item.ucInfo?.isNew && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Nova UC</span>}
                                                            {item.isUg && <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded">Unidade Geradora</span>}
                                                        </div>
                                                    )}
                                                    
                                                    {item.status === 'error' && (
                                                        <p className="text-xs text-red-600 font-medium mt-1">{item.error}</p>
                                                    )}
                                                    
                                                    {item.alerts?.length > 0 && (
                                                        <div className="mt-2 space-y-1">
                                                            {item.alerts.map((al, idx) => (
                                                                <p key={idx} className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-100 flex items-center">
                                                                    <AlertCircle className="w-3 h-3 mr-1 shrink-0" /> {al}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            
                                            {item.status === 'done' && (
                                                <div className="flex flex-col lg:flex-row items-end lg:items-center gap-3 shrink-0 mt-3 lg:mt-0">
                                                    
                                                    {/* Prioridade ou Porcentagem */}
                                                    <div className="flex flex-col">
                                                        <label className="text-[10px] font-bold text-gray-400 uppercase">{usinaInfo.tipo_compensacao === 'porcentagem' ? 'Cota (%)' : 'Prioridade'}</label>
                                                        {item.ucInfo?.isNew ? (
                                                            <input 
                                                                type="number" 
                                                                value={item.priorityVal} 
                                                                onChange={(e) => updateItemPriority(item.id, e.target.value)}
                                                                className="w-20 text-sm border-gray-200 rounded-lg p-1.5 focus:ring-1 focus:ring-emerald-500 font-medium"
                                                                placeholder={usinaInfo.tipo_compensacao === 'porcentagem' ? '%' : 'Nº'}
                                                            />
                                                        ) : (
                                                            <span className="w-20 inline-block text-sm bg-gray-100 border border-gray-200 text-gray-500 rounded-lg p-1.5 text-center font-bold">
                                                                {item.priorityVal}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Status da Fatura */}
                                                    <div className="flex flex-col">
                                                        <label className="text-[10px] font-bold text-gray-400 uppercase">Status <span className="text-red-500">*</span></label>
                                                        <select 
                                                            value={item.selectedStatus} 
                                                            onChange={(e) => updateItemStatus(item.id, e.target.value)}
                                                            className="w-32 text-sm border-gray-200 rounded-lg p-1.5 focus:ring-1 focus:ring-emerald-500 font-medium bg-white"
                                                        >
                                                            <option value="A Vencer">A Vencer</option>
                                                            <option value="Vencido">Vencido</option>
                                                            <option value="Pago">Pago</option>
                                                            <option value="Parcelada">Parcelada</option>
                                                            <option value="Contestada">Contestada</option>
                                                        </select>
                                                    </div>
                                                    
                                                    {/* Actions */}
                                                    <div className="flex items-center gap-2 border-l border-gray-200 pl-3 h-full">
                                                        <button onClick={() => handleSaveItem(item)} className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg transition-colors font-medium shadow-sm flex items-center" title="Processar (Salvar)">
                                                            Processar
                                                        </button>
                                                        <button onClick={() => removeItem(item.id)} className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors" title="Excluir da fila">
                                                            <Trash2 className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {item.selectedStatus === 'Pago' && item.status === 'done' && (
                                                <div className="absolute top-0 right-10 -mt-2.5 bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm border border-blue-200 flex items-center">
                                                    CDC Ativo
                                                </div>
                                            )}

                                            {item.status === 'saved' && (
                                                <div className="shrink-0 flex items-center ml-auto">
                                                    <span className="text-emerald-600 font-bold text-sm flex items-center bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-200">
                                                        <CheckCircle2 className="w-4 h-4 mr-2" />
                                                        Processado
                                                    </span>
                                                    <button onClick={() => removeItem(item.id)} className="ml-3 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                            
                                            {item.status === 'error' && (
                                                <button onClick={() => removeItem(item.id)} className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors shrink-0 ml-auto">
                                                    <Trash2 className="w-5 h-5" />
                                                </button>
                                            )}

                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400">
                            <FileText className="w-16 h-16 mb-4 opacity-30" />
                            <p className="font-medium">Nenhuma fatura na esteira.</p>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                {queue.length > 0 && (
                    <div className="bg-white px-6 py-4 border-t border-gray-200 flex justify-end items-center shrink-0">
                        <button 
                            onClick={onClose} 
                            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all hover:-translate-y-0.5 flex items-center"
                        >
                            <CheckCircle2 className="w-5 h-5 mr-2" />
                            Concluir e Fechar
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
