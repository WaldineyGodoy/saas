import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Loader2, Download, AlertCircle, FileText, CheckCircle2 } from 'lucide-react';
import { getSecurePdfUrl } from '../lib/pdfHelper';
import ManualInvoiceUploadModal from './ManualInvoiceUploadModal';
import { useUI } from '../contexts/UIContext';

export default function ScraperQueueModal({ isOpen, onClose, onProcessed }) {
    const { showAlert } = useUI();
    const [queue, setQueue] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [pdfBlob, setPdfBlob] = useState(null);

    useEffect(() => {
        if (isOpen) {
            fetchQueue();
        }
    }, [isOpen]);

    const fetchQueue = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('invoices')
                .select(`
                    id, 
                    uc_id, 
                    mes_referencia, 
                    valor_concessionaria, 
                    concessionaria_pdf_url,
                    reading_status,
                    status,
                    reading_error,
                    consumer_units!inner (
                        numero_uc,
                        titular_fatura_id,
                        titular_fatura:titular_fatura_id(name)
                    )
                `)
                .eq('reading_status', 'processing')
                .eq('status', 'sem_faturamento')
                .order('mes_referencia', { ascending: false });

            if (error) throw error;
            setQueue(data || []);
        } catch (error) {
            console.error('Error fetching scraper queue:', error);
            showAlert('Erro ao buscar fila de processamento', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleProcess = async (invoice) => {
        if (!invoice.concessionaria_pdf_url) {
            showAlert('Conta sem PDF anexado.', 'warning');
            return;
        }

        setProcessingId(invoice.id);
        try {
            const secureUrl = await getSecurePdfUrl(supabase, invoice.concessionaria_pdf_url);
            const response = await fetch(secureUrl);
            if (!response.ok) throw new Error('Falha ao baixar PDF');
            const blob = await response.blob();
            
            // Generate a File object from the blob
            const file = new File([blob], `fatura_${invoice.consumer_units.numero_uc}_${invoice.mes_referencia}.pdf`, { type: 'application/pdf' });
            
            setPdfBlob(file);
            setSelectedInvoice(invoice);
        } catch (error) {
            console.error('Error downloading PDF:', error);
            showAlert('Erro ao preparar o PDF para processamento.', 'error');
        } finally {
            setProcessingId(null);
        }
    };

    const handleSuccess = () => {
        setSelectedInvoice(null);
        setPdfBlob(null);
        fetchQueue();
        if (onProcessed) onProcessed();
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
        }}>
            <div style={{
                background: 'white',
                borderRadius: '12px',
                width: '100%',
                maxWidth: '800px',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Download size={24} color="#3b82f6" />
                            Contas Baixadas (Fila de Processamento)
                        </h2>
                        <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.875rem' }}>
                            Contas extraídas automaticamente pelo robô aguardando revisão e extração.
                        </p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                        <X size={24} />
                    </button>
                </div>

                <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
                    {loading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem', color: '#64748b' }}>
                            <Loader2 size={32} className="spin" />
                            <span style={{ marginLeft: '1rem' }}>Buscando fila...</span>
                        </div>
                    ) : queue.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                            <CheckCircle2 size={48} color="#22c55e" style={{ margin: '0 auto 1rem auto' }} />
                            <h3 style={{ margin: '0 0 0.5rem 0', color: '#1e293b' }}>Fila Vazia</h3>
                            <p style={{ margin: 0 }}>Nenhuma conta aguardando processamento no momento.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem', background: '#f1f5f9', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 'bold', color: '#475569' }}>
                                <span>{queue.length} conta{queue.length !== 1 ? 's' : ''} na fila</span>
                            </div>
                            
                            {queue.map((inv) => (
                                <div key={inv.id} style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between',
                                    padding: '1rem',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '8px',
                                    background: 'white'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ background: '#eff6ff', padding: '0.75rem', borderRadius: '8px', color: '#3b82f6' }}>
                                            <FileText size={24} />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 'bold', color: '#1e293b' }}>
                                                UC {inv.consumer_units.numero_uc}
                                            </div>
                                            <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                                                {inv.consumer_units.titular_fatura?.name || 'Sem Titular'} • Ref: {inv.mes_referencia}
                                            </div>
                                            {inv.reading_error && (
                                                <div style={{ fontSize: '0.75rem', color: '#ea580c', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    <AlertCircle size={12} /> {inv.reading_error}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        {inv.valor_concessionaria && (
                                            <div style={{ fontWeight: '600', color: '#0f172a' }}>
                                                R$ {Number(inv.valor_concessionaria).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </div>
                                        )}
                                        
                                        <button 
                                            onClick={() => handleProcess(inv)}
                                            disabled={processingId === inv.id}
                                            style={{ 
                                                background: '#3b82f6', 
                                                color: 'white', 
                                                padding: '0.5rem 1rem', 
                                                borderRadius: '6px', 
                                                border: 'none', 
                                                cursor: processingId === inv.id ? 'not-allowed' : 'pointer',
                                                fontWeight: '600',
                                                fontSize: '0.875rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.5rem',
                                                opacity: processingId === inv.id ? 0.7 : 1
                                            }}
                                        >
                                            {processingId === inv.id ? (
                                                <><Loader2 size={16} className="spin" /> Baixando...</>
                                            ) : (
                                                'Processar'
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {selectedInvoice && pdfBlob && (
                <ManualInvoiceUploadModal 
                    uc={{ ...selectedInvoice.consumer_units, id: selectedInvoice.uc_id }}
                    initialFile={pdfBlob}
                    onClose={() => {
                        setSelectedInvoice(null);
                        setPdfBlob(null);
                    }}
                    onSuccess={handleSuccess}
                />
            )}
        </div>
    );
}
