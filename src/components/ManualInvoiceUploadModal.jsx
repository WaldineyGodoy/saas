import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, FileText, CheckCircle, AlertCircle, X, Search, Check, RefreshCw, AlertTriangle } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import * as pdfjsLib from 'pdfjs-dist';
// Explicitly load the worker for pdfjs
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export default function ManualInvoiceUploadModal({ uc, onClose, onSuccess }) {
    const { showAlert, showConfirm } = useUI();
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [extractionStatus, setExtractionStatus] = useState('idle'); // idle, extracting, success, error, mismtach
    const [extractedData, setExtractedData] = useState({
        mesReferencia: '',
        vencimento: '',
        valorTotal: '',
        consumoKwh: '',
        consumoCompensado: '',
        cipValor: '',
        outrosLancamentos: '',
        codigoCliente: ''
    });

    const fileInputRef = useRef(null);

    const formatCurrency = (val) => {
        if (typeof val !== 'number' && !val) return 'R$ 0,00';
        const num = typeof val === 'string' ? parseFloat(val.replace(',', '.')) : val;
        if (isNaN(num)) return 'R$ 0,00';
        return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const handleFileChange = async (e) => {
        const selectedFile = e.target.files[0];
        if (!selectedFile) return;

        if (selectedFile.type !== 'application/pdf') {
            showAlert('Por favor, selecione um arquivo PDF.', 'error');
            return;
        }

        setFile(selectedFile);
        await processPDF(selectedFile);
    };

    const parseValue = (raw) => {
        if (!raw) return 0;
        if (raw.includes(',') && raw.includes('.')) return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
        if (raw.includes(',')) return parseFloat(raw.replace(',', '.'));
        return parseFloat(raw);
    };

    const processPDF = async (pdfFile) => {
        setExtractionStatus('extracting');
        try {
            const arrayBuffer = await pdfFile.arrayBuffer();
            const pdfDocument = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            let fullText = '';
            for (let i = 1; i <= pdfDocument.numPages; i++) {
                const page = await pdfDocument.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += pageText + ' ';
            }

            // Neoenergia Patterns
            const cleanText = fullText.replace(/\s+/g, ' '); // normalize spaces

            const ucMatch = cleanText.match(/(?:Conta Contrato|C[óo]digo do Cliente|Instala[çc][ãa]o)[:\s]*(\d{9,11})/i) ||
                            cleanText.match(/N[úu]mero da \w+[:\s]*(\d{9,11})/i) ||
                            cleanText.match(/(\d{10})/); // Fallback to any 10 digit number

            // Month Format: REF:MÊS/ANO 03/2026 or Mês de Referência 03/2026
            const explicitRefMatch = cleanText.match(/(?:REF[:\s]*M[EÊ]S.*?ANO|M[eê]s(?:\s*de)?\s*Refer[eê]ncia)[^\d]*(0[1-9]|1[0-2])\/(20\d{2})/i) ||
                                     cleanText.match(/(?:REF[:\s]*M[EÊ]S.*?ANO|M[eê]s(?:\s*de)?\s*Refer[eê]ncia)[^\w]*([A-Z]{3}\/\d{4})/i);
            const refMonthMatch = explicitRefMatch || cleanText.match(/(0[1-9]|1[0-2])\/(20[2-9]\d)/); // Strict fallback format

            const dueDateMatch = cleanText.match(/Vencimento.*?\s(\d{2}\/\d{2}\/\d{2,4})/i) || cleanText.match(/VENCIMENTO.*?\b(\d{2}\/\d{2}\/\d{2,4})\b/i);
            const totalAmountMatch = cleanText.match(/(?:TOTAL A PAGAR R\$|Total\s*a\s*Pagar|Valor\s*a\s*Pagar|TOTAL)[^\d]+?([\d.]+(?:,\d{2}))/i) ||
                                     cleanText.match(/R\$\s*([\d.]+(?:,\d{2}))/i);
            
            // Consumo (Ativa) TE -> Format 'Consumo-TE kWh 3.230,00'
            const consumptionMatch = cleanText.match(/Consumo-TE.*?kWh\s*([\d.]+(?:,\d+)?)/i) || 
                                     cleanText.match(/(?:Energia Ativa.*?TE|TE\s*-\s*Energia|Consumo.*?TE|Energia Ativa).*?(?:kWh|\s)\s*([\d.]+(?:,\d+)?)/i);
            
            // Consumo Compensado -> Format 'G2Comp.oUC-nM-TE kWh 3.230,00-'
            const compensadoMatch = cleanText.match(/Comp.*?oUC.*?(?:TE|TUSD).*?kWh\s*([\d.]+(?:,\d+)?)/i) ||
                                    cleanText.match(/(?:Energia.*?Injetada|Energia.*?Compensada|Injetada).*?(?:kWh|\s)\s*([\d.]+(?:,\d+)?)/i);

            // CIP -> Format 'Ilum. Púb. Municipal 360,58'
            const cipMatch = cleanText.match(/(?:Ilum\.?\s*P[uú]b\.?\s*Municipal|CONTR\.? ILUM\.? PUB\.?|COSIP|CIP-MUNICIP\.)[^\d]*([\d.]+(?:,\d{2}))/i);

            // Outros Lancamentos (Multas, Juros, etc)
            const multasMatch = cleanText.match(/(?:Multa|Juros(?:.*Mora)?|Atualiza[çc][ãa]o Monet[áa]ria)[^\d]+?([\d.]+(?:,\d{2}))/ig);
            let somaOutros = 0;
            if (multasMatch) {
                multasMatch.forEach(m => {
                    const valMatch = m.match(/([\d.]+(?:,\d{2}))$/);
                    if (valMatch) somaOutros += parseValue(valMatch[1]);
                });
            }

            const parsedUc = ucMatch ? ucMatch[1] : '';
            const isUcMatch = parsedUc === uc.numero_uc;

            let extractedMesRef = '';
            if (explicitRefMatch) {
                extractedMesRef = `${explicitRefMatch[1]}/${explicitRefMatch[2]}`;
            } else if (refMonthMatch) {
                extractedMesRef = refMonthMatch[0];
            }

            if (extractedMesRef && extractedMesRef.includes('/')) {
                // normalize e.g. 03/2026 or MAR/2026
                const parts = extractedMesRef.split('/');
                const months = { 'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12' };
                let mm = parts[0].toUpperCase();
                mm = months[mm] || mm.padStart(2, '0');
                const yyyy = parts[1].length === 2 ? `20${parts[1]}` : parts[1];
                extractedMesRef = `${mm}/${yyyy}`;
            }

            let extractedDueDate = '';
            if (dueDateMatch) {
                const parts = dueDateMatch[1].split('/');
                const yyyy = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                extractedDueDate = `${yyyy}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
            }

            const parsedConsumo = parseValue(consumptionMatch ? consumptionMatch[1] : 0);
            const parsedCompensado = parseValue(compensadoMatch ? compensadoMatch[1] : 0);

            setExtractedData({
                codigoCliente: parsedUc,
                mesReferencia: extractedMesRef,
                vencimento: extractedDueDate,
                valorTotal: parseValue(totalAmountMatch ? totalAmountMatch[1] : null) || 0,
                consumoKwh: parseInt(parsedConsumo) || 0,
                consumoCompensado: parseInt(parsedCompensado) || 0,
                cipValor: parseValue(cipMatch ? cipMatch[1] : 0) || 0,
                outrosLancamentos: somaOutros,
            });

            if (!parsedUc) {
                setExtractionStatus('error');
            } else if (!isUcMatch) {
                setExtractionStatus('mismatch');
            } else {
                setExtractionStatus('success');
            }

        } catch (error) {
            console.error('Erro ao ler PDF:', error);
            setExtractionStatus('error');
            showAlert('Erro ao ler o arquivo PDF. Preencha manualmente.', 'error');
        }
    };

    const handleUpload = async () => {
        if (!file) return showAlert('Arquivo PDF não selecionado.', 'warning');
        
        let mesRefFormat = '';
        if (extractedData.mesReferencia) {
            const parts = extractedData.mesReferencia.split('/');
            mesRefFormat = `${parts[1]}-${parts[0].padStart(2, '0')}-01`;
        }

        if (!mesRefFormat) {
            return showAlert('Mês de referência não extraído. Revise o PDF.', 'warning');
        }

        setUploading(true);
        try {
            const fileName = `manual_${Date.now()}.pdf`;
            const storagePath = `invoices/${uc.numero_uc}/${fileName}`;
            
            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('energy-bills')
                .upload(storagePath, file, {
                    contentType: 'application/pdf',
                    upsert: true
                });

            if (uploadError) throw uploadError;

            // Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('energy-bills')
                .getPublicUrl(storagePath);

            // Upsert invoice data
            const valorTarifa = uc.tarifa_concessionaria || 0;
            const kwhMinimo = uc.tipo_ligacao === 'trifasico' ? 100 : (uc.tipo_ligacao === 'bifasico' ? 50 : 30);

            const payload = {
                uc_id: uc.id,
                mes_referencia: mesRefFormat,
                vencimento: extractedData.vencimento || null,
                tarifa_concessionaria: valorTarifa,
                tarifa_minima: kwhMinimo * valorTarifa,
                consumo_kwh: extractedData.consumoKwh || 0,
                iluminacao_publica: extractedData.cipValor || 0,
                outros_lancamentos: extractedData.outrosLancamentos || 0,
                consumo_reais: (extractedData.consumoKwh || kwhMinimo) * valorTarifa,
                valor_a_pagar: extractedData.valorTotal || 0,
                desconto_assinante: Number(uc.desconto_assinante) || 0,
                status: 'a_vencer',
                concessionaria_pdf_url: publicUrl
            };

            const { error: dbError } = await supabase
                .from('invoices')
                .upsert(payload, { onConflict: 'uc_id,mes_referencia' });

            if (dbError) throw dbError;

            // Update UC status so the robot knows it was successful
            const { error: ucError } = await supabase
                .from('consumer_units')
                .update({ last_scraping_status: 'success' })
                .eq('id', uc.id);
            
            if (ucError) throw ucError;

            showAlert('Fatura enviada e registrada com sucesso!', 'success');
            if (onSuccess) onSuccess();
            onClose();

        } catch (error) {
            console.error('Erro de upload:', error);
            showAlert('Erro ao fazer upload da fatura: ' + error.message, 'error');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1200, backdropFilter: 'blur(4px)' }}>
            <div style={{ background: 'white', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
                {/* Header */}
                <div style={{ padding: '1.2rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
                    <div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Upload size={18} /> Upload Manual de Fatura
                        </h3>
                        <p style={{ fontSize: '0.8rem', color: '#64748b' }}>UC: {uc.numero_uc}</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    
                    {/* Upload Area */}
                    <div 
                        onClick={() => fileInputRef.current?.click()}
                        style={{ 
                            border: '2px dashed #cbd5e1', 
                            borderRadius: '12px', 
                            padding: '2rem', 
                            textAlign: 'center', 
                            cursor: 'pointer',
                            background: file ? '#f0fdf4' : '#f8fafc',
                            borderColor: file ? '#86efac' : '#cbd5e1',
                            transition: 'all 0.2s'
                        }}
                    >
                        <input 
                            type="file" 
                            accept="application/pdf" 
                            ref={fileInputRef} 
                            style={{ display: 'none' }} 
                            onChange={handleFileChange}
                        />
                        {file ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                                <FileText size={32} color="#22c55e" />
                                <span style={{ fontWeight: 600, color: '#166534' }}>{file.name}</span>
                                <span style={{ fontSize: '0.8rem', color: '#15803d' }}>{(file.size / 1024 / 1024).toFixed(2)} MB - Clique para trocar</span>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                                <Upload size={32} color="#94a3b8" />
                                <span style={{ fontWeight: 600, color: '#475569' }}>Selecionar arquivo PDF da fatura</span>
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Apenas PDFs da Concessionária</span>
                            </div>
                        )}
                    </div>

                    {/* Extraction Status & Form */}
                    {extractionStatus !== 'idle' && (
                        <div style={{ padding: '1.25rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>
                                {extractionStatus === 'extracting' && (
                                    <><RefreshCw size={16} className="animate-spin" color="#3b82f6" /><span style={{ color: '#2563eb', fontWeight: 600, fontSize: '0.9rem' }}>Extraindo dados da Fatura...</span></>
                                )}
                                {extractionStatus === 'success' && (
                                    <><CheckCircle size={16} color="#22c55e" /><span style={{ color: '#166534', fontWeight: 600, fontSize: '0.9rem' }}>Dados extraídos com sucesso</span></>
                                )}
                                {extractionStatus === 'mismatch' && (
                                    <><AlertTriangle size={16} color="#eab308" /><span style={{ color: '#854d0e', fontWeight: 600, fontSize: '0.9rem' }}>Aviso: A UC do PDF difere desta UC</span></>
                                )}
                                {extractionStatus === 'error' && (
                                    <><AlertCircle size={16} color="#ef4444" /><span style={{ color: '#991b1b', fontWeight: 600, fontSize: '0.9rem' }}>Falha ao extrair do PDF. Verifique abaixo.</span></>
                                )}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div style={{ gridColumn: '1 / -1', background: extractionStatus === 'mismatch' ? '#fefce8' : 'transparent', padding: extractionStatus === 'mismatch' ? '0.5rem' : 0, borderRadius: '6px' }}>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Código do Cliente (UC no PDF)</label>
                                    <div style={{ fontWeight: 600, color: extractionStatus === 'mismatch' ? '#a16207' : '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {extractedData.codigoCliente || '-'}
                                        {extractionStatus === 'mismatch' && <span style={{ fontSize: '0.7rem', background: '#fef08a', color: '#854d0e', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Confi: {uc.numero_uc}</span>}
                                    </div>
                                </div>
                                
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Mês Referência</label>
                                    <input 
                                        type="text" 
                                        value={extractedData.mesReferencia} 
                                        onChange={e => setExtractedData({...extractedData, mesReferencia: e.target.value})}
                                        placeholder="MM/AAAA"
                                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Vencimento</label>
                                    <input 
                                        type="date" 
                                        value={extractedData.vencimento} 
                                        onChange={e => setExtractedData({...extractedData, vencimento: e.target.value})}
                                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Valor Total a Pagar</label>
                                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '1.1rem' }}>{formatCurrency(extractedData.valorTotal)}</div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Consumo (kWh)</label>
                                    <div style={{ fontWeight: 600, color: '#334155' }}>{extractedData.consumoKwh} kWh</div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Consumo Compensado</label>
                                    <div style={{ fontWeight: 600, color: '#16a34a' }}>{extractedData.consumoCompensado} kWh</div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>CIP (Ilum. Pública)</label>
                                    <div style={{ fontWeight: 600, color: '#334155' }}>{formatCurrency(extractedData.cipValor)}</div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Multas / Juros / Outros</label>
                                    <div style={{ fontWeight: 600, color: '#ef4444' }}>{formatCurrency(extractedData.outrosLancamentos)}</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={onClose} style={{ padding: '0.5rem 1rem', background: 'transparent', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#475569', fontWeight: 600, cursor: 'pointer' }}>
                        Cancelar
                    </button>
                    <button 
                        onClick={handleUpload}
                        disabled={uploading || !file || extractionStatus === 'extracting'}
                        style={{ 
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.5rem 1.5rem', 
                            background: uploading || !file ? '#94a3b8' : '#2563eb', 
                            border: 'none', 
                            borderRadius: '6px', 
                            color: '#fff', 
                            fontWeight: 600, 
                            cursor: uploading || !file ? 'not-allowed' : 'pointer',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                        }}
                    >
                        {uploading ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                        {uploading ? 'Processando...' : 'Confirmar e Subir Fatura'}
                    </button>
                </div>
            </div>
        </div>
    );
}
