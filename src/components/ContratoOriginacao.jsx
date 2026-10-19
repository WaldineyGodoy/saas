import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { useBranding } from '../contexts/BrandingContext';
import { createAutentiqueDocument, cancelAutentiqueDocument, shortenLink, sendWhatsapp } from '../lib/api';
import {
    AlertCircle, Ban, CheckCircle, Clock, ExternalLink, FileSignature,
    History, Loader2, RefreshCcw, Send
} from 'lucide-react';
import ContratoOriginador from './ContratoOriginador';
import {
    baixarPdfContratoOriginador, DEFAULTS_ORIGINADOR, dividirEmPaginasOriginador,
    gerarPdfContratoOriginadorBase64, MODALIDADES_ORIGINACAO, montarContratoOriginador
} from '../lib/contratoOriginador';
import { numeroBr, paraNumero } from '../lib/contratoBase';

/**
 * Contrato de Originação e Indicação de Negócios, na aba Contrato do
 * originador.
 *
 * Espelha o painel do contrato de gestão (ContratoGestaoUsina): mesma
 * mecânica de minuta editável, mesma gravação em
 * `contract_terms.minutas`, mesmo envio pela Autentique com entrega do
 * link por WhatsApp e e-mail feita por nós.
 *
 * O que muda é de onde vêm os números: os percentuais do Start e da
 * Recorrência são os do cadastro do originador (aba Financeiro), e não
 * campos deste painel. Duplicá-los aqui criaria uma terceira fonte de
 * verdade sobre comissão — e a primeira a divergir das outras duas. Ver
 * a memória crm-comissao-duas-fontes.
 */

/** Prazos do contrato. A mesma lista valida o envio e desenha o formulário. */
const CAMPOS_PRAZOS = [
    { key: 'avisoPrevioDias', label: 'Aviso prévio de rescisão (dias)' },
    { key: 'prazoPagamentoDias', label: 'Prazo de pagamento sem split (dias)' },
    { key: 'naoAliciamentoMeses', label: 'Não aliciamento após o fim (meses)' },
    { key: 'prazoEstornoMeses', label: 'Prazo de estorno (meses)' }
];

const condicoesParaTela = (termos) => {
    const tela = { ...DEFAULTS_ORIGINADOR, ...(termos || {}) };
    for (const chave of Object.keys(tela)) {
        if (typeof tela[chave] === 'number') tela[chave] = numeroBr(tela[chave]);
    }
    return tela;
};

const cartao = { background: 'white', padding: '1.5rem', borderRadius: '16px', border: '1px solid #f1f5f9', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', marginBottom: '1.5rem' };
const rotuloCampo = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' };
const estiloCampo = { width: '100%', padding: '0.65rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' };

const resumoEnvio = (envio) => `WhatsApp: ${envio.whatsapp} · E-mail: ${envio.email}`;
const algumCanalFalhou = (envio) =>
    String(envio.whatsapp).startsWith('falhou') || String(envio.email).startsWith('falhou');

export default function ContratoOriginacao({ originadorId, registrarHistorico }) {
    const { showAlert, showConfirm } = useUI();
    const { branding } = useBranding();

    const [originador, setOriginador] = useState(null);
    const [lider, setLider] = useState(null);
    const [signatures, setSignatures] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [opts, setOpts] = useState(DEFAULTS_ORIGINADOR);
    const [draft, setDraft] = useState('');
    const [gerandoMinuta, setGerandoMinuta] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [cancelando, setCancelando] = useState(null);

    const lerOriginador = useCallback(async () => {
        const { data, error } = await supabase.from('originators_v2').select('*').eq('id', originadorId).maybeSingle();
        if (error) throw error;
        setOriginador(data);

        // O Líder entra no Anexo I. Quem foi promovido ou trocou de Líder em
        // outra tela veria o Líder antigo na minuta sem esta releitura.
        let chefe = null;
        if (data?.lider_id) {
            const { data: l } = await supabase
                .from('originators_v2')
                .select('id, name, cpf_cnpj')
                .eq('id', data.lider_id)
                .maybeSingle();
            chefe = l || null;
        }
        setLider(chefe);
        return { originador: data, lider: chefe };
    }, [originadorId]);

    const lerAssinaturas = useCallback(async () => {
        const { data, error } = await supabase
            .from('signatures')
            .select('*')
            .eq('signer_id', originadorId)
            .eq('signer_type', 'originador')
            .order('created_at', { ascending: false });
        if (error) throw error;
        setSignatures(data || []);
        return data || [];
    }, [originadorId]);

    useEffect(() => {
        if (!originadorId) {
            setOriginador(null); setLider(null); setSignatures([]);
            return undefined;
        }
        let cancelado = false;
        (async () => {
            setCarregando(true);
            try {
                const [{ originador: o }] = await Promise.all([lerOriginador(), lerAssinaturas()]);
                if (cancelado) return;
                setOpts(condicoesParaTela(o?.contract_terms));
                setDraft('');
            } catch (e) {
                console.error('Erro ao carregar o contrato de originação:', e);
                if (!cancelado) showAlert('Erro ao carregar o contrato: ' + e.message, 'error');
            } finally {
                if (!cancelado) setCarregando(false);
            }
        })();
        return () => { cancelado = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [originadorId]);

    const textoGerado = useMemo(
        () => (originador ? montarContratoOriginador(originador, lider, opts) : ''),
        [originador, lider, opts]
    );

    // Ordem de precedência: o que está sendo digitado agora, depois a minuta
    // gravada, e por último o texto montado a partir dos campos.
    const minutaSalva = (opts.minutas || {}).originador || '';
    const texto = draft || minutaSalva || textoGerado;
    const minutaEditada = texto !== textoGerado;

    const modalidadesMarcadas = MODALIDADES_ORIGINACAO.filter(m => opts[m.chave]);

    const condicoesParaGravar = () => {
        const gravar = { foro: opts.foro };
        for (const m of MODALIDADES_ORIGINACAO) gravar[m.chave] = !!opts[m.chave];
        for (const campo of CAMPOS_PRAZOS) {
            const n = paraNumero(opts[campo.key]);
            if (Number.isFinite(n)) gravar[campo.key] = n;
        }
        // A minuta editada à mão não está nas listas acima e seria apagada
        // por quem reescreve `contract_terms` inteiro.
        if (opts.minutas && Object.keys(opts.minutas).length) gravar.minutas = opts.minutas;
        return gravar;
    };

    const nomeArquivo = (sufixo) =>
        `Contrato_Originacao_${(originador?.name || 'originador').replace(/\s+/g, '_')}_${sufixo}.pdf`;

    /**
     * Grava a minuta como ela está na tela e baixa o PDF.
     *
     * A edição à mão manda: vai para `contract_terms.minutas.originador`,
     * volta ao reabrir e é o que sai no PDF e na Autentique. Sem edição nada
     * é gravado em `minutas`, e o cadastro é relido antes de montar o texto.
     */
    const gerarMinuta = async () => {
        if (!originador?.id) { showAlert('Salve o originador antes de gerar a minuta.', 'warning'); return; }

        setGerandoMinuta(true);
        try {
            const editada = minutaEditada;

            if (editada) {
                setDraft(texto);
            } else {
                await lerOriginador();
                setDraft('');
            }

            // Só minuta escrita à mão é gravada. Guardar uma cópia do texto
            // automático congelaria o contrato: ele pararia de acompanhar os
            // campos, e apareceria "editada à mão" sem ninguém ter editado.
            const minutas = { ...(opts.minutas || {}) };
            if (editada) minutas.originador = texto;

            const { error } = await supabase.from('originators_v2')
                .update({ contract_terms: { ...condicoesParaGravar(), minutas } })
                .eq('id', originador.id);
            if (error) throw error;
            setOpts(prev => ({ ...prev, minutas }));

            await baixarPdfContratoOriginador(nomeArquivo('MINUTA'));

            showAlert(editada
                ? 'Minuta editada salva no originador e PDF baixado para análise.'
                : 'Minuta refeita com o cadastro atual e PDF baixado para análise.', 'success');
        } catch (e) {
            console.error('Erro ao gerar minuta do contrato de originação:', e);
            showAlert('Erro ao gerar a minuta: ' + e.message, 'error');
        } finally {
            setGerandoMinuta(false);
        }
    };

    /** Joga fora a minuta editada — a da tela e a gravada — e volta ao automático. */
    const descartarEdicoes = async () => {
        const minutas = { ...(opts.minutas || {}) };
        delete minutas.originador;
        setDraft('');
        setOpts(prev => ({ ...prev, minutas }));
        if (!originador?.id) return;
        const { error } = await supabase.from('originators_v2')
            .update({ contract_terms: { ...condicoesParaGravar(), minutas } })
            .eq('id', originador.id);
        if (error) console.error('Erro ao descartar a minuta salva:', error);
    };

    const mensagemContrato = (link) =>
        `Olá ${originador.name}, aqui é a B2W Energia. ⚡\n\n` +
        `Segue o seu Contrato de Originação e Indicação de Negócios para assinatura digital. 📄\n\n` +
        `${link}\n\n` +
        `Qualquer dúvida sobre as cláusulas, é só responder esta mensagem.`;

    /**
     * Dispara o link por WhatsApp e e-mail e devolve o resultado de cada canal.
     *
     * Cada canal falha por conta própria: e-mail recusado não pode impedir o
     * WhatsApp de sair, e nenhum dos dois invalida o contrato que já subiu
     * para a Autentique.
     */
    const enviarLink = async (link) => {
        const mensagem = mensagemContrato(link);
        const resultado = { whatsapp: null, email: null };

        if (!originador.phone) {
            resultado.whatsapp = 'não enviado (sem telefone cadastrado)';
        } else {
            try {
                let instanceName = 'default';
                const { data: config } = await supabase
                    .from('integrations_config')
                    .select('variables')
                    .eq('service_name', 'evolution_api')
                    .single();
                if (config?.variables?.instance_name) instanceName = config.variables.instance_name;

                await sendWhatsapp(originador.phone.replace(/\D/g, ''), mensagem, null, null, null, instanceName);
                resultado.whatsapp = 'enviado';
            } catch (waErr) {
                console.error('Erro ao enviar WhatsApp:', waErr);
                resultado.whatsapp = `falhou: ${waErr.message}`;
            }
        }

        if (!originador.email) {
            resultado.email = 'não enviado (sem e-mail cadastrado)';
        } else {
            try {
                // `functions.invoke` devolve o erro em `error`, não lança. Sem
                // checar isto, e-mail recusado passava como enviado.
                const { error } = await supabase.functions.invoke('send-email', {
                    body: {
                        to: originador.email,
                        subject: 'Contrato de Originação e Indicação de Negócios - B2W Energia',
                        text: mensagem
                    }
                });
                if (error) throw error;
                resultado.email = 'enviado';
            } catch (emailErr) {
                console.error('Erro ao enviar E-mail:', emailErr);
                resultado.email = `falhou: ${emailErr.message}`;
            }
        }

        return resultado;
    };

    const registrar = (acao, detalhes, conteudo) => {
        if (registrarHistorico && originador?.id) registrarHistorico('originator', originador.id, acao, detalhes, conteudo);
    };

    const enviarContrato = async () => {
        if (!originador?.id) { showAlert('Salve o originador antes de gerar o contrato.', 'warning'); return; }
        if (!originador.phone && !originador.email) {
            showAlert('Cadastre telefone ou e-mail do originador antes de enviar o contrato.', 'warning');
            return;
        }
        if (!originador.cpf_cnpj) {
            showAlert('Preencha o CPF/CNPJ do originador: ele qualifica a parte no contrato.', 'warning');
            return;
        }
        if (!modalidadesMarcadas.length) {
            showAlert('Marque ao menos uma frente de originação: o contrato precisa de objeto.', 'warning');
            return;
        }

        const invalidos = CAMPOS_PRAZOS
            .filter(campo => !Number.isFinite(paraNumero(opts[campo.key])))
            .map(campo => campo.label);
        if (invalidos.length) {
            showAlert(`Preencha com um número: ${invalidos.join(', ')}.`, 'warning');
            return;
        }

        setEnviando(true);
        try {
            // Congela o texto que está na tela para que o PDF capturado seja
            // exatamente o que foi revisado.
            const textoFinal = texto;
            setDraft(textoFinal);

            const pdfBase64 = await gerarPdfContratoOriginadorBase64();
            const fileName = nomeArquivo(Date.now());

            // O bloco de assinatura fica no fim do texto, então a marca vai na
            // última folha — que varia com o tamanho do contrato.
            const ultimaPagina = dividirEmPaginasOriginador(textoFinal).length;

            const result = await createAutentiqueDocument({
                documentName: fileName,
                fileBase64: pdfBase64,
                // Sem `email`: com e-mail a Autentique entrega por conta dela e
                // não devolve link público. Quem entrega o link somos nós.
                signers: [{ name: originador.name, action: 'SIGN', positions: [{ x: 50, y: 78, z: ultimaPagina }] }],
                signerId: originador.id,
                signerType: 'originador'
            });

            if (result.error) throw new Error(result.error);
            if (!result?.documentId) throw new Error('Falha ao criar documento na Autentique: ID não retornado.');
            if (result.signingLinkFound === false) {
                throw new Error('A Autentique não devolveu link de assinatura. O documento foi criado, mas o link não pode ser enviado — verifique no painel dela.');
            }

            let finalLink = result.url;
            try {
                const shortRes = await shortenLink(
                    result.url,
                    `originacao-${originador.id.substring(0, 5)}-${Date.now().toString().slice(-4)}`,
                    `Contrato de Originação - ${originador.name}`
                );
                if (shortRes.success && shortRes.shortUrl) finalLink = shortRes.shortUrl;
            } catch (shortErr) {
                console.warn('Falha ao encurtar link do contrato:', shortErr);
            }

            // As condições vão junto: o contrato que subiu para assinatura foi
            // montado com elas, e o banco não pode dizer outra coisa.
            await supabase.from('originators_v2')
                .update({ contract_terms: condicoesParaGravar() })
                .eq('id', originador.id);

            await supabase.from('signatures')
                .update({ short_url: finalLink, document_type: 'originacao' })
                .eq('autentique_doc_id', result.documentId);

            const envio = await enviarLink(finalLink);

            showAlert(
                algumCanalFalhou(envio)
                    ? `Contrato criado, mas houve falha no envio. ${resumoEnvio(envio)}`
                    : `Contrato gerado e enviado. ${resumoEnvio(envio)}`,
                algumCanalFalhou(envio) ? 'warning' : 'success'
            );
            lerOriginador();
            lerAssinaturas();
            registrar('envio_contrato', {
                document_name: fileName,
                autentique_doc_id: result.documentId,
                tipo: 'originacao',
                modalidades: modalidadesMarcadas.map(m => m.chave),
                envio
            }, `Contrato de Originação enviado para assinatura. ${resumoEnvio(envio)}`);
        } catch (error) {
            console.error('Erro ao enviar contrato de originação:', error);
            showAlert('Erro ao enviar contrato: ' + error.message, 'error');
        } finally {
            setEnviando(false);
        }
    };

    const cancelarContrato = async (sig) => {
        const ok = await showConfirm(
            'Cancelar este contrato na Autentique? O link de assinatura deixa de valer e o documento é removido de lá. Não dá para desfazer.',
            'Cancelar contrato'
        );
        if (!ok) return;

        setCancelando(sig.id);
        try {
            const res = await cancelAutentiqueDocument(sig.id);
            if (res?.error) throw new Error(res.error);
            showAlert(res?.jaCancelado ? 'Este contrato já estava cancelado.' : 'Contrato cancelado.', 'success');
            lerAssinaturas();
            registrar('cancelamento_contrato', { signature_id: sig.id, tipo: 'originacao' },
                'Contrato de Originação cancelado na Autentique.');
        } catch (error) {
            showAlert('Erro ao cancelar contrato: ' + error.message, 'error');
        } finally {
            setCancelando(null);
        }
    };

    const reenviarLink = async (sig) => {
        const ok = await showConfirm('Deseja reenviar o link de assinatura para o originador?', 'Reenviar Link');
        if (!ok) return;

        try {
            let finalLink = sig.short_url || sig.autentique_url;
            const envio = await enviarLink(finalLink);
            showAlert(
                algumCanalFalhou(envio) ? `Falha no reenvio. ${resumoEnvio(envio)}` : `Link reenviado. ${resumoEnvio(envio)}`,
                algumCanalFalhou(envio) ? 'warning' : 'success'
            );
            registrar('reenvio_contrato', { signature_id: sig.id, envio },
                `Link de assinatura reenviado. ${resumoEnvio(envio)}`);
        } catch (error) {
            showAlert('Erro ao reenviar link: ' + error.message, 'error');
        }
    };

    if (!originadorId) {
        return (
            <div style={{ ...cartao, display: 'flex', gap: '0.5rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a' }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                Salve o originador para gerar o Contrato de Originação.
            </div>
        );
    }

    if (carregando && !originador) {
        return <div style={{ ...cartao, color: '#94a3b8', fontSize: '0.9rem' }}>Carregando...</div>;
    }

    if (!originador) {
        return <div style={{ ...cartao, color: '#b91c1c', fontSize: '0.9rem' }}>Originador não encontrado.</div>;
    }

    const ocupado = gerandoMinuta || enviando;
    const split = originador.split_commission || {};

    return (
        <>
            <div style={cartao}>
                <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                    <FileSignature size={20} color="#3b82f6" /> Frentes de originação
                </h4>
                <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#64748b' }}>
                    O que estiver marcado entra no objeto do contrato (Cláusula 1) e ganha a regra própria da Cláusula 9.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    {MODALIDADES_ORIGINACAO.map(m => (
                        <label
                            key={m.chave}
                            style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.85rem 1rem', border: `1px solid ${opts[m.chave] ? '#bfdbfe' : '#e2e8f0'}`, background: opts[m.chave] ? '#eff6ff' : 'white', borderRadius: '12px', cursor: 'pointer' }}
                        >
                            <input
                                type="checkbox"
                                checked={!!opts[m.chave]}
                                onChange={e => { setOpts({ ...opts, [m.chave]: e.target.checked }); setDraft(''); }}
                                style={{ marginTop: '0.2rem' }}
                            />
                            <span>
                                <span style={{ display: 'block', fontWeight: 700, fontSize: '0.88rem', color: '#1e293b' }}>{m.rotulo}</span>
                                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{m.resumo}</span>
                            </span>
                        </label>
                    ))}
                </div>

                <div style={{ marginTop: '1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                    {CAMPOS_PRAZOS.map(campo => (
                        <div key={campo.key}>
                            <label style={rotuloCampo}>{campo.label}</label>
                            <input
                                // Texto, e não `type="number"`: o campo de número recusa a
                                // vírgula do teclado brasileiro.
                                type="text"
                                inputMode="decimal"
                                style={estiloCampo}
                                value={opts[campo.key] ?? ''}
                                onChange={e => {
                                    setOpts({ ...opts, [campo.key]: e.target.value.replace(/[^\d.,]/g, '') });
                                    setDraft('');
                                }}
                            />
                        </div>
                    ))}
                    <div>
                        <label style={rotuloCampo}>Foro</label>
                        <input
                            type="text"
                            style={estiloCampo}
                            value={opts.foro ?? ''}
                            onChange={e => { setOpts({ ...opts, foro: e.target.value }); setDraft(''); }}
                        />
                    </div>
                </div>

                <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', fontSize: '0.83rem', color: '#0369a1' }}>
                    O Anexo I do contrato sai do cadastro: Start de {numeroBr(paraNumero(split.start) || 0)}% e Recorrência de {numeroBr(paraNumero(split.recurrent) || 0)}% (aba Financeiro),
                    cargo {originador.cargo || 'ppf'}{lider ? `, Líder ${lider.name}` : ', sem Líder vinculado'}.
                    Para mudar os percentuais, mude no cadastro — o contrato não os edita, porque é o cadastro que o motor do split lê na hora de pagar.
                </div>
            </div>

            <div style={cartao}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b', flexWrap: 'wrap' }}>
                        Minuta
                        {minutaEditada && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.6rem', borderRadius: '999px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '0.72rem', fontWeight: 700 }}>
                                <AlertCircle size={13} /> editada à mão, não acompanha os campos
                            </span>
                        )}
                    </h4>
                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                        {minutaEditada && (
                            <button type="button" onClick={descartarEdicoes} style={{ padding: '0.6rem 1rem', background: 'white', color: '#92400e', border: '1px solid #fde68a', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>
                                Descartar edições
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={ocupado}
                            onClick={gerarMinuta}
                            title="Salva a minuta como ela está na tela e baixa o PDF para análise"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.6rem 1rem', background: 'white', color: '#3b82f6', border: '1px solid #bfdbfe', borderRadius: '10px', fontWeight: 600, cursor: ocupado ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: ocupado ? 0.6 : 1 }}
                        >
                            {gerandoMinuta ? <><Loader2 size={15} className="spin-animation" /> Gerando...</> : <><RefreshCcw size={15} /> Gerar minuta (salva e baixa PDF)</>}
                        </button>
                        <button
                            type="button"
                            disabled={ocupado}
                            onClick={enviarContrato}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', background: ocupado ? '#94a3b8' : '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: ocupado ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                        >
                            {enviando ? <><Loader2 size={16} className="spin-animation" /> Enviando...</> : <><Send size={16} /> Gerar e enviar para assinatura</>}
                        </button>
                    </div>
                </div>

                <textarea
                    value={texto}
                    onChange={e => setDraft(e.target.value)}
                    spellCheck={false}
                    style={{ width: '100%', minHeight: '340px', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem', lineHeight: 1.6, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                />
                <p style={{ margin: '0.6rem 0 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                    O texto acima é o que será impresso no PDF enviado à Autentique. Marcar uma frente ou alterar um prazo remonta a minuta.
                </p>
            </div>

            <div style={cartao}>
                <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                    <History size={20} color="#3b82f6" /> Contratos enviados
                </h4>

                {signatures.length === 0 ? (
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Nenhum contrato de originação enviado para assinatura.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {signatures.map(sig => {
                            const cor = sig.status === 'signed' ? '#16a34a'
                                : sig.status === 'rejected' || sig.status === 'canceled' ? '#dc2626'
                                    : '#d97706';
                            const Icone = sig.status === 'signed' ? CheckCircle
                                : sig.status === 'pending' ? Clock : AlertCircle;
                            return (
                                <div key={sig.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.9rem 1rem', border: '1px solid #f1f5f9', borderRadius: '12px', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                                        <Icone size={18} color={cor} />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {sig.document_name || 'Contrato de Originação'}
                                            </div>
                                            <div style={{ fontSize: '0.78rem', color: cor, fontWeight: 600 }}>
                                                {sig.status === 'signed' ? 'Assinado'
                                                    : sig.status === 'pending' ? 'Aguardando assinatura'
                                                        : sig.status === 'rejected' ? 'Recusado' : 'Cancelado'}
                                                {' · '}
                                                {new Date(sig.created_at).toLocaleDateString('pt-BR')}
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <a
                                            href={sig.short_url || sig.autentique_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: '10px', color: '#3b82f6', textDecoration: 'none', fontSize: '0.8rem', fontWeight: 600 }}
                                        >
                                            <ExternalLink size={14} /> Abrir
                                        </a>
                                        {sig.status === 'pending' && (
                                            <button
                                                type="button"
                                                onClick={() => reenviarLink(sig)}
                                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: '10px', background: 'white', color: '#64748b', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                                            >
                                                <Send size={14} /> Reenviar
                                            </button>
                                        )}
                                        {sig.status === 'pending' && (
                                            <button
                                                type="button"
                                                disabled={cancelando === sig.id}
                                                onClick={() => cancelarContrato(sig)}
                                                title="Cancela na Autentique e invalida o link"
                                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.8rem', border: '1px solid #fecaca', borderRadius: '10px', background: '#fef2f2', color: '#b91c1c', cursor: cancelando === sig.id ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                                            >
                                                {cancelando === sig.id
                                                    ? <><Loader2 size={14} className="spin-animation" /> Cancelando...</>
                                                    : <><Ban size={14} /> Cancelar</>}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/*
              Folhas do contrato, fora da tela, prontas para o html2canvas.
              Montadas só durante a geração do PDF. O gerador espera 1500ms
              antes de varrer o DOM, tempo de sobra para o React montar isto.
            */}
            {ocupado && <ContratoOriginador texto={texto} branding={branding} />}
        </>
    );
}
