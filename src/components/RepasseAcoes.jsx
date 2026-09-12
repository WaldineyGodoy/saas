import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { dinheiro, competenciaLegivel } from '../lib/rateioArrendamento';
import { Send, AlertTriangle } from 'lucide-react';

/**
 * Pagar UM repasse de arrendamento, por PIX ou por boleto.
 *
 * Vive num componente só porque é usado em dois lugares — a fila geral e o
 * modal da própria área — e duplicar a lógica de pagamento é o jeito mais
 * rápido de fazer as duas telas divergirem sobre o que é pagar.
 *
 * O lançamento no razão NÃO sai daqui. Ele nasce do gatilho sobre a virada de
 * status em `arrendamento_pagamentos`, para os dois trilhos lançarem igual e
 * para o razão não depender de a tela conseguir fazer uma segunda chamada.
 */

const campo = { width: '100%', padding: '0.6rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };

/**
 * O motivo real, e não "Edge Function returned a non-2xx status code".
 *
 * Quando a função responde 4xx, o supabase-js entrega um FunctionsHttpError
 * cuja mensagem só diz que houve erro; o que aconteceu está no corpo da
 * resposta, pendurado em `error.context`. Sem ler esse corpo, a recusa do
 * Asaas — chave inexistente, saldo insuficiente, transferência sem token
 * configurado — chega ao operador como uma frase que não ajuda em nada.
 */
async function motivoDaFalha(error, data) {
    if (data?.error) return data.error;
    try {
        const corpo = await error?.context?.json?.();
        if (corpo?.error) return corpo.error;
        if (corpo?.message) return corpo.message;
    } catch {
        try {
            const texto = await error?.context?.text?.();
            if (texto) return texto.slice(0, 400);
        } catch { /* sem corpo legível: fica a mensagem original */ }
    }
    return error?.message || 'falha desconhecida';
}

export default function RepasseAcoes({ linha, beneficiario, usinaNome, aoConcluir }) {
    const { showAlert, showConfirm } = useUI();
    const [ocupado, setOcupado] = useState(false);
    // Boleto já guardado na fila anual da imobiliária chega junto com o
    // repasse: o campo nasce preenchido e ninguém redigita 47 dígitos.
    const [boleto, setBoleto] = useState(linha.linha_digitavel || '');

    const trilho = beneficiario?.forma_pagamento || linha.forma_pagamento;

    /**
     * Marca `enfileirado` ANTES de chamar o banco e só então `pago`.
     *
     * Se o dinheiro sair e a tela cair no meio, a linha fica em `enfileirado`
     * e aparece para conferência — em vez de voltar a `a pagar` como se nada
     * tivesse acontecido, que é como se paga duas vezes.
     */
    const marcar = async (status, extra = {}) => {
        const { error } = await supabase
            .from('arrendamento_pagamentos')
            .update({ status, ...extra })
            .eq('id', linha.id);
        if (error) throw error;
    };

    const pagarPix = async () => {
        if (!beneficiario?.pix_key) {
            showAlert(`${beneficiario?.nome || 'O beneficiário'} não tem chave PIX cadastrada.`, 'warning');
            return;
        }

        const ok = await showConfirm(
            `Pagar ${dinheiro(linha.valor)} a ${beneficiario.nome} por PIX `
            + `(${beneficiario.pix_key_type}: ${beneficiario.pix_key}), `
            + `competência ${competenciaLegivel(linha.competencia)}?`,
            'Confirmar repasse'
        );
        if (!ok) return;

        setOcupado(true);
        try {
            await marcar('enfileirado');

            const { data, error } = await supabase.functions.invoke('transfer-asaas-pix', {
                body: {
                    amount: Number(linha.valor),
                    // Só o identificador do beneficiário. A chave PIX é resolvida
                    // no servidor, a partir do cadastro: mandá-la daqui não
                    // adianta, porque a função a ignora de propósito — destino
                    // vindo do cliente foi o que a transformava num saque.
                    beneficiaryId: beneficiario.id,
                    description: `Arrendamento ${competenciaLegivel(linha.competencia)} - ${usinaNome || ''}`.slice(0, 60)
                }
            });

            if (error || data?.error) throw new Error(await motivoDaFalha(error, data));

            // Prende a transferência ao repasse. É esse elo que faz o webhook
            // do Asaas, ao confirmar o token, achar o repasse e marcá-lo pago.
            // Sem ele a confirmação chega em financial_transfers e morre ali.
            if (data?.transferId) {
                const { data: tr } = await supabase
                    .from('financial_transfers')
                    .select('id')
                    .eq('asaas_transfer_id', data.transferId)
                    .maybeSingle();
                if (tr?.id) {
                    await supabase.from('arrendamento_pagamentos')
                        .update({ financial_transfer_id: tr.id })
                        .eq('id', linha.id);
                }
            }

            // O Asaas devolve PENDING quando a transferência ainda espera a
            // autorização por token. Marcar 'pago' aí lançaria a saída no razão
            // antes de o dinheiro sair, e o Banco Asaas passaria a mentir.
            // 'enfileirado' é o que ela é até a confirmação chegar.
            const concluida = ['DONE', 'CONFIRMED'].includes(String(data?.status || '').toUpperCase());

            if (concluida) {
                await marcar('pago');
                showAlert(`Repasse de ${dinheiro(linha.valor)} enviado a ${beneficiario.nome}.`, 'success');
            } else {
                showAlert(
                    `Transferência de ${dinheiro(linha.valor)} criada para ${beneficiario.nome}, `
                    + 'e aguardando autorização por token no Asaas. O repasse fica como "Enviado ao banco" '
                    + 'até a confirmação, e só então entra no razão.',
                    'info'
                );
            }
            aoConcluir?.();
        } catch (e) {
            try { await marcar('falhou', { observacoes: e.message }); } catch { /* o erro abaixo ja' reporta */ }
            showAlert('Falha no repasse: ' + e.message, 'error');
            aoConcluir?.();
        } finally {
            setOcupado(false);
        }
    };

    const pagarBoleto = async () => {
        const linhaDigitavel = boleto.trim();
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
            `Pagar ${dinheiro(linha.valor)} a ${beneficiario?.nome}, `
            + `competência ${competenciaLegivel(linha.competencia)}, pelo boleto colado?`,
            'Confirmar repasse'
        );
        if (!ok) return;

        setOcupado(true);
        try {
            await marcar('enfileirado', { linha_digitavel: linhaDigitavel });

            const { data, error } = await supabase.functions.invoke('pay-asaas-bill', {
                body: {
                    identification: linhaDigitavel,
                    value: Number(linha.valor),
                    description: `Arrendamento ${competenciaLegivel(linha.competencia)}`,
                    dueDate: linha.vencimento
                }
            });

            if (error || data?.success === false) throw new Error(await motivoDaFalha(error, data));

            await marcar('pago');
            showAlert(`Boleto de ${dinheiro(linha.valor)} pago para ${beneficiario?.nome}.`, 'success');
            aoConcluir?.();
        } catch (e) {
            try { await marcar('falhou', { observacoes: e.message }); } catch { /* o erro abaixo ja' reporta */ }
            showAlert('Falha no pagamento do boleto: ' + e.message, 'error');
            aoConcluir?.();
        } finally {
            setOcupado(false);
        }
    };

    // A casa não recebe: o dinheiro dela já está na conta.
    if (beneficiario?.tipo === 'casa' || linha.status === 'pago') return null;

    if (!trilho) {
        return (
            <div style={{ fontSize: '0.83rem', color: '#b45309', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <AlertTriangle size={15} />
                Sem forma de pagamento cadastrada. Defina no cadastro do beneficiário antes de repassar.
            </div>
        );
    }

    if (trilho === 'pix') {
        return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                    PIX {beneficiario?.pix_key_type}: {beneficiario?.pix_key
                        || <strong style={{ color: '#b45309' }}>chave não cadastrada</strong>}
                </span>
                <button
                    type="button"
                    disabled={ocupado || !beneficiario?.pix_key}
                    onClick={pagarPix}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1.1rem', borderRadius: '10px', border: 'none', background: (ocupado || !beneficiario?.pix_key) ? '#94a3b8' : '#16a34a', color: 'white', fontWeight: 700, cursor: (ocupado || !beneficiario?.pix_key) ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                >
                    <Send size={15} /> {ocupado ? 'Enviando…' : 'Pagar por PIX'}
                </button>
            </div>
        );
    }

    return (
        <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Linha digitável do boleto desta competência
            </label>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <input
                    style={{ ...campo, flex: '1 1 320px' }}
                    value={boleto}
                    onChange={e => setBoleto(e.target.value)}
                    placeholder="00190.00009 03123.456780 12345.678901 2 12340000060000"
                />
                <button
                    type="button"
                    disabled={ocupado}
                    onClick={pagarBoleto}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1.1rem', borderRadius: '10px', border: 'none', background: ocupado ? '#94a3b8' : '#16a34a', color: 'white', fontWeight: 700, cursor: ocupado ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                >
                    <Send size={15} /> {ocupado ? 'Pagando…' : 'Conferir e pagar'}
                </button>
            </div>
            <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.74rem', color: '#94a3b8' }}>
                O valor é conferido contra o que está no boleto antes de mandar ao banco.
            </p>
        </div>
    );
}
