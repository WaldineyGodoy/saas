import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, FileText, CheckCircle, AlertCircle, X, Search, Check, RefreshCw, AlertTriangle } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { recalcularFatura } from '../lib/api';
import * as pdfjsLib from 'pdfjs-dist';
// Explicitly load the worker for pdfjs
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export default function ManualInvoiceUploadModal({ uc, onClose, onSuccess, initialFile = null }) {
    const { showAlert, showConfirm } = useUI();
    const [file, setFile] = useState(initialFile);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [extractionStatus, setExtractionStatus] = useState('idle'); // idle, extracting, success, error, mismtach
    const [applyStamp, setApplyStamp] = useState(true);
    const [extractedData, setExtractedData] = useState({
        mesReferencia: '',
        vencimento: '',
        valorTotal: '',
        consumoKwh: '',
        consumoCompensado: '',
        energiaInjetada: '',
        cipValor: '',
        outrosLancamentos: '',
        codigoCliente: '',
        stampCoords: null // x, y for "Informações Importantes"
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

    React.useEffect(() => {
        if (initialFile) {
            processPDF(initialFile);
        }
    }, [initialFile]);

    const processPDF = async (pdfFile) => {
        setExtractionStatus('extracting');
        try {
            const data = await parseEnergyBill(pdfFile, uc?.numero_uc);
            setExtractedData(data);

            if (!data.codigoCliente) {
                setExtractionStatus('error');
            } else if (!data.isUcMatch) {
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
            let fileToUpload = file;

            // Apply Stamp and Trim if requested
            if (applyStamp) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
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

                    // Determine Y coordinate (pdfjs ty is from bottom, same as pdf-lib)
                    // If we found the "Informações Importantes" text, position below it.
                    // Otherwise, use a safe default at the bottom area.
                    let stampX = 40;
                    let stampY = 50;

                    if (extractedData.stampCoords) {
                        stampX = extractedData.stampCoords.x;
                        stampY = Math.max(20, extractedData.stampCoords.y - 15); // Just below the title
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
                    fileToUpload = new File([pdfBytes], file.name, { type: 'application/pdf' });
                    console.log("PDF trimmed and stamped successfully.");
                } catch (pdfErr) {
                    console.warn("Failed to apply stamp/trim, using original file:", pdfErr);
                }
            }

            const fileName = `manual_${Date.now()}.pdf`;
            const storagePath = `invoices/${uc.numero_uc}/${fileName}`;
            
            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('energy-bills')
                .upload(storagePath, fileToUpload, {
                    contentType: 'application/pdf',
                    upsert: true
                });

            if (uploadError) throw uploadError;

            // Upsert invoice data
            const valorTarifa = uc.tarifa_concessionaria || 0;
            const kwhMinimo = uc.tipo_ligacao === 'trifasico' ? 100 : (uc.tipo_ligacao === 'bifasico' ? 50 : 30);

            const payload = {
                uc_id: uc.id,
                mes_referencia: mesRefFormat,
                vencimento: extractedData.vencimento || null,
                vencimento_concessionaria: extractedData.vencimento || null,
                data_leitura: extractedData.dataLeitura || null,
                tarifa_concessionaria: valorTarifa,
                tarifa_minima: Math.max(0, ((extractedData.consumoKwh || 0) - (extractedData.consumoCompensado || 0)) * valorTarifa),
                consumo_kwh: extractedData.consumoKwh || 0,
                consumo_compensado: extractedData.consumoCompensado || 0,
                energia_injetada: extractedData.energiaInjetada || 0,
                iluminacao_publica: extractedData.cipValor || 0,
                outros_lancamentos: extractedData.outrosLancamentos || 0,
                consumo_reais: (extractedData.consumoKwh || kwhMinimo) * valorTarifa,
                valor_a_pagar: extractedData.valorTotal || 0,
                valor_concessionaria: extractedData.valorTotal || 0,
                desconto_assinante: Number(uc.desconto_assinante) || 0,
                desconto_aplicado: Number(uc.desconto_assinante) || 0,
                status: 'ag_emissao_boleto',
                concessionaria_pdf_url: storagePath,
                linha_digitavel: extractedData.linhaDigitavel || null,
                pix_string: extractedData.pixString || null,
                reading_status: 'success',
                reading_checked_at: new Date().toISOString(),
                is_placeholder: false
            };

            const { data: newInvoice, error: dbError } = await supabase
                .from('invoices')
                .upsert(payload, { onConflict: 'uc_id,mes_referencia' })
                .select()
                .single();

            if (dbError) throw dbError;

            // O upload manual gravava valor_a_pagar = total da conta da
            // concessionaria. Isso so esta certo quando a UC nao compensa; se
            // compensa, o assinante paga a energia com desconto e o numero e
            // outro. Quem decide isso agora e a fn_calcular_fatura, a mesma que
            // o robo usa.
            if (newInvoice?.id && !newInvoice?.asaas_payment_id) {
                try {
                    await recalcularFatura(newInvoice.id);
                } catch (recalcErro) {
                    console.error('Falha ao recalcular a fatura no servidor:', recalcErro);
                }
            }

            // Update UC status so the robot knows it was successful
            const { error: ucError } = await supabase
                .from('consumer_units')
                .update({ last_scraping_status: 'success' })
                .eq('id', uc.id);
            
            if (ucError) throw ucError;

            showAlert('Fatura enviada e registrada com sucesso!', 'success');
            if (onSuccess) onSuccess(newInvoice);
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
                            <Upload size={18} /> Conta de Energia Concessionária
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
                                <span style={{ fontWeight: 600, color: '#475569' }}>Selecionar PDF da Conta Concessionária</span>
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Extração automática de consumo e valores</span>
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
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Data da Leitura</label>
                                    <input 
                                        type="date" 
                                        value={extractedData.dataLeitura} 
                                        onChange={e => setExtractedData({...extractedData, dataLeitura: e.target.value})}
                                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Consumo (kWh)</label>
                                    <div style={{ fontWeight: 600, color: '#334155' }}>{extractedData.consumoKwh} kWh</div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#0284c7', display: 'block', marginBottom: '0.2rem' }}>Energia Injetada</label>
                                    <div style={{ fontWeight: 600, color: '#0284c7' }}>{extractedData.energiaInjetada || 0} kWh</div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Consumo Compensado</label>
                                    <div style={{ fontWeight: 600, color: '#16a34a' }}>{extractedData.consumoCompensado} kWh</div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Multas / Juros / Outros</label>
                                    <div style={{ fontWeight: 600, color: '#ef4444' }}>{formatCurrency(extractedData.outrosLancamentos)}</div>
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>CIP (Ilum. Pública)</label>
                                    <div style={{ fontWeight: 600, color: '#334155' }}>{formatCurrency(extractedData.cipValor)}</div>
                                </div>

                                <div>
                                                                         <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Valor Total da Conta de Energia</label>
                                    <input 
                                        type="number" 
                                        step="0.01"
                                        value={extractedData.valorTotal} 
                                        onChange={e => setExtractedData({...extractedData, valorTotal: parseFloat(e.target.value) || 0})}
                                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none', fontWeight: 700, color: '#0f172a' }}
                                    />
                                </div>

                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Linha Digitável (Código de Barras)</label>
                                    <input 
                                        type="text" 
                                        value={extractedData.linhaDigitavel} 
                                        onChange={e => setExtractedData({...extractedData, linhaDigitavel: e.target.value})}
                                        placeholder="00000000000 0 00000000000 0..."
                                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none', fontFamily: 'monospace', fontSize: '0.85rem' }}
                                    />
                                </div>

                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Código PIX Copia e Cola</label>
                                    <textarea 
                                        value={extractedData.pixString} 
                                        onChange={e => setExtractedData({...extractedData, pixString: e.target.value})}
                                        placeholder="00020126..."
                                        rows={3}
                                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Security Stamp Toggle - MOVED TO BOTTOM */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.8rem', background: '#fff7ed', borderRadius: '8px', border: '1px solid #ffedd5', width: '100%' }}>
                        <input 
                            type="checkbox" 
                            id="applyStamp"
                            checked={applyStamp}
                            onChange={(e) => setApplyStamp(e.target.checked)}
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        <label htmlFor="applyStamp" style={{ fontSize: '0.9rem', fontWeight: '500', color: '#9a3412', cursor: 'pointer', flex: 1 }}>
                             Aviso para Não Pagar 
                             <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'normal', color: '#c2410c', marginTop: '2px' }}>
                                (Quando ativo: descarta 2ª página e aplica carimbo de segurança no PDF)
                             </span>
                        </label>
                    </div>
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
                        {uploading ? 'Processando...' : 'Confirmar e Registrar Conta'}
                    </button>
                </div>
            </div>
        </div>
    );
}
