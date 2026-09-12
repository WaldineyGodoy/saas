import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { dinheiro, competenciaLegivel } from '../lib/rateioArrendamento';
import { FileText, Trash2, CheckCircle2, AlertTriangle, ClipboardPaste } from 'lucide-react';

/**
 * Fila de boletos de um beneficiário.
 *
 * A imobiliária manda os 12 boletos do ano de uma vez, em janeiro, e a
 * competência de agosto só é reconhecida em setembro. Por isso o boleto tem
 * vida própria: ele CHEGA ANTES do pagamento existir. Guardá-los aqui troca
 * 12 digitações ao longo do ano por uma colagem só, e 12 chances de colar o
 * boleto do mês errado por zero.
 *
 * Valor e vencimento não se digitam: a linha digitável já os carrega, e o
 * banco os extrai ao salvar. Linha que ele não souber ler é recusada agora,
 * não no dia de pagar.
 */

const campo = { width: '100%', padding: '0.6rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
const rotulo = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' };

/** A competência é o mês anterior ao vencimento, igual ao reconhecimento. */
const competenciaDoVencimento = (venc) => {
    if (!venc) return '';
    const d = new Date(venc + 'T12:00:00');
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

export default function BoletosDoBeneficiario({ beneficiario, aoMudar }) {
    const { showAlert, showConfirm } = useUI();
    const [lista, setLista] = useState([]);
    const [colagem, setColagem] = useState('');
    const [previa, setPrevia] = useState(null);
    const [ocupado, setOcupado] = useState(false);

    const carregar = useCallback(async () => {
        if (!beneficiario?.id) { setLista([]); return; }
        const { data, error } = await supabase
            .from('arrendamento_boletos')
            .select('*')
            .eq('beneficiary_id', beneficiario.id)
            .order('competencia');
        if (error) { console.error('Erro ao carregar boletos:', error); return; }
        setLista(data || []);
    }, [beneficiario?.id]);

    useEffect(() => { carregar(); }, [carregar]);

    /**
     * Lê cada linha colada e monta a prévia. A conferência é do banco, pela
     * mesma função que valida no pagamento: duas implementações do mesmo
     * formato divergiriam com o tempo.
     */
    const conferir = async () => {
        const linhas = colagem.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
        if (!linhas.length) {
            showAlert('Cole as linhas digitáveis, uma por linha.', 'warning');
            return;
        }

        setOcupado(true);
        try {
            const lidas = [];
            for (const linha of linhas) {
                const { data: v, error } = await supabase.rpc('fn_validar_linha_digitavel', {
                    p_linha: linha, p_valor: null, p_vencimento: null
                });
                if (error) throw error;
                const legivel = v?.formato && v.formato !== 'desconhecido';
                lidas.push({
                    linha,
                    legivel,
                    valor: v?.valor_boleto ?? null,
                    vencimento: v?.vencimento_boleto ?? null,
                    competencia: competenciaDoVencimento(v?.vencimento_boleto),
                    erro: legivel ? null : (v?.divergencias || []).join(' ')
                });
            }
            setPrevia(lidas);
        } catch (e) {
            showAlert('Erro ao conferir os boletos: ' + e.message, 'error');
        } finally {
            setOcupado(false);
        }
    };

    const salvar = async () => {
        const bons = (previa || []).filter(p => p.legivel && p.competencia);
        if (!bons.length) {
            showAlert('Nenhum boleto legível com competência definida.', 'warning');
            return;
        }

        setOcupado(true);
        const falhas = [];
        for (const b of bons) {
            const { error } = await supabase.from('arrendamento_boletos').insert({
                beneficiary_id: beneficiario.id,
                competencia: b.competencia,
                linha_digitavel: b.linha
            });
            if (error) falhas.push(`${competenciaLegivel(b.competencia)}: ${error.message}`);
        }
        setOcupado(false);

        if (falhas.length) {
            showAlert(`${bons.length - falhas.length} salvos. Falharam:\n\n` + falhas.join('\n'), 'warning');
        } else {
            showAlert(`${bons.length} boleto(s) guardado(s).`, 'success');
        }
        setColagem('');
        setPrevia(null);
        carregar();
        aoMudar?.();
    };

    const excluir = async (b) => {
        if (b.arrendamento_pagamento_id) {
            showAlert('Este boleto já está preso a um repasse. Não dá para removê-lo.', 'warning');
            return;
        }
        const ok = await showConfirm(`Remover o boleto de ${competenciaLegivel(b.competencia)}?`, 'Remover boleto');
        if (!ok) return;
        const { error } = await supabase.from('arrendamento_boletos').delete().eq('id', b.id);
        if (error) { showAlert('Erro ao remover: ' + error.message, 'error'); return; }
        carregar();
        aoMudar?.();
    };

    const setCompetencia = (i, valor) => setPrevia(prev => prev.map((p, j) => j === i ? { ...p, competencia: valor } : p));

    return (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', background: '#f8fafc' }}>
            <h5 style={{ margin: '0 0 0.3rem 0', display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#334155', fontSize: '0.88rem' }}>
                <FileText size={16} color="#3b82f6" /> Boletos de {beneficiario?.nome || 'beneficiário'}
            </h5>
            <p style={{ margin: '0 0 0.9rem 0', fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.4 }}>
                Cole os 12 boletos do ano de uma vez, um por linha. A competência sai do vencimento que está
                dentro de cada boleto, e você ajusta se algum vier diferente.
            </p>

            {lista.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
                    {lista.map(b => (
                        <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0.7rem', background: 'white', border: '1px solid #f1f5f9', borderRadius: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.82rem', color: '#334155' }}>
                                <strong>{competenciaLegivel(b.competencia)}</strong>
                                {' · '}{dinheiro(b.valor)}
                                {b.vencimento ? ` · vence ${new Date(b.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {b.arrendamento_pagamento_id && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#166534' }}>
                                        <CheckCircle2 size={12} /> em uso
                                    </span>
                                )}
                                <button type="button" onClick={() => excluir(b)} title="Remover" style={{ padding: '0.3rem', border: '1px solid #fecaca', borderRadius: '6px', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}>
                                    <Trash2 size={13} />
                                </button>
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {!previa ? (
                <>
                    <label style={rotulo}>Linhas digitáveis, uma por linha</label>
                    <textarea
                        style={{ ...campo, minHeight: '90px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.78rem' }}
                        value={colagem}
                        onChange={e => setColagem(e.target.value)}
                        placeholder={'00190.00009 03123.456780 12345.678901 2 12340000060000\n00190.00009 03123.456780 12345.678901 2 12640000060000'}
                    />
                    <button
                        type="button"
                        disabled={ocupado}
                        onClick={conferir}
                        style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1rem', border: '1px solid #bfdbfe', borderRadius: '10px', background: 'white', color: '#3b82f6', fontWeight: 600, cursor: ocupado ? 'not-allowed' : 'pointer', fontSize: '0.83rem' }}
                    >
                        <ClipboardPaste size={15} /> {ocupado ? 'Conferindo…' : 'Conferir boletos'}
                    </button>
                </>
            ) : (
                <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.8rem' }}>
                        {previa.map((p, i) => (
                            <div key={i} style={{ padding: '0.6rem 0.7rem', background: p.legivel ? 'white' : '#fef2f2', border: `1px solid ${p.legivel ? '#f1f5f9' : '#fecaca'}`, borderRadius: '8px' }}>
                                {p.legivel ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                        <input
                                            type="month"
                                            style={{ ...campo, width: '150px' }}
                                            value={p.competencia ? p.competencia.slice(0, 7) : ''}
                                            onChange={e => setCompetencia(i, e.target.value ? `${e.target.value}-01` : '')}
                                        />
                                        <span style={{ fontSize: '0.82rem', color: '#334155' }}>
                                            {dinheiro(p.valor)}
                                            {p.vencimento ? ` · vence ${new Date(p.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''}
                                        </span>
                                    </div>
                                ) : (
                                    <span style={{ fontSize: '0.8rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <AlertTriangle size={14} /> {p.erro || 'linha não reconhecida'}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => setPrevia(null)} style={{ padding: '0.5rem 1rem', border: '1px solid #e2e8f0', borderRadius: '10px', background: 'white', color: '#64748b', fontWeight: 600, cursor: 'pointer', fontSize: '0.83rem' }}>
                            Voltar
                        </button>
                        <button type="button" disabled={ocupado} onClick={salvar} style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '10px', background: ocupado ? '#94a3b8' : '#16a34a', color: 'white', fontWeight: 700, cursor: ocupado ? 'not-allowed' : 'pointer', fontSize: '0.83rem' }}>
                            {ocupado ? 'Salvando…' : `Guardar ${previa.filter(p => p.legivel && p.competencia).length} boleto(s)`}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
