import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { useBranding } from '../contexts/BrandingContext';
import {
    X, Download, CheckCircle, Clock, Zap, Users, FileText, AlertTriangle,
    ChevronRight, Activity, Hash, Calendar, Edit3, Save, XCircle
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import HistoryTimeline from './HistoryTimeline';

const STATUS_CONFIG = {
    criada: {
        label: 'Criada',
        color: '#1d4ed8',
        bg: '#eff6ff',
        border: '#bfdbfe',
        icon: FileText,
        transitions: [
            { target: 'processando', label: 'Iniciar Processamento', color: '#b45309', icon: Clock },
            { target: 'cancelada', label: 'Cancelar', color: '#4b5563', icon: XCircle }
        ]
    },
    processando: {
        label: 'Processando',
        color: '#b45309',
        bg: '#fffbeb',
        border: '#fde68a',
        icon: Clock,
        transitions: [
            { target: 'concluida', label: 'Marcar como Concluída', color: '#166534', icon: CheckCircle },
            { target: 'reprovada', label: 'Reprovar', color: '#dc2626', icon: AlertTriangle },
            { target: 'cancelada', label: 'Cancelar', color: '#4b5563', icon: XCircle }
        ]
    },
    reprovada: {
        label: 'Reprovada',
        color: '#dc2626',
        bg: '#fef2f2',
        border: '#fca5a5',
        icon: AlertTriangle,
        transitions: [
            { target: 'processando', label: 'Voltar para Processamento', color: '#b45309', icon: Clock },
            { target: 'cancelada', label: 'Cancelar', color: '#4b5563', icon: XCircle }
        ]
    },
    concluida: {
        label: 'Concluída',
        color: '#166534',
        bg: '#f0fdf4',
        border: '#bbf7d0',
        icon: CheckCircle,
        transitions: [
            { target: 'cancelada', label: 'Cancelar', color: '#4b5563', icon: XCircle }
        ]
    },
    cancelada: {
        label: 'Cancelada',
        color: '#4b5563',
        bg: '#f3f4f6',
        border: '#d1d5db',
        icon: XCircle,
        transitions: []
    }
};

const STATUS_ORDER = ['criada', 'processando', 'reprovada', 'concluida', 'cancelada'];

function formatDateBR(isoString) {
    if (!isoString) return null;
    return new Date(isoString).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function getUCStatusBadge(status) {
    const map = {
        ativo: { bg: '#dcfce7', color: '#166534', label: 'Ativo' },
        ativacao: { bg: '#dbeafe', color: '#1d4ed8', label: 'Em Ativação' },
        em_ativacao: { bg: '#dbeafe', color: '#1d4ed8', label: 'Em Ativação' },
        vinculado: { bg: '#ede9fe', color: '#6d28d9', label: 'Vinculado' },
        aguardando_conexao: { bg: '#fef9c3', color: '#92400e', label: 'Ag. Conexão' },
        desconectado: { bg: '#fee2e2', color: '#991b1b', label: 'Desconectado' },
        cancelado: { bg: '#f1f5f9', color: '#64748b', label: 'Cancelado' },
        cancelado_inadimplente: { bg: '#fee2e2', color: '#991b1b', label: 'Canc. Inadim.' },
    };
    return map[status] || { bg: '#f1f5f9', color: '#64748b', label: status || '-' };
}

export default function RateioListModal({ rateio, onClose, onUpdated }) {
    const { showAlert, showConfirm } = useUI();
    const { branding } = useBranding();
    const [loading, setLoading] = useState(false);
    const [protocolo, setProtocolo] = useState(rateio.protocolo || '');
    const [editingProtocolo, setEditingProtocolo] = useState(false);
    const [savingProtocolo, setSavingProtocolo] = useState(false);

    const statusCfg = STATUS_CONFIG[rateio.status] || STATUS_CONFIG.criada;
    const ucs = rateio.ucs_snapshot || [];
    const isPorcentagem = rateio.rateio_type === 'porcentagem';
    const statusDates = rateio.status_dates || {};

    // Only show UCs with allowed statuses (geradora always included)
    const ALLOWED_RATEIO_STATUSES = ['ativo', 'em_atraso', 'aguardando_conexao'];
    const eligibleUCs = ucs.filter(uc =>
        uc.tipo_unidade === 'geradora' || ALLOWED_RATEIO_STATUSES.includes(uc.status)
    );
    const excludedCount = ucs.length - eligibleUCs.length;

    /* ── Save Protocolo ────────────────────────────────────────── */
    const handleSaveProtocolo = async () => {
        setSavingProtocolo(true);
        try {
            const { error } = await supabase
                .from('rateio_lists')
                .update({ protocolo, updated_at: new Date().toISOString() })
                .eq('id', rateio.id);
            if (error) throw error;
            setEditingProtocolo(false);
            showAlert('Protocolo salvo!', 'success');
            if (onUpdated) onUpdated();
        } catch (err) {
            showAlert('Erro ao salvar protocolo: ' + err.message, 'error');
        } finally {
            setSavingProtocolo(false);
        }
    };

    /* ── Update Status ────────────────────────────────────────── */
    const handleUpdateStatus = async (targetStatus) => {
        const targetCfg = STATUS_CONFIG[targetStatus];
        if (!targetCfg) return;

        const isFinishing = targetStatus === 'concluida';
        let confirmMsg = `Deseja alterar o status para "${targetCfg.label}"?`;

        if (isFinishing) {
            confirmMsg = `Ao marcar como Concluída, todas as UCs vinculadas que não estiverem ativas serão automaticamente ativadas. Confirmar?`;
        } else if (targetStatus === 'cancelada') {
            confirmMsg = `Tem certeza que deseja Cancelar esta lista de rateio?`;
        } else if (targetStatus === 'reprovada') {
            confirmMsg = `Deseja marcar esta lista de rateio como Reprovada?`;
        }

        const confirmed = await showConfirm('Alterar Status', confirmMsg, 'Sim, Confirmar', 'Cancelar');
        if (!confirmed) return;

        setLoading(true);
        try {
            const now = new Date().toISOString();
            const newStatusDates = {
                ...statusDates,
                [`${targetStatus}_at`]: now
            };

            const { error } = await supabase
                .from('rateio_lists')
                .update({
                    status: targetStatus,
                    status_dates: newStatusDates,
                    updated_at: now
                })
                .eq('id', rateio.id);

            if (error) throw error;

            // Trigger: when concluded → activate non-active UCs
            if (isFinishing && rateio.usina_id) {
                const ucIds = ucs
                    .filter(uc => !['ativo', 'cancelado', 'cancelado_inadimplente'].includes(uc.status))
                    .map(uc => uc.id)
                    .filter(Boolean);

                if (ucIds.length > 0) {
                    const { error: ucError } = await supabase
                        .from('consumer_units')
                        .update({ status: 'ativo' })
                        .in('id', ucIds);

                    if (ucError) {
                        showAlert('Status atualizado, mas houve erro ao ativar algumas UCs.', 'warning');
                    } else {
                        showAlert(`Status → Concluída! ${ucIds.length} UC(s) ativada(s).`, 'success');
                    }
                } else {
                    showAlert('Status atualizado para Concluída!', 'success');
                }
            } else {
                showAlert(`Status → "${targetCfg.label}"!`, 'success');
            }

            if (onUpdated) onUpdated();
            onClose();
        } catch (err) {
            showAlert('Erro ao atualizar status: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    /* ── Anexo IV ──────────────────────────────────────────────── */
    const handleGenerateAnexoIV = () => {
        if (eligibleUCs.length === 0) {
            showAlert('Não há UCs elegíveis no snapshot para gerar o Anexo IV.', 'warning');
            return;
        }

        // CSV — only eligible UCs
        const csvHeaders = ['tipoCompensacao', 'cpf/cnpj', 'Conta contrato', 'Prioridade', 'Porcentagem', 'Saldo Remanescente'];
        const csvRows = eligibleUCs.map(uc => [
            uc.tipo_unidade === 'geradora' ? 'Unidade Geradora' : 'Unidade consumidora',
            uc.cpf_cnpj || '',
            uc.numero_uc,
            !isPorcentagem ? (uc.prioridade || '') : '',
            isPorcentagem ? Number(uc.calculatedPercentage || 0).toFixed(2) : '',
            uc.saldo_remanescente ? 'x' : ''
        ].join(';'));

        const csvContent = [csvHeaders.join(';'), ...csvRows].join('\n');
        const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const csvUrl = URL.createObjectURL(csvBlob);
        const csvLink = document.createElement('a');
        csvLink.href = csvUrl;
        csvLink.download = `lista_ucs_${rateio.usina_name || 'usina'}.csv`;
        csvLink.click();

        // PDF
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
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        currentY += 8;
        if (rateio.protocolo) {
            doc.text(`Protocolo: ${rateio.protocolo}`, 20, currentY);
            currentY += 6;
        }
        doc.text(`Usina: ${rateio.usina_name || '-'}`, 20, currentY); currentY += 6;
        doc.text(`Unidade Geradora: ${rateio.unidade_geradora || '-'}`, 20, currentY); currentY += 6;
        doc.text(`Concessionária: ${rateio.concessionaria || '-'}`, 20, currentY); currentY += 10;

        doc.setFont('helvetica', 'normal');
        const introText = "Declarar o percentual da energia excedente que será destinada a unidade principal (geradora) e a cada unidade consumidora participante do sistema de compensação de energia elétrica.";
        const splitText = doc.splitTextToSize(introText, pageWidth - 40);
        doc.text(splitText, 20, currentY);
        currentY += splitText.length * 5 + 10;

        autoTable(doc, {
            startY: currentY,
            head: [['Conta Contato', 'CPF/CNPJ', 'Unidade Consumidora', isPorcentagem ? 'Percentual' : 'Prioridade']],
            body: eligibleUCs.map(uc => [
                uc.numero_uc,
                uc.cpf_cnpj || '',
                uc.tipo_unidade === 'geradora' ? 'Principal(Gerador)' : 'Compensação',
                isPorcentagem ? `${Number(uc.calculatedPercentage || 0).toFixed(2)}%` : (uc.prioridade || '-')
            ]),
            theme: 'grid',
            headStyles: { fillColor: [100, 160, 60], textColor: [255, 255, 255], halign: 'center' },
            bodyStyles: { halign: 'center', fontSize: 9 },
            columnStyles: { 2: { halign: 'left' } }
        });

        currentY = Math.max(doc.lastAutoTable.finalY + 30, 250);
        const today = new Date().toLocaleDateString('pt-BR');
        doc.line(20, currentY, 70, currentY);
        doc.text('Local: Natal RN', 20, currentY + 5);
        doc.line(pageWidth / 2 - 25, currentY, pageWidth / 2 + 25, currentY);
        doc.text(`Data: ${today}`, pageWidth / 2, currentY + 5, { align: 'center' });
        doc.line(pageWidth - 70, currentY, pageWidth - 20, currentY);
        doc.text('Assinatura', pageWidth - 45, currentY + 5, { align: 'center' });

        doc.save(`anexo_iv_${rateio.usina_name || 'usina'}.pdf`);
        showAlert('Arquivo CSV e PDF gerados com sucesso!', 'success');
    };

    const StatusIcon = statusCfg.icon;
    const primaryColor = branding?.primary_color || '#003366';

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: 1100,
            backdropFilter: 'blur(4px)'
        }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                .rateio-modal * { font-family: 'Inter', sans-serif; }
                .rml-scrollbar::-webkit-scrollbar { width: 5px; }
                .rml-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .rml-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
                .rml-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                .rml-row:hover { background: #f8fafc !important; }
                .rml-proto-input {
                    border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 0.5rem 0.75rem;
                    font-size: 0.9rem; font-weight: 600; color: #1e293b; width: 100%;
                    outline: none; transition: border-color 0.2s;
                }
                .rml-proto-input:focus { border-color: ${primaryColor}; box-shadow: 0 0 0 3px ${primaryColor}20; }
            `}</style>

            <div className="rateio-modal rml-scrollbar" style={{
                background: '#f8fafc',
                borderRadius: '18px',
                width: '95%',
                maxWidth: '860px',
                maxHeight: '93vh',
                overflowY: 'auto',
                boxShadow: '0 30px 80px rgba(0,0,0,0.3)',
            }}>

                {/* ── Header ─────────────────────────────────────────── */}
                <div style={{
                    padding: '1.5rem 2rem',
                    background: 'white',
                    borderBottom: '1px solid #e2e8f0',
                    borderRadius: '18px 18px 0 0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                        <div style={{ padding: '0.65rem', background: primaryColor + '15', borderRadius: '12px', color: primaryColor }}>
                            <FileText size={24} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.3rem', color: '#1e293b', fontWeight: 800, lineHeight: 1.2 }}>
                                {rateio.usina_name || 'Usina'}
                            </h3>
                            <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                                Lista de Rateio · criada em {formatDateBR(rateio.created_at)}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: '#f1f5f9', border: 'none', cursor: 'pointer',
                        color: '#64748b', padding: '0.5rem', borderRadius: '8px', lineHeight: 1,
                        transition: 'all 0.2s'
                    }}>
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '1.75rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                    {/* ── Status + Actions ──────────────────────────────── */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'white', borderRadius: '14px', padding: '1.1rem 1.5rem',
                        border: '1px solid #e2e8f0', boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                        flexWrap: 'wrap', gap: '0.75rem'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                                padding: '0.4rem 1rem', borderRadius: '99px', fontSize: '0.82rem', fontWeight: 700,
                                background: statusCfg.bg, color: statusCfg.color, border: `1px solid ${statusCfg.border}`
                            }}>
                                <StatusIcon size={14} />{statusCfg.label}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                Tipo: <strong style={{ color: '#475569' }}>{isPorcentagem ? 'Porcentagem' : 'Prioridade'}</strong>
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                            <button onClick={handleGenerateAnexoIV} style={{
                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                padding: '0.55rem 1.1rem', background: primaryColor,
                                color: 'white', border: 'none', borderRadius: '10px',
                                cursor: 'pointer', fontSize: '0.83rem', fontWeight: 700
                            }}>
                                <Download size={15} /> Anexo IV
                            </button>
                            {(statusCfg.transitions || []).map((trans) => {
                                const TransIcon = trans.icon;
                                return (
                                    <button
                                        key={trans.target}
                                        onClick={() => handleUpdateStatus(trans.target)}
                                        disabled={loading}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                                            padding: '0.55rem 1.1rem',
                                            background: trans.color,
                                            color: 'white', border: 'none', borderRadius: '10px',
                                            cursor: loading ? 'wait' : 'pointer', fontSize: '0.83rem', fontWeight: 700,
                                            opacity: loading ? 0.7 : 1
                                        }}
                                    >
                                        <TransIcon size={15} />{trans.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Info Cards Row ────────────────────────────────── */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.9rem' }}>
                        {[
                            { icon: Zap, label: 'Unidade Geradora', value: rateio.unidade_geradora || '-', color: '#f59e0b', bg: '#fffbeb' },
                            { icon: Users, label: 'Total de UCs', value: `${rateio.qtd_ucs} UC${rateio.qtd_ucs !== 1 ? 's' : ''}`, color: '#3b82f6', bg: '#eff6ff' },
                            { icon: Activity, label: 'Concessionária', value: rateio.concessionaria || '-', color: '#8b5cf6', bg: '#f5f3ff' },
                        ].map((info, i) => (
                            <div key={i} style={{
                                background: 'white', borderRadius: '12px', padding: '0.9rem 1rem',
                                border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.65rem'
                            }}>
                                <div style={{ padding: '0.45rem', background: info.bg, borderRadius: '8px', color: info.color, flexShrink: 0 }}>
                                    <info.icon size={17} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.67rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{info.label}</div>
                                    <div style={{ fontSize: '0.9rem', color: '#1e293b', fontWeight: 700, lineHeight: 1.2 }}>{info.value}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* ── Protocolo Field ───────────────────────────────── */}
                    <div style={{
                        background: 'white', borderRadius: '14px', padding: '1.25rem 1.5rem',
                        border: '1px solid #e2e8f0', boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Hash size={16} color="#64748b" />
                                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    Protocolo
                                </span>
                            </div>
                            {!editingProtocolo ? (
                                <button onClick={() => setEditingProtocolo(true)} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                                    background: '#f1f5f9', border: 'none', borderRadius: '7px',
                                    padding: '0.3rem 0.7rem', cursor: 'pointer',
                                    fontSize: '0.75rem', color: '#64748b', fontWeight: 600
                                }}>
                                    <Edit3 size={13} /> Editar
                                </button>
                            ) : (
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button onClick={() => { setEditingProtocolo(false); setProtocolo(rateio.protocolo || ''); }} style={{
                                        background: '#f1f5f9', border: 'none', borderRadius: '7px',
                                        padding: '0.3rem 0.7rem', cursor: 'pointer',
                                        fontSize: '0.75rem', color: '#64748b', fontWeight: 600
                                    }}>
                                        Cancelar
                                    </button>
                                    <button onClick={handleSaveProtocolo} disabled={savingProtocolo} style={{
                                        display: 'flex', alignItems: 'center', gap: '0.35rem',
                                        background: primaryColor, border: 'none', borderRadius: '7px',
                                        padding: '0.3rem 0.7rem', cursor: 'pointer',
                                        fontSize: '0.75rem', color: 'white', fontWeight: 600,
                                        opacity: savingProtocolo ? 0.7 : 1
                                    }}>
                                        <Save size={13} /> Salvar
                                    </button>
                                </div>
                            )}
                        </div>
                        {editingProtocolo ? (
                            <input
                                className="rml-proto-input"
                                placeholder="Ex: 2025-12345 · Informe o número do protocolo da concessionária"
                                value={protocolo}
                                onChange={e => setProtocolo(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSaveProtocolo()}
                                autoFocus
                            />
                        ) : (
                            <div style={{
                                padding: '0.6rem 0.75rem',
                                background: protocolo ? '#f8fafc' : '#fafafa',
                                borderRadius: '8px',
                                border: '1px dashed #e2e8f0',
                                fontSize: '0.95rem',
                                fontWeight: protocolo ? 700 : 400,
                                color: protocolo ? '#1e293b' : '#94a3b8',
                                minHeight: '2.4rem',
                                display: 'flex', alignItems: 'center'
                            }}>
                                {protocolo || 'Nenhum protocolo registrado — clique em Editar para adicionar'}
                            </div>
                        )}
                    </div>

                    {/* ── Status Progress + Dates ──────────────────────── */}
                    <div style={{
                        background: 'white', borderRadius: '14px', padding: '1.25rem 1.5rem',
                        border: '1px solid #e2e8f0', boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                            <Calendar size={16} color="#64748b" />
                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Linha do Tempo
                            </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {STATUS_ORDER.map((s, idx) => {
                                const cfg = STATUS_CONFIG[s];
                                const currentIdx = STATUS_ORDER.indexOf(rateio.status);
                                const isActive = rateio.status === s;
                                const isPast = currentIdx > idx;
                                const isFuture = currentIdx < idx;

                                // Date resolution: criada uses created_at, others use status_dates
                                let dateStr = null;
                                if (s === 'criada') {
                                    dateStr = formatDateBR(rateio.created_at);
                                } else {
                                    dateStr = formatDateBR(statusDates[`${s}_at`]);
                                }

                                const Ic = cfg.icon;
                                const dotColor = isActive ? cfg.color : isPast ? '#10b981' : '#cbd5e1';
                                const lineColor = isPast ? '#10b981' : '#e2e8f0';

                                return (
                                    <div key={s} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                                        {/* Timeline dot + line */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                            <div style={{
                                                width: '38px', height: '38px', borderRadius: '50%',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                background: dotColor,
                                                color: isFuture ? '#94a3b8' : 'white',
                                                boxShadow: isActive ? `0 0 0 5px ${cfg.bg}` : 'none',
                                                transition: 'all 0.3s ease',
                                                zIndex: 1
                                            }}>
                                                {isPast ? <CheckCircle size={18} /> : <Ic size={16} />}
                                            </div>
                                            {idx < STATUS_ORDER.length - 1 && (
                                                <div style={{ width: '2px', height: '36px', background: lineColor, margin: '3px 0', transition: 'background 0.3s' }} />
                                            )}
                                        </div>

                                        {/* Label + date */}
                                        <div style={{ paddingTop: '0.55rem', paddingBottom: idx < STATUS_ORDER.length - 1 ? '0.5rem' : 0 }}>
                                            <div style={{
                                                fontSize: '0.88rem', fontWeight: 700,
                                                color: isActive ? cfg.color : isPast ? '#166534' : '#94a3b8'
                                            }}>
                                                {cfg.label}
                                                {isActive && (
                                                    <span style={{
                                                        marginLeft: '0.5rem', fontSize: '0.65rem',
                                                        background: cfg.bg, color: cfg.color,
                                                        padding: '0.1rem 0.45rem', borderRadius: '99px',
                                                        border: `1px solid ${cfg.border}`, fontWeight: 700
                                                    }}>Atual</span>
                                                )}
                                            </div>
                                            {dateStr ? (
                                                <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                    <Calendar size={11} />
                                                    {dateStr}
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: '0.73rem', color: '#cbd5e1', marginTop: '0.15rem', fontStyle: 'italic' }}>
                                                    {isFuture ? 'Pendente' : 'Data não registrada'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── History Timeline / Informações Complementares ── */}
                    <div style={{
                        background: 'white', borderRadius: '14px', padding: '1.25rem 1.5rem',
                        border: '1px solid #e2e8f0', boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                            <Clock size={16} color="#64748b" />
                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Informações Complementares e Histórico
                            </span>
                        </div>
                        <HistoryTimeline
                            entityType="rateio"
                            entityId={rateio.id}
                            entityName={rateio.usina_name}
                            isInline={true}
                            compact={true}
                            hideHeader={true}
                        />
                    </div>

                    {/* ── UCs Table ─────────────────────────────────────── */}
                    <div style={{
                        background: 'white', borderRadius: '14px',
                        border: '1px solid #e2e8f0', overflow: 'hidden',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                    }}>
                        <div style={{
                            padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Users size={16} color="#64748b" />
                                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' }}>
                                    Unidades Consumidoras <span style={{ color: '#94a3b8', fontWeight: 500 }}>({eligibleUCs.length})</span>
                                </span>
                                {excludedCount > 0 && (
                                    <span style={{
                                        fontSize: '0.7rem', color: '#b45309', background: '#fffbeb',
                                        border: '1px solid #fde68a', padding: '0.15rem 0.55rem',
                                        borderRadius: '99px', fontWeight: 700
                                    }}>
                                        {excludedCount} excluída{excludedCount !== 1 ? 's' : ''} (status inelegível)
                                    </span>
                                )}
                            </div>
                            <span style={{
                                fontSize: '0.7rem', color: '#94a3b8', background: '#f1f5f9',
                                padding: '0.2rem 0.6rem', borderRadius: '99px'
                            }}>
                                Snapshot da criação
                            </span>
                        </div>

                        {eligibleUCs.length === 0 ? (
                            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8' }}>
                                <AlertTriangle size={26} style={{ marginBottom: '0.5rem', opacity: 0.4 }} />
                                <p style={{ margin: 0, fontSize: '0.85rem' }}>Nenhuma UC elegível (Ativa, Em Atraso ou Ag. Conexão) neste rateio.</p>
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc' }}>
                                            {['Nº UC', 'CPF/CNPJ', 'Tipo', isPorcentagem ? 'Percentual' : 'Prioridade', 'Status', 'Franquia'].map((h, i) => (
                                                <th key={i} style={{
                                                    padding: '0.75rem 1rem', textAlign: i >= 3 ? 'center' : 'left',
                                                    color: '#64748b', fontWeight: 700, fontSize: '0.72rem',
                                                    textTransform: 'uppercase', letterSpacing: '0.04em',
                                                    borderBottom: '1px solid #e2e8f0',
                                                    ...(i === 5 ? { textAlign: 'right' } : {})
                                                }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {eligibleUCs.map((uc, idx) => {
                                            const ucBadge = getUCStatusBadge(uc.status);
                                            const isGeradora = uc.tipo_unidade === 'geradora';
                                            return (
                                                <tr key={uc.id || idx} className="rml-row" style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}>
                                                    <td style={{ padding: '0.8rem 1rem', fontWeight: 700, color: '#1e293b' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                            {isGeradora && (
                                                                <span style={{ fontSize: '0.62rem', background: '#fef9c3', color: '#92400e', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 800 }}>UG</span>
                                                            )}
                                                            {uc.numero_uc || '-'}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '0.8rem 1rem', color: '#475569' }}>{uc.cpf_cnpj || '-'}</td>
                                                    <td style={{ padding: '0.8rem 1rem', color: '#475569' }}>{isGeradora ? 'Principal (Geradora)' : 'Compensação'}</td>
                                                    <td style={{ padding: '0.8rem 1rem', textAlign: 'center', fontWeight: 700, color: primaryColor }}>
                                                        {isPorcentagem ? `${Number(uc.calculatedPercentage || 0).toFixed(2)}%` : (uc.prioridade || idx + 1)}
                                                        {uc.saldo_remanescente && <span style={{ fontSize: '0.62rem', color: '#10b981', marginLeft: '0.3rem', fontWeight: 800 }}>SR</span>}
                                                    </td>
                                                    <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                                        <span style={{
                                                            display: 'inline-block', padding: '0.22rem 0.65rem',
                                                            borderRadius: '99px', fontSize: '0.7rem', fontWeight: 700,
                                                            background: ucBadge.bg, color: ucBadge.color
                                                        }}>{ucBadge.label}</span>
                                                    </td>
                                                    <td style={{ padding: '0.8rem 1rem', textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                                                        {uc.franquia ? `${Math.round(uc.franquia)} kWh` : '-'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* ── Concluída banner ─────────────────────────────── */}
                    {rateio.status === 'concluida' && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '1rem 1.25rem', background: '#f0fdf4',
                            border: '1px solid #bbf7d0', borderRadius: '12px'
                        }}>
                            <CheckCircle size={20} color="#16a34a" />
                            <div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#166534' }}>Rateio Concluído</div>
                                <div style={{ fontSize: '0.78rem', color: '#4ade80' }}>Todas as UCs elegíveis foram ativadas automaticamente.</div>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
