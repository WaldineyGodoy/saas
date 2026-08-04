import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { LayoutDashboard, Plus, FileText, AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Activity, Zap, Edit, Trash2, Save, X, Coins, UploadCloud, Loader2, Sun, Home, Moon, Banknote, PiggyBank, DollarSign, AlertTriangle, Eye, Download, HelpCircle } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import StandaloneAccountModal from '../components/StandaloneAccountModal';
import StandaloneUsinaModal from '../components/StandaloneUsinaModal';
import BatchInvoiceProcessor from '../components/BatchInvoiceProcessor';
import { useAuth } from '../contexts/AuthContext';

export default function StandaloneAnalysis() {
    const { profile, user } = useAuth();
    const [usinas, setUsinas] = useState([]);
    const [selectedUsinaId, setSelectedUsinaId] = useState(() => localStorage.getItem('lastSelectedUsinaId') || '');
    const [usinaInfo, setUsinaInfo] = useState(null);
    const [irradianciaInfo, setIrradianciaInfo] = useState(null);
    const [ucs, setUcs] = useState([]);
    const [contas, setContas] = useState([]);
    const [cycles, setCycles] = useState([]);
    const [selectedCycleId, setSelectedCycleId] = useState('all');
    const [cosipRates, setCosipRates] = useState([]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
    const [showTokensPopup, setShowTokensPopup] = useState(false);

    const [alertPopup, setAlertPopup] = useState(null); // { isOpen, alertas, ucName }
    
    // CRUD States
    const [editContaModal, setEditContaModal] = useState(null);
    const [deleteModal, setDeleteModal] = useState(null);
    const [createUsinaModal, setCreateUsinaModal] = useState({ isOpen: false, nome: '', tipo_compensacao: 'prioridade' });
    const [editUsinaModal, setEditUsinaModal] = useState(false);
    const [showVerificationAlert, setShowVerificationAlert] = useState(false);
    const [activeTooltip, setActiveTooltip] = useState(null);

    // ----------------- IMPORT DEMONSTRATIVO -----------------
    const fileInputDemonstrativoRef = useRef(null);
    const [isExtractingDemonstrativo, setIsExtractingDemonstrativo] = useState(false);

    const handleImportDemonstrativo = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!selectedUsinaId) {
            setAlertPopup({ isOpen: true, alertas: ['Selecione uma Usina primeiro.'] });
            return;
        }

        if (file.type !== 'application/pdf') {
            setAlertPopup({ isOpen: true, alertas: ['Por favor, selecione um arquivo PDF.'] });
            return;
        }

        setIsExtractingDemonstrativo(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const base64 = reader.result.toString().split(',')[1];
                
                const { data, error } = await supabase.functions.invoke('parse-demonstrativo', {
                    body: { pdfBase64: base64 }
                });

                if (error) throw error;
                if (!data || !data.ucs || data.ucs.length === 0) {
                    throw new Error("Nenhuma UC encontrada no documento.");
                }

                let isInferredPorcentagem = false;
                const sumValues = data.ucs.reduce((acc, curr) => acc + curr.valor, 0);
                if (Math.abs(sumValues - 100) < 1 || data.ucs.some(u => u.valor > 100 || !Number.isInteger(u.valor))) {
                    isInferredPorcentagem = true;
                }
                const newRateioType = isInferredPorcentagem ? 'porcentagem' : 'prioridade';

                await supabase.from('standalone_usinas').update({ tipo_compensacao: newRateioType }).eq('id', selectedUsinaId);
                
                const { data: existingUcs, error: ucsError } = await supabase
                    .from('standalone_ucs')
                    .select('id, numero_uc')
                    .eq('usina_id', selectedUsinaId);
                
                if (ucsError) throw ucsError;

                for (const item of data.ucs) {
                    const cleanUcNum = item.uc.replace(/\D/g, '');
                    let dbUc = existingUcs.find(u => u.numero_uc.replace(/\D/g, '') === cleanUcNum);
                    
                    const payload = {
                        usina_id: selectedUsinaId,
                        numero_uc: cleanUcNum,
                        tipo: 'beneficiaria',
                        prioridade: newRateioType === 'prioridade' ? item.valor : 1,
                        porcentagem: newRateioType === 'porcentagem' ? item.valor : 0,
                        conta_saldo: false
                    };

                    if (dbUc) {
                        await supabase.from('standalone_ucs').update(payload).eq('id', dbUc.id);
                    } else {
                        await supabase.from('standalone_ucs').insert(payload);
                    }
                }

                await loadData();
                setAlertPopup({ isOpen: true, alertas: [`Demonstrativo processado. ${data.ucs.length} UCs vinculadas (Regra: ${newRateioType === 'prioridade' ? 'Prioridade' : 'Porcentagem'}).`] });
            };
        } catch (error) {
            console.error('Erro ao processar demonstrativo:', error);
            setAlertPopup({ isOpen: true, alertas: ['Erro ao processar o demonstrativo: ' + error.message] });
        } finally {
            setIsExtractingDemonstrativo(false);
            if (fileInputDemonstrativoRef.current) {
                fileInputDemonstrativoRef.current.value = '';
            }
        }
    };

    const loadData = async () => {
        if (!user || !profile) return;
        setLoading(true);
        // Load Usinas based on role
        let usinasQuery = supabase.from('standalone_usinas').select('*').order('nome');
        
        if (profile.role === 'admin') {
            const { data: subordinates } = await supabase.from('profiles').select('id').eq('superior_id', user.id);
            const subIds = subordinates ? subordinates.map(s => s.id) : [];
            const allowedIds = [user.id, ...subIds];
            usinasQuery = usinasQuery.in('owner_id', allowedIds);
        } else if (profile.role !== 'super_admin') {
            usinasQuery = usinasQuery.eq('owner_id', user.id);
        }

        const { data: usinasData } = await usinasQuery;
        setUsinas(usinasData || []);

        const { data: cosipData } = await supabase.from('cosip_rates').select('*');
        setCosipRates(cosipData || []);
        
        if (usinasData && usinasData.length > 0) {
            let currentUsinaId = selectedUsinaId;
            // Verifica se a usina selecionada ainda existe, se não, pega a primeira
            if (!currentUsinaId || !usinasData.find(u => u.id === currentUsinaId)) {
                currentUsinaId = usinasData[0].id;
            }
            setSelectedUsinaId(currentUsinaId);
            localStorage.setItem('lastSelectedUsinaId', currentUsinaId);
            
            const usina = usinasData.find(u => u.id === currentUsinaId);
            setUsinaInfo(usina);
            
            if (usina && usina.ibge_code) {
                const { data: irrData } = await supabase.from('irradiancia').select('*').eq('"cod.ibge"', usina.ibge_code).single();
                setIrradianciaInfo(irrData);
            } else {
                setIrradianciaInfo(null);
            }

            // Load UCs for this usina
            const { data: ucsData } = await supabase.from('standalone_ucs').select('*').eq('usina_id', currentUsinaId);
            setUcs(ucsData || []);

            // Load Contas for these UCs
            if (ucsData && ucsData.length > 0) {
                const ucIds = ucsData.map(u => u.id);
                const { data: contasData } = await supabase.from('standalone_contas').select('*').in('uc_id', ucIds);
                
                let uniqueContas = [];
                if (contasData) {
                    const seen = new Set();
                    const sorted = [...contasData].sort((a, b) => (b.id > a.id ? 1 : -1)); // keep newest
                    for (const c of sorted) {
                        let mesRef = c.mes_referencia ? c.mes_referencia.replace(/[^0-9]/g, '') : '';
                        if (mesRef.length === 6 && mesRef.startsWith('20')) {
                            mesRef = mesRef.substring(4, 6) + mesRef.substring(0, 4);
                        }
                        if (!mesRef && c.data_leitura) {
                            mesRef = c.data_leitura.substring(0, 7).replace('-', '');
                        }
                        const key = `${c.uc_id}-${mesRef}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            uniqueContas.push(c);
                        }
                    }
                }
                setContas(uniqueContas);
            } else {
                setContas([]);
            }
        }
        setLoading(false);
    };

    useEffect(() => {
        if (user && profile) {
            loadData();
        }
    }, [user, profile, selectedUsinaId]);

    // Compute cycles
    useEffect(() => {
        if (!ucs.length || !contas.length) {
            setCycles([]);
            return;
        }

        const ug = ucs.find(u => u.tipo === 'ug');
        if (!ug) {
            setCycles([]);
            return;
        }

        const ugContas = contas
            .filter(c => c.uc_id === ug.id && c.data_leitura)
            .sort((a, b) => new Date(a.data_leitura) - new Date(b.data_leitura));

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
            const ugConta = ugContas.find(c => {
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
                const idx = ugContas.indexOf(ugConta);
                const nextConta = ugContas.find((c, i) => i > idx && new Date(c.data_leitura) > new Date(ugConta.data_leitura));
                
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

        // Current UI expects the list in some order? We can keep 1 to 12 or 12 to 1
        setCycles(computedCycles.reverse()); // 12 first down to 1
        if (computedCycles.length > 0 && selectedCycleId === 'all') {
            // Default to the most recent cycle that actually has invoices
            const defaultCycle = computedCycles.find(c => c.ugConta) || computedCycles[0];
            setSelectedCycleId(defaultCycle.id);
        }
    }, [ucs, contas]);


    const handleSaveConta = async () => {
        try {
            const dataToSave = {
                mes_referencia: editContaModal.mes_referencia,
                data_leitura: editContaModal.data_leitura || null,
                vencimento: editContaModal.vencimento || null,
                consumo_kwh: editContaModal.consumo_kwh,
                energia_injetada: editContaModal.energia_injetada,
                energia_compensada: editContaModal.energia_compensada,
                saldo_kwh: editContaModal.saldo_kwh,
                iluminacao_publica: editContaModal.iluminacao_publica || 0,
                parcelamento: editContaModal.parcelamento || 0,
                outros_lancamentos: editContaModal.outros_lancamentos || 0,
                consumo_reais: editContaModal.consumo_reais || 0,
                fio_b_total: editContaModal.fio_b_total || 0,
                valor_concessionaria: editContaModal.valor_concessionaria || 0
            };

            if (editContaModal.id) {
                const { error } = await supabase.from('standalone_contas').update(dataToSave).eq('id', editContaModal.id);
                if (error) throw error;
            }
            loadData();
            setEditContaModal(null);
        } catch (err) {
            alert('Erro ao salvar fatura: ' + err.message);
        }
    };

    const confirmDelete = async () => {
        try {
            if (deleteModal.type === 'conta') {
                const { error } = await supabase.from('standalone_contas').delete().eq('id', deleteModal.id);
                if (error) throw error;
            }
            loadData();
            setDeleteModal(null);
        } catch (err) {
            alert('Erro ao excluir: ' + err.message);
        }
    };

    const handleCreateUsina = () => {
        setCreateUsinaModal({ isOpen: true, nome: '', tipo_compensacao: 'prioridade' });
    };
    const handleGeneratePDF = async () => {
        if (!profile || (profile.tokens || 0) <= 0) {
            setShowTokensPopup(true);
            return;
        }

        const element = document.getElementById('pdf-content');
        if (!element) return;
        
        try {
            setIsGeneratingPDF(true);
            // wait a tick for react to render the client header if needed
            await new Promise(r => setTimeout(r, 100));

            const canvas = await html2canvas(element, { scale: 2, useCORS: true });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            
            const pdfWidth = pdf.internal.pageSize.getWidth();
            // A4 page height is 297mm. If canvas height is larger, it might be truncated or scaled down.
            // We'll scale it to fit the width.
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            
            const cycle = cycles.find(c => c.id === selectedCycleId);
            pdf.save(`relatorio_${usinaInfo?.nome || 'usina'}_${cycle?.name || 'ciclo'}.pdf`);
        } catch (error) {
            console.error('Erro ao gerar PDF:', error);
            alert('Erro ao gerar PDF. Tente novamente.');
        } finally {
            setIsGeneratingPDF(false);
        }
    };

    // Render Data
    const renderDashboard = () => {
        if (loading) return <div className="p-8 text-center text-gray-500">Carregando dados...</div>;
        if (!usinaInfo) return <div className="p-8 text-center text-gray-500">Nenhuma usina encontrada.</div>;

        const cycle = cycles.find(c => c.id === selectedCycleId);
        
        let filteredContas = contas;
        if (cycle && selectedCycleId !== 'all') {
            filteredContas = contas.filter(c => {
                let targetMonthNumber = null;

                if (c.data_leitura) {
                    const lDate = new Date(c.data_leitura);
                    
                    // 1. Check if it falls exactly within a known contiguous cycle (start inclusive, end exclusive)
                    const cycleMatch = cycles.find(cyc => cyc.startDate && cyc.endDate && lDate >= cyc.startDate && lDate < cyc.endDate);
                    if (cycleMatch) {
                        return cycleMatch.id === cycle.id;
                    }
                    
                    // 2. Intelligent gap filling using threshold day
                    // Calculate average UG reading day to extrapolate missing months
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
                    
                    return cycle.id === `ciclo-${targetMonth}`;
                }

                if (c.mes_referencia) {
                    const m = getMonthFromRef(c.mes_referencia);
                    return parseInt(cycle.id.split('-')[1]) === m;
                }

                return false;
            });
        }

        // Month Keys for Irradiance
        const irrKeys = ['jan.khw', 'fev.khw', 'mar.kwh', 'abr.kwh', 'mai.kwh', 'jun.kwh', 'jul.kwh', 'ago.kwh', 'set.kwh', 'out.kwh', 'nov.kwh', 'dez.khw'];
        
        let geracaoEstimada = 0;
        let geracaoAferida = null;
        let isAferida = false;
        let geracaoExibida = 0;
        let showLowGenerationAlert = false;
        
        // Find all UG contas to determine months
        const ugContas = filteredContas.filter(c => {
            const u = ucs.find(uc => uc.id === c.uc_id);
            return u && u.tipo === 'ug';
        });

        if (usinaInfo?.potencia_kwp && irradianciaInfo) {
            ugContas.forEach(ugConta => {
                if (ugConta.data_leitura) {
                    const dateObj = new Date(ugConta.data_leitura);
                    const monthIdx = dateObj.getUTCMonth(); // 0 to 11
                    const yearStr = dateObj.getUTCFullYear().toString();
                    
                    const irrFactor = irradianciaInfo[irrKeys[monthIdx]];
                    let est = 0;
                    if (irrFactor) {
                        est = Math.round(Number(irrFactor) * Number(usinaInfo.potencia_kwp));
                        geracaoEstimada += est;
                    }
                    
                    if (usinaInfo.geracao_aferida && usinaInfo.geracao_aferida[yearStr] && usinaInfo.geracao_aferida[yearStr][monthIdx] !== undefined && usinaInfo.geracao_aferida[yearStr][monthIdx] !== null) {
                        const aferida = Number(usinaInfo.geracao_aferida[yearStr][monthIdx]);
                        geracaoAferida = (geracaoAferida || 0) + aferida;
                        isAferida = true;
                        geracaoExibida += aferida;
                    } else {
                        geracaoExibida += est;
                    }
                }
            });

            if (isAferida && geracaoAferida < (geracaoEstimada * 0.85)) {
                showLowGenerationAlert = true;
            }
        }

        // Totals
        let totalInjetado = 0;
        let totalCompensado = 0;
        let totalValorFaturas = 0;
        let totalParcelamentos = 0;
        let totalConsumoKwh = 0;
        let totalConsumoFaturadoKwh = 0;
        let totalConsumoFaturadoReais = 0;
        let totalValorAuditadoCalc = 0;
        const contasComParcelamento = [];

        filteredContas.forEach(c => {
            const uc = ucs.find(u => u.id === c.uc_id);
            if (!uc) return;

            const isUg = uc.tipo === 'ug';
            const inj = Number(c.energia_injetada || 0);
            const comp = Number(c.energia_compensada || 0);
            const cons = Number(c.consumo_kwh || 0);

            if (isUg) totalInjetado += inj;
            totalCompensado += comp;
            totalConsumoKwh += cons;

            const uncomp = Math.max(0, cons - comp);
            totalConsumoFaturadoKwh += uncomp;

            const frac = cons > 0 ? uncomp / cons : 0;
            const consumoCorreto = Number(c.consumo_reais || 0) * frac;
            totalConsumoFaturadoReais += consumoCorreto;

            const fioBCorreto = comp * Number(c.fio_b_vr_unit || 0);

            let ilumCorreto = Number(c.iluminacao_publica || 0);
            if (uc.municipio && uc.classe && cosipRates.length > 0) {
                const match = cosipRates.find(r => 
                    r.municipio.toUpperCase() === uc.municipio.toUpperCase() &&
                    r.classe.toUpperCase() === uc.classe.toUpperCase() &&
                    cons >= Number(r.faixa_de) &&
                    cons <= Number(r.faixa_ate)
                );
                if (match) {
                    if (Number(match.valor_fixo) > 0) ilumCorreto = Number(match.valor_fixo);
                    else if (Number(match.percentual) > 0) ilumCorreto = (Number(c.consumo_reais || 0) * Number(match.percentual)) / 100;
                }
            }

            const outrosCorreto = Number(c.parcelamento || 0) + Number(c.outros_lancamentos || 0);
            const valAudCalc = consumoCorreto + fioBCorreto + ilumCorreto + outrosCorreto;
            totalValorAuditadoCalc += valAudCalc;

            const vOcr = Number(c.valor_concessionaria || 0);
            const vAud = Number(c.valor_auditado || 0);
            
            totalValorFaturas += (c.status_conta === 'Auditado' && vAud > 0) ? vAud : vOcr;
            
            const parc = parseFloat(c.parcelamento) || 0;
            totalParcelamentos += parc;
            
            if (parc > 0) {
                const ucName = uc.numero_uc || 'Desconhecida';
                contasComParcelamento.push({ uc: ucName, valor: parc, mesRef: c.mes_referencia || 'N/D' });
            }
        });

        // Rows
        let sortedUcs = [...ucs];
        // UG always first
        sortedUcs.sort((a, b) => {
            if (a.tipo === 'ug' && b.tipo !== 'ug') return -1;
            if (b.tipo === 'ug' && a.tipo !== 'ug') return 1;
            if (usinaInfo.tipo_compensacao === 'prioridade') {
                return (a.prioridade || 999) - (b.prioridade || 999);
            } else {
                return (b.porcentagem || 0) - (a.porcentagem || 0);
            }
        });

        const totalSaldo = Math.max(0, totalInjetado - totalCompensado);

        let currentCascadeBalance = 0;
        let totalCompensadoAteAqui = 0;
        

        const mappedUcs = sortedUcs.map(uc => {
            const contasDaUc = filteredContas.filter(c => c.uc_id === uc.id);
            const conta = contasDaUc[0]; // first one for reference

            const compensado = contasDaUc.reduce((acc, c) => acc + Number(c.energia_compensada || 0), 0);
            const consumo = contasDaUc.reduce((acc, c) => acc + Number(c.consumo_kwh || 0), 0);
            const injetado = uc.tipo === 'ug' ? contasDaUc.reduce((acc, c) => acc + Number(c.energia_injetada || 0), 0) : 0;
            const uncompensated = Math.max(0, consumo - compensado);

            let saldoCascata = 0;
            if (uc.tipo === 'ug') {
                currentCascadeBalance += injetado;
                currentCascadeBalance -= compensado;
                saldoCascata = Math.max(0, currentCascadeBalance);
            } else {
                currentCascadeBalance -= compensado;
                saldoCascata = Math.max(0, currentCascadeBalance);
            }

            let saldoAnterior = 0;
            if (cycle && selectedCycleId !== 'all') {
                const contasAnteriores = contas.filter(c => {
                    if (c.uc_id !== uc.id || !c.data_leitura) return false;
                    const d = new Date(c.data_leitura);
                    return d < cycle.startDate;
                });
                contasAnteriores.forEach(c => {
                    if (uc.tipo === 'ug') {
                        const inj = Number(c.energia_injetada || 0);
                        const comp = Number(c.energia_compensada || 0);
                        saldoAnterior += Math.max(0, inj - comp);
                    } else {
                        saldoAnterior += Number(c.saldo_kwh || 0);
                    }
                });
            }

            const dataLeituraObj = conta?.data_leitura ? new Date(conta.data_leitura) : null;
            let dataLeitura = '';
            if (dataLeituraObj) {
                const d = dataLeituraObj.getUTCDate().toString().padStart(2, '0');
                const m = (dataLeituraObj.getUTCMonth() + 1).toString().padStart(2, '0');
                dataLeitura = `${d}/${m}`;
            }

            const valorOcr = conta ? Number(conta.valor_concessionaria || 0) : 0;
            const valorAuditado = Number(conta?.valor_auditado || 0);
            const statusAuditoria = conta?.status_conta || 'Pendente';
            const hasAlerts = conta && ((conta.alertas && conta.alertas.length > 0) || parseFloat(conta.parcelamento) > 0);

            totalCompensadoAteAqui += compensado;
            
            const frac = consumo > 0 ? uncompensated / consumo : 0;
            const consumoCorreto = Number(conta?.consumo_reais || 0) * frac;

            const fioBCorreto = compensado * Number(conta?.fio_b_vr_unit || 0);
            
            let ilumCorreto = Number(conta?.iluminacao_publica || 0);
            if (uc.municipio && uc.classe && cosipRates.length > 0) {
                const match = cosipRates.find(r => 
                    r.municipio.toUpperCase() === uc.municipio.toUpperCase() &&
                    r.classe.toUpperCase() === uc.classe.toUpperCase() &&
                    Number(conta?.consumo_kwh || 0) >= Number(r.faixa_de) &&
                    Number(conta?.consumo_kwh || 0) <= Number(r.faixa_ate)
                );
                if (match) {
                    if (Number(match.valor_fixo) > 0) {
                        ilumCorreto = Number(match.valor_fixo);
                    } else if (Number(match.percentual) > 0) {
                        ilumCorreto = (Number(conta?.consumo_reais || 0) * Number(match.percentual)) / 100;
                    }
                }
            }
            
            const outrosCorreto = Number(conta?.parcelamento || 0) + Number(conta?.outros_lancamentos || 0);
            const valorAuditadoCalc = consumoCorreto + fioBCorreto + ilumCorreto + outrosCorreto;

            return { uc, conta, compensado, consumo, injetado, uncompensated, saldo: saldoCascata, saldoAnterior, dataLeitura, valorOcr, valorAuditado, statusAuditoria, hasAlerts, totalCompensadoAteAqui, consumoCorreto, fioBCorreto, ilumCorreto, outrosCorreto, valorAuditadoCalc };
        });

        // Find max values for progress bar scaling
        let maxVal = Math.max(totalInjetado, 1);
        mappedUcs.forEach(c => {
            if (c.compensado > maxVal) maxVal = c.compensado;
        if (c.consumo > maxVal) maxVal = c.consumo;
            if (c.saldo > maxVal) maxVal = c.saldo;
        });

        const autoConsumoCalc = Math.max(0, geracaoExibida - totalInjetado);
        const showExpansionAlert = (autoConsumoCalc + totalConsumoKwh) > geracaoExibida;

        return (
            <div id="pdf-content" className="space-y-6 animate-in slide-in-from-bottom-4 duration-500 bg-gray-50/50 p-2 rounded-xl">
                {/* Cabeçalho do Cliente (Somente visível no PDF) */}
                {isGeneratingPDF && (
                    <div className="text-center mb-6 border-b border-gray-200 pb-4">
                        <h2 className="text-2xl font-extrabold text-gray-800">{usinaInfo?.nome_cliente || usinaInfo?.nome || 'Cliente'}</h2>
                        <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mt-1">Relatório de Desempenho e Auditoria - {cycle?.name} {cycle?.label ? `(${cycle.label})` : ''}</p>
                    </div>
                )}

                
                {/* Generation Block */}
                <style dangerouslySetInnerHTML={{ __html: `
                @keyframes energyFlow {
                    0% { left: -25%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { left: 100%; opacity: 0; }
                }
                .animate-energy-flow {
                    animation: energyFlow 3.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
                }
                `}} />
                <div className="relative pt-2 pb-2">
                    {/* Energy line background for desktop */}
                    <div className="absolute top-[50%] left-8 right-8 h-[2px] -translate-y-1/2 hidden xl:block z-0 pointer-events-none">
                        {/* Base track */}
                        <div className="absolute inset-0 bg-gray-200/40 rounded-full"></div>
                        
                        {/* Moving Container */}
                        <div className="absolute top-[50%] -translate-y-1/2 w-[25%] h-[40px] animate-energy-flow flex items-center justify-center">
                            {/* Glow trail */}
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent blur-md"></div>
                            {/* Solid line */}
                            <div className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>
                            {/* Core bright dot */}
                            <div className="w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_15px_5px_rgba(34,211,238,0.8)] z-10"></div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3 relative z-10">
                    {/* 1. Geração Estimada Card */}
                    <div className="relative group transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1 z-0 hover:z-10">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-2xl blur opacity-25 group-hover:opacity-75 group-hover:blur-md transition-all duration-500"></div>
                        <div className="relative bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-blue-100 group-hover:border-blue-300 group-hover:shadow-lg group-hover:shadow-blue-500/20 flex flex-col items-center justify-between text-center transition-all duration-300 h-full">
                            <div className="flex flex-col items-center space-y-1 mb-2">
                                <div className="flex items-center justify-center gap-1">
                                    <p className="text-[9px] text-blue-600/80 font-bold uppercase tracking-wider leading-tight">
                                        {isAferida ? 'Geração Aferida' : 'Geração Estimada'}
                                    </p>
                                    <span title="Energia gerada pela usina no período. Pode ser aferida (leitura real) ou estimada (baseada em potência e irradiação local)."><HelpCircle className="w-3 h-3 text-blue-400 cursor-help" /></span>
                                </div>
                            </div>
                            <div className="bg-gradient-to-br from-blue-400 to-indigo-500 p-2.5 rounded-xl shadow-inner shadow-blue-700/20 text-white mb-2">
                                <Sun className="w-5 h-5"/>
                            </div>
                            <div className="flex flex-col items-center">
                                <h3 className={`text-lg font-extrabold flex items-center gap-1 justify-center leading-tight ${isGeneratingPDF ? 'text-blue-700' : 'bg-gradient-to-r from-blue-600 to-indigo-700 bg-clip-text text-transparent'}`}>
                                    {geracaoExibida > 0 ? geracaoExibida.toLocaleString('pt-BR') : '--'} <span className="text-[8px] font-semibold text-gray-400">kWh</span>
                                </h3>
                                {showLowGenerationAlert && (
                                    <div className="flex items-center text-[8px] font-bold text-red-600 bg-red-50 border border-red-100 px-1 py-0.5 rounded mt-1">
                                        <AlertCircle className="w-3 h-3 mr-1"/> {geracaoEstimada}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 2. Auto Consumo */}
                    <div className="relative group transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1 z-0 hover:z-10">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-red-400 to-rose-500 rounded-2xl blur opacity-25 group-hover:opacity-75 group-hover:blur-md transition-all duration-500"></div>
                        <div className="relative bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-red-100 group-hover:border-red-300 group-hover:shadow-lg group-hover:shadow-red-500/20 flex flex-col items-center justify-between text-center transition-all duration-300 h-full">
                            <div className="flex items-center justify-center gap-1 mb-2">
                                <p className="text-[9px] text-red-600/80 font-bold uppercase tracking-wider leading-tight">Auto Consumo</p>
                                <span title="Energia consumida instantaneamente pela própria unidade geradora, que não chega a ser injetada na rede da concessionária."><HelpCircle className="w-3 h-3 text-red-400 cursor-help" /></span>
                            </div>
                            <div className="bg-gradient-to-br from-red-400 to-rose-500 p-2.5 rounded-xl shadow-inner shadow-red-700/20 text-white mb-2">
                                <Home className="w-5 h-5"/>
                            </div>
                            <h3 className={`text-lg font-extrabold flex items-center gap-1 justify-center leading-tight ${isGeneratingPDF ? 'text-red-700' : 'bg-gradient-to-r from-red-600 to-rose-700 bg-clip-text text-transparent'}`}>
                                {Math.max(0, geracaoExibida - totalInjetado).toLocaleString('pt-BR')} <span className="text-[8px] font-semibold text-gray-400">kWh</span>
                            </h3>
                        </div>
                    </div>

                    {/* 3. Energia Injetada */}
                    <div className="relative group transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1 z-0 hover:z-10">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-2xl blur opacity-25 group-hover:opacity-75 group-hover:blur-md transition-all duration-500"></div>
                        <div className="relative bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-emerald-100 group-hover:border-emerald-300 group-hover:shadow-lg group-hover:shadow-emerald-500/20 flex flex-col items-center justify-between text-center transition-all duration-300 h-full">
                            <div className="flex items-center justify-center gap-1 mb-2">
                                <p className="text-[9px] text-emerald-600/80 font-bold uppercase tracking-wider leading-tight">Energia Injetada</p>
                                <span title="Excedente de energia que a usina envia para a rede da concessionária, gerando créditos."><HelpCircle className="w-3 h-3 text-emerald-400 cursor-help" /></span>
                            </div>
                            <div className="bg-gradient-to-br from-emerald-400 to-emerald-600 p-2.5 rounded-xl shadow-inner shadow-emerald-700/20 text-white mb-2">
                                <Zap className="w-5 h-5"/>
                            </div>
                            <h3 className={`text-lg font-extrabold flex items-center gap-1 justify-center leading-tight ${isGeneratingPDF ? 'text-emerald-700' : 'bg-gradient-to-r from-emerald-700 to-teal-800 bg-clip-text text-transparent'}`}>{totalInjetado.toLocaleString('pt-BR')} <span className="text-[8px] font-semibold text-gray-400">kWh</span></h3>
                        </div>
                    </div>

                    {/* 4. Energia Consumida */}
                    <div className="relative group transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1 z-0 hover:z-10">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-400 to-violet-500 rounded-2xl blur opacity-25 group-hover:opacity-75 group-hover:blur-md transition-all duration-500"></div>
                        <div className="relative bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-purple-100 group-hover:border-purple-300 group-hover:shadow-lg group-hover:shadow-purple-500/20 flex flex-col items-center justify-between text-center transition-all duration-300 h-full">
                            <div className="flex items-center justify-center gap-1 mb-2">
                                <p className="text-[9px] text-purple-600/80 font-bold uppercase tracking-wider leading-tight">Energia Consumida</p>
                                <span title="Total de energia que todas as unidades consumiram da rede da concessionária no período."><HelpCircle className="w-3 h-3 text-purple-400 cursor-help" /></span>
                            </div>
                            <div className="bg-gradient-to-br from-purple-400 to-violet-500 p-2.5 rounded-xl shadow-inner shadow-purple-700/20 text-white mb-2">
                                <Moon className="w-5 h-5"/>
                            </div>
                            <h3 className={`text-lg font-extrabold flex items-center gap-1 justify-center leading-tight ${isGeneratingPDF ? 'text-purple-700' : 'bg-gradient-to-r from-purple-700 to-violet-800 bg-clip-text text-transparent'}`}>{totalConsumoKwh.toLocaleString('pt-BR')} <span className="text-[8px] font-semibold text-gray-400">kWh</span></h3>
                        </div>
                    </div>
                    
                    {/* 5. Energia Compensada */}
                    <div className="relative group transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1 z-0 hover:z-10">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-yellow-400 to-amber-500 rounded-2xl blur opacity-25 group-hover:opacity-75 group-hover:blur-md transition-all duration-500"></div>
                        <div className="relative bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-yellow-100 group-hover:border-yellow-300 group-hover:shadow-lg group-hover:shadow-yellow-500/20 flex flex-col items-center justify-between text-center transition-all duration-300 h-full">
                            <div className="flex items-center justify-center gap-1 mb-2">
                                <p className="text-[9px] text-yellow-600/80 font-bold uppercase tracking-wider leading-tight">Energia Compensada</p>
                                <span title="Total de energia consumida que foi abatida usando os créditos de energia injetada."><HelpCircle className="w-3 h-3 text-yellow-400 cursor-help" /></span>
                            </div>
                            <div className="bg-gradient-to-br from-yellow-400 to-amber-500 p-2.5 rounded-xl shadow-inner shadow-yellow-700/20 text-white mb-2">
                                <Coins className="w-5 h-5"/>
                            </div>
                            <h3 className={`text-lg font-extrabold flex items-center gap-1 justify-center leading-tight ${isGeneratingPDF ? 'text-yellow-600' : 'bg-gradient-to-r from-yellow-600 to-amber-700 bg-clip-text text-transparent'}`}>{totalCompensado.toLocaleString('pt-BR')} <span className="text-[8px] font-semibold text-gray-400">kWh</span></h3>
                        </div>
                    </div>

                    {/* 6. Energia Faturada */}
                    <div className="relative group transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1 z-0 hover:z-10">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-orange-400 to-red-500 rounded-2xl blur opacity-25 group-hover:opacity-75 group-hover:blur-md transition-all duration-500"></div>
                        <div className="relative bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-orange-100 group-hover:border-orange-300 group-hover:shadow-lg group-hover:shadow-orange-500/20 flex flex-col items-center justify-between text-center transition-all duration-300 h-full" title={`R$ ${totalConsumoFaturadoReais.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}>
                            <div className="flex items-center justify-center gap-1 mb-2">
                                <p className="text-[9px] text-orange-600/80 font-bold uppercase tracking-wider leading-tight">Energia Faturada</p>
                                <span title="Energia consumida que não foi coberta pelos créditos e será cobrada na fatura, incluindo o custo de disponibilidade."><HelpCircle className="w-3 h-3 text-orange-400 cursor-help" /></span>
                            </div>
                            <div className="bg-gradient-to-br from-orange-400 to-red-500 p-2.5 rounded-xl shadow-inner shadow-orange-700/20 text-white mb-2">
                                <Banknote className="w-5 h-5"/>
                            </div>
                            <h3 className={`text-lg font-extrabold flex items-center gap-1 justify-center leading-tight ${isGeneratingPDF ? 'text-orange-600' : 'bg-gradient-to-r from-orange-600 to-red-700 bg-clip-text text-transparent'}`}>{totalConsumoFaturadoKwh.toLocaleString('pt-BR')} <span className="text-[8px] font-semibold text-gray-400">kWh</span></h3>
                        </div>
                    </div>

                    {/* 7. Saldo no Ciclo */}
                    <div className="relative group transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1 z-0 hover:z-10">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-400 to-green-500 rounded-2xl blur opacity-25 group-hover:opacity-75 group-hover:blur-md transition-all duration-500"></div>
                        <div className="relative bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-emerald-100 group-hover:border-emerald-300 group-hover:shadow-lg group-hover:shadow-emerald-500/20 flex flex-col items-center justify-between text-center transition-all duration-300 h-full">
                            <div className="flex items-center justify-center gap-1 mb-2">
                                <p className="text-[9px] text-emerald-600/80 font-bold uppercase tracking-wider leading-tight">Saldo no Ciclo</p>
                                <span title="Créditos gerados neste ciclo que sobraram após todas as compensações. Serão acumulados para os próximos meses."><HelpCircle className="w-3 h-3 text-emerald-400 cursor-help" /></span>
                            </div>
                            <div className="bg-gradient-to-br from-emerald-400 to-green-500 p-2.5 rounded-xl shadow-inner shadow-emerald-700/20 text-white mb-2">
                                <PiggyBank className="w-5 h-5"/>
                            </div>
                            <h3 className={`text-lg font-extrabold flex items-center gap-1 justify-center leading-tight ${isGeneratingPDF ? 'text-emerald-600' : 'bg-gradient-to-r from-emerald-600 to-green-700 bg-clip-text text-transparent'}`}>{totalSaldo.toLocaleString('pt-BR')} <span className="text-[8px] font-semibold text-gray-400">kWh</span></h3>
                        </div>
                    </div>

                    {/* 8. Total Faturas */}
                    <div className="relative group transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1 z-0 hover:z-10">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-400 to-sky-500 rounded-2xl blur opacity-25 group-hover:opacity-75 group-hover:blur-md transition-all duration-500"></div>
                        <div className="relative bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-cyan-100 group-hover:border-cyan-300 group-hover:shadow-lg group-hover:shadow-cyan-500/20 flex flex-col items-center justify-between text-center transition-all duration-300 h-full">
                            <div className="flex items-center justify-center gap-1 mb-2">
                                <p className="text-[9px] text-cyan-600/80 font-bold uppercase tracking-wider leading-tight">Total Faturas</p>
                                <span title="Soma dos valores auditados (ou cobrados) nas faturas de todas as unidades no período."><HelpCircle className="w-3 h-3 text-cyan-400 cursor-help" /></span>
                            </div>
                            <div className="bg-gradient-to-br from-cyan-400 to-sky-500 p-2.5 rounded-xl shadow-inner shadow-cyan-700/20 text-white mb-2">
                                <DollarSign className="w-5 h-5"/>
                            </div>
                            <h3 className={`font-extrabold flex items-baseline justify-center gap-1 w-full px-1 leading-tight ${isGeneratingPDF ? 'text-cyan-700' : 'bg-gradient-to-r from-cyan-700 to-sky-800 bg-clip-text text-transparent'}`} title={`R$ ${totalValorAuditadoCalc.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}>
                                <span className="text-[10px] text-cyan-700">R$</span>
                                <span className="text-base tracking-tighter">{totalValorAuditadoCalc.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                            </h3>
                        </div>
                    </div>
                </div>
                </div>

                {selectedCycleId !== 'all' && (
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg shadow-gray-200/50 border border-gray-100 overflow-hidden relative">
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-emerald-400 via-teal-500 to-blue-500"></div>
                    <div className="p-6 bg-gray-50/50 border-b border-gray-100 flex justify-between items-center">
                        <h3 className="font-bold text-gray-800 flex items-center">
                            <LayoutDashboard className="w-5 h-5 mr-2 text-emerald-500"/>
                            Demonstrativo por Unidade
                            <button data-html2canvas-ignore="true" onClick={loadData} className="ml-4 p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors" title="Atualizar Dados">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                            </button>
                            <button data-html2canvas-ignore="true" onClick={handleGeneratePDF} disabled={isGeneratingPDF} className="ml-2 flex items-center px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md transition-colors text-sm font-semibold border border-blue-100 shadow-sm disabled:opacity-50" title="Gerar PDF">
                                {isGeneratingPDF ? (
                                    <span className="animate-spin mr-1">⌛</span>
                                ) : (
                                    <Download className="w-4 h-4 mr-1" />
                                )}
                                {isGeneratingPDF ? 'Gerando...' : 'Gerar PDF'}
                            </button>
                        </h3>
                        <div className="text-xs font-semibold text-gray-500 flex space-x-5">
                            <span className="flex items-center"><span className="w-2.5 h-2.5 bg-blue-500 rounded-full mr-2 shadow-sm"></span> Compensado</span>
                            <span className="flex items-center"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-full mr-2 shadow-sm"></span> Saldo Final</span>
                        </div>
                    </div>
                    <div className="divide-y divide-gray-100/80">
                        {mappedUcs.map(({ uc, conta, compensado, consumo, injetado, uncompensated, saldo, saldoAnterior, dataLeitura, valorOcr, valorAuditado, statusAuditoria, hasAlerts, totalCompensadoAteAqui, consumoCorreto, fioBCorreto, ilumCorreto, outrosCorreto, valorAuditadoCalc }) => {

                            const isMasked = conta && Array.isArray(conta.alertas) && conta.alertas.includes("LIMITE_FREE_EXCEDIDO");

                            // Escala para a barra empilhada
                            const maxValTable = Math.max(totalInjetado, maxVal);
                            const currentMax = maxValTable > 0 ? maxValTable : 1;
                            
                            const compWidth = (compensado / currentMax) * 100;
                            const uncompWidth = (uncompensated / currentMax) * 100;
                            const saldoWidth = (saldo / currentMax) * 100;

                            return (
                                <div key={uc.id} className="p-4 hover:bg-emerald-50/30 transition-all duration-300 flex items-center group">
                                    <div className="w-[20%] pr-4 flex flex-col items-start">
                                        <div className="font-bold text-gray-800 group-hover:text-emerald-700 transition-colors">{uc.numero_uc}</div>
                                        <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mt-1 flex flex-wrap gap-1">
                                            <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">{uc.tipo === 'ug' ? 'Geradora' : 'Consumidora'}</span>
                                            {uc.tipo === 'uc' && usinaInfo.tipo_compensacao === 'prioridade' && <span className="bg-blue-50 px-2 py-0.5 rounded text-blue-600">Prio: {uc.prioridade} {dataLeitura && `| Lida: ${dataLeitura}`}</span>}
                                            {uc.tipo === 'uc' && usinaInfo.tipo_compensacao === 'porcentagem' && <span className="bg-purple-50 px-2 py-0.5 rounded text-purple-600">Cota: {uc.porcentagem}% {dataLeitura && `| Lida: ${dataLeitura}`}</span>}
                                            {uc.tipo === 'ug' && dataLeitura && <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">Lida: {dataLeitura}</span>}
                                            {uc.conta_saldo && <span className="bg-emerald-50 px-2 py-0.5 rounded text-emerald-600">Saldo</span>}
                                        </div>
                                        {hasAlerts && (
                                            <button 
                                                onClick={() => {
                                                    let dynamicAlerts = conta.alertas ? [...conta.alertas] : [];
                                                    if (parseFloat(conta.parcelamento) > 0) {
                                                        const pVal = parseFloat(conta.parcelamento);
                                                        const pDesc = conta.parcelamento_descricao || 'Parcelamento';
                                                        const alertText = `Auditoria: Parcelamento identificado (${pDesc} - R$ ${pVal.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}). Verifique se é devido.`;
                                                        if (!dynamicAlerts.includes(alertText)) {
                                                            dynamicAlerts.push(alertText);
                                                        }
                                                    }
                                                    setAlertPopup({ isOpen: true, alertas: dynamicAlerts, ucName: uc.numero_uc });
                                                }}
                                                className="mt-3 flex items-center bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg border border-red-200 transition-colors shadow-sm"
                                            >
                                                <AlertCircle className="w-4 h-4 mr-1.5" />
                                                <span className="text-xs font-bold">Alertas</span>
                                            </button>
                                        )}
                                    </div>
                                    <div className="w-[50%] px-4 border-l border-gray-100 flex flex-col justify-center space-y-4 relative min-h-[120px]">
                                        {isMasked && (
                                            <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px] z-30 flex flex-col items-center justify-center rounded-xl m-2 border border-gray-100 shadow-sm">
                                                <AlertTriangle className="w-6 h-6 text-orange-500 mb-1" />
                                                <p className="text-xs font-bold text-gray-800">Dados Ocultos (Limite Free)</p>
                                                <p className="text-[10px] text-gray-600 px-4 text-center mt-1">
                                                    Exclua esta fatura, adquira Tokens Pagos e refaça a análise para visualizar.
                                                </p>
                                            </div>
                                        )}
                                        {/* Auto Consumo Bar (Only UG) */}
                                        {uc.tipo === 'ug' && (
                                            <div className="flex flex-col w-full group/autoconsumo cursor-default">
                                                <div className="flex justify-between items-end mb-1 ml-[82px]">
                                                    <div className="flex items-baseline space-x-1">
                                                        <span className="text-[9px] uppercase font-bold text-red-500 tracking-wider">Auto Consumo</span>
                                                        <span className="text-[11px] font-extrabold text-red-600 leading-none">{Math.max(0, geracaoExibida - injetado)} <span className="text-[9px] opacity-70">kWh</span></span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center w-full">
                                                    <div className="flex flex-col items-end mr-3 min-w-[70px]">
                                                        <span className="text-[9px] uppercase font-bold text-gray-400 mb-0.5 tracking-wider text-right">Total Gerado</span>
                                                        <span className="text-[12px] font-extrabold text-gray-600 leading-none">{geracaoExibida} <span className="text-[9px] opacity-70">kWh</span></span>
                                                    </div>
                                                    <div className="flex-1 bg-gray-100/80 rounded-full h-4 flex overflow-hidden relative shadow-inner border border-gray-200">
                                                        <div 
                                                            style={{ width: `${geracaoExibida > 0 ? Math.min(100, (Math.max(0, geracaoExibida - injetado) / geracaoExibida) * 100) : 0}%` }} 
                                                            className="bg-gradient-to-r from-red-400 to-red-500 h-full transition-all duration-1000 ease-out z-20 relative"
                                                        ></div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Primeira Barra: Compensado vs Injetado */}
                                        <div className="flex flex-col w-full group/bar cursor-default mt-2">
                                            <div className="flex justify-between items-end mb-1 ml-[82px]">
                                                <div className="flex items-baseline space-x-3">
                                                    <div className="flex items-baseline space-x-1">
                                                        <span className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Compensado</span>
                                                        <span className="text-[11px] font-extrabold text-blue-600 leading-none">{compensado} <span className="text-[9px] opacity-70">kWh</span></span>
                                                        {compensado > 0 && (
                                                            <span className="text-[10px] font-extrabold text-blue-800 ml-1.5 drop-shadow-sm">Fio B R$ {(compensado * Number(conta?.fio_b_vr_unit || 0)).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-baseline space-x-1">
                                                        <span className="text-[9px] uppercase font-bold text-gray-400 tracking-wider">Cons. Fat.</span>
                                                        <span className="text-[11px] font-extrabold text-red-400 leading-none">{uncompensated} <span className="text-[9px] opacity-70">kWh</span></span>
                                                        {conta && (
                                                            <span className="text-[10px] font-extrabold text-red-500 ml-1.5">(R$ {(Number(conta.consumo_reais || 0) * (consumo > 0 ? uncompensated / consumo : 0)).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})})</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center w-full">
                                                <div className="flex flex-col items-end mr-3 min-w-[70px]">
                                                    <span className="text-[9px] uppercase font-bold text-gray-400 mb-0.5 tracking-wider text-right">
                                                        {uc.tipo === 'ug' ? 'Injetado' : 'Saldo Ant.'}
                                                    </span>
                                                    <span className="text-[12px] font-extrabold text-gray-600 leading-none">
                                                        {uc.tipo === 'ug' ? totalInjetado : (totalInjetado - (totalCompensadoAteAqui - compensado))} <span className="text-[9px] opacity-70">kWh</span>
                                                    </span>
                                                </div>

                                                <div className="flex-1 bg-gray-100/80 rounded-full h-4 flex overflow-hidden relative shadow-inner border border-gray-200">
                                                    {/* Compensado (Azul) */}
                                                    <div 
                                                        style={{ width: `${totalInjetado > 0 ? Math.min(100, (compensado / totalInjetado) * 100) : 0}%` }} 
                                                        className="bg-gradient-to-r from-blue-400 to-blue-500 h-full transition-all duration-1000 ease-out z-20 relative flex items-center justify-end pr-2"
                                                    >
                                                    </div>
                                                    
                                                    {/* Consumo Nao Compensado (Vermelho) */}
                                                    {uncompWidth > 0 && (
                                                        <div 
                                                            style={{ width: `${totalInjetado > 0 ? Math.min(100, (uncompensated / totalInjetado) * 100) : 0}%` }} 
                                                            className="bg-gradient-to-r from-red-400 to-red-500 h-full transition-all duration-1000 ease-out z-10 relative border-l border-white/20"
                                                        ></div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Segunda Barra: Total Compensado vs Saldo */}
                                        {totalInjetado > 0 && (
                                            <div className="flex flex-col w-full group/bar2 cursor-default mt-2">
                                                <div className="flex justify-between items-end mb-1 ml-[82px]">
                                                    <div></div>
                                                    <div className="flex items-baseline space-x-1">
                                                        <span className="text-[9px] uppercase font-bold text-red-500 tracking-wider">Energia Consumida</span>
                                                        <span className="text-[11px] font-extrabold text-red-600 leading-none">{consumo} <span className="text-[9px] opacity-70">kWh</span></span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center w-full">
                                                    <div className="flex flex-col items-end mr-3 min-w-[70px]">
                                                        <span className="text-[9px] uppercase font-bold text-orange-500 mb-0.5 tracking-wider text-right">Total Comp.</span>
                                                        <span className="text-[12px] font-extrabold text-orange-600 leading-none">{totalCompensadoAteAqui}</span>
                                                    </div>

                                                    <div className="flex-1 rounded-sm h-4 flex relative shadow-sm overflow-hidden bg-gray-100/80">
                                                        {/* Segmento Total Compensado */}
                                                        <div 
                                                            style={{ width: `${Math.min(100, (totalCompensadoAteAqui / totalInjetado) * 100)}%` }} 
                                                            className="bg-gradient-to-r from-orange-400 to-orange-500 h-full transition-all duration-1000 ease-out border-r border-white/30"
                                                        ></div>
                                                        {/* Segmento Saldo */}
                                                        <div 
                                                            style={{ width: `${Math.min(100, (saldo / totalInjetado) * 100)}%` }} 
                                                            className="bg-gradient-to-r from-emerald-400 to-emerald-500 h-full transition-all duration-1000 ease-out"
                                                        ></div>
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-start mt-1 ml-[82px]">
                                                    <div className="flex items-baseline space-x-1">
                                                        <span className="text-[9px] uppercase font-bold text-red-500 tracking-wider">Consumo da Unid.</span>
                                                        <span className="text-[11px] font-extrabold text-red-600 leading-none">
                                                            {uc.tipo === 'ug' ? consumo + Math.max(0, geracaoExibida - injetado) : consumo} <span className="text-[9px] opacity-70">kWh</span>
                                                        </span>
                                                    </div>
                                                    <div className="flex items-baseline space-x-1">
                                                        <span className="text-[9px] uppercase font-bold text-emerald-500 tracking-wider">Saldo</span>
                                                        <span className="text-[11px] font-extrabold text-emerald-600 leading-none">{saldo} <span className="text-[9px] opacity-70">kWh</span></span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    

                                    <div className="w-[30%] pl-4 flex items-start justify-end space-x-3">
                                        {/* Breakdown Blocks & Totals (Col) */}
                                        {isMasked ? (
                                            <div className="flex items-center justify-between w-full bg-orange-50 border border-orange-100 p-3 rounded-xl shadow-sm mr-2 self-center">
                                                <div className="flex flex-col mr-3">
                                                    <span className="text-[10px] font-bold text-orange-800 uppercase tracking-wider mb-0.5">Adquira Tokens Pagos</span>
                                                    <span className="text-[9px] text-orange-600 leading-tight">Para analisar mais de 2 contas por ciclo, adquira tokens.</span>
                                                </div>
                                                <button onClick={() => window.location.href = '/analisedeconta/recarga'} className="px-3 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg text-xs font-bold shadow-sm hover:shadow-md hover:from-orange-600 hover:to-orange-700 transition-all whitespace-nowrap flex items-center">
                                                    <Coins className="w-3.5 h-3.5 mr-1" />
                                                    Tokens
                                                </button>
                                            </div>
                                        ) : (
                                            conta && (
                                                <div className="flex space-x-3 mr-2">
                                                {/* Coluna Fatura (Lido) */}
                                                <div className="flex flex-col items-center">
                                                    <div className="border border-gray-200 rounded-lg p-2 w-[120px] bg-white flex flex-col justify-between shadow-sm mb-2">
                                                        <span className="text-[9px] font-bold text-gray-500 uppercase text-center border-b border-gray-100 pb-1 mb-1">Fatura (Lido)</span>
                                                        <div className="flex justify-between text-[8px] text-gray-600"><span title="Consumo Faturado">Cons.</span> <span className="font-semibold">{(Number(conta.consumo_reais || 0) * (consumo > 0 ? uncompensated / consumo : 0)).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                        <div className="flex justify-between text-[8px] text-gray-600"><span title="Fio B">Fio B</span> <span className="font-semibold">{Number(conta.fio_b_total || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                        <div className="flex justify-between text-[8px] text-gray-600"><span title="Ilum. Pub.">Ilum.</span> <span className="font-semibold">{Number(conta.iluminacao_publica || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                        {Number(conta.parcelamento || 0) > 0 && (
                                                            <div className="flex justify-between text-[8px] text-orange-600"><span title="Parcelamento">Parc.</span> <span className="font-semibold">{Number(conta.parcelamento || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                        )}
                                                        <div className="flex justify-between text-[8px] text-gray-600"><span title="Outros">Outros</span> <span className="font-semibold">{Number(conta.outros_lancamentos || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                    </div>
                                                    
                                                    {/* Total Fatura */}
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Fatura (OCR)</span>
                                                        <span className="text-xs font-bold text-gray-600">R$ {valorOcr.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                                                    </div>
                                                </div>

                                                <div className="flex flex-col items-center">
                                                    <div className="border border-emerald-200 rounded-lg p-2 w-[120px] bg-emerald-50/30 flex flex-col justify-between shadow-sm mb-2">
                                                        <span className="text-[9px] font-bold text-emerald-600 uppercase text-center border-b border-emerald-100 pb-1 mb-1">Auditado (Calc)</span>
                                                        <div className="flex justify-between text-[8px] text-gray-700"><span title="Consumo">Cons.</span> <span className="font-semibold text-emerald-700">{consumoCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                        <div className="flex justify-between text-[8px] text-gray-700"><span title="Fio B">Fio B</span> <span className="font-semibold text-emerald-700">{fioBCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                        <div className="flex justify-between text-[8px] text-gray-700"><span title="Ilum. Pub.">Ilum.</span> <span className="font-semibold text-emerald-700">{ilumCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                        {Number(conta.parcelamento || 0) > 0 && (
                                                            <div className="flex justify-between text-[8px] text-orange-600"><span title="Parcelamento">Parc.</span> <span className="font-semibold text-orange-700">{Number(conta.parcelamento || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                        )}
                                                        <div className="flex justify-between text-[8px] text-gray-700"><span title="Outros">Outros</span> <span className="font-semibold text-emerald-700">{Number(conta.outros_lancamentos || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
                                                    </div>
                                                    
                                                    {/* Total Auditado */}
                                                    <div className="flex flex-col items-center">
                                                        <span className={`text-[9px] font-bold uppercase tracking-widest ${statusAuditoria === 'contestado' ? 'text-red-500' : 'text-emerald-500'} mb-0.5`}>
                                                            {statusAuditoria === 'contestado' ? 'Contestado' : 'Auditado'}
                                                        </span>
                                                        <span className={`text-xs font-extrabold ${statusAuditoria === 'contestado' ? 'text-red-600' : 'text-emerald-600'}`}>
                                                            R$ {valorAuditadoCalc.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                        </span>
                                                </div>
                                                </div>
                                                </div>
                                            )
                                        )}
                                        
                                        {conta && (
                                            <div className="flex flex-col space-y-2 mt-1">
                                                {!isMasked && conta.pdf_url && (
                                                    <a
                                                        href={conta.pdf_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-1.5 text-gray-500 bg-gray-50 hover:bg-gray-100 hover:text-gray-700 rounded-lg transition-colors flex items-center justify-center"
                                                        title="Visualizar Conta Analisada"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </a>
                                                )}
                                                {!isMasked && (
                                                    <button 
                                                        onClick={() => setEditContaModal(conta)}
                                                        className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center justify-center"
                                                        title="Editar Valores Manuais"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button 
                                                    onClick={() => {
                                                        setDeleteModal({
                                                            id: conta.id,
                                                            type: 'conta',
                                                            title: 'Excluir Fatura',
                                                            message: `Tem certeza que deseja excluir a fatura de Ref ${conta.mes_referencia}? Isso removerá a conta da análise deste ciclo.`
                                                        });
                                                    }}
                                                    className="p-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center justify-center"
                                                    title="Excluir Fatura"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                        
                                        {!conta && (
                                            <div className="flex flex-col justify-center items-end h-full">
                                                <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 italic bg-gray-50 px-3 py-1 rounded whitespace-nowrap">S/ Fatura</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* Alertas Summary */}
                    {filteredContas.some(c => c.alertas && Array.isArray(c.alertas) && c.alertas.length > 0) && (
                        <div className="p-5 bg-orange-50/50 border-t border-orange-100">
                            <h4 className="text-sm font-bold text-orange-700 flex items-center mb-3">
                                <AlertCircle className="w-4 h-4 mr-2" /> Resumo de Divergências (Auditoria)
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {mappedUcs.filter(m => m.conta && m.conta.alertas && Array.isArray(m.conta.alertas) && m.conta.alertas.length > 0).map(m => (
                                    <div key={m.uc.id} className="bg-white border border-orange-200 rounded-lg p-3 shadow-sm">
                                        <h5 className="text-xs font-bold text-gray-800 mb-2 border-b border-gray-100 pb-1">{m.uc.numero_uc} - {m.uc.tipo === 'ug' ? 'Geradora' : 'Consumidora'}</h5>
                                        <ul className="space-y-1">
                                            {m.conta.alertas.map((al, idx) => (
                                                <li key={idx} className="text-[10px] text-gray-600 flex items-start">
                                                    <span className="text-orange-500 mr-1.5 mt-0.5">•</span> 
                                                    <span>{typeof al === 'string' ? al : (al.message || JSON.stringify(al))}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                )}

                {/* --- Alertas Movidos para o Rodapé --- */}
                {showExpansionAlert && (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl shadow-sm flex items-start space-x-4">
                        <div className="bg-amber-100 p-2 rounded-full flex-shrink-0 animate-pulse">
                            <AlertTriangle className="w-6 h-6 text-amber-600" />
                        </div>
                        <div>
                            <h3 className="font-extrabold text-amber-800 text-lg">ALERTA DE AUDITORIA: Necessidade de Ampliação</h3>
                            <p className="text-amber-700 font-medium text-sm mt-1">
                                A soma do auto consumo com a energia consumida está superior à geração {isAferida ? 'aferida' : 'estimada'} no período. Recomenda-se um estudo para ampliação do sistema.
                            </p>
                        </div>
                    </div>
                )}
                
                {showLowGenerationAlert && isAferida && (
                    <div className="bg-orange-50 border-l-4 border-orange-500 p-4 rounded-xl shadow-sm flex items-start space-x-4">
                        <div className="bg-orange-100 p-2 rounded-full flex-shrink-0 animate-pulse">
                            <AlertTriangle className="w-6 h-6 text-orange-600" />
                        </div>
                        <div>
                            <h3 className="font-extrabold text-orange-800 text-lg">ALERTA DE AUDITORIA: Baixa Geração</h3>
                            <p className="text-orange-700 font-medium text-sm mt-1">
                                A geração aferida foi inferior à geração estimada em mais de 15%. Verifique a necessidade de manutenção preventiva ou limpeza dos módulos.
                            </p>
                        </div>
                    </div>
                )}

                {contasComParcelamento.length > 0 && (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl shadow-sm flex items-start space-x-4">
                        <div className="bg-red-100 p-2 rounded-full flex-shrink-0 animate-pulse">
                            <AlertTriangle className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                            <h3 className="font-extrabold text-red-800 text-lg">ALERTA VISUAL: Parcelamento Detectado neste Ciclo!</h3>
                            <p className="text-red-700 font-medium text-sm mt-1">
                                O sistema identificou cobranças de parcelamento/acordos nas seguintes UCs:
                            </p>
                            <ul className="mt-2 space-y-1">
                                {contasComParcelamento.map((cp, i) => (
                                    <li key={i} className="text-sm font-bold text-red-900 bg-red-100/50 px-3 py-1 rounded-lg inline-block mr-2">
                                        UC {cp.uc} (Ref: {cp.mesRef}): R$ {cp.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                    </li>
                                ))}
                            </ul>
                            <p className="text-xs text-red-600 font-bold mt-2 uppercase tracking-wide">
                                * Verifique a tabela de UCs para ler os detalhes da auditoria.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-[#f8fafc] font-sans selection:bg-emerald-200">
            {/* Header com Glassmorphism */}
            <header className="bg-white/70 backdrop-blur-lg border-b border-gray-200/60 px-8 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
                <div className="flex items-center space-x-4">
                    <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-2.5 rounded-xl shadow-lg shadow-emerald-600/20">
                        <LayoutDashboard className="text-white w-6 h-6"/>
                    </div>
                    <div>
                        <h1 className="text-xl font-extrabold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">Análise de Contas Independente</h1>
                        <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-widest mt-0.5">Ambiente Isolado Seguro</p>
                    </div>
                </div>

                <div className="flex items-center space-x-4">
                    <div className="relative">
                        <select 
                            value={selectedUsinaId}
                            onChange={e => {
                                setSelectedUsinaId(e.target.value);
                                localStorage.setItem('lastSelectedUsinaId', e.target.value);
                            }}
                            className="appearance-none border border-gray-200 rounded-xl text-sm font-semibold px-4 py-2.5 pr-10 bg-white/50 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none hover:border-gray-300 transition-colors shadow-sm"
                        >
                            <option value="" disabled>Selecione uma Usina</option>
                            {usinas.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                        </select>
                        <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-3 pointer-events-none" />
                    </div>
                    <button onClick={() => window.location.href = '/analisedeconta/gerenciar'} className="bg-gradient-to-r from-gray-700 to-gray-800 text-white border border-gray-600 hover:from-gray-800 hover:to-black px-4 py-2.5 rounded-xl shadow-sm transition-all hover:shadow-md hover:shadow-gray-900/20 hover:-translate-y-0.5 flex items-center font-semibold text-sm" title="Minhas Unidades">
                        <LayoutDashboard className="w-4 h-4 mr-2" />
                        Minhas Unidades
                    </button>
                    <div className="flex items-center space-x-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                        <div className="flex flex-col items-end justify-center">
                            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Saldo</span>
                            <span className="text-sm font-extrabold text-emerald-700 leading-none">{(profile?.free_tokens || 0) + (profile?.tokens || 0)}</span>
                        </div>
                        <button onClick={() => window.location.href = '/analisedeconta/recarga'} className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white border border-emerald-400 hover:from-emerald-600 hover:to-emerald-700 px-3 py-1.5 rounded-lg shadow-sm transition-all hover:shadow-md hover:shadow-emerald-900/20 hover:-translate-y-0.5 flex items-center font-semibold text-xs" title="Recarregar Tokens">
                            <Coins className="w-3.5 h-3.5 mr-1" />
                            Recarga
                        </button>
                    </div>
                    <button onClick={handleCreateUsina} className="bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-500 hover:text-white p-2.5 rounded-xl shadow-sm transition-all hover:shadow-md hover:shadow-emerald-500/20 hover:-translate-y-0.5" title="Nova Usina">
                        <Plus className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <main className="max-w-6xl mx-auto p-8 space-y-8">
                {/* Actions & Filters */}
                <div className="flex justify-between items-center bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex items-center space-x-4">
                        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
                            <Activity className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Período Analisado</label>
                            <div className="flex items-center gap-3">
                                <div className="relative flex items-center bg-gray-50/50 border border-gray-200 rounded-lg p-1 w-[280px] justify-between">
                                <button 
                                    onClick={() => {
                                        if (selectedCycleId === 'all') {
                                            if (cycles.length > 0) setSelectedCycleId(cycles[cycles.length - 1].id);
                                        } else {
                                            const idx = cycles.findIndex(c => c.id === selectedCycleId);
                                            if (idx < cycles.length - 1) setSelectedCycleId(cycles[idx + 1].id);
                                            else setSelectedCycleId('all');
                                        }
                                    }}
                                    className="p-1.5 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-800 transition-colors"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                
                                <div className="flex-1 flex flex-col items-center justify-center">
                                    <span className="text-sm font-bold text-gray-800">
                                        {selectedCycleId === 'all' ? 'Ver Todos os Registros' : (cycles.find(c => c.id === selectedCycleId)?.name || 'Desconhecido')}
                                    </span>
                                    {selectedCycleId !== 'all' && (
                                        <span className="text-[9px] text-gray-500 font-medium">
                                            {cycles.find(c => c.id === selectedCycleId)?.label}
                                        </span>
                                    )}
                                </div>

                                <button 
                                    onClick={() => {
                                        if (selectedCycleId === 'all') {
                                            if (cycles.length > 0) setSelectedCycleId(cycles[0].id);
                                        } else {
                                            const idx = cycles.findIndex(c => c.id === selectedCycleId);
                                            if (idx > 0) setSelectedCycleId(cycles[idx - 1].id);
                                            else setSelectedCycleId('all');
                                        }
                                    }}
                                    className="p-1.5 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-800 transition-colors"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                            {selectedCycleId === 'all' && (
                                <button 
                                    data-html2canvas-ignore="true" 
                                    onClick={handleGeneratePDF} 
                                    disabled={isGeneratingPDF} 
                                    className="flex items-center px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md transition-colors text-sm font-bold border border-blue-100 shadow-sm disabled:opacity-50" 
                                    title="Gerar PDF do Histórico"
                                >
                                    {isGeneratingPDF ? (
                                        <span className="animate-spin mr-1">⌛</span>
                                    ) : (
                                        <Download className="w-4 h-4 mr-1" />
                                    )}
                                    {isGeneratingPDF ? 'Gerando...' : 'Gerar PDF'}
                                </button>
                            )}
                        </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="relative flex items-center">
                            <button 
                                onClick={() => {
                                    if (!usinaInfo?.verificada) {
                                        setShowVerificationAlert(true);
                                        return;
                                    }
                                    setIsBatchModalOpen(true);
                                }}
                                disabled={!selectedUsinaId}
                                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-blue-500/30 flex items-center transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-500/40"
                            >
                                <UploadCloud className="w-5 h-5 mr-2" />
                                Múltiplas Contas
                            </button>
                            <div 
                                className="ml-2 bg-blue-100 text-blue-600 hover:bg-blue-600 hover:text-white cursor-help rounded-full w-6 h-6 flex items-center justify-center text-xs font-black transition-colors"
                                onMouseEnter={() => setActiveTooltip('batch')}
                                onMouseLeave={() => setActiveTooltip(null)}
                            >
                                ?
                            </div>
                            
                            {activeTooltip === 'batch' && (
                                <div className="absolute bottom-full right-0 mb-3 w-64 p-3 bg-gray-900 text-white text-xs font-medium rounded-xl shadow-2xl z-50 text-center animate-in fade-in zoom-in-95 duration-200 border border-gray-700 pointer-events-none">
                                    Permite importar até 12 faturas (PDFs) de uma vez. O sistema lerá e agrupará todas automaticamente no ciclo correspondente.
                                    <div className="absolute top-full right-2 border-4 border-transparent border-t-gray-900"></div>
                                </div>
                            )}
                        </div>

                        <div className="relative flex items-center">
                            <button 
                                onClick={() => fileInputDemonstrativoRef.current?.click()} 
                                disabled={!selectedUsinaId || isExtractingDemonstrativo}
                                className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-emerald-500/30 flex items-center transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-500/40"
                            >
                                {isExtractingDemonstrativo ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <UploadCloud className="w-5 h-5 mr-2" />}
                                {isExtractingDemonstrativo ? 'Importando...' : 'Importar Demonstrativo'}
                            </button>
                            <input
                                type="file"
                                ref={fileInputDemonstrativoRef}
                                style={{ display: 'none' }}
                                accept="application/pdf"
                                onChange={handleImportDemonstrativo}
                            />
                            <div 
                                className="ml-2 bg-emerald-100 text-emerald-600 hover:bg-emerald-600 hover:text-white cursor-help rounded-full w-6 h-6 flex items-center justify-center text-xs font-black transition-colors"
                                onMouseEnter={() => setActiveTooltip('single')}
                                onMouseLeave={() => setActiveTooltip(null)}
                            >
                                ?
                            </div>

                            {activeTooltip === 'single' && (
                                <div className="absolute bottom-full right-0 mb-3 w-64 p-3 bg-gray-900 text-white text-xs font-medium rounded-xl shadow-2xl z-50 text-center animate-in fade-in zoom-in-95 duration-200 border border-gray-700 pointer-events-none">
                                    Importe o Demonstrativo de Faturamento para preencher automaticamente as UCs da Usina e sua regra de rateio.
                                    <div className="absolute top-full right-2 border-4 border-transparent border-t-gray-900"></div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {renderDashboard()}
            </main>

            {/* OCR Modal */}
            <StandaloneAccountModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                usinaId={selectedUsinaId}
                onSave={loadData}
            />

            {/* Alertas Popup com Glassmorphism */}
            {alertPopup && alertPopup.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => setAlertPopup(null)}></div>
                    <div className="relative bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-white/20">
                        <div className="bg-gradient-to-r from-red-50 to-orange-50 p-5 flex justify-between items-center border-b border-red-100/50">
                            <h3 className="font-extrabold text-red-700 flex items-center text-lg">
                                <AlertCircle className="w-6 h-6 mr-3 text-red-500"/> 
                                Detalhamento - UC {alertPopup.ucName}
                            </h3>
                        </div>
                        <div className="p-6">
                            <ul className="space-y-4">
                                {alertPopup.alertas.map((a, idx) => (
                                    <li key={idx} className="flex items-start text-sm text-gray-700 bg-white shadow-sm p-4 rounded-xl border border-red-50">
                                        <span className="bg-gradient-to-br from-red-400 to-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mr-3 mt-0.5 shadow-sm shadow-red-500/20">{idx+1}</span>
                                        <span className="leading-relaxed font-medium">{a}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="p-5 bg-gray-50/80 border-t border-gray-100 flex justify-end">
                            <button onClick={() => setAlertPopup(null)} className="px-6 py-2.5 bg-white border border-gray-200 hover:border-gray-300 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all shadow-sm">Fechar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* CRUD MODALS */}
            {deleteModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={() => setDeleteModal(null)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="bg-red-50 border-b border-red-100 p-5 flex items-center text-red-600">
                            <AlertCircle className="w-6 h-6 mr-3" />
                            <h3 className="font-extrabold text-lg">{deleteModal.title}</h3>
                        </div>
                        <div className="p-6">
                            <p className="text-sm text-gray-600 font-medium leading-relaxed">{deleteModal.message}</p>
                        </div>
                        <div className="p-4 bg-gray-50 flex justify-end space-x-3 border-t border-gray-100">
                            <button onClick={() => setDeleteModal(null)} className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm">Cancelar</button>
                            <button onClick={confirmDelete} className="px-4 py-2 font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-md shadow-red-500/20 transition-all text-sm">Sim, Excluir</button>
                        </div>
                    </div>
                </div>
            )}

            {editContaModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditContaModal(null)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="font-extrabold text-lg text-gray-800">Editar Fatura (OCR)</h3>
                            <button onClick={() => setEditContaModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mês Ref.</label>
                                    <input type="text" value={editContaModal.mes_referencia} onChange={e => setEditContaModal({...editContaModal, mes_referencia: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data Leitura</label>
                                    <input type="date" value={editContaModal.data_leitura || ''} onChange={e => setEditContaModal({...editContaModal, data_leitura: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Consumo (kWh)</label>
                                    <input type="number" value={editContaModal.consumo_kwh} onChange={e => setEditContaModal({...editContaModal, consumo_kwh: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Compensada (kWh)</label>
                                    <input type="number" value={editContaModal.energia_compensada} onChange={e => setEditContaModal({...editContaModal, energia_compensada: parseFloat(e.target.value)})} className="w-full border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Saldo Kwh</label>
                                    <input type="number" value={editContaModal.saldo_kwh} onChange={e => setEditContaModal({...editContaModal, saldo_kwh: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Consumo R$</label>
                                    <input type="number" value={editContaModal.consumo_reais} onChange={e => setEditContaModal({...editContaModal, consumo_reais: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fio B Total</label>
                                    <input type="number" value={editContaModal.fio_b_total} onChange={e => setEditContaModal({...editContaModal, fio_b_total: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">IP (Iluminação)</label>
                                    <input type="number" value={editContaModal.iluminacao_publica} onChange={e => setEditContaModal({...editContaModal, iluminacao_publica: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-amber-500 uppercase mb-1">Parcelamento</label>
                                    <input type="number" value={editContaModal.parcelamento} onChange={e => setEditContaModal({...editContaModal, parcelamento: parseFloat(e.target.value)})} className="w-full border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Outros Lançamentos</label>
                                    <input type="number" value={editContaModal.outros_lancamentos} onChange={e => setEditContaModal({...editContaModal, outros_lancamentos: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-indigo-500 uppercase mb-1">Total Fatura (OCR)</label>
                                    <input type="number" value={editContaModal.valor_concessionaria} onChange={e => setEditContaModal({...editContaModal, valor_concessionaria: parseFloat(e.target.value)})} className="w-full border-indigo-200 bg-indigo-50 rounded-lg px-3 py-2 text-sm font-bold border" />
                                </div>
                            </div>
                            
                            <button onClick={handleSaveConta} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-md flex justify-center items-center mt-4 transition-colors">
                                <Save className="w-4 h-4 mr-2"/> Salvar Fatura
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Usina Modal (Current Usina) */}
            <StandaloneUsinaModal 
                isOpen={editUsinaModal} 
                onClose={() => setEditUsinaModal(false)} 
                onSave={loadData} 
                usinaData={usinaInfo}
                userId={user?.id}
            />

            {/* Create Usina Modal */}
            <StandaloneUsinaModal 
                isOpen={createUsinaModal.isOpen} 
                onClose={() => setCreateUsinaModal({ isOpen: false })} 
                onSave={loadData} 
                usinaData={null}
                userId={user?.id}
            />

            {/* Verification Alert Modal */}
            {showVerificationAlert && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowVerificationAlert(false)}></div>
                    <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 p-6 flex flex-col items-center text-center">
                        <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
                        <h3 className="font-extrabold text-xl text-gray-800 mb-2">Usina não verificada</h3>
                        <p className="text-sm text-gray-600 mb-6 font-medium">
                            Esta usina ainda não foi verificada. Acesse as configurações da usina para validá-la e liberar a análise.
                        </p>
                        <div className="flex flex-col w-full space-y-3">
                            <button 
                                onClick={() => {
                                    setShowVerificationAlert(false);
                                    setEditUsinaModal(true);
                                }} 
                                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors shadow-sm"
                            >
                                Criar ou Verificar Usina
                            </button>
                            <button 
                                onClick={() => setShowVerificationAlert(false)} 
                                className="w-full font-bold text-gray-500 hover:text-gray-700 py-2 transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Tokens Premium Popup */}
            {showTokensPopup && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 max-w-sm w-full animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center">
                            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
                                <Download className="w-6 h-6" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-800 mb-2">Recurso Premium</h3>
                            <p className="text-sm text-gray-600 mb-6 font-medium">
                                A emissão de relatórios em PDF é um recurso exclusivo para usuários que possuem tokens adquiridos. Tokens de bonificação mensal (Free) não habilitam esta função.
                            </p>
                            <div className="flex w-full gap-3">
                                <button onClick={() => setShowTokensPopup(false)} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors">
                                    Agora não
                                </button>
                                <button onClick={() => window.location.href = '/analisedeconta/recarga'} className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-colors shadow-md shadow-emerald-500/30">
                                    Adquirir Tokens
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <BatchInvoiceProcessor
                isOpen={isBatchModalOpen}
                onClose={() => setIsBatchModalOpen(false)}
                usinaInfo={usinaInfo}
                ucs={ucs}
                contas={contas}
                profile={profile}
                onSave={loadData}
            />
        </div>
    );
}
