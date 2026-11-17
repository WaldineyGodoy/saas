import { useState, useEffect } from 'react';
import { X, Save, Lock, GitBranch, SunMedium, Percent, FileText, Award, Info } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
    CAMPOS_PLANO_USINA,
    PLANO_USINA_VAZIO,
    lerFechamentos,
    validarPlanoUsina,
    rascunhoNovaVersao,
    payloadPlanoUsina
} from '../../../lib/planoUsina';

const GRUPOS_PLANO_USINA = [
    {
        id: 'gestao',
        titulo: '1. Gestão B2W e Taxas Operacionais do Fechamento',
        subtitulo: 'Encargos recorrentes descontados na apuração mensal da usina',
        icon: Percent,
        cor: '#0284c7',
        chaves: ['percentual_recorrente', 'taxa_admin_reais', 'taxa_recuperacao_pct']
    },
    {
        id: 'originador',
        titulo: '2. Comissionamento do Originador da Usina',
        subtitulo: 'Remuneração recorrente e bônus de fechamento de quem originou o fornecedor',
        icon: Award,
        cor: '#7c3aed',
        chaves: ['originador_recorrente_pct', 'originador_lider_recorrente_pct'],
        incluiBonusFechamentos: true
    },
    {
        id: 'gestao_creditos',
        titulo: '3. Parâmetros Sugeridos para o Contrato de Gestão de Créditos',
        subtitulo: 'Valores iniciais preenchidos ao gerar o Contrato de Gestão do fornecedor',
        icon: FileText,
        cor: '#059669',
        chaves: ['desconto_pct', 'dia_corte', 'dia_repasse', 'prazo_transferencia_dias', 'prazo_honorarios_dias']
    },
    {
        id: 'compra_venda',
        titulo: '4. Cláusulas de Compra e Venda, Multas e Garantia',
        subtitulo: 'Termos contratuais de rescisão, mora e garantia de instalação',
        icon: SunMedium,
        cor: '#d97706',
        chaves: ['retencao_rescisao_pct', 'multa_atraso_mes_pct', 'multa_atraso_teto_pct', 'garantia_instalacao_meses']
    }
];

/**
 * Cria, edita ou versiona um Plano de Usina (spec 2026-10-06, secao 3).
 *
 *  - 'novo'   -> INSERT
 *  - 'editar' -> UPDATE; com usina vinculada so nome e descricao (o banco
 *                recusa o resto em fn_planos_usina_trava)
 *  - 'versao' -> fn_planos_usina_nova_versao: nasce um plano novo e o antigo
 *                fica somente para contratos
 */
export default function PlanoUsinaModal({ isOpen, modo, plano, usinasVinculadas = 0, onClose, onSave, showAlert }) {
    const [dados, setDados] = useState(PLANO_USINA_VAZIO);
    const [bonusTexto, setBonusTexto] = useState('');
    const [salvando, setSalvando] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const base = modo === 'versao'
            ? rascunhoNovaVersao(plano)
            : { ...PLANO_USINA_VAZIO, ...(plano || {}) };
        setDados(base);
        setBonusTexto((base.originador_bonus_fechamentos || []).join(', '));
    }, [isOpen, modo, plano]);

    if (!isOpen) return null;

    const travado = modo === 'editar' && usinasVinculadas > 0;
    const definir = (chave, valor) => setDados(prev => ({ ...prev, [chave]: valor }));

    const titulo = modo === 'novo' ? 'Criar Plano de Usina'
        : modo === 'versao' ? `Nova versão de "${plano?.nome}"`
        : `Editar "${plano?.nome}"`;

    const campoPorChave = Object.fromEntries(CAMPOS_PLANO_USINA.map(c => [c.chave, c]));

    const salvar = async () => {
        const completo = { ...dados, originador_bonus_fechamentos: lerFechamentos(bonusTexto) };
        const erros = validarPlanoUsina(completo);
        if (erros.length) {
            showAlert(erros.join('\n'), 'error');
            return;
        }
        const payload = payloadPlanoUsina(completo);

        setSalvando(true);
        try {
            let error;
            if (modo === 'novo') {
                ({ error } = await supabase.from('planos_usina').insert([payload]));
            } else if (modo === 'versao') {
                ({ error } = await supabase.rpc('fn_planos_usina_nova_versao', { p_origem: plano.id, p_dados: payload }));
            } else {
                const mudanca = travado ? { nome: payload.nome, descricao: payload.descricao } : payload;
                ({ error } = await supabase.from('planos_usina').update(mudanca).eq('id', plano.id));
            }
            if (error) throw error;
            showAlert(
                modo === 'versao'
                    ? `Nova versão criada. "${plano.nome}" fica somente para os contratos que já estão nele.`
                    : 'Plano de usina salvo.',
                'success'
            );
            onSave?.();
            onClose();
        } catch (err) {
            console.error('Erro ao salvar plano de usina:', err);
            showAlert('Erro ao salvar plano de usina: ' + (err.message || 'erro desconhecido'), 'error');
        } finally {
            setSalvando(false);
        }
    };

    const rotulo = {
        display: 'block',
        fontSize: '0.74rem',
        fontWeight: 700,
        color: '#475569',
        marginBottom: '0.38rem',
        textTransform: 'uppercase',
        letterSpacing: '0.025em'
    };

    const campo = (bloqueado, numerico = false) => ({
        width: '100%',
        padding: '0.62rem 0.85rem',
        borderRadius: '10px',
        fontSize: '0.88rem',
        fontWeight: numerico ? 700 : 500,
        fontVariantNumeric: numerico ? 'tabular-nums' : undefined,
        boxSizing: 'border-box',
        border: '1px solid #cbd5e1',
        background: bloqueado ? '#f1f5f9' : '#f8fafc',
        color: bloqueado ? '#94a3b8' : '#0f172a',
        outline: 'none',
        transition: 'all 0.15s'
    });

    const cardSecao = {
        background: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        padding: '1.2rem 1.35rem',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.68)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
        }}>
            <style>{`
                .pu-input:focus {
                    border-color: #0284c7 !important;
                    background-color: #ffffff !important;
                    box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.12) !important;
                }
            `}</style>
            <div style={{
                background: '#f8fafc',
                borderRadius: '16px',
                width: '96vw',
                maxWidth: '980px',
                maxHeight: '92vh',
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.38)',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Pinned Authority Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1.15rem 1.75rem',
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#ffffff',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            background: 'rgba(245, 158, 11, 0.18)',
                            border: '1px solid rgba(251, 191, 36, 0.35)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fbbf24',
                            flexShrink: 0
                        }}>
                            <SunMedium size={22} />
                        </div>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#ffffff', fontWeight: 800, letterSpacing: '-0.02em' }}>
                                    {titulo}
                                </h3>
                                <span style={{
                                    padding: '0.18rem 0.65rem',
                                    borderRadius: '999px',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    background: modo === 'versao' ? 'rgba(139, 92, 246, 0.25)' : 'rgba(14, 165, 233, 0.2)',
                                    border: `1px solid ${modo === 'versao' ? 'rgba(167, 139, 250, 0.4)' : 'rgba(56, 189, 248, 0.35)'}`,
                                    color: modo === 'versao' ? '#ddd6fe' : '#7dd3fc'
                                }}>
                                    {modo === 'novo' ? 'Novo Cadastro' : modo === 'versao' ? 'Versionamento' : 'Edição'}
                                </span>
                                {usinasVinculadas > 0 && (
                                    <span style={{
                                        padding: '0.18rem 0.65rem',
                                        borderRadius: '999px',
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                        fontVariantNumeric: 'tabular-nums',
                                        background: 'rgba(245, 158, 11, 0.2)',
                                        border: '1px solid rgba(251, 191, 36, 0.35)',
                                        color: '#fde68a'
                                    }}>
                                        {usinasVinculadas} {usinasVinculadas === 1 ? 'usina vinculada' : 'usinas vinculadas'}
                                    </span>
                                )}
                            </div>
                            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                                Governança de gestão B2W, comissionamento do originador do fornecedor e cláusulas contratuais da usina
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        title="Fechar"
                        style={{
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            width: '38px',
                            height: '38px',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            color: '#e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Scrollable Body */}
                <div style={{ padding: '1.35rem 1.75rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
                    {travado && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.65rem',
                            background: '#fffbeb',
                            border: '1px solid #fde68a',
                            borderRadius: '12px',
                            padding: '0.85rem 1.1rem',
                            fontSize: '0.82rem',
                            color: '#92400e',
                            lineHeight: 1.45
                        }}>
                            <Lock size={17} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <strong style={{ display: 'block', marginBottom: '0.15rem' }}>Parâmetros Financeiros Protegidos</strong>
                                Este plano tem {usinasVinculadas} usina(s) vinculada(s): percentuais e valores não mudam mais. Para alterar alíquotas ou prazos, use <strong>"Criar nova versão"</strong> na listagem.
                            </div>
                        </div>
                    )}
                    {modo === 'versao' && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.65rem',
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: '12px',
                            padding: '0.85rem 1.1rem',
                            fontSize: '0.82rem',
                            color: '#1e40af',
                            lineHeight: 1.45
                        }}>
                            <GitBranch size={17} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <strong style={{ display: 'block', marginBottom: '0.15rem' }}>Criação de Nova Versão</strong>
                                Ao salvar, nasce um plano novo e "{plano?.nome}" passa a valer somente para as usinas que já estão nele. Ele não aparece mais para usinas novas.
                            </div>
                        </div>
                    )}

                    {/* Identificação do Plano */}
                    <div style={cardSecao}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '1rem', alignItems: 'start' }}>
                            <div>
                                <label style={rotulo}>Nome do Plano de Usina *</label>
                                <input
                                    className="pu-input"
                                    placeholder="Ex.: Plano Usina Padrão 6%"
                                    value={dados.nome}
                                    onChange={e => definir('nome', e.target.value)}
                                    style={campo(false)}
                                />
                            </div>
                            <div>
                                <label style={rotulo}>Descrição / Observações Internas</label>
                                <input
                                    className="pu-input"
                                    placeholder="Resumo comercial ou observações de vigência..."
                                    value={dados.descricao || ''}
                                    onChange={e => definir('descricao', e.target.value)}
                                    style={campo(false)}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Grupos de Campos Paramétricos */}
                    {GRUPOS_PLANO_USINA.map(grupo => {
                        const Icon = grupo.icon;
                        return (
                            <div key={grupo.id} style={cardSecao}>
                                <div style={{ marginBottom: '1rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9' }}>
                                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Icon size={17} color={grupo.cor} />
                                        {grupo.titulo}
                                    </h4>
                                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.76rem', color: '#64748b' }}>
                                        {grupo.subtitulo}
                                    </p>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                                    {grupo.chaves.map(chave => {
                                        const c = campoPorChave[chave];
                                        if (!c) return null;
                                        return (
                                            <div key={c.chave}>
                                                <label style={rotulo}>{c.rotulo}</label>
                                                <input
                                                    className="pu-input"
                                                    type="number"
                                                    step={c.inteiro ? '1' : '0.01'}
                                                    min="0"
                                                    max={c.max ?? undefined}
                                                    disabled={travado}
                                                    value={dados[c.chave] ?? ''}
                                                    onChange={e => definir(c.chave, e.target.value)}
                                                    style={campo(travado, true)}
                                                />
                                                {c.chave === 'originador_lider_recorrente_pct' && (
                                                    <div style={{ marginTop: '0.3rem', fontSize: '0.72rem', color: '#64748b', lineHeight: 1.4 }}>
                                                        Sem Líder válido e ativo no originador do fornecedor, essa parte fica para a associação se couber no teto.
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {grupo.incluiBonusFechamentos && (
                                        <div>
                                            <label style={rotulo}>Originador da usina — bônus no(s) fechamento(s) nº</label>
                                            <input
                                                className="pu-input"
                                                placeholder="Ex.: 2 ou 2, 3"
                                                disabled={travado}
                                                value={bonusTexto}
                                                onChange={e => setBonusTexto(e.target.value)}
                                                style={campo(travado, true)}
                                            />
                                            <div style={{ marginTop: '0.3rem', fontSize: '0.72rem', color: '#64748b', lineHeight: 1.4 }}>
                                                No(s) fechamento(s) listado(s) com saldo positivo, transfere ao originador o saldo que iria ao investidor.
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Nota Explicativa do Motor de Fechamento */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.65rem',
                        background: '#f1f5f9',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '0.9rem 1.1rem',
                        fontSize: '0.78rem',
                        color: '#475569',
                        lineHeight: 1.5
                    }}>
                        <Info size={16} color="#0284c7" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span>
                            A gestão B2W é a mesma cobrança dos 10% da B2W no split. O originador da usina recebe o recorrente em toda fatura paga das UCs dela e,
                            no(s) fechamento(s) informado(s) com saldo positivo, o saldo que iria ao investidor. Sem originador vinculado à usina, os dois ficam para a associação.
                            Taxa de administração e de recuperação são cobradas no fechamento mensal. Desconto, dias de corte e repasse e prazos de transferência e honorários
                            sugerem os valores do Contrato de Gestão de Créditos do fornecedor, que continuam editáveis lá.
                        </span>
                    </div>
                </div>

                {/* Pinned Footer */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '1rem 1.75rem',
                    background: '#ffffff',
                    borderTop: '1px solid #e2e8f0',
                    flexShrink: 0
                }}>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                        Gestão B2W: <strong style={{ color: '#0f172a' }}>{Number(dados.percentual_recorrente || 0)}%</strong> • Admin: <strong style={{ color: '#0f172a' }}>R$ {Number(dados.taxa_admin_reais || 0).toFixed(2).replace('.', ',')}</strong>/UC • Originador: <strong style={{ color: '#0f172a' }}>{Number(dados.originador_recorrente_pct || 0)}%</strong>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: '0.62rem 1.25rem',
                                borderRadius: '10px',
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                color: '#475569',
                                fontWeight: 700,
                                fontSize: '0.84rem',
                                cursor: 'pointer'
                            }}
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={salvar}
                            disabled={salvando}
                            style={{
                                padding: '0.62rem 1.5rem',
                                borderRadius: '10px',
                                border: 'none',
                                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                                color: '#ffffff',
                                fontWeight: 700,
                                fontSize: '0.86rem',
                                cursor: salvando ? 'wait' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.45rem',
                                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)'
                            }}
                        >
                            <Save size={16} />
                            {salvando ? 'Salvando...' : (modo === 'versao' ? 'Criar nova versão' : 'Salvar')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
