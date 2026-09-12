import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import { dinheiro } from '../../lib/rateioArrendamento';
import { Landmark, RefreshCw, Send, AlertTriangle, CheckCircle2, Clock, FileText } from 'lucide-react';

/**
 * Fila de repasse de arrendamento.
 *
 * Paga-se POR BENEFICIÁRIO, nunca por área: a mesma terra pode ter um dono
 * recebendo por PIX e outro por boleto de imobiliária, e os dois trilhos
 * confirmam em tempos diferentes. Pagamento parcial é estado legítimo, e por
 * isso a lista não tem ação "pagar a área".
 *
 * O lançamento no razão NÃO sai daqui. Ele nasce do gatilho sobre a virada de
 * status em `arrendamento_pagamentos`, para os dois trilhos lançarem igual e
 * para o razão não depender de a tela conseguir fazer a segunda chamada.
 */

const card = {
    background: 'white',
    padding: '1.5rem',
    borderRadius: '16px',
    border: '1px solid #f1f5f9',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
    marginBottom: '1.5rem'
};

const campo = { width: '100%', padding: '0.6rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };

const SITUACAO = {
    a_pagar:           { rotulo: 'A pagar',            cor: '#1d4ed8', fundo: '#eff6ff', icone: Clock },
    aguardando_boleto: { rotulo: 'Aguardando boleto',  cor: '#b45309', fundo: '#fffbeb', icone: FileText },
    enfileirado:       { rotulo: 'Enviado ao banco',   cor: '#7c3aed', fundo: '#f5f3ff', icone: Send },
    pago:              { rotulo: 'Pago',               cor: '#166534', fundo: '#f0fdf4', icone: CheckCircle2 },
    falhou:            { rotulo: 'Falhou',             cor: '#b91c1c', fundo: '#fef2f2', icone: AlertTriangle }
};

const competenciaLegivel = (d) => {
    if (!d) return '—';
    const [ano, mes] = String(d).split('-');
    return `${mes}/${ano}`;
};

export default function ArrendamentoPagamentos() {
    const { showAlert, showConfirm } = useUI();
    const [linhas, setLinhas] = useState([]);
    const [saldo, setSaldo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pagando, setPagando] = useState(null);
    const [boletos, setBoletos] = useState({});
    const [soPendentes, setSoPendentes] = useState(true);

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            const [{ data, error }, { data: s, error: se }] = await Promise.all([
                supabase
                    .from('arrendamento_pagamentos')
                    .select('*, beneficiario:leased_area_beneficiaries(id, nome, doc, tipo, forma_pagamento, pix_key, pix_key_type, leased_area_id), usina:usinas(id, name)')
                    .order('competencia', { ascending: false }),
                supabase.rpc('fn_saldo_arrendamento_a_pagar')
            ]);
            // supabase-js devolve { data, error } e nunca lança: sem este teste
            // a fila apareceria vazia como se nada estivesse pendente.
            if (error) throw error;
            if (se) throw se;

            setLinhas(data || []);
            setSaldo(s || null);
        } catch (e) {
            console.error('Erro ao carregar fila de arrendamento:', e);
            showAlert('Erro ao carregar a fila: ' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [showAlert]);

    useEffect(() => { carregar(); }, [carregar]);

    /**
     * Marca `enfileirado` ANTES de chamar o banco e só então `pago`.
     *
     * Se o dinheiro sair e a tela cair no meio, a linha fica em `enfileirado`
     * e aparece para conferência — em vez de ficar `a_pagar` como se nada
     * tivesse acontecido, que é como se paga duas vezes.
     */
    const marcar = async (linha, status, extra = {}) => {
        const { error } = await supabase
            .from('arrendamento_pagamentos')
            .update({ status, ...extra })
            .eq('id', linha.id);
        if (error) throw error;
    };

    const pagarPix = async (linha) => {
        const b = linha.beneficiario;
        if (!b?.pix_key) {
            showAlert(`${b?.nome || 'O beneficiário'} não tem chave PIX cadastrada. Cadastre em Configurações › Áreas Arrendadas.`, 'warning');
            return;
        }

        const ok = await showConfirm(
            `Pagar ${dinheiro(linha.valor)} a ${b.nome} por PIX (${b.pix_key_type}: ${b.pix_key}), competência ${competenciaLegivel(linha.competencia)}?`,
            'Confirmar repasse'
        );
        if (!ok) return;

        setPagando(linha.id);
        try {
            await marcar(linha, 'enfileirado');

            const { data, error } = await supabase.functions.invoke('transfer-asaas-pix', {
                body: {
                    amount: Number(linha.valor),
                    pixKey: b.pix_key,
                    pixKeyType: b.pix_key_type,
                    description: `Arrendamento ${competenciaLegivel(linha.competencia)} - ${linha.usina?.name || ''}`.slice(0, 60),
                    destinationType: 'arrendante',
                    supplierId: null
                }
            });

            if (error || data?.error) throw new Error(data?.error || error.message);

            await marcar(linha, 'pago');
            showAlert(`Repasse de ${dinheiro(linha.valor)} enviado a ${b.nome}.`, 'success');
            carregar();
        } catch (e) {
            try { await marcar(linha, 'falhou', { observacoes: e.message }); } catch { /* já registrado no erro abaixo */ }
            showAlert('Falha no repasse: ' + e.message, 'error');
            carregar();
        } finally {
            setPagando(null);
        }
    };

    const pagarBoleto = async (linha) => {
        const b = linha.beneficiario;
        const linhaDigitavel = (boletos[linha.id] || '').trim();

        if (!linhaDigitavel) {
            showAlert('Cole a linha digitável do boleto desta competência.', 'warning');
            return;
        }

        // Trava de graça: a linha digitável carrega o valor dentro dela. Colar
        // o boleto do mês errado ou de outro credor para aqui, antes do Asaas.
        const { data: v, error: ve } = await supabase.rpc('fn_validar_linha_digitavel', {
            p_linha: linhaDigitavel,
            p_valor: Number(linha.valor),
            p_vencimento: linha.vencimento
        });
        if (ve) { showAlert('Erro ao conferir o boleto: ' + ve.message, 'error'); return; }

        if (!v?.ok) {
            showAlert('Boleto recusado:\n\n' + (v?.divergencias || []).join('\n'), 'error');
            return;
        }
        if ((v.divergencias || []).length) {
            const segue = await showConfirm(
                (v.divergencias || []).join('\n') + '\n\nPagar assim mesmo?',
                'Divergência no boleto'
            );
            if (!segue) return;
        }

        const ok = await showConfirm(
            `Pagar ${dinheiro(linha.valor)} a ${b?.nome}, competência ${competenciaLegivel(linha.competencia)}, pelo boleto colado?`,
            'Confirmar repasse'
        );
        if (!ok) return;

        setPagando(linha.id);
        try {
            await marcar(linha, 'enfileirado', { linha_digitavel: linhaDigitavel });

            const { data, error } = await supabase.functions.invoke('pay-asaas-bill', {
                body: {
                    identification: linhaDigitavel,
                    value: Number(linha.valor),
                    description: `Arrendamento ${competenciaLegivel(linha.competencia)}`,
                    dueDate: linha.vencimento
                }
            });

            if (error) throw error;
            if (data?.success === false) throw new Error(data.error || 'Asaas recusou o pagamento');

            await marcar(linha, 'pago');
            showAlert(`Boleto de ${dinheiro(linha.valor)} pago para ${b?.nome}.`, 'success');
            carregar();
        } catch (e) {
            try { await marcar(linha, 'falhou', { observacoes: e.message }); } catch { /* já registrado no erro abaixo */ }
            showAlert('Falha no pagamento do boleto: ' + e.message, 'error');
            carregar();
        } finally {
            setPagando(null);
        }
    };

    const visiveis = soPendentes ? linhas.filter(l => l.status !== 'pago') : linhas;

    // Agrupa por competência para o operador enxergar o mês, não a linha solta.
    const porCompetencia = visiveis.reduce((acc, l) => {
        (acc[l.competencia] = acc[l.competencia] || []).push(l);
        return acc;
    }, {});

    return (
        <div style={{ padding: '1.5rem' }}>
            <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                        <Landmark size={20} color="#3b82f6" /> Repasse de Arrendamento
                    </h3>
                    <p style={{ margin: '0.4rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                        Paga-se por beneficiário. Uma área com dois donos pode ter um pago e outro pendente.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#475569' }}>
                        <input type="checkbox" checked={soPendentes} onChange={e => setSoPendentes(e.target.checked)} />
                        Só pendentes
                    </label>
                    <button type="button" onClick={carregar} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', background: 'white', color: '#475569', fontWeight: 600, cursor: 'pointer' }}>
                        <RefreshCw size={16} /> Atualizar
                    </button>
                </div>
            </div>

            {saldo && (
                <div style={{ ...card, background: saldo.negativo ? '#fef2f2' : 'white', border: `1px solid ${saldo.negativo ? '#fecaca' : '#f1f5f9'}` }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.25rem' }}>Obrigação em aberto com os arrendantes (conta 2.1.5)</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: saldo.negativo ? '#b91c1c' : '#1e293b' }}>
                        {dinheiro(saldo.saldo)}
                    </div>
                    {saldo.negativo && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.83rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <AlertTriangle size={15} />
                            Saldo negativo significa que se pagou algo que nunca foi reconhecido. Isso é defeito, não estado.
                        </div>
                    )}
                </div>
            )}

            {loading ? (
                <div style={card}><p style={{ color: '#94a3b8', margin: 0 }}>Carregando…</p></div>
            ) : visiveis.length === 0 ? (
                <div style={card}><p style={{ color: '#94a3b8', margin: 0 }}>
                    {linhas.length === 0
                        ? 'Nenhum repasse reconhecido ainda. A obrigação nasce no fechamento da usina ou no reconhecimento de pré-operação.'
                        : 'Nenhum repasse pendente.'}
                </p></div>
            ) : (
                Object.keys(porCompetencia).sort().reverse().map(comp => {
                    const grupo = porCompetencia[comp];
                    const total = grupo.reduce((s, l) => s + Number(l.valor || 0), 0);
                    return (
                        <div key={comp} style={card}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <h4 style={{ margin: 0, color: '#1e293b', fontSize: '1rem' }}>Competência {competenciaLegivel(comp)}</h4>
                                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{grupo.length} repasse(s) · {dinheiro(total)}</span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {grupo.map(l => {
                                    const s = SITUACAO[l.status] || SITUACAO.a_pagar;
                                    const Icone = s.icone;
                                    const b = l.beneficiario;
                                    const trilho = b?.forma_pagamento || l.forma_pagamento;
                                    const ocupado = pagando === l.id;

                                    return (
                                        <div key={l.id} style={{ border: '1px solid #f1f5f9', borderRadius: '12px', padding: '1rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontWeight: 700, color: '#1e293b' }}>{b?.nome || 'beneficiário removido'}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
                                                        {l.usina?.name || '—'}
                                                        {l.vencimento ? ` · vence ${new Date(l.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''}
                                                        {l.origem === 'b2w_pre_operacao' ? ' · custo da B2W (pré-operação)' : ' · cobrado do fornecedor'}
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '1.05rem' }}>{dinheiro(l.valor)}</div>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.3rem', padding: '0.2rem 0.6rem', borderRadius: '999px', background: s.fundo, color: s.cor, fontSize: '0.74rem', fontWeight: 700 }}>
                                                        <Icone size={12} /> {s.rotulo}
                                                    </span>
                                                </div>
                                            </div>

                                            {l.status !== 'pago' && b?.tipo !== 'casa' && (
                                                <div style={{ marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px dashed #e2e8f0' }}>
                                                    {!trilho ? (
                                                        <div style={{ fontSize: '0.83rem', color: '#b45309', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                            <AlertTriangle size={15} />
                                                            Sem forma de pagamento cadastrada. Defina em Configurações › Áreas Arrendadas antes de repassar.
                                                        </div>
                                                    ) : trilho === 'pix' ? (
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                                            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                                                                PIX {b?.pix_key_type}: {b?.pix_key || <strong style={{ color: '#b45309' }}>chave não cadastrada</strong>}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                disabled={ocupado || !b?.pix_key}
                                                                onClick={() => pagarPix(l)}
                                                                style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1.1rem', borderRadius: '10px', border: 'none', background: (ocupado || !b?.pix_key) ? '#94a3b8' : '#16a34a', color: 'white', fontWeight: 700, cursor: (ocupado || !b?.pix_key) ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                                                            >
                                                                <Send size={15} /> {ocupado ? 'Enviando…' : 'Pagar por PIX'}
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div>
                                                            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                                                                Linha digitável do boleto desta competência
                                                            </label>
                                                            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                                                <input
                                                                    style={{ ...campo, flex: '1 1 320px' }}
                                                                    value={boletos[l.id] || ''}
                                                                    onChange={e => setBoletos(p => ({ ...p, [l.id]: e.target.value }))}
                                                                    placeholder="00190.00009 03123.456780 12345.678901 2 12340000060000"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    disabled={ocupado}
                                                                    onClick={() => pagarBoleto(l)}
                                                                    style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1.1rem', borderRadius: '10px', border: 'none', background: ocupado ? '#94a3b8' : '#16a34a', color: 'white', fontWeight: 700, cursor: ocupado ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                                                                >
                                                                    <Send size={15} /> {ocupado ? 'Pagando…' : 'Conferir e pagar'}
                                                                </button>
                                                            </div>
                                                            <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.74rem', color: '#94a3b8' }}>
                                                                O valor é conferido contra o que está no boleto antes de mandar ao banco.
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {l.status === 'falhou' && l.observacoes && (
                                                <div style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: '#b91c1c' }}>{l.observacoes}</div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
}
