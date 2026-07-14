import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, Calculator, Plus, X, Loader2, AlertCircle } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { parseInvoice } from '../lib/api';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

export default function StandaloneAccountModal({ isOpen, onClose, onSave, usinaId }) {
    const { showAlert, showConfirm } = useUI();
    const { profile } = useAuth();
    const [step, setStep] = useState('upload'); // 'upload', 'sandbox', 'create_uc'
    const [pdfFile, setPdfFile] = useState(null);
    const [isParsing, setIsParsing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Extracted Data
    const [formData, setFormData] = useState({
        mes_referencia: '',
        data_leitura: '',
        data_leitura_anterior: '',
        vencimento: '',
        consumo_kwh: '',
        energia_injetada: '',
        energia_compensada: '',
        saldo_kwh: '',
        valor_concessionaria: '',
        numero_uc: '',
        pdf_url: ''
    });

    const [alertas, setAlertas] = useState([]);
    
    // Existing or New UC State
    const [matchedUc, setMatchedUc] = useState(null);
    const [newUcForm, setNewUcForm] = useState({
        numero_uc: '',
        tipo: 'uc',
        sistema_compensacao: 'prioridade',
        prioridade: 2,
        porcentagem: 0,
        conta_saldo: false
    });

    useEffect(() => {
        if (!isOpen) {
            setStep('upload');
            setPdfFile(null);
            setFormData({
                mes_referencia: '', data_leitura: '', data_leitura_anterior: '', vencimento: '',
                consumo_kwh: '', energia_injetada: '', energia_compensada: '', saldo_kwh: '', valor_concessionaria: '', numero_uc: '', pdf_url: '', status_conta: '', parcelamento_descricao: '', parcelamento: ''
            });
            setAlertas([]);
            setMatchedUc(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handlePdfChange = (e) => {
        const file = e.target.files[0];
        if (file) setPdfFile(file);
    };

    const triggerUpload = async () => {
        if (!pdfFile) {
            showAlert('Por favor, selecione um PDF.', 'warning');
            return;
        }

        setIsParsing(true);
        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = reader.result;
                try {
                    const parsedData = await parseInvoice(base64);
                    
                    let extractedCompensado = parsedData.consumo_compensado;
                    let extractedInjetada = parsedData.energia_injetada;
                    let extractedSaldo = parsedData.saldo_kwh;
                    let extractedUcNumber = parsedData.numero_uc || parsedData.codigo_cliente || parsedData.conta_contrato;
                    
                    // PDF Fallback
                    const pdf = await pdfjsLib.getDocument({ data: atob(base64.split(',')[1] || base64) }).promise;
                    let fullText = "";
                    for (let i = 1; i <= Math.min(pdf.numPages, 2); i++) {
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

                    const classMatch = cleanText.match(/(?:CLASSIFICA(?:Ç|C)(?:Ã|A)O|Classe)[\s:]*(B[123]|Grupo A)/i);
                    let invoiceClass = classMatch ? classMatch[1].toUpperCase() : 'B1';

                    const autoAlerts = [];
                    if (!extractedCompensado && !extractedInjetada) autoAlerts.push('Atenção: Nem energia injetada nem compensada identificada.');
                    
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
                        status_conta: 'A Vencer' // Default
                    };
                    setFormData(extractedData);
                    setAlertas(autoAlerts);

                    if (extractedUcNumber) {
                        const { data: uc } = await supabase
                            .from('standalone_ucs')
                            .select('*')
                            .eq('numero_uc', extractedUcNumber)
                            .maybeSingle();

                        if (uc) {
                            setMatchedUc(uc);
                            
                            // Regra de Auditoria: Histórico de Parcelamento
                            if (extractedData.parcelamento > 0) {
                                const { data: hist } = await supabase
                                    .from('standalone_contas')
                                    .select('id')
                                    .eq('uc_id', uc.id)
                                    .eq('status_conta', 'Parcelada')
                                    .limit(1);
                                    
                                if (!hist || hist.length === 0) {
                                    autoAlerts.push(`Alerta de Auditoria: Cobrança de parcelamento identificada (${extractedData.parcelamento_descricao} no valor de R$ ${extractedData.parcelamento}), mas não há registro de conta com status 'Parcelada' no histórico desta UC.`);
                                }
                            }
                            
                            setAlertas(autoAlerts);
                            setStep('sandbox');
                        } else {
                            // Needs creation
                            setNewUcForm(prev => ({ ...prev, numero_uc: extractedUcNumber }));
                            setStep('create_uc');
                        }
                    } else {
                        showAlert('Não foi possível identificar o número da UC no PDF.', 'error');
                        setStep('sandbox');
                    }

                } catch (err) {
                    showAlert('Falha na extração: ' + err.message, 'error');
                } finally {
                    setIsParsing(false);
                }
            };
            reader.readAsDataURL(pdfFile);
        } catch (error) {
            setIsParsing(false);
            showAlert('Erro ao abrir arquivo.', 'error');
        }
    };

    const handleCreateUc = async () => {
        try {
            setIsSubmitting(true);
            const ucData = {
                usina_id: usinaId,
                numero_uc: newUcForm.numero_uc,
                tipo: newUcForm.tipo,
                prioridade: newUcForm.tipo === 'ug' ? 1 : newUcForm.prioridade,
                porcentagem: newUcForm.tipo === 'uc' && newUcForm.sistema_compensacao === 'porcentagem' ? newUcForm.porcentagem : 0,
                conta_saldo: newUcForm.conta_saldo
            };

            // Verificação de limite Free
            if (profile && profile.role !== 'super_admin') {
                const { data: freshProfile } = await supabase.from('profiles').select('tokens, free_tokens').eq('id', profile.id).single();
                const totalTokens = (freshProfile?.free_tokens || 0) + (freshProfile?.tokens || 0);
                
                if (totalTokens < 10) {
                    const { data: userUsinas } = await supabase.from('standalone_usinas').select('id').eq('owner_id', profile.id);
                    if (userUsinas && userUsinas.length > 0) {
                        const usinaIds = userUsinas.map(u => u.id);
                        const { data: userUcs } = await supabase.from('standalone_ucs').select('id').in('usina_id', usinaIds);
                        if (userUcs && userUcs.length >= 3) {
                            showAlert('Limite Free excedido. Adquira Tokens para adicionar mais Unidades Consumidoras.', 'error');
                            setIsSubmitting(false);
                            return;
                        }
                    }
                }
            }

            const { data, error } = await supabase.from('standalone_ucs').insert(ucData).select().single();
            if (error) throw error;
            
            // Se for UG, atualizar o sistema_compensacao da usina
            if (newUcForm.tipo === 'ug') {
                await supabase.from('standalone_usinas').update({ tipo_compensacao: newUcForm.sistema_compensacao }).eq('id', usinaId);
            }

            setMatchedUc(data);
            showAlert('UC/UG criada com sucesso.', 'success');
            setStep('sandbox');
        } catch (err) {
            showAlert('Erro ao criar UC: ' + err.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveInvoice = async () => {
        if (!matchedUc) {
            showAlert('Nenhuma UC vinculada a esta fatura.', 'warning');
            return;
        }

        try {
            setIsSubmitting(true);
            
            // --- Verificação de Limites e Tokens ---
            let requireTokens = false;
            
            if (profile && profile.role !== 'super_admin') {
                const { data: userUsinas } = await supabase.from('standalone_usinas').select('id').eq('owner_id', profile.id);
                if (userUsinas && userUsinas.length > 0) {
                    const usinaIds = userUsinas.map(u => u.id);
                    const { data: userUcs } = await supabase.from('standalone_ucs').select('id').in('usina_id', usinaIds);
                    
                    if (userUcs && userUcs.length > 0) {
                        const ucIds = userUcs.map(u => u.id);
                        const { data: existingContas } = await supabase
                            .from('standalone_contas')
                            .select('id')
                            .in('uc_id', ucIds)
                            .eq('mes_referencia', formData.mes_referencia);
                            
                        // Se já tem 3 contas neste ciclo, cobra tokens
                        if (existingContas && existingContas.length >= 3) {
                            requireTokens = true;
                        }
                    }
                }
            }

            if (requireTokens) {
                const { data: freshProfile } = await supabase.from('profiles').select('tokens, free_tokens').eq('id', profile.id).single();
                const freeT = freshProfile?.free_tokens || 0;
                const paidT = freshProfile?.tokens || 0;
                const totalTokens = freeT + paidT;
                
                if (totalTokens < 10) {
                    showAlert('Limite Free excedido. Você precisa de 10 Tokens para salvar esta análise. Recarregue no menu lateral.', 'error');
                    setIsSubmitting(false);
                    return;
                }
                
                // Deduct from free first, then paid
                let newFree = freeT;
                let newPaid = paidT;
                if (freeT >= 10) {
                    newFree -= 10;
                } else {
                    const remainder = 10 - freeT;
                    newFree = 0;
                    newPaid -= remainder;
                }
                
                await supabase.from('profiles').update({ free_tokens: newFree, tokens: newPaid }).eq('id', profile.id);
                await supabase.from('token_transactions').insert({
                    profile_id: profile.id,
                    amount: -10,
                    type: 'usage',
                    status: 'completed',
                    description: `Análise de conta - UC ${matchedUc.numero_uc} - Ciclo ${formData.mes_referencia}`
                });
            }
            // --- Fim da verificação ---

            // Upload PDF if exists
            let pdfUrl = '';
            if (pdfFile) {
                const fileExt = pdfFile.name.split('.').pop();
                const fileName = `${matchedUc.id}-${Date.now()}.${fileExt}`;
                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('invoices')
                    .upload(`standalone/${fileName}`, pdfFile);
                if (!uploadError && uploadData) {
                    const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(`standalone/${fileName}`);
                    pdfUrl = publicUrl;
                }
            }

            const invoiceData = {
                uc_id: matchedUc.id,
                mes_referencia: formData.mes_referencia,
                data_leitura: formData.data_leitura || null,
                data_leitura_anterior: formData.data_leitura_anterior || null,
                vencimento: formData.vencimento || null,
                consumo_kwh: formData.consumo_kwh,
                energia_injetada: formData.energia_injetada,
                energia_compensada: formData.energia_compensada,
                saldo_kwh: formData.saldo_kwh,
                valor_concessionaria: formData.valor_concessionaria,
                parcelamento: formData.parcelamento,
                status_conta: formData.status_conta,
                pdf_url: pdfUrl,
                alertas: alertas
            };

            const { error } = await supabase.from('standalone_contas').insert(invoiceData);
            if (error) throw error;

            showAlert('Fatura salva com sucesso!', 'success');
            if (onSave) onSave();
            onClose();
        } catch (err) {
            showAlert('Erro ao salvar fatura: ' + err.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
            <div className="relative bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-white/20 transform transition-all animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center p-6 border-b border-gray-100/50 bg-white/50 sticky top-0 z-10">
                    <h2 className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                        {step === 'upload' ? 'Upload de Fatura' : step === 'create_uc' ? 'Criar Nova Unidade' : 'Revisão de Dados'}
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100/80 rounded-full transition-colors group">
                        <X className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors"/>
                    </button>
                </div>

                <div className="p-6">
                    {step === 'upload' && (
                        <div className="space-y-6">
                            <div className="relative group">
                                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
                                <div className="relative border-2 border-dashed border-emerald-200 bg-white/60 rounded-xl p-10 text-center hover:border-emerald-400 transition-colors">
                                    <FileText className="w-14 h-14 text-emerald-400 mx-auto mb-4 group-hover:scale-110 transition-transform duration-300" />
                                    <h3 className="text-lg font-semibold text-gray-800 mb-2">Selecione a Fatura PDF</h3>
                                    <p className="text-sm text-gray-500 mb-6">Arraste e solte o arquivo ou clique para procurar</p>
                                    <label className="cursor-pointer inline-flex items-center justify-center px-6 py-2.5 border border-emerald-200 rounded-full text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors">
                                        <span>Procurar Arquivo</span>
                                        <input type="file" accept=".pdf" onChange={handlePdfChange} className="hidden" />
                                    </label>
                                    {pdfFile && <div className="mt-4 text-sm font-medium text-emerald-600">{pdfFile.name}</div>}
                                </div>
                            </div>
                            <button
                                onClick={triggerUpload}
                                disabled={isParsing || !pdfFile}
                                className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-medium flex items-center justify-center transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:-translate-y-0.5"
                            >
                                {isParsing ? <><Loader2 className="w-5 h-5 animate-spin mr-2"/> Extraindo dados...</> : 'Analisar Documento'}
                            </button>
                        </div>
                    )}

                    {step === 'create_uc' && (
                        <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
                            <div className="bg-amber-50/80 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start shadow-sm">
                                <AlertCircle className="w-5 h-5 mr-3 shrink-0 text-amber-500 mt-0.5" />
                                <div>
                                    <p className="font-semibold text-sm">Unidade não encontrada</p>
                                    <p className="text-sm opacity-90 mt-1">A UC <strong>{newUcForm.numero_uc}</strong> não existe nesta Usina. Cadastre-a agora para prosseguir.</p>
                                </div>
                            </div>

                            <div className="bg-gray-50/50 p-5 rounded-xl border border-gray-100 space-y-4">
                                <div className="grid grid-cols-2 gap-5">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Número da UC</label>
                                        <input type="text" value={newUcForm.numero_uc} disabled className="w-full bg-gray-100/80 border-gray-200 text-gray-500 rounded-lg p-2.5 text-sm font-medium"/>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tipo de Entidade</label>
                                        <select value={newUcForm.tipo} onChange={e => setNewUcForm({...newUcForm, tipo: e.target.value})} className="w-full border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white transition-all shadow-sm">
                                            <option value="uc">Unidade Consumidora (UC)</option>
                                            <option value="ug">Unidade Geradora (UG)</option>
                                        </select>
                                    </div>

                                    {newUcForm.tipo === 'ug' ? (
                                        <div className="col-span-2">
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Sistema de Compensação da Usina</label>
                                            <select value={newUcForm.sistema_compensacao} onChange={e => setNewUcForm({...newUcForm, sistema_compensacao: e.target.value})} className="w-full border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white transition-all shadow-sm">
                                                <option value="prioridade">Prioridade (Hierarquia de UCs)</option>
                                                <option value="porcentagem">Porcentagem (Cotas fixas)</option>
                                            </select>
                                        </div>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Nível de Prioridade</label>
                                                <input type="number" min="2" value={newUcForm.prioridade} onChange={e => setNewUcForm({...newUcForm, prioridade: parseInt(e.target.value)})} className="w-full border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white transition-all shadow-sm"/>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Cota (%)</label>
                                                <input type="number" step="0.1" value={newUcForm.porcentagem} onChange={e => setNewUcForm({...newUcForm, porcentagem: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white transition-all shadow-sm"/>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <label className="flex items-center space-x-3 mt-2 p-3 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                    <input type="checkbox" checked={newUcForm.conta_saldo} onChange={e => setNewUcForm({...newUcForm, conta_saldo: e.target.checked})} className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300"/>
                                    <span className="text-sm font-medium text-gray-700">Esta é uma <span className="text-emerald-600">conta saldo</span>? (Recebe sobras de crédito do ciclo)</span>
                                </label>
                            </div>

                            <div className="flex justify-end pt-2">
                                <button onClick={handleCreateUc} disabled={isSubmitting} className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-medium shadow-md shadow-emerald-500/20 flex items-center transition-all hover:-translate-y-0.5">
                                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : 'Salvar e Prosseguir'}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 'sandbox' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="bg-gray-50/80 p-5 rounded-xl border border-gray-100 shadow-inner">
                                <div className="flex items-center justify-between mb-5">
                                    <h3 className="text-sm font-bold text-gray-600 uppercase tracking-wider flex items-center">
                                        <div className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></div>
                                        Dados da Fatura (UC: {matchedUc?.numero_uc})
                                    </h3>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-5">
                                    <div className="col-span-2 md:col-span-3">
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5 flex items-center">
                                            Status da Conta <span className="text-red-500 ml-1">*</span>
                                        </label>
                                        <select 
                                            value={formData.status_conta} 
                                            onChange={e => setFormData({...formData, status_conta: e.target.value})} 
                                            className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-2 focus:ring-emerald-500 bg-white shadow-sm font-medium"
                                        >
                                            <option value="">Selecione...</option>
                                            <option value="A Vencer">A Vencer</option>
                                            <option value="Vencido">Vencido</option>
                                            <option value="Pago">Pago</option>
                                            <option value="Parcelada">Parcelada</option>
                                            <option value="Contestada">Contestada</option>
                                        </select>
                                        {formData.status_conta === 'Pago' && (
                                            <p className="text-xs text-blue-600 mt-2 font-medium bg-blue-50 p-2 rounded border border-blue-100">
                                                <AlertCircle className="w-3 h-3 inline mr-1" />
                                                <strong>Atenção (CDC):</strong> Como a conta está Paga, se o auditor identificar cobrança indevida, o cliente tem direito à restituição em dobro.
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Mês Ref.</label>
                                        <input type="text" value={formData.mes_referencia} onChange={e => setFormData({...formData, mes_referencia: e.target.value})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Leitura UG/UC</label>
                                        <input type="date" value={formData.data_leitura} onChange={e => setFormData({...formData, data_leitura: e.target.value})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Vencimento</label>
                                        <input type="date" value={formData.vencimento} onChange={e => setFormData({...formData, vencimento: e.target.value})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Consumo (kWh)</label>
                                        <input type="number" value={formData.consumo_kwh} onChange={e => setFormData({...formData, consumo_kwh: parseFloat(e.target.value)})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-emerald-600 uppercase mb-1.5">Energia Injetada</label>
                                        <input type="number" value={formData.energia_injetada} onChange={e => setFormData({...formData, energia_injetada: parseFloat(e.target.value)})} className="w-full text-sm border-emerald-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-emerald-50 shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-blue-600 uppercase mb-1.5">Energia Comp.</label>
                                        <input type="number" value={formData.energia_compensada} onChange={e => setFormData({...formData, energia_compensada: parseFloat(e.target.value)})} className="w-full text-sm border-blue-200 rounded-lg p-2 focus:ring-1 focus:ring-blue-500 bg-blue-50 shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Saldo Kwh</label>
                                        <input type="number" value={formData.saldo_kwh} onChange={e => setFormData({...formData, saldo_kwh: parseFloat(e.target.value)})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>
                                </div>
                            </div>
                            
                            {alertas.length > 0 && (
                                <div className="bg-red-50/80 p-4 rounded-xl border border-red-200 shadow-sm">
                                    <h4 className="text-red-700 font-bold text-sm mb-3 flex items-center">
                                        <AlertCircle className="w-5 h-5 mr-2 text-red-500"/>
                                        Alertas do Validador OCR
                                    </h4>
                                    <ul className="text-sm text-red-600 space-y-2">
                                        {alertas.map((a, i) => (
                                            <li key={i} className="flex items-start">
                                                <span className="w-1.5 h-1.5 bg-red-400 rounded-full mr-2 mt-1.5 shrink-0"></span>
                                                {a}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="flex justify-end pt-2">
                                <button onClick={handleSaveInvoice} disabled={isSubmitting} className="px-8 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-medium flex items-center shadow-md shadow-emerald-500/20 transition-all hover:-translate-y-0.5">
                                    {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin mr-2"/> : 'Confirmar e Salvar Fatura'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
