import { useState, useEffect } from 'react';
import { X, Save, Lock, Info, Star, Award, Sparkles, Clock, ShieldCheck, Ticket } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
    CARGOS_ORIGINADOR,
    ROTULO_CARGO,
    TIPOS_RECOMPENSA,
    NIVEIS,
    NIVEIS_TELA,
    MAX_NIVEIS_ORIGINADOR,
    PLANO_ORIGINADOR_VAZIO,
    normalizarPlanoOriginador,
    validarPlanoOriginador,
    payloadPlanoOriginador,
    multiplicadorStart,
    lerMultiplicador,
    multiplicadorValido,
    formatarMultiplicador,
    simularStart,
    TEXTO_BASE_PERCENTUAL,
    TEXTO_TETO_START,
    mensagemErroPlanoOriginador
} from '../../../lib/planoOriginador';
import VouchersPlanoOriginador from './VouchersPlanoOriginador';

const kwhBr = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const decimalBr = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
// Lê "1.000", "1000" ou "1,02" para o exemplo (não é gravado).
const lerNumeroExemplo = (t) => {
    const s = String(t ?? '').trim();
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\.(?=\d{3}(\D|$))/g, ''));
    return Number.isFinite(n) ? n : 0;
};

const CARGO_BADGE_STYLE = {
    lider: { bg: '#ede9fe', color: '#6d28d9', border: '#ddd6fe', sig: 'LÍDER' },
    ppe: { bg: '#fef3c7', color: '#b45309', border: '#fde68a', sig: 'PPE' },
    ppp: { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd', sig: 'PPP' },
    ppf: { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', sig: 'PPF' }
};

/**
 * Cria ou edita um Plano do Originador
 * (spec docs/superpowers/specs/2026-11-10-plano-originador-design.md,
 * revisão de 12/11/2026).
 */
export default function PlanoOriginadorModal({ isOpen, plano, onClose, onSave, showAlert }) {
    const [dados, setDados] = useState(() => normalizarPlanoOriginador(PLANO_ORIGINADOR_VAZIO));
    const [xTexto, setXTexto] = useState('1');
    // Exemplo vivo (só na tela, não é gravado).
    const [exConsumo, setExConsumo] = useState('1.000');
    const [exTarifa, setExTarifa] = useState('1,02');
    const [exFaturas, setExFaturas] = useState(['600', '1.200', '800']);
    const [erros, setErros] = useState([]);
    const [salvando, setSalvando] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const base = normalizarPlanoOriginador({ ...PLANO_ORIGINADOR_VAZIO, ...(plano || {}) });
        setDados(base);
        setXTexto(decimalBr(multiplicadorStart(base) || 1));
        setErros([]);
    }, [isOpen, plano]);

    if (!isOpen) return null;

    const editando = !!plano?.id;
    const ehPadrao = !!plano?.padrao;
    const usaStart = dados.tipo_recompensa !== 'recorrente';
    const usaRecorrencia = dados.tipo_recompensa !== 'start';
    const xNumero = lerMultiplicador(xTexto);
    const xValido = multiplicadorValido(xNumero);

    const definir = (chave, valor) => setDados(prev => ({ ...prev, [chave]: valor }));

    // config = 'start_config' | 'recorrente_config'
    const definirNivel = (config, cargo, nivel, valor) => setDados(prev => {
        const matriz = prev[config].regras_multinivel;
        const linha = matriz[cargo];
        return {
            ...prev,
            [config]: {
                ...prev[config],
                regras_multinivel: { ...matriz, [cargo]: { ...linha, niveis: { ...linha.niveis, [nivel]: valor } } }
            }
        };
    });

    const definirMaxNiveis = (config, cargo, max) => setDados(prev => {
        const matriz = prev[config].regras_multinivel;
        const linha = matriz[cargo];
        const niveis = Object.fromEntries(NIVEIS.map((lk, i) => [lk, i + 1 > max ? '0' : linha.niveis[lk]]));
        return {
            ...prev,
            [config]: {
                ...prev[config],
                regras_multinivel: { ...matriz, [cargo]: { niveis, max_niveis: max } }
            }
        };
    });

    const salvar = async () => {
        if (usaStart && !xValido) {
            setErros(['Start: informe quantas vezes o consumo médio ele paga (número maior que zero; aceita decimal, ex.: 1,5).']);
            return;
        }
        const completo = {
            ...dados,
            padrao: ehPadrao,
            start_config: {
                regras_multinivel: dados.start_config.regras_multinivel,
                multiplicador: usaStart ? xNumero : dados.start_config.multiplicador
            }
        };
        const lista = validarPlanoOriginador(completo);
        setErros(lista);
        if (lista.length) return;

        const payload = payloadPlanoOriginador(completo);
        setSalvando(true);
        try {
            const { error } = editando
                ? await supabase.from('planos_originador').update(payload).eq('id', plano.id)
                : await supabase.from('planos_originador').insert([payload]);
            if (error) throw error;
            showAlert(editando ? 'Plano do Originador salvo.' : 'Plano do Originador criado.', 'success');
            onSave?.();
            onClose();
        } catch (err) {
            console.error('Erro ao salvar Plano do Originador:', err);
            showAlert('Erro ao salvar: ' + mensagemErroPlanoOriginador(err), 'error');
        } finally {
            setSalvando(false);
        }
    };

    const rotulo = {
        display: 'block',
        fontSize: '0.74rem',
        fontWeight: 700,
        color: '#475569',
        marginBottom: '0.36rem',
        textTransform: 'uppercase',
        letterSpacing: '0.025em'
    };
    const campo = (bloqueado, numerico = false) => ({
        width: '100%',
        padding: '0.6rem 0.8rem',
        borderRadius: '10px',
        fontSize: '0.88rem',
        fontWeight: numerico ? 700 : 500,
        fontVariantNumeric: numerico ? 'tabular-nums' : undefined,
        boxSizing: 'border-box',
        border: '1px solid #cbd5e1',
        background: bloqueado ? '#f1f5f9' : '#f8fafc',
        color: bloqueado ? '#94a3b8' : '#0f172a',
        outline: 'none'
    });
    const pct = (bloqueado) => ({
        ...campo(bloqueado, true),
        padding: '0.45rem 0.55rem',
        textAlign: 'right',
        minWidth: '72px',
        background: bloqueado ? '#f1f5f9' : '#ffffff'
    });
    const ajuda = { margin: '0.3rem 0 0 0', fontSize: '0.76rem', color: '#64748b', lineHeight: 1.45 };
    const secao = {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '14px',
        padding: '1.2rem 1.35rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
    };
    const tituloSecao = { margin: 0, fontSize: '0.96rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' };
    const th = { padding: '0.6rem 0.75rem', fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.03em', textAlign: 'left' };
    const td = { padding: '0.5rem 0.75rem' };

    // Grade cargo x L1..L3 com "Níveis pagos" (0..3), igual para Start e Recorrência.
    const grade = (config) => (
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={th}>Cargo / Função</th>
                        <th style={th}>Níveis Pagos</th>
                        {NIVEIS_TELA.map(lk => <th key={lk} style={{ ...th, textAlign: 'right' }}>{lk} (% s/ Tarifa)</th>)}
                    </tr>
                </thead>
                <tbody>
                    {CARGOS_ORIGINADOR.map(c => {
                        const linha = dados[config].regras_multinivel[c];
                        const teto = MAX_NIVEIS_ORIGINADOR[c];
                        const badge = CARGO_BADGE_STYLE[c] || CARGO_BADGE_STYLE.ppf;
                        return (
                            <tr key={c} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                                <td style={{ ...td, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                                        <span style={{
                                            fontSize: '0.66rem',
                                            fontWeight: 800,
                                            padding: '0.12rem 0.45rem',
                                            borderRadius: '6px',
                                            background: badge.bg,
                                            color: badge.color,
                                            border: `1px solid ${badge.border}`
                                        }}>
                                            {badge.sig}
                                        </span>
                                        <span>{ROTULO_CARGO[c]}</span>
                                    </div>
                                </td>
                                <td style={td}>
                                    <select
                                        value={linha.max_niveis}
                                        onChange={e => definirMaxNiveis(config, c, Number(e.target.value))}
                                        style={{ ...campo(false, true), padding: '0.42rem 0.55rem', minWidth: '82px', background: '#ffffff' }}
                                        title={`Máximo para este cargo: ${teto}`}
                                    >
                                        {Array.from({ length: teto + 1 }, (_, i) => (
                                            <option key={i} value={i}>{i} {i === 1 ? 'nível' : 'níveis'}</option>
                                        ))}
                                    </select>
                                </td>
                                {NIVEIS_TELA.map((lk, i) => {
                                    const bloqueado = i + 1 > linha.max_niveis;
                                    return (
                                        <td key={lk} style={{ ...td, textAlign: 'right' }}>
                                            <input
                                                type="number" min="0" max="100" step="0.01"
                                                disabled={bloqueado}
                                                value={bloqueado ? '0' : linha.niveis[lk]}
                                                onChange={e => definirNivel(config, c, lk, e.target.value)}
                                                style={pct(bloqueado)}
                                                title={bloqueado ? 'Nível acima dos níveis pagos deste cargo' : undefined}
                                            />
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );

    // Exemplo vivo: 3 faturas, teto por fatura = 1 × o consumo médio, total =
    // X × o consumo médio; valor por cargo no L1 = kWh do Start × tarifa × %.
    const consumoEx = lerNumeroExemplo(exConsumo);
    const tarifaEx = lerNumeroExemplo(exTarifa);
    const cargosEx = CARGOS_ORIGINADOR.filter(c => {
        const linha = dados.start_config.regras_multinivel[c];
        return linha.max_niveis >= 1 && Number(linha.niveis.L1) > 0;
    });
    const cargosMostrados = cargosEx.length ? cargosEx : ['lider'];
    const pctL1 = (c) => Number(dados.start_config.regras_multinivel[c].niveis.L1) || 0;
    const sim = simularStart({
        consumoMedioKwh: consumoEx,
        multiplicador: xValido ? xNumero : 0,
        compensados: exFaturas.map(lerNumeroExemplo)
    });
    const exemplo = (
        <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '0.9rem 1.1rem',
            fontSize: '0.8rem',
            color: '#334155',
            lineHeight: 1.5
        }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', marginBottom: '0.6rem', paddingBottom: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>
                <strong style={{ color: '#0f172a', fontSize: '0.82rem' }}>Simulador Interativo do Start (apenas simulação visual)</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem' }}>
                    <span>Consumo médio:</span>
                    <input value={exConsumo} onChange={e => setExConsumo(e.target.value)} inputMode="decimal" style={{ ...pct(false), width: '86px', minWidth: 0 }} />
                    <span>kWh • Tarifa R$</span>
                    <input value={exTarifa} onChange={e => setExTarifa(e.target.value)} inputMode="decimal" style={{ ...pct(false), width: '78px', minWidth: 0 }} />
                    <span>/kWh</span>
                </div>
            </div>
            {!xValido ? (
                <span>Informe X para ver o exemplo.</span>
            ) : (
                <>
                    <div style={{ marginBottom: '0.5rem', fontVariantNumeric: 'tabular-nums' }}>
                        Teto por fatura: <strong>{kwhBr(sim.tetoFaturaKwh)} kWh</strong> (1 × o consumo médio) · Total do Start: <strong style={{ color: '#1d4ed8' }}>{kwhBr(sim.tetoKwh)} kWh</strong> ({formatarMultiplicador(xNumero)} o consumo médio).
                    </div>
                    <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#ffffff' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums' }}>
                            <thead>
                                <tr style={{ color: '#475569', textAlign: 'left', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                                    <th style={{ padding: '0.45rem 0.65rem' }}>Fatura</th>
                                    <th style={{ padding: '0.45rem 0.65rem' }}>kWh Compensados</th>
                                    <th style={{ padding: '0.45rem 0.65rem' }}>Start Sobre</th>
                                    <th style={{ padding: '0.45rem 0.65rem' }}>Acumulado</th>
                                    {cargosMostrados.map(c => (
                                        <th key={c} style={{ padding: '0.45rem 0.65rem', textAlign: 'right' }}>{ROTULO_CARGO[c]} L1 ({decimalBr(pctL1(c))}%)</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sim.faturas.map((f, i) => (
                                    <tr key={i} style={{ borderBottom: i < sim.faturas.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                                        <td style={{ padding: '0.4rem 0.65rem', fontWeight: 800, color: '#0f172a' }}>F{i + 1}</td>
                                        <td style={{ padding: '0.4rem 0.65rem' }}>
                                            <input
                                                value={exFaturas[i]}
                                                onChange={e => setExFaturas(prev => prev.map((v, j) => (j === i ? e.target.value : v)))}
                                                inputMode="decimal"
                                                style={{ ...pct(false), width: '82px', minWidth: 0, padding: '0.3rem 0.45rem' }}
                                            />
                                        </td>
                                        <td style={{ padding: '0.4rem 0.65rem', fontWeight: 700, color: '#1d4ed8' }}>{kwhBr(f.kwhStart)} kWh</td>
                                        <td style={{ padding: '0.4rem 0.65rem' }}>
                                            {kwhBr(f.acumulado)} kWh
                                            {f.encerrou && (
                                                <span style={{ marginLeft: '0.35rem', fontSize: '0.68rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '0.1rem 0.4rem', borderRadius: '999px' }}>
                                                    encerrado
                                                </span>
                                            )}
                                        </td>
                                        {cargosMostrados.map(c => (
                                            <td key={c} style={{ padding: '0.4rem 0.65rem', textAlign: 'right', fontWeight: 700, color: '#15803d' }}>
                                                {reais(f.kwhStart * tarifaEx * (pctL1(c) / 100))}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ marginTop: '0.45rem', color: '#64748b', fontSize: '0.74rem' }}>
                        Em cada fatura: menor entre o compensado, o consumo médio e o saldo até o total. Valor = kWh do Start × tarifa × %.
                    </div>
                </>
            )}
        </div>
    );

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
            <div style={{
                background: '#f8fafc',
                borderRadius: '16px',
                width: '96vw',
                maxWidth: '1120px',
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
                    background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#ffffff',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.95rem' }}>
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            background: 'rgba(139, 92, 246, 0.22)',
                            border: '1px solid rgba(167, 139, 250, 0.38)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#c4b5fd',
                            flexShrink: 0
                        }}>
                            <Award size={22} />
                        </div>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#ffffff', fontWeight: 800, letterSpacing: '-0.02em' }}>
                                    {editando ? `Editar "${plano.nome}"` : 'Criar Plano do Originador'}
                                </h3>
                                {ehPadrao && (
                                    <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                        padding: '0.18rem 0.6rem',
                                        borderRadius: '999px',
                                        background: '#fef3c7',
                                        color: '#92400e'
                                    }}>
                                        <Star size={12} /> Plano Padrão
                                    </span>
                                )}
                                <span style={{
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    padding: '0.18rem 0.65rem',
                                    borderRadius: '999px',
                                    background: dados.status === 'ativo' ? '#dcfce7' : '#f1f5f9',
                                    color: dados.status === 'ativo' ? '#166534' : '#475569'
                                }}>
                                    {dados.status === 'ativo' ? 'Ativo' : 'Inativo'}
                                </span>
                            </div>
                            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#cbd5e1' }}>
                                Matriz de comissionamento Start e Recorrente (Líder, PPE, PPP e PPF), licenças anuais e vouchers
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
                    <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.6rem',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '12px',
                        padding: '0.8rem 1rem',
                        fontSize: '0.8rem',
                        color: '#1e40af',
                        lineHeight: 1.45
                    }}>
                        <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span>
                            Este plano paga <strong>Líder, PPE, PPP e PPF</strong>. Vale o plano escolhido no cadastro do originador, se for diferente do Padrão.
                            Senão, vale o plano ligado ao plano de assinatura da UC.
                        </span>
                    </div>

                    {ehPadrao && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.6rem',
                            background: '#fffbeb',
                            border: '1px solid #fde68a',
                            borderRadius: '12px',
                            padding: '0.8rem 1rem',
                            fontSize: '0.8rem',
                            color: '#92400e'
                        }}>
                            <Star size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>
                                Este é o <strong>Plano Padrão</strong>. Ele vale para quem não tem outro plano vinculado, fica sempre ativo e não pode ser excluído.
                            </span>
                        </div>
                    )}

                    {erros.length > 0 && (
                        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '0.85rem 1.1rem', fontSize: '0.82rem', color: '#b91c1c' }}>
                            <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>Corrija antes de salvar:</div>
                            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                                {erros.map(e => <li key={e}>{e}</li>)}
                            </ul>
                        </div>
                    )}

                    {/* Bloco 1: Identificação, Status e Tipo de Recompensa */}
                    <div style={secao}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 1.1fr', gap: '1rem', alignItems: 'start' }}>
                            <div>
                                <label style={rotulo}>Nome do Plano *</label>
                                <input
                                    placeholder="Ex.: Plano Originador Expansão"
                                    value={dados.nome}
                                    onChange={e => definir('nome', e.target.value)}
                                    style={campo(false)}
                                />
                            </div>
                            <div>
                                <label style={rotulo}>Status</label>
                                <select
                                    value={dados.status}
                                    disabled={ehPadrao}
                                    onChange={e => definir('status', e.target.value)}
                                    style={campo(ehPadrao)}
                                >
                                    <option value="ativo">Ativo</option>
                                    <option value="inativo">Inativo</option>
                                </select>
                                {ehPadrao && (
                                    <p style={{ ...ajuda, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                        <Lock size={11} /> Sempre ativo (Padrão).
                                    </p>
                                )}
                            </div>
                            <div>
                                <label style={rotulo}>Modalidade de Recompensa</label>
                                <select
                                    value={dados.tipo_recompensa}
                                    onChange={e => definir('tipo_recompensa', e.target.value)}
                                    style={campo(false)}
                                >
                                    {TIPOS_RECOMPENSA.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                                </select>
                                <p style={ajuda}>{TIPOS_RECOMPENSA.find(t => t.valor === dados.tipo_recompensa)?.ajuda}</p>
                            </div>
                        </div>

                        <div>
                            <label style={rotulo}>Descrição / Observações</label>
                            <textarea
                                placeholder="Descrição das regras comerciais deste plano de originador..."
                                value={dados.descricao || ''}
                                onChange={e => definir('descricao', e.target.value)}
                                rows={2}
                                style={{ ...campo(false), resize: 'vertical' }}
                            />
                        </div>
                    </div>

                    {/* Bloco 2: Start */}
                    {usaStart && (
                        <div style={secao}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                                <h4 style={tituloSecao}>
                                    <Sparkles size={18} color="#2563eb" />
                                    Start — X × o Consumo Médio (em kWh compensados)
                                </h4>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '0.35rem 0.75rem', borderRadius: '10px' }}>
                                    <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#1e40af' }}>Multiplicador (X):</span>
                                    <input
                                        inputMode="decimal"
                                        value={xTexto}
                                        onChange={e => setXTexto(e.target.value)}
                                        style={{
                                            width: '74px',
                                            padding: '0.3rem 0.5rem',
                                            borderRadius: '6px',
                                            border: `1px solid ${xValido ? '#93c5fd' : '#f87171'}`,
                                            background: '#ffffff',
                                            textAlign: 'right',
                                            fontWeight: 800,
                                            fontSize: '0.86rem',
                                            color: '#1e3a8a',
                                            fontVariantNumeric: 'tabular-nums'
                                        }}
                                    />
                                    <span style={{ fontSize: '0.78rem', color: '#1e40af', fontWeight: 700 }}>× consumo médio da UC</span>
                                </div>
                            </div>

                            {!xValido && (
                                <p style={{ ...ajuda, color: '#b91c1c', fontWeight: 600 }}>Use um número maior que zero (aceita decimal, ex.: 1,5).</p>
                            )}
                            <p style={{ ...ajuda, margin: 0 }}>{TEXTO_TETO_START}</p>

                            {grade('start_config')}

                            <p style={{ ...ajuda, margin: 0 }}>
                                L1 = venda direta; L2 e L3 = UCs indicadas na cadeia. Todos os níveis usam o mesmo teto. {TEXTO_BASE_PERCENTUAL}
                            </p>
                            {exemplo}
                        </div>
                    )}

                    {/* Bloco 3: Recorrência */}
                    {usaRecorrencia && (
                        <div style={secao}>
                            <h4 style={tituloSecao}>
                                <Clock size={18} color="#16a34a" />
                                Recorrência Mensal por Nível (L1 a L3)
                            </h4>
                            {grade('recorrente_config')}
                            <p style={{ ...ajuda, margin: 0 }}>
                                Paga sobre os kWh compensados de toda fatura paga, enquanto o parceiro estiver ativo. {TEXTO_BASE_PERCENTUAL}
                                Até 3 níveis por cargo; nível acima do escolhido fica 0.
                            </p>
                        </div>
                    )}

                    {dados.tipo_recompensa === 'ambos' && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.6rem',
                            background: '#f5f3ff',
                            border: '1px solid #ddd6fe',
                            borderRadius: '12px',
                            padding: '0.8rem 1rem',
                            fontSize: '0.8rem',
                            color: '#5b21b6',
                            lineHeight: 1.45
                        }}>
                            <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>
                                No <strong>Híbrido</strong> o Start paga, em cada fatura, até 1 × o consumo médio, até somar {xValido ? formatarMultiplicador(xNumero) : 'X ×'} o consumo médio da UC. A fatura que completa esse total paga só Start;
                                a recorrência começa na fatura seguinte. Nunca os dois na mesma fatura.
                            </span>
                        </div>
                    )}

                    {/* Bloco 4: Licença Anual por Cargo */}
                    <div style={secao}>
                        <h4 style={tituloSecao}>
                            <ShieldCheck size={18} color="#0284c7" />
                            Licença Anual por Cargo (R$/ano)
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
                            {CARGOS_ORIGINADOR.map(c => {
                                const val = Number(dados.licenca_config?.[c] ?? 0);
                                const isento = val === 0;
                                const badge = CARGO_BADGE_STYLE[c] || CARGO_BADGE_STYLE.ppf;
                                return (
                                    <div key={c} style={{
                                        background: '#f8fafc',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '10px',
                                        padding: '0.85rem 1rem'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a' }}>{ROTULO_CARGO[c]}</span>
                                            <span style={{
                                                fontSize: '0.65rem',
                                                fontWeight: 800,
                                                padding: '0.1rem 0.45rem',
                                                borderRadius: '999px',
                                                background: isento ? '#dcfce7' : badge.bg,
                                                color: isento ? '#166534' : badge.color
                                            }}>
                                                {isento ? 'Isento' : 'Anual'}
                                            </span>
                                        </div>
                                        <div style={{ position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>R$</span>
                                            <input
                                                type="number" min="0" step="0.01"
                                                value={dados.licenca_config?.[c] ?? 0}
                                                onChange={e => setDados(prev => ({ ...prev, licenca_config: { ...prev.licenca_config, [c]: e.target.value } }))}
                                                style={{ ...campo(false, true), paddingLeft: '2.2rem', textAlign: 'right', background: '#ffffff' }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <p style={{ ...ajuda, margin: 0 }}>
                            0 = cargo isento neste plano. A licença vale 1 ano a partir do pagamento. Sem pagamento, ou vencida,
                            o parceiro recebe como PPF — Free até pagar. Trocar o preço recalcula os parceiros deste plano.
                        </p>
                    </div>

                    {/* Bloco 5: Vouchers da Licença */}
                    <div style={secao}>
                        <div>
                            <h4 style={tituloSecao}>
                                <Ticket size={18} color="#0f766e" />
                                Vouchers de Desconto e Isenção da Licença
                            </h4>
                            <p style={{ ...ajuda, margin: '0.2rem 0 0 0' }}>
                                Isentam ou dão desconto na licença anual. No modal do originador a equipe só digita o código; vale só para parceiros deste plano.
                            </p>
                        </div>
                        <VouchersPlanoOriginador planoId={plano?.id || null} showAlert={showAlert} />
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
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Modalidade: <strong style={{ color: '#0f172a' }}>{TIPOS_RECOMPENSA.find(t => t.valor === dados.tipo_recompensa)?.rotulo || dados.tipo_recompensa}</strong>
                        {usaStart && xValido && (
                            <> • Teto Start: <strong style={{ color: '#1d4ed8', fontVariantNumeric: 'tabular-nums' }}>{formatarMultiplicador(xNumero)} consumo médio</strong></>
                        )}
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
                                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                                color: '#ffffff',
                                fontWeight: 700,
                                fontSize: '0.86rem',
                                cursor: salvando ? 'wait' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.45rem',
                                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.25)'
                            }}
                        >
                            <Save size={16} />
                            {salvando ? 'Salvando...' : 'Salvar Plano do Originador'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
