import { useState, useEffect } from 'react';
import { X, Save, Lock, GitBranch } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
    CAMPOS_PLANO_USINA,
    PLANO_USINA_VAZIO,
    lerFechamentos,
    validarPlanoUsina,
    rascunhoNovaVersao,
    payloadPlanoUsina
} from '../../../lib/planoUsina';

/**
 * Cria, edita ou versiona um Plano de Usina (spec 2026-10-06, secao 3).
 *
 *  - 'novo'   -> INSERT
 *  - 'editar' -> UPDATE; com usina vinculada so nome e descricao (o banco
 *                recusa o resto em fn_planos_usina_trava)
 *  - 'versao' -> fn_planos_usina_nova_versao: nasce um plano novo e o antigo
 *                fica somente para contratos
 */
export default function PlanoUsinaModal({ isOpen, modo, plano, usinasVinculadas = 0, planosRecompensa, onClose, onSave, showAlert }) {
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

    // O desconto do plano de usina e termo do contrato de gestao; a base do
    // split usa o desconto do plano de recompensas. Divergir e permitido,
    // mas a tela avisa (spec secao 3, item 5).
    const recompensasSel = planosRecompensa.find(p => p.id === dados.plano_assinatura_id);
    const descontoDiverge = !!recompensasSel && Number(recompensasSel.desconto_assinante) !== Number(dados.desconto_pct);

    const titulo = modo === 'novo' ? 'Criar Plano de Usina'
        : modo === 'versao' ? `Nova versão de "${plano?.nome}"`
        : `Editar "${plano?.nome}"`;

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

    const rotulo = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' };
    const campo = (bloqueado) => ({
        width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', fontSize: '0.88rem', boxSizing: 'border-box',
        border: '1px solid #cbd5e1', background: bloqueado ? '#f1f5f9' : 'white', color: bloqueado ? '#94a3b8' : '#0f172a'
    });

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
            <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '760px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.1rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a', fontWeight: 800 }}>{titulo}</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }} title="Fechar">
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                    {travado && (
                        <div style={{ display: 'flex', gap: '0.5rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#92400e' }}>
                            <Lock size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            Este plano tem {usinasVinculadas} usina(s) vinculada(s): percentuais, valores e plano de recompensas não mudam mais. Para mudar, use "Criar nova versão".
                        </div>
                    )}
                    {modo === 'versao' && (
                        <div style={{ display: 'flex', gap: '0.5rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#1e40af' }}>
                            <GitBranch size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            Ao salvar, nasce um plano novo e "{plano?.nome}" passa a valer somente para as usinas que já estão nele. Ele não aparece mais para usinas novas.
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={rotulo}>Nome do plano</label>
                            <input value={dados.nome} onChange={e => definir('nome', e.target.value)} style={campo(false)} />
                        </div>
                        <div>
                            <label style={rotulo}>Plano de recompensas</label>
                            <select
                                value={dados.plano_assinatura_id || ''}
                                disabled={travado}
                                onChange={e => definir('plano_assinatura_id', e.target.value || null)}
                                style={campo(travado)}
                            >
                                <option value="">Sem plano de recompensas (não recebe usina)</option>
                                {planosRecompensa.map(p => (
                                    <option key={p.id} value={p.id} disabled={!p.ativo && p.id !== dados.plano_assinatura_id}>
                                        {p.nome} · {p.tipo_recompensa} · desconto {Number(p.desconto_assinante)}%{p.ativo ? '' : ' (inativo)'}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {descontoDiverge && (
                        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#92400e' }}>
                            O desconto ao consumidor deste plano ({Number(dados.desconto_pct)}%) é diferente do desconto do plano de recompensas "{recompensasSel.nome}" ({Number(recompensasSel.desconto_assinante)}%).
                            O contrato de gestão sai com o deste plano; o split calcula a base com o do plano de recompensas.
                        </div>
                    )}

                    <div>
                        <label style={rotulo}>Descrição</label>
                        <textarea value={dados.descricao || ''} onChange={e => definir('descricao', e.target.value)} rows={2} style={{ ...campo(false), resize: 'vertical' }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
                        {CAMPOS_PLANO_USINA.map(c => (
                            <div key={c.chave}>
                                <label style={rotulo}>{c.rotulo}</label>
                                <input
                                    type="number"
                                    step={c.inteiro ? '1' : '0.01'}
                                    min="0"
                                    max={c.max ?? undefined}
                                    disabled={travado}
                                    value={dados[c.chave] ?? ''}
                                    onChange={e => definir(c.chave, e.target.value)}
                                    style={campo(travado)}
                                />
                            </div>
                        ))}
                        <div>
                            <label style={rotulo}>Originador da usina — bônus no(s) fechamento(s) nº</label>
                            <input
                                placeholder="ex.: 2"
                                disabled={travado}
                                value={bonusTexto}
                                onChange={e => setBonusTexto(e.target.value)}
                                style={campo(travado)}
                            />
                        </div>
                    </div>

                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
                        A gestão B2W é a mesma cobrança dos 10% da B2W no split. O originador da usina recebe o recorrente em toda fatura paga das UCs dela e,
                        no(s) fechamento(s) informado(s) com saldo positivo, o saldo que iria ao investidor. Sem originador vinculado à usina, os dois ficam para a associação.
                        Taxa de administração e de recuperação são cobradas no fechamento mensal. Desconto, dias de corte e repasse e prazos de transferência e honorários
                        sugerem os valores do Contrato de Gestão de Créditos do fornecedor, que continuam editáveis lá.
                    </p>
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
                        {modo === 'versao' ? 'Criar nova versão' : 'Salvar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
