import { useState, useEffect } from 'react';
import { X, Save, Sparkles, RefreshCw, Layers, Info, Check, Percent } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useUI } from '../../../contexts/UIContext';

export default function PlanModal({ isOpen, onClose, onSave, planToEdit }) {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(false);

    // Estado do formulário
    const [nome, setNome] = useState('');
    const [descontoAssinante, setDescontoAssinante] = useState('15');
    const [ativo, setAtivo] = useState(true);
    const [recompensasAtivo, setRecompensasAtivo] = useState(true);
    const [tipoRecompensa, setTipoRecompensa] = useState('start'); // 'start' | 'recorrente' | 'hibrido'

    // Configuração do Start
    const [faturasElegiveisStart, setFaturasElegiveisStart] = useState([2]); // padrão: 2a fatura
    const [regrasStart, setRegrasStart] = useState({
        1: { associacao: 0, coordenador: 0, embaixador: 0, assinante: 0 },
        2: { associacao: 0, coordenador: 0, embaixador: 0, assinante: 0 },
        3: { associacao: 0, coordenador: 0, embaixador: 0, assinante: 0 }
    });

    // Configuração do Recorrente
    const [mesesRecorrente, setMesesRecorrente] = useState(48);
    const [regrasRecorrente, setRegrasRecorrente] = useState({
        associacao: 0,
        coordenador: 0,
        embaixador: 0,
        assinante: 0
    });

    // Preenche com dados se for edição ou reseta para novo
    useEffect(() => {
        if (planToEdit) {
            setNome(planToEdit.nome || '');
            setDescontoAssinante(planToEdit.desconto_assinante ?? '15');
            setAtivo(planToEdit.ativo ?? true);
            setRecompensasAtivo(planToEdit.recompensas_ativo ?? true);
            setTipoRecompensa(planToEdit.tipo_recompensa || 'start');

            if (planToEdit.start_config) {
                setFaturasElegiveisStart(planToEdit.start_config.faturas_elegiveis || [2]);
                setRegrasStart({
                    1: { associacao: 0, coordenador: 0, embaixador: 0, assinante: 0, ...(planToEdit.start_config.regras?.[1] || {}) },
                    2: { associacao: 0, coordenador: 0, embaixador: 0, assinante: 0, ...(planToEdit.start_config.regras?.[2] || {}) },
                    3: { associacao: 0, coordenador: 0, embaixador: 0, assinante: 0, ...(planToEdit.start_config.regras?.[3] || {}) }
                });
            }

            if (planToEdit.recorrente_config) {
                setMesesRecorrente(planToEdit.recorrente_config.meses ?? 48);
                setRegrasRecorrente({
                    associacao: planToEdit.recorrente_config.regras?.associacao ?? 0,
                    coordenador: planToEdit.recorrente_config.regras?.coordenador ?? 0,
                    embaixador: planToEdit.recorrente_config.regras?.embaixador ?? 0,
                    assinante: planToEdit.recorrente_config.regras?.assinante ?? 0
                });
            }
        } else {
            setNome('');
            setDescontoAssinante('15');
            setAtivo(true);
            setRecompensasAtivo(true);
            setTipoRecompensa('start');
            setFaturasElegiveisStart([2]);
            setRegrasStart({
                1: { associacao: 0, coordenador: 0, embaixador: 0, assinante: 0 },
                2: { associacao: 0, coordenador: 0, embaixador: 0, assinante: 0 },
                3: { associacao: 0, coordenador: 0, embaixador: 0, assinante: 0 }
            });
            setMesesRecorrente(48);
            setRegrasRecorrente({ associacao: 0, coordenador: 0, embaixador: 0, assinante: 0 });
        }
    }, [planToEdit, isOpen]);

    if (!isOpen) return null;

    // Toggle de fatura elegível no Start
    const toggleFaturaStart = (faturaNum) => {
        setFaturasElegiveisStart(prev => {
            if (prev.includes(faturaNum)) {
                if (prev.length === 1) {
                    showAlert('Pelo menos uma fatura deve ser selecionada no Start.', 'warning');
                    return prev;
                }
                return prev.filter(f => f !== faturaNum).sort((a, b) => a - b);
            } else {
                return [...prev, faturaNum].sort((a, b) => a - b);
            }
        });
    };

    // Alteração de percentuais no Start
    const handleStartPctChange = (faturaNum, papel, value) => {
        const val = value === '' ? '' : Math.max(0, Math.min(100, parseFloat(value) || 0));
        setRegrasStart(prev => ({
            ...prev,
            [faturaNum]: {
                ...prev[faturaNum],
                [papel]: val
            }
        }));
    };

    // Alteração de percentuais no Recorrente
    const handleRecorrentePctChange = (papel, value) => {
        const val = value === '' ? '' : Math.max(0, Math.min(100, parseFloat(value) || 0));
        setRegrasRecorrente(prev => ({
            ...prev,
            [papel]: val
        }));
    };

    // Cálculo da fatura onde se inicia a recorrência no modo híbrido
    const maxFaturaStart = faturasElegiveisStart.length > 0 ? Math.max(...faturasElegiveisStart) : 0;
    const inicioRecorrenciaHibrido = maxFaturaStart + 1;

    // Salvar
    const handleSave = async (e) => {
        e.preventDefault();

        if (!nome.trim()) {
            showAlert('Por favor, informe o Nome do Plano.', 'error');
            return;
        }

        const descVal = parseFloat(descontoAssinante);
        if (isNaN(descVal) || descVal < 0 || descVal > 100) {
            showAlert('O desconto do assinante deve ser um percentual entre 0 e 100.', 'error');
            return;
        }

        setLoading(true);

        const payload = {
            nome: nome.trim(),
            desconto_assinante: descVal,
            ativo,
            recompensas_ativo: recompensasAtivo,
            tipo_recompensa: tipoRecompensa,
            start_config: {
                faturas_elegiveis: faturasElegiveisStart,
                regras: regrasStart
            },
            recorrente_config: {
                meses: parseInt(mesesRecorrente, 10) || 48,
                regras: regrasRecorrente
            },
            updated_at: new Date().toISOString()
        };

        try {
            if (planToEdit?.id) {
                const { error } = await supabase
                    .from('planos_assinatura_energia')
                    .update(payload)
                    .eq('id', planToEdit.id);

                if (error) throw error;
                showAlert('Plano atualizado com sucesso!', 'success');
            } else {
                const { error } = await supabase
                    .from('planos_assinatura_energia')
                    .insert([payload]);

                if (error) throw error;
                showAlert('Plano criado com sucesso!', 'success');
            }

            if (onSave) onSave();
            onClose();
        } catch (err) {
            console.error('Erro ao salvar plano:', err);
            showAlert('Erro ao salvar plano: ' + (err.message || 'Erro desconhecido'), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(6px)', padding: '1rem'
        }}>
            <div style={{
                background: '#ffffff', width: '100%', maxWidth: '820px', borderRadius: '24px',
                maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                animation: 'modalFadeIn 0.25s ease-out', border: '1px solid #e2e8f0'
            }}>
                <style>{`
                    @keyframes modalFadeIn {
                        from { opacity: 0; transform: translateY(8px) scale(0.99); }
                        to { opacity: 1; transform: translateY(0) scale(1); }
                    }
                    .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                    .custom-scrollbar::-webkit-scrollbar-track { background: #f8fafc; }
                    .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
                `}</style>

                {/* Header */}
                <div style={{
                    padding: '1.25rem 2rem', background: '#ffffff', borderBottom: '1px solid #f1f5f9',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                        <div style={{
                            padding: '0.65rem', background: '#e0f2fe', borderRadius: '12px',
                            color: '#0284c7', display: 'flex'
                        }}>
                            <Percent size={22} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a', fontWeight: 700 }}>
                                {planToEdit ? 'Editar Plano de Assinatura' : 'Criar Plano de Assinatura'}
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                                Parametrize desconto do assinante e regras de recompensa
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: '#f1f5f9', border: 'none', cursor: 'pointer',
                            color: '#64748b', padding: '0.5rem', borderRadius: '50%', display: 'flex',
                            transition: 'background 0.2s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                        onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body com Scroll */}
                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div className="custom-scrollbar" style={{
                        padding: '1.75rem 2rem', overflowY: 'auto', flex: 1,
                        background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '1.5rem'
                    }}>

                        {/* Bloco 1: Informações Gerais do Plano */}
                        <div style={{
                            background: 'white', padding: '1.5rem', borderRadius: '16px',
                            border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                        }}>
                            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', color: '#1e293b', fontWeight: 600 }}>
                                Informações Principais
                            </h4>

                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                                        Nome do Plano *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Ex: Plano Economia Verde 15%"
                                        value={nome}
                                        onChange={e => setNome(e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px',
                                            border: '1px solid #cbd5e1', fontSize: '0.9rem', outline: 'none',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                                        Desconto do Assinante (%) *
                                    </label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max="100"
                                            placeholder="15.00"
                                            value={descontoAssinante}
                                            onChange={e => setDescontoAssinante(e.target.value)}
                                            required
                                            style={{
                                                width: '100%', padding: '0.65rem 1.8rem 0.65rem 0.85rem', borderRadius: '10px',
                                                border: '1px solid #cbd5e1', fontSize: '0.9rem', outline: 'none',
                                                boxSizing: 'border-box'
                                            }}
                                        />
                                        <span style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>
                                            %
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Toggle Ativo */}
                            <div style={{
                                marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                            }}>
                                <div>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>Status do Plano</span>
                                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
                                        {ativo ? 'Disponível para seleção e uso na plataforma' : 'Inativo (arquivado temporariamente)'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setAtivo(!ativo)}
                                    style={{
                                        width: '46px', height: '24px', borderRadius: '20px',
                                        background: ativo ? '#0284c7' : '#cbd5e1', border: 'none',
                                        cursor: 'pointer', position: 'relative', transition: 'background 0.2s', padding: 0
                                    }}
                                >
                                    <div style={{
                                        width: '18px', height: '18px', borderRadius: '50%', background: 'white',
                                        position: 'absolute', top: '3px', left: ativo ? '25px' : '3px',
                                        transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                    }} />
                                </button>
                            </div>
                        </div>

                        {/* Bloco 2: Seção de Recompensas */}
                        <div style={{
                            background: 'white', padding: '1.5rem', borderRadius: '16px',
                            border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                marginBottom: '1.25rem'
                            }}>
                                <div>
                                    <h4 style={{ margin: 0, fontSize: '0.98rem', color: '#0f172a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Sparkles size={18} color="#0284c7" />
                                        Seção de Recompensas
                                    </h4>
                                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                                        Configure os percentuais pagos para a rede de originadores e parceiros
                                    </p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: recompensasAtivo ? '#0284c7' : '#64748b' }}>
                                        {recompensasAtivo ? 'Ativado' : 'Desativado'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setRecompensasAtivo(!recompensasAtivo)}
                                        style={{
                                            width: '46px', height: '24px', borderRadius: '20px',
                                            background: recompensasAtivo ? '#10b981' : '#cbd5e1', border: 'none',
                                            cursor: 'pointer', position: 'relative', transition: 'background 0.2s', padding: 0
                                        }}
                                    >
                                        <div style={{
                                            width: '18px', height: '18px', borderRadius: '50%', background: 'white',
                                            position: 'absolute', top: '3px', left: recompensasAtivo ? '25px' : '3px',
                                            transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                        }} />
                                    </button>
                                </div>
                            </div>

                            {recompensasAtivo ? (
                                <>
                                    {/* 3 Opções de Modalidade de Recompensa */}
                                    <div style={{ marginBottom: '1.5rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.6rem' }}>
                                            Modalidade de Recompensa:
                                        </label>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                                            {/* Opção Start */}
                                            <button
                                                type="button"
                                                onClick={() => setTipoRecompensa('start')}
                                                style={{
                                                    padding: '0.85rem 1rem', borderRadius: '12px', border: '2px solid',
                                                    borderColor: tipoRecompensa === 'start' ? '#0284c7' : '#e2e8f0',
                                                    background: tipoRecompensa === 'start' ? '#f0f9ff' : '#ffffff',
                                                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s'
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                                                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: tipoRecompensa === 'start' ? '#0284c7' : '#1e293b' }}>
                                                        Start
                                                    </span>
                                                    {tipoRecompensa === 'start' && <Check size={16} color="#0284c7" />}
                                                </div>
                                                <span style={{ fontSize: '0.73rem', color: '#64748b', display: 'block', lineHeight: 1.3 }}>
                                                    Paga na 2ª fatura (ou faturas 1, 2, 3)
                                                </span>
                                            </button>

                                            {/* Opção Recorrente */}
                                            <button
                                                type="button"
                                                onClick={() => setTipoRecompensa('recorrente')}
                                                style={{
                                                    padding: '0.85rem 1rem', borderRadius: '12px', border: '2px solid',
                                                    borderColor: tipoRecompensa === 'recorrente' ? '#10b981' : '#e2e8f0',
                                                    background: tipoRecompensa === 'recorrente' ? '#f0fdf4' : '#ffffff',
                                                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s'
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                                                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: tipoRecompensa === 'recorrente' ? '#059669' : '#1e293b' }}>
                                                        Recorrente
                                                    </span>
                                                    {tipoRecompensa === 'recorrente' && <Check size={16} color="#059669" />}
                                                </div>
                                                <span style={{ fontSize: '0.73rem', color: '#64748b', display: 'block', lineHeight: 1.3 }}>
                                                    Paga em toda fatura mensal (ex: 48 meses)
                                                </span>
                                            </button>

                                            {/* Opção Híbrido */}
                                            <button
                                                type="button"
                                                onClick={() => setTipoRecompensa('hibrido')}
                                                style={{
                                                    padding: '0.85rem 1rem', borderRadius: '12px', border: '2px solid',
                                                    borderColor: tipoRecompensa === 'hibrido' ? '#8b5cf6' : '#e2e8f0',
                                                    background: tipoRecompensa === 'hibrido' ? '#f5f3ff' : '#ffffff',
                                                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s'
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                                                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: tipoRecompensa === 'hibrido' ? '#7c3aed' : '#1e293b' }}>
                                                        Híbrido
                                                    </span>
                                                    {tipoRecompensa === 'hibrido' && <Check size={16} color="#7c3aed" />}
                                                </div>
                                                <span style={{ fontSize: '0.73rem', color: '#64748b', display: 'block', lineHeight: 1.3 }}>
                                                    Ativar ambos (Start + Recorrência subsequente)
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* PAINEL START */}
                                    {(tipoRecompensa === 'start' || tipoRecompensa === 'hibrido') && (
                                        <div style={{
                                            border: '1px solid #bae6fd', background: '#f0f9ff', borderRadius: '14px',
                                            padding: '1.25rem', marginBottom: '1.25rem'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <span style={{
                                                        background: '#0284c7', color: 'white', fontSize: '0.7rem',
                                                        fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: '6px', textTransform: 'uppercase'
                                                    }}>
                                                        Start
                                                    </span>
                                                    <span style={{ fontSize: '0.86rem', fontWeight: 600, color: '#0369a1' }}>
                                                        Recompensa nas Faturas Iniciais
                                                    </span>
                                                </div>
                                                <span style={{ fontSize: '0.75rem', color: '#0369a1' }}>
                                                    Selecione as faturas elegíveis:
                                                </span>
                                            </div>

                                            {/* Checkboxes das faturas 1, 2, 3 */}
                                            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                                                {[1, 2, 3].map(fatNum => {
                                                    const isChecked = faturasElegiveisStart.includes(fatNum);
                                                    return (
                                                        <button
                                                            key={fatNum}
                                                            type="button"
                                                            onClick={() => toggleFaturaStart(fatNum)}
                                                            style={{
                                                                flex: 1, padding: '0.55rem 0.75rem', borderRadius: '8px',
                                                                border: isChecked ? '2px solid #0284c7' : '1px solid #cbd5e1',
                                                                background: isChecked ? '#ffffff' : '#f8fafc',
                                                                color: isChecked ? '#0284c7' : '#64748b',
                                                                fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                                                                transition: 'all 0.15s'
                                                            }}
                                                        >
                                                            <div style={{
                                                                width: '16px', height: '16px', borderRadius: '4px',
                                                                border: isChecked ? 'none' : '1.5px solid #94a3b8',
                                                                background: isChecked ? '#0284c7' : 'transparent',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                            }}>
                                                                {isChecked && <Check size={12} color="white" />}
                                                            </div>
                                                            Fatura {fatNum} {fatNum === 2 && <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>(padrão)</span>}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* Configuração individual para cada fatura elegível marcada */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                                                {faturasElegiveisStart.map(fatNum => (
                                                    <div key={fatNum} style={{
                                                        background: 'white', padding: '1rem', borderRadius: '10px',
                                                        border: '1px solid #e0f2fe'
                                                    }}>
                                                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.6rem' }}>
                                                            Percentuais da Fatura {fatNum}:
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.65rem' }}>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', fontWeight: 600, marginBottom: '0.25rem' }}>
                                                                    Assoc./Consórcio (%)
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0"
                                                                    max="100"
                                                                    placeholder="0.00"
                                                                    value={regrasStart[fatNum]?.associacao ?? ''}
                                                                    onChange={e => handleStartPctChange(fatNum, 'associacao', e.target.value)}
                                                                    style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', fontWeight: 600, marginBottom: '0.25rem' }}>
                                                                    Coord./Líder (%)
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0"
                                                                    max="100"
                                                                    placeholder="0.00"
                                                                    value={regrasStart[fatNum]?.coordenador ?? ''}
                                                                    onChange={e => handleStartPctChange(fatNum, 'coordenador', e.target.value)}
                                                                    style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', fontWeight: 600, marginBottom: '0.25rem' }}>
                                                                    Embaix./Originador (%)
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0"
                                                                    max="100"
                                                                    placeholder="0.00"
                                                                    value={regrasStart[fatNum]?.embaixador ?? ''}
                                                                    onChange={e => handleStartPctChange(fatNum, 'embaixador', e.target.value)}
                                                                    style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', fontWeight: 600, marginBottom: '0.25rem' }}>
                                                                    Assinante Originador (%)
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0"
                                                                    max="100"
                                                                    placeholder="0.00"
                                                                    value={regrasStart[fatNum]?.assinante ?? ''}
                                                                    onChange={e => handleStartPctChange(fatNum, 'assinante', e.target.value)}
                                                                    style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* PAINEL RECORRENTE */}
                                    {(tipoRecompensa === 'recorrente' || tipoRecompensa === 'hibrido') && (
                                        <div style={{
                                            border: '1px solid #a7f3d0', background: '#f0fdf4', borderRadius: '14px',
                                            padding: '1.25rem', marginBottom: '1rem'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <span style={{
                                                        background: '#10b981', color: 'white', fontSize: '0.7rem',
                                                        fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: '6px', textTransform: 'uppercase'
                                                    }}>
                                                        Recorrente
                                                    </span>
                                                    <span style={{ fontSize: '0.86rem', fontWeight: 600, color: '#065f46' }}>
                                                        Recompensa Mensal Contínua
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <label style={{ fontSize: '0.76rem', fontWeight: 600, color: '#065f46' }}>
                                                        Vigência (meses):
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="120"
                                                        value={mesesRecorrente}
                                                        onChange={e => setMesesRecorrente(e.target.value)}
                                                        style={{
                                                            width: '65px', padding: '0.35rem 0.5rem', borderRadius: '6px',
                                                            border: '1px solid #a7f3d0', background: 'white', fontSize: '0.82rem',
                                                            fontWeight: 700, textAlign: 'center'
                                                        }}
                                                    />
                                                </div>
                                            </div>

                                            <div style={{ background: 'white', padding: '1rem', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                                                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#065f46', marginBottom: '0.6rem' }}>
                                                    Percentuais pagos mensalmente durante os {mesesRecorrente || 48} meses:
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.65rem' }}>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', fontWeight: 600, marginBottom: '0.25rem' }}>
                                                            Assoc./Consórcio (%)
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="100"
                                                            placeholder="0.00"
                                                            value={regrasRecorrente.associacao ?? ''}
                                                            onChange={e => handleRecorrentePctChange('associacao', e.target.value)}
                                                            style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', fontWeight: 600, marginBottom: '0.25rem' }}>
                                                            Coord./Líder (%)
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="100"
                                                            placeholder="0.00"
                                                            value={regrasRecorrente.coordenador ?? ''}
                                                            onChange={e => handleRecorrentePctChange('coordenador', e.target.value)}
                                                            style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', fontWeight: 600, marginBottom: '0.25rem' }}>
                                                            Embaix./Originador (%)
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="100"
                                                            placeholder="0.00"
                                                            value={regrasRecorrente.embaixador ?? ''}
                                                            onChange={e => handleRecorrentePctChange('embaixador', e.target.value)}
                                                            style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', fontWeight: 600, marginBottom: '0.25rem' }}>
                                                            Assinante Originador (%)
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="100"
                                                            placeholder="0.00"
                                                            value={regrasRecorrente.assinante ?? ''}
                                                            onChange={e => handleRecorrentePctChange('assinante', e.target.value)}
                                                            style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', boxSizing: 'border-box' }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* AVISO DO MODO HÍBRIDO (NÃO-SOBREPOSIÇÃO) */}
                                    {tipoRecompensa === 'hibrido' && (
                                        <div style={{
                                            background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '12px',
                                            padding: '0.85rem 1rem', display: 'flex', alignItems: 'flex-start', gap: '0.65rem'
                                        }}>
                                            <Info size={18} color="#7c3aed" style={{ flexShrink: 0, marginTop: '2px' }} />
                                            <div style={{ fontSize: '0.78rem', color: '#5b21b6', lineHeight: 1.45 }}>
                                                <strong>Regra de Não-Sobreposição no Modo Híbrido:</strong>
                                                <br />
                                                O plano Start será aplicado nas faturas selecionadas (até a fatura {maxFaturaStart}).
                                                A comissão <strong>Recorrente</strong> iniciará automaticamente a partir da <strong>Fatura {inicioRecorrenciaHibrido}</strong> e perdurará pelos {mesesRecorrente} meses seguintes.
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div style={{
                                    padding: '1.5rem', textAlign: 'center', background: '#f8fafc',
                                    borderRadius: '12px', border: '1px dashed #cbd5e1'
                                }}>
                                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                                        As recompensas estão <strong>desativadas</strong> para este plano. Nenhuma comissão será provisionada automaticamente para originadores ou parceiros.
                                    </p>
                                </div>
                            )}
                        </div>

                    </div>

                    {/* Footer com Ações */}
                    <div style={{
                        padding: '1rem 2rem', background: '#ffffff', borderTop: '1px solid #f1f5f9',
                        display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center'
                    }}>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            style={{
                                padding: '0.65rem 1.25rem', borderRadius: '10px', border: '1px solid #cbd5e1',
                                background: 'white', color: '#475569', fontSize: '0.88rem', fontWeight: 600,
                                cursor: 'pointer', transition: 'all 0.15s'
                            }}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                padding: '0.65rem 1.5rem', borderRadius: '10px', border: 'none',
                                background: '#0284c7', color: 'white', fontSize: '0.88rem', fontWeight: 600,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
                                transition: 'background 0.15s', opacity: loading ? 0.7 : 1
                            }}
                        >
                            <Save size={16} />
                            {loading ? 'Salvando...' : (planToEdit ? 'Atualizar Plano' : 'Criar Plano')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
