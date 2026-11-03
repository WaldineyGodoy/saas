import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ehPapelInterno } from '../../lib/papeis';
import { Pin, PinOff, Search, Clock, TriangleAlert, Loader2, X } from 'lucide-react';
import {
    ESTADO, ROTULO_ESTADO, PINTURA_ESTADO,
    estadoDaFatura, contaNoDevido, somarDevido,
    dozeMeses, chaveDoMes, ucCasaBusca, moeda, moedaCurta,
} from '../../lib/faturaEstado';

const CHAVE_ULTIMO = 'subscriber_billing_ultimo_assinante';

const oculto = {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** Marca desenhada nos dois estados que exigem ação. Pago e não faturado se
 *  distinguem pelo conteúdo da célula, então não levam marca: marcar o estado
 *  dominante encheria a grade de ícone sem informar nada. */
function MarcaEstado({ estado }) {
    if (estado === ESTADO.ABERTO) return <Clock size={11} strokeWidth={2.4} style={{ verticalAlign: '-1px', marginRight: 3 }} aria-hidden="true" />;
    if (estado === ESTADO.ATRASADO) return <TriangleAlert size={11} strokeWidth={2.4} style={{ verticalAlign: '-1px', marginRight: 3 }} aria-hidden="true" />;
    return null;
}

function Celula({ invoice }) {
    const estado = estadoDaFatura(invoice);
    const pintura = PINTURA_ESTADO[estado];

    if (estado === ESTADO.SEM_REGISTRO) {
        return (
            <td style={{ ...celulaBase, color: pintura.tinta }}>
                <span aria-hidden="true">&middot;</span>
                <span style={oculto}>Sem registro</span>
            </td>
        );
    }

    return (
        <td style={celulaBase}>
            <span
                title={`${ROTULO_ESTADO[estado]} — ${moeda(invoice.valor_a_pagar)}`}
                style={{
                    display: 'block', padding: '3px 5px', borderRadius: 'var(--radius-sm)',
                    background: pintura.fundo, color: pintura.tinta,
                    outline: pintura.tracejado ? '1px dashed #9ca3af' : 'none', outlineOffset: -1,
                    textDecoration: estado === ESTADO.CANCELADO ? 'line-through' : 'none',
                    fontWeight: estado === ESTADO.ATRASADO ? 700 : 400,
                }}
            >
                <MarcaEstado estado={estado} />
                {moedaCurta(invoice.valor_a_pagar)}
                <span style={oculto}>{` ${ROTULO_ESTADO[estado]}`}</span>
            </span>
        </td>
    );
}

const celulaBase = {
    padding: '6px 5px', textAlign: 'right', fontSize: '12px',
    fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--color-bg-light)',
};

const th = {
    padding: '8px 5px', fontSize: '12px', fontWeight: 700, textAlign: 'right',
    color: 'var(--color-text-medium)', background: '#f9fafb',
    borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap',
};

export default function SubscriberBillingDashboard() {
    const { profile } = useAuth();
    const interno = ehPapelInterno(profile?.role);

    const [assinantes, setAssinantes] = useState([]);
    const [assinanteId, setAssinanteId] = useState(localStorage.getItem(CHAVE_ULTIMO) || '');
    const [ucs, setUcs] = useState([]);
    const [faturas, setFaturas] = useState([]);
    const [busca, setBusca] = useState('');
    const [fixadas, setFixadas] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState(null);

    const meses = useMemo(() => dozeMeses(), []);

    useEffect(() => {
        let vivo = true;
        supabase.from('subscribers').select('id, name').order('name')
            .then(({ data, error }) => {
                if (!vivo) return;
                if (error) setErro(error.message); else setAssinantes(data || []);
            });
        return () => { vivo = false; };
    }, []);

    const carregar = useCallback(async (id) => {
        if (!id) { setUcs([]); setFaturas([]); return; }
        setCarregando(true);
        setErro(null);
        try {
            const { data: ucsData, error: ucErro } = await supabase
                .from('consumer_units')
                .select('id, numero_uc, numero_uc_anterior, status, nao_faturavel')
                .eq('subscriber_id', id)
                .order('numero_uc');
            if (ucErro) throw ucErro;

            const lista = ucsData || [];
            setUcs(lista);

            if (lista.length === 0) { setFaturas([]); return; }

            const inicio = `${meses[0].chave}-01`;
            const { data: invData, error: invErro } = await supabase
                .from('invoices')
                .select('id, uc_id, mes_referencia, valor_a_pagar, status, vencimento')
                .in('uc_id', lista.map((u) => u.id))
                .gte('mes_referencia', inicio);
            if (invErro) throw invErro;
            setFaturas(invData || []);
        } catch (e) {
            setErro(e.message || 'Falha ao carregar a posição do assinante.');
            setUcs([]); setFaturas([]);
        } finally {
            setCarregando(false);
        }
    }, [meses]);

    useEffect(() => { carregar(assinanteId); }, [assinanteId, carregar]);

    const trocarAssinante = (id) => {
        setAssinanteId(id);
        setBusca('');
        setFixadas([]);
        if (id) localStorage.setItem(CHAVE_ULTIMO, id); else localStorage.removeItem(CHAVE_ULTIMO);
    };

    // Índice uc -> mês -> fatura. A última fatura do mês ganha quando há mais de
    // uma: a chave por período ainda não existe no banco (ver memória do CRM).
    const porUc = useMemo(() => {
        const mapa = new Map();
        faturas.forEach((inv) => {
            const mes = chaveDoMes(inv.mes_referencia);
            if (!mes) return;
            if (!mapa.has(inv.uc_id)) mapa.set(inv.uc_id, new Map());
            mapa.get(inv.uc_id).set(mes, inv);
        });
        return mapa;
    }, [faturas]);

    const linhas = useMemo(() => ucs.map((uc) => {
        const doMes = porUc.get(uc.id) || new Map();
        const celulas = meses.map((m) => doMes.get(m.chave) || null);
        return { uc, celulas, devido: somarDevido(celulas.filter(Boolean)) };
    }), [ucs, porUc, meses]);

    const temFiltro = busca.trim() !== '';
    const casam = useMemo(() => linhas.filter((l) => ucCasaBusca(l.uc, busca)), [linhas, busca]);
    const idsCasam = useMemo(() => new Set(casam.map((l) => l.uc.id)), [casam]);

    // Fixada continua visível mesmo fora do filtro: é exatamente para isso que
    // se fixa uma UC antes de buscar outra.
    const visiveis = useMemo(() => {
        const fixas = linhas.filter((l) => fixadas.includes(l.uc.id));
        const resto = casam.filter((l) => !fixadas.includes(l.uc.id));
        return [...fixas, ...resto];
    }, [linhas, casam, fixadas]);

    const escopo = temFiltro ? casam : linhas;
    const totalDevido = escopo.reduce((acc, l) => acc + l.devido, 0);

    const contagem = useMemo(() => {
        const c = { [ESTADO.PAGO]: 0, [ESTADO.ABERTO]: 0, [ESTADO.PRONTO]: 0, [ESTADO.SEM_CONTA]: 0, [ESTADO.ATRASADO]: 0, [ESTADO.CANCELADO]: 0 };
        escopo.forEach((l) => l.celulas.forEach((inv) => {
            if (!inv) return;
            const e = estadoDaFatura(inv);
            if (c[e] !== undefined) c[e] += 1;
        }));
        return c;
    }, [escopo]);

    const fixadasFora = fixadas.filter((id) => temFiltro && !idsCasam.has(id)).length;
    const assinante = assinantes.find((a) => a.id === assinanteId);
    const alternarFixa = (id) => setFixadas((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

    if (!interno) {
        return <div className="card" style={{ padding: '2rem' }}>Esta tela é restrita à equipe interna.</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 300 }}>
                    <h2 style={{ fontSize: '1.45rem', letterSpacing: '-0.01em' }}>
                        {assinante ? assinante.name : 'Posição de cobrança'}
                    </h2>
                    <label style={{ display: 'block', marginTop: '0.5rem' }}>
                        <span style={oculto}>Assinante</span>
                        <select
                            value={assinanteId}
                            onChange={(e) => trocarAssinante(e.target.value)}
                            style={{ minWidth: 320, padding: '0.45rem 0.6rem', fontSize: '0.9rem' }}
                        >
                            <option value="">Escolha um assinante…</option>
                            {assinantes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </label>
                </div>

                {assinanteId && !carregando && (
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-medium)' }}>
                            Total devido {temFiltro ? `· ${escopo.length} UC do filtro` : `· ${linhas.length} UCs`}
                        </div>
                        <div style={{ fontSize: '2.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>
                            {moeda(totalDevido)}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)', marginTop: 2 }}>
                            {contagem[ESTADO.PAGO]} pagas · {contagem[ESTADO.ABERTO]} em aberto · {contagem[ESTADO.ATRASADO]} atrasadas · {contagem[ESTADO.PRONTO]} prontas para emitir · {contagem[ESTADO.SEM_CONTA]} sem conta
                            {contagem[ESTADO.CANCELADO] > 0 && ` · ${contagem[ESTADO.CANCELADO]} canceladas, fora do devido`}
                        </div>
                    </div>
                )}
            </div>

            {erro && (
                <div className="card" style={{ padding: '1rem', background: 'var(--color-error-bg)', color: '#991b1b' }}>
                    {erro}
                </div>
            )}

            {!assinanteId && (
                <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-medium)' }}>
                    Escolha um assinante para ver a posição das UCs dele nos últimos doze ciclos.
                </div>
            )}

            {assinanteId && carregando && (
                <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-medium)' }}>
                    <Loader2 size={18} style={{ verticalAlign: '-3px', marginRight: 8, animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                    Carregando a posição do assinante…
                </div>
            )}

            {assinanteId && !carregando && ucs.length === 0 && !erro && (
                <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-medium)' }}>
                    Este assinante não tem unidade consumidora cadastrada.
                </div>
            )}

            {assinanteId && !carregando && ucs.length > 0 && (
                <>
                    <div className="card" style={{ padding: '0.9rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: fixadas.length ? '0.75rem' : 0, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-blue)' }}>
                                Bancada {fixadas.length > 0 ? `· ${fixadas.length} fixada${fixadas.length > 1 ? 's' : ''}` : '· nenhuma UC fixada'}
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={oculto}>Buscar UC</span>
                                <Search size={15} color="var(--color-text-medium)" aria-hidden="true" />
                                <input
                                    type="search"
                                    value={busca}
                                    onChange={(e) => setBusca(e.target.value)}
                                    placeholder="buscar UC — atual ou número anterior"
                                    style={{ width: 280, padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                                />
                                {temFiltro && (
                                    <button type="button" className="btn btn-secondary" onClick={() => setBusca('')} style={{ padding: '0.3rem 0.6rem' }}>
                                        <X size={14} aria-hidden="true" /><span style={oculto}>Limpar busca</span>
                                    </button>
                                )}
                            </label>
                        </div>

                        {fixadas.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                {linhas.filter((l) => fixadas.includes(l.uc.id)).map((l) => (
                                    <div key={l.uc.id} style={{ border: '1px solid var(--color-orange)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.7rem', minWidth: 190, background: '#fffaf5' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                                            <span style={{ fontWeight: 600, fontSize: '0.86rem', fontVariantNumeric: 'tabular-nums' }}>{l.uc.numero_uc}</span>
                                            <button type="button" onClick={() => alternarFixa(l.uc.id)} className="btn btn-secondary" style={{ padding: '0.15rem 0.35rem' }} title="Soltar da bancada">
                                                <PinOff size={13} aria-hidden="true" /><span style={oculto}>Soltar {l.uc.numero_uc} da bancada</span>
                                            </button>
                                        </div>
                                        {l.uc.numero_uc_anterior && (
                                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-medium)' }}>anterior {l.uc.numero_uc_anterior}</div>
                                        )}
                                        <div style={{ fontSize: '1.05rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: '0.3rem' }}>{moeda(l.devido)}</div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-medium)' }}>devido nos 12 ciclos</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.7rem 1rem', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-blue)' }}>
                                Relatório de faturas · {meses[0].rotulo} a {meses[11].rotulo}
                            </div>
                            <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', fontSize: '0.74rem', color: 'var(--color-text-medium)' }}>
                                {[ESTADO.PAGO, ESTADO.ABERTO, ESTADO.PRONTO, ESTADO.SEM_CONTA, ESTADO.ATRASADO, ESTADO.SEM_REGISTRO].map((e) => (
                                    <span key={e} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <i style={{ width: 11, height: 11, borderRadius: 3, display: 'inline-block', background: e === ESTADO.SEM_REGISTRO ? 'var(--color-bg-light)' : PINTURA_ESTADO[e].fundo, outline: PINTURA_ESTADO[e].tracejado ? '1px dashed #9ca3af' : 'none', outlineOffset: -1 }} aria-hidden="true" />
                                        <span style={{ color: PINTURA_ESTADO[e].tinta === '#9ca3af' ? 'var(--color-text-medium)' : PINTURA_ESTADO[e].tinta }}>
                                            <MarcaEstado estado={e} />{ROTULO_ESTADO[e]}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                                <caption style={oculto}>
                                    Valor da fatura do assinante por unidade consumidora e mês de referência, dos últimos doze ciclos.
                                </caption>
                                <thead>
                                    <tr>
                                        <th scope="col" style={{ ...th, textAlign: 'left', paddingLeft: '1rem', width: 168 }}>UC</th>
                                        {meses.map((m) => (
                                            <th key={m.chave} scope="col" style={{ ...th, ...(m.atual ? { color: 'var(--color-blue)', background: '#eef2f7' } : null) }}>
                                                {m.rotulo}{m.atual && <span style={oculto}> (mês atual)</span>}
                                            </th>
                                        ))}
                                        <th scope="col" style={{ ...th, paddingRight: '1rem', background: 'var(--color-bg-light)', color: 'var(--color-blue)', width: 104 }}>Devido</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visiveis.map((l) => {
                                        const fixa = fixadas.includes(l.uc.id);
                                        return (
                                            <tr key={l.uc.id} style={fixa ? { background: '#fffaf5' } : null}>
                                                <th scope="row" style={{ padding: '6px 5px 6px 1rem', textAlign: 'left', fontSize: '12.5px', fontWeight: 600, borderBottom: '1px solid var(--color-bg-light)', fontVariantNumeric: 'tabular-nums' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => alternarFixa(l.uc.id)}
                                                        title={fixa ? 'Soltar da bancada' : 'Fixar na bancada'}
                                                        style={{ border: 0, background: 'none', padding: 0, marginRight: 6, cursor: 'pointer', color: fixa ? 'var(--color-orange)' : '#9ca3af', verticalAlign: '-2px' }}
                                                    >
                                                        <Pin size={13} strokeWidth={fixa ? 2.6 : 2} aria-hidden="true" />
                                                        <span style={oculto}>{fixa ? `Soltar ${l.uc.numero_uc}` : `Fixar ${l.uc.numero_uc}`}</span>
                                                    </button>
                                                    {l.uc.numero_uc}
                                                    {l.uc.nao_faturavel && <span style={{ display: 'block', fontSize: '11px', fontWeight: 400, color: 'var(--color-text-medium)' }}>não faturável</span>}
                                                    {!l.uc.nao_faturavel && l.uc.numero_uc_anterior && (
                                                        <span style={{ display: 'block', fontSize: '11px', fontWeight: 400, color: 'var(--color-text-medium)' }}>ant. {l.uc.numero_uc_anterior}</span>
                                                    )}
                                                </th>
                                                {l.celulas.map((inv, i) => <Celula key={meses[i].chave} invoice={inv} />)}
                                                <td style={{ ...celulaBase, paddingRight: '1rem', fontWeight: 700, fontSize: '12.5px', background: '#f9fafb' }}>
                                                    {moedaCurta(l.devido)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {visiveis.length === 0 && (
                                        <tr>
                                            <td colSpan={14} style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-medium)', fontSize: '0.88rem' }}>
                                                Nenhuma UC casa com “{busca}”. A busca aceita o número atual e o anterior.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.65rem 1rem', borderTop: '1px solid var(--color-border)', background: '#f9fafb', fontSize: '0.78rem', color: 'var(--color-text-medium)', flexWrap: 'wrap' }}>
                            <span>
                                Valor da fatura do assinante, por mês de referência. Sem conta (R$&nbsp;0,00) é conta não apurada, não dívida quitada.
                                {fixadasFora > 0 && ` ${fixadasFora} UC fixada fora do filtro continua na tabela, fora do total.`}
                            </span>
                            <span>Total devido <strong style={{ color: 'var(--color-text-dark)', fontVariantNumeric: 'tabular-nums' }}>{moeda(totalDevido)}</strong></span>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
