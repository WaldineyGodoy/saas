import { useState, useEffect, useMemo } from 'react';
import { X, Save, Lock, Info, Star } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
    CARGOS_ORIGINADOR,
    ROTULO_CARGO,
    TIPOS_RECOMPENSA,
    NIVEIS,
    PLANO_ORIGINADOR_VAZIO,
    normalizarPlanoOriginador,
    validarPlanoOriginador,
    payloadPlanoOriginador,
    lerFaturasElegiveis,
    mensagemErroPlanoOriginador
} from '../../../lib/planoOriginador';
import { MAX_NIVEIS } from '../../../lib/planoRecompensas';

/**
 * Cria ou edita um Plano do Originador
 * (spec docs/superpowers/specs/2026-11-10-plano-originador-design.md).
 *
 * Remunera só Líder, PPE, PPP e PPF. O formato gravado sai de
 * payloadPlanoOriginador (nunca grava `padrao`); o banco guarda o Padrão
 * contra inativação e exclusão.
 */
export default function PlanoOriginadorModal({ isOpen, plano, onClose, onSave, showAlert }) {
    const [dados, setDados] = useState(PLANO_ORIGINADOR_VAZIO);
    const [faturasTexto, setFaturasTexto] = useState('');
    const [erros, setErros] = useState([]);
    const [salvando, setSalvando] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const base = normalizarPlanoOriginador({ ...PLANO_ORIGINADOR_VAZIO, ...(plano || {}) });
        // Percentuais ficam como texto enquanto se digita.
        const regras = Object.fromEntries(Object.entries(base.start_config.regras).map(([ord, r]) => [
            ord, Object.fromEntries(CARGOS_ORIGINADOR.map(c => [c, String(r[c] ?? 0)]))
        ]));
        setDados({ ...base, start_config: { ...base.start_config, regras } });
        setFaturasTexto(base.start_config.faturas_elegiveis.join(', '));
        setErros([]);
    }, [isOpen, plano]);

    const faturasLidas = useMemo(() => lerFaturasElegiveis(faturasTexto), [faturasTexto]);

    if (!isOpen) return null;

    const editando = !!plano?.id;
    const ehPadrao = !!plano?.padrao;
    const usaStart = dados.tipo_recompensa !== 'recorrente';
    const usaRecorrencia = dados.tipo_recompensa !== 'start';
    const faturasDaGrade = faturasLidas || dados.start_config.faturas_elegiveis;

    const definir = (chave, valor) => setDados(prev => ({ ...prev, [chave]: valor }));

    const definirStart = (ord, cargo, valor) => setDados(prev => {
        const regras = { ...(prev.start_config.regras || {}) };
        regras[String(ord)] = { ...(regras[String(ord)] || {}), [cargo]: valor };
        return { ...prev, start_config: { ...prev.start_config, regras } };
    });

    const definirNivel = (cargo, nivel, valor) => setDados(prev => {
        const matriz = prev.recorrente_config.regras_multinivel;
        const linha = matriz[cargo];
        return {
            ...prev,
            recorrente_config: {
                ...prev.recorrente_config,
                regras_multinivel: { ...matriz, [cargo]: { ...linha, niveis: { ...linha.niveis, [nivel]: valor } } }
            }
        };
    });

    const definirMaxNiveis = (cargo, max) => setDados(prev => {
        const matriz = prev.recorrente_config.regras_multinivel;
        const linha = matriz[cargo];
        // Nível acima do máximo fica 0.
        const niveis = Object.fromEntries(NIVEIS.map((lk, i) => [lk, i + 1 > max ? '0' : linha.niveis[lk]]));
        return {
            ...prev,
            recorrente_config: {
                ...prev.recorrente_config,
                regras_multinivel: { ...matriz, [cargo]: { niveis, max_niveis: max } }
            }
        };
    });

    const salvar = async () => {
        if (usaStart && faturasLidas === null) {
            setErros(['Faturas do Start: use números inteiros a partir de 1, separados por vírgula, como 1, 2.']);
            return;
        }
        const completo = {
            ...dados,
            padrao: ehPadrao,
            start_config: { ...dados.start_config, faturas_elegiveis: faturasLidas || dados.start_config.faturas_elegiveis }
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

    const rotulo = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' };
    const campo = (bloqueado) => ({
        width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', fontSize: '0.88rem', boxSizing: 'border-box',
        border: '1px solid #cbd5e1', background: bloqueado ? '#f1f5f9' : 'white', color: bloqueado ? '#94a3b8' : '#0f172a'
    });
    const pct = (bloqueado) => ({ ...campo(bloqueado), padding: '0.45rem 0.5rem', textAlign: 'right', minWidth: '64px' });
    const ajuda = { margin: '0.3rem 0 0 0', fontSize: '0.74rem', color: '#64748b', lineHeight: 1.45 };
    const secao = { border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' };
    const tituloSecao = { margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' };
    const th = { padding: '0.5rem', fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'left' };
    const td = { padding: '0.4rem 0.5rem' };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
            <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '820px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.1rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a', fontWeight: 800 }}>
                        {editando ? `Editar "${plano.nome}"` : 'Criar Plano do Originador'}
                    </h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }} title="Fechar">
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#1e40af', lineHeight: 1.45 }}>
                        <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span>
                            Este plano paga Líder, PPE, PPP e PPF. Vale o plano escolhido no cadastro do originador, se for diferente do Padrão.
                            Senão, vale o plano ligado ao plano de assinatura da UC.
                        </span>
                    </div>

                    {ehPadrao && (
                        <div style={{ display: 'flex', gap: '0.5rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#92400e' }}>
                            <Star size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            Este é o Plano Padrão. Ele vale para quem não tem outro plano. Fica sempre ativo e não pode ser excluído.
                        </div>
                    )}

                    {erros.length > 0 && (
                        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#b91c1c' }}>
                            <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>Corrija antes de salvar:</div>
                            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                                {erros.map(e => <li key={e}>{e}</li>)}
                            </ul>
                        </div>
                    )}

                    <div>
                        <label style={rotulo}>Nome do plano</label>
                        <input value={dados.nome} onChange={e => definir('nome', e.target.value)} style={campo(false)} />
                    </div>

                    <div>
                        <label style={rotulo}>Descrição</label>
                        <textarea value={dados.descricao || ''} onChange={e => definir('descricao', e.target.value)} rows={2} style={{ ...campo(false), resize: 'vertical' }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
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
                                    <Lock size={12} /> O Plano Padrão não pode ser inativado.
                                </p>
                            )}
                        </div>
                        <div>
                            <label style={rotulo}>Tipo de recompensa</label>
                            <select value={dados.tipo_recompensa} onChange={e => definir('tipo_recompensa', e.target.value)} style={campo(false)}>
                                {TIPOS_RECOMPENSA.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                            </select>
                        </div>
                    </div>

                    {usaStart && (
                        <div style={secao}>
                            <h4 style={tituloSecao}>Bônus Start</h4>
                            <div>
                                <label style={rotulo}>Faturas em que o Start é pago</label>
                                <input
                                    placeholder="ex.: 1, 2"
                                    value={faturasTexto}
                                    onChange={e => setFaturasTexto(e.target.value)}
                                    style={{ ...campo(false), maxWidth: '240px', borderColor: faturasLidas === null ? '#f87171' : '#cbd5e1' }}
                                />
                                <p style={ajuda}>
                                    Conta só fatura paga com energia compensada. 1 = a primeira fatura com compensação da UC.
                                </p>
                                {faturasLidas === null && (
                                    <p style={{ ...ajuda, color: '#b91c1c' }}>Use números inteiros a partir de 1, separados por vírgula.</p>
                                )}
                            </div>

                            {faturasDaGrade.length === 0 ? (
                                <p style={{ ...ajuda, margin: 0 }}>Informe as faturas para preencher os percentuais.</p>
                            ) : (
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                                        <thead>
                                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                                <th style={th}>Fatura</th>
                                                {CARGOS_ORIGINADOR.map(c => <th key={c} style={th}>{ROTULO_CARGO[c]} (%)</th>)}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {faturasDaGrade.map(ord => (
                                                <tr key={ord} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ ...td, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{ord}ª fatura</td>
                                                    {CARGOS_ORIGINADOR.map(c => (
                                                        <td key={c} style={td}>
                                                            <input
                                                                type="number" min="0" max="100" step="0.01"
                                                                value={dados.start_config.regras?.[String(ord)]?.[c] ?? '0'}
                                                                onChange={e => definirStart(ord, c, e.target.value)}
                                                                style={pct(false)}
                                                            />
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <p style={{ ...ajuda, margin: 0 }}>
                                Percentual sobre a base de cálculo líquida da fatura. O Start vai só para o originador direto (nível 1).
                            </p>
                        </div>
                    )}

                    {usaRecorrencia && (
                        <div style={secao}>
                            <h4 style={tituloSecao}>Recorrência</h4>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                            <th style={th}>Cargo</th>
                                            <th style={th}>Níveis pagos</th>
                                            {NIVEIS.map(lk => <th key={lk} style={th}>{lk} (%)</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {CARGOS_ORIGINADOR.map(c => {
                                            const linha = dados.recorrente_config.regras_multinivel[c];
                                            const teto = MAX_NIVEIS[c];
                                            return (
                                                <tr key={c} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ ...td, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{ROTULO_CARGO[c]}</td>
                                                    <td style={td}>
                                                        <select
                                                            value={linha.max_niveis}
                                                            onChange={e => definirMaxNiveis(c, Number(e.target.value))}
                                                            style={{ ...campo(false), padding: '0.45rem 0.5rem', minWidth: '70px' }}
                                                            title={`Máximo para este cargo: ${teto}`}
                                                        >
                                                            {Array.from({ length: teto + 1 }, (_, i) => (
                                                                <option key={i} value={i}>{i}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    {NIVEIS.map((lk, i) => {
                                                        const bloqueado = i + 1 > linha.max_niveis;
                                                        return (
                                                            <td key={lk} style={td}>
                                                                <input
                                                                    type="number" min="0" max="100" step="0.01"
                                                                    disabled={bloqueado}
                                                                    value={bloqueado ? '0' : linha.niveis[lk]}
                                                                    onChange={e => definirNivel(c, lk, e.target.value)}
                                                                    style={pct(bloqueado)}
                                                                    title={bloqueado ? 'Nível acima do máximo deste cargo' : undefined}
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
                            <p style={{ ...ajuda, margin: 0 }}>
                                Percentual sobre a base de cálculo líquida, em toda fatura paga. Máximo de níveis: Líder 3, demais 2.
                                Nível acima do máximo fica 0.
                                {dados.tipo_recompensa === 'ambos' && ' Nas faturas do Start, o nível 1 recebe o Start no lugar da recorrência. Nas outras faturas e nos demais níveis vale a recorrência.'}
                            </p>
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderTop: '1px solid #e2e8f0' }}>
                    <button onClick={onClose} style={{ padding: '0.6rem 1.1rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 600, cursor: 'pointer' }}>
                        Cancelar
                    </button>
                    <button
                        onClick={salvar}
                        disabled={salvando}
                        style={{ padding: '0.6rem 1.2rem', borderRadius: '10px', border: 'none', background: '#0284c7', color: 'white', fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                        <Save size={16} />
                        {salvando ? 'Salvando...' : 'Salvar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
