import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import { dinheiro, competenciaLegivel } from '../../lib/rateioArrendamento';
import RepasseAcoes from '../../components/RepasseAcoes';
import { Landmark, RefreshCw, AlertTriangle, CheckCircle2, Clock, FileText, Send } from 'lucide-react';

/**
 * Fila de repasse de arrendamento — a visão que atravessa todas as áreas.
 *
 * Paga-se POR BENEFICIÁRIO, nunca por área: a mesma terra pode ter um dono
 * recebendo por PIX e outro por boleto de imobiliária, e os dois trilhos
 * confirmam em tempos diferentes. Pagamento parcial é estado legítimo, e por
 * isso não existe ação "pagar a área".
 *
 * A mesma ação também vive dentro do modal de cada área, pelo componente
 * `RepasseAcoes`. Esta tela existe para responder "o que devo este mês" sem
 * abrir área por área.
 */

const card = {
    background: 'white',
    padding: '1.5rem',
    borderRadius: '16px',
    border: '1px solid #f1f5f9',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
    marginBottom: '1.5rem'
};

const SITUACAO = {
    a_pagar:           { rotulo: 'A pagar',           cor: '#1d4ed8', fundo: '#eff6ff', icone: Clock },
    aguardando_boleto: { rotulo: 'Aguardando boleto', cor: '#b45309', fundo: '#fffbeb', icone: FileText },
    enfileirado:       { rotulo: 'Enviado ao banco',  cor: '#7c3aed', fundo: '#f5f3ff', icone: Send },
    pago:              { rotulo: 'Pago',              cor: '#166534', fundo: '#f0fdf4', icone: CheckCircle2 },
    falhou:            { rotulo: 'Falhou',            cor: '#b91c1c', fundo: '#fef2f2', icone: AlertTriangle }
};

export default function ArrendamentoPagamentos() {
    const { showAlert } = useUI();
    const [linhas, setLinhas] = useState([]);
    const [saldo, setSaldo] = useState(null);
    const [loading, setLoading] = useState(true);
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

    const visiveis = soPendentes ? linhas.filter(l => l.status !== 'pago') : linhas;

    // Agrupa por competência para o operador enxergar o mês, não a linha solta.
    const porCompetencia = visiveis.reduce((acc, l) => {
        (acc[l.competencia] = acc[l.competencia] || []).push(l);
        return acc;
    }, {});

    return (
        <div>
            <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                        <Landmark size={20} color="#3b82f6" /> Repasses a pagar
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
                                    return (
                                        <div key={l.id} style={{ border: '1px solid #f1f5f9', borderRadius: '12px', padding: '1rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontWeight: 700, color: '#1e293b' }}>{l.beneficiario?.nome || 'beneficiário removido'}</div>
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

                                            {l.status !== 'pago' && l.beneficiario?.tipo !== 'casa' && (
                                                <div style={{ marginTop: '0.9rem', paddingTop: '0.9rem', borderTop: '1px dashed #e2e8f0' }}>
                                                    <RepasseAcoes
                                                        linha={l}
                                                        beneficiario={l.beneficiario}
                                                        usinaNome={l.usina?.name}
                                                        aoConcluir={carregar}
                                                    />
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
