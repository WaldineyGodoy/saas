import { useState, useEffect } from 'react';
import { X, Save, Lock, Info, Star } from 'lucide-react';
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

const kwhBr = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const decimalBr = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
// Lê "1.000", "1000" ou "1,02" para o exemplo (não é gravado).
const lerNumeroExemplo = (t) => {
    const s = String(t ?? '').trim();
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\.(?=\d{3}(\D|$))/g, ''));
    return Number.isFinite(n) ? n : 0;
};

/**
 * Cria ou edita um Plano do Originador
 * (spec docs/superpowers/specs/2026-11-10-plano-originador-design.md,
 * revisão de 12/11/2026).
 *
 * Remunera só Líder, PPE, PPP e PPF. Start = X × o consumo médio da UC, em
 * kWh compensados (2ª revisão de 12/11/2026), no máximo 1 × o consumo médio
 * por fatura, com uma matriz cargo x nível.
 * Recorrência = matriz cargo x nível. Híbrido = Start até completar o teto;
 * recorrência a partir da fatura seguinte. Percentuais sobre kWh compensado ×
 * tarifa cheia da concessionária.
 * O formato gravado sai de payloadPlanoOriginador (nunca grava `padrao`); o
 * banco guarda o Padrão contra inativação e exclusão.
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
        // normalizarPlanoOriginador lê o Start antigo (N faturas, % por fatura)
        // e o novo (multiplicador + matriz por nível); a tela só grava o novo.
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
        // Nível acima do máximo fica 0 (L4 sempre 0).
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

    // Grade cargo x L1..L3 com "Níveis pagos" (0..3), igual para Start e Recorrência.
    const grade = (config) => (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={th}>Cargo</th>
                        <th style={th}>Níveis pagos</th>
                        {NIVEIS_TELA.map(lk => <th key={lk} style={th}>{lk} (%)</th>)}
                    </tr>
                </thead>
                <tbody>
                    {CARGOS_ORIGINADOR.map(c => {
                        const linha = dados[config].regras_multinivel[c];
                        const teto = MAX_NIVEIS_ORIGINADOR[c];
                        return (
                            <tr key={c} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ ...td, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{ROTULO_CARGO[c]}</td>
                                <td style={td}>
                                    <select
                                        value={linha.max_niveis}
                                        onChange={e => definirMaxNiveis(config, c, Number(e.target.value))}
                                        style={{ ...campo(false), padding: '0.45rem 0.5rem', minWidth: '70px' }}
                                        title={`Máximo para este cargo: ${teto}`}
                                    >
                                        {Array.from({ length: teto + 1 }, (_, i) => (
                                            <option key={i} value={i}>{i}</option>
                                        ))}
                                    </select>
                                </td>
                                {NIVEIS_TELA.map((lk, i) => {
                                    const bloqueado = i + 1 > linha.max_niveis;
                                    return (
                                        <td key={lk} style={td}>
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
        <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#334155', lineHeight: 1.5 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <strong>Exemplo:</strong>
                <span>consumo médio</span>
                <input value={exConsumo} onChange={e => setExConsumo(e.target.value)} inputMode="decimal" style={{ ...pct(false), width: '90px', minWidth: 0 }} />
                <span>kWh, tarifa R$</span>
                <input value={exTarifa} onChange={e => setExTarifa(e.target.value)} inputMode="decimal" style={{ ...pct(false), width: '80px', minWidth: 0 }} />
                <span>/kWh</span>
            </div>
            {!xValido ? (
                <span>Informe X para ver o exemplo.</span>
            ) : (
                <>
                    <div style={{ marginBottom: '0.35rem' }}>
                        Teto por fatura: <strong>{kwhBr(sim.tetoFaturaKwh)} kWh</strong> (1 × o consumo médio) · total do Start: <strong>{kwhBr(sim.tetoKwh)} kWh</strong> ({formatarMultiplicador(xNumero)} o consumo médio).
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                            <thead>
                                <tr style={{ color: '#475569', textAlign: 'left' }}>
                                    <th style={{ padding: '0.2rem 0.6rem 0.2rem 0' }}>Fatura</th>
                                    <th style={{ padding: '0.2rem 0.6rem' }}>kWh compensados</th>
                                    <th style={{ padding: '0.2rem 0.6rem' }}>Start sobre</th>
                                    <th style={{ padding: '0.2rem 0.6rem' }}>Acumulado</th>
                                    {cargosMostrados.map(c => (
                                        <th key={c} style={{ padding: '0.2rem 0.6rem' }}>{ROTULO_CARGO[c]} L1 {decimalBr(pctL1(c))}%</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sim.faturas.map((f, i) => (
                                    <tr key={i}>
                                        <td style={{ padding: '0.2rem 0.6rem 0.2rem 0', fontWeight: 700 }}>F{i + 1}</td>
                                        <td style={{ padding: '0.2rem 0.6rem' }}>
                                            <input
                                                value={exFaturas[i]}
                                                onChange={e => setExFaturas(prev => prev.map((v, j) => (j === i ? e.target.value : v)))}
                                                inputMode="decimal"
                                                style={{ ...pct(false), width: '80px', minWidth: 0 }}
                                            />
                                        </td>
                                        <td style={{ padding: '0.2rem 0.6rem', fontWeight: 700 }}>{kwhBr(f.kwhStart)} kWh</td>
                                        <td style={{ padding: '0.2rem 0.6rem' }}>{kwhBr(f.acumulado)} kWh{f.encerrou ? ' (encerrado)' : ''}</td>
                                        {cargosMostrados.map(c => (
                                            <td key={c} style={{ padding: '0.2rem 0.6rem' }}>{reais(f.kwhStart * tarifaEx * (pctL1(c) / 100))}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ marginTop: '0.35rem', color: '#64748b' }}>
                        Em cada fatura: menor entre o compensado, o consumo médio e o saldo até o total. Valor = kWh do Start × tarifa × %.
                    </div>
                </>
            )}
        </div>
    );

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
                            <p style={ajuda}>{TIPOS_RECOMPENSA.find(t => t.valor === dados.tipo_recompensa)?.ajuda}</p>
                        </div>
                    </div>

                    {usaStart && (
                        <div style={secao}>
                            <h4 style={tituloSecao}>Start — X × o consumo médio, em kWh compensados</h4>
                            <div>
                                <label style={rotulo}>Start: X × o consumo médio</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <input
                                        inputMode="decimal"
                                        value={xTexto}
                                        onChange={e => setXTexto(e.target.value)}
                                        style={{ ...campo(false), maxWidth: '120px', textAlign: 'right', borderColor: xValido ? '#cbd5e1' : '#f87171' }}
                                    />
                                    <span style={{ fontSize: '0.86rem', color: '#334155', fontWeight: 600 }}>× o consumo médio da UC</span>
                                </div>
                                {!xValido && (
                                    <p style={{ ...ajuda, color: '#b91c1c' }}>Use um número maior que zero (aceita decimal, ex.: 1,5).</p>
                                )}
                                <p style={ajuda}>{TEXTO_TETO_START}</p>
                            </div>
                            {grade('start_config')}
                            <p style={{ ...ajuda, margin: 0 }}>
                                L1 = venda direta; L2 e L3 = UCs indicadas na cadeia. Todos os níveis usam o mesmo teto. {TEXTO_BASE_PERCENTUAL}
                            </p>
                            {exemplo}
                        </div>
                    )}

                    {usaRecorrencia && (
                        <div style={secao}>
                            <h4 style={tituloSecao}>Recorrência</h4>
                            {grade('recorrente_config')}
                            <p style={{ ...ajuda, margin: 0 }}>
                                Paga sobre os kWh compensados de toda fatura paga, enquanto o parceiro estiver ativo. {TEXTO_BASE_PERCENTUAL}
                                Até 3 níveis por cargo; nível acima do escolhido fica 0.
                            </p>
                        </div>
                    )}

                    {dados.tipo_recompensa === 'ambos' && (
                        <div style={{ display: 'flex', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#334155', lineHeight: 1.45 }}>
                            <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>
                                No Híbrido o Start paga, em cada fatura, até 1 × o consumo médio, até somar {xValido ? formatarMultiplicador(xNumero) : 'X ×'} o consumo médio da UC. A fatura que completa esse total paga só Start;
                                a recorrência começa na fatura seguinte. Nunca os dois na mesma fatura.
                            </span>
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
