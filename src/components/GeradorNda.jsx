import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { useBranding } from '../contexts/BrandingContext';
import { createAutentiqueDocument, cancelAutentiqueDocument, shortenLink, sendWhatsapp } from '../lib/api';
import { normalizePhoneDdi } from '../lib/validators';
import {
    AlertCircle, Ban, CheckCircle, Clock, ExternalLink, FileLock2,
    Loader2, RefreshCcw, Send
} from 'lucide-react';
import ContratoNda from './ContratoNda';
import {
    baixarPdfNda, DEFAULTS_NDA, dividirEmPaginasNda, gerarPdfNdaBase64, MODELOS_NDA, montarTextoNda
} from '../lib/contratoNda';
import { numeroBr, paraNumero, rotuloDocumento } from '../lib/contratoBase';

/**
 * Gerador de NDA / Termo de Confidencialidade no modal do lead (aba
 * Comunicados).
 *
 * Mesma mecânica dos contratos do originador e da gestão: minuta editável,
 * gravada só quando editada à mão (`leads.contract_terms.nda.minuta`),
 * PDF pela FolhaContrato, assinatura pela Autentique com o link entregue
 * por nós via WhatsApp (Evolution) e e-mail.
 *
 * A assinatura fica em `signatures` com signer_type='lead' e
 * document_type='nda'. O webhook só carimba o status: NDA assinado não
 * mexe no status do lead.
 */

const CAMPOS_NUMERICOS = [
    { key: 'prazoSigiloAnos', label: 'Prazo do sigilo (anos)' },
    { key: 'naoConcorrenciaAnos', label: 'Não concorrência (anos, 0 = sem)' },
    { key: 'devolucaoDias', label: 'Devolução do material (dias)' }
];

const paraTela = (termos) => {
    const tela = { ...DEFAULTS_NDA, ...(termos || {}) };
    for (const chave of Object.keys(tela)) {
        if (typeof tela[chave] === 'number') tela[chave] = numeroBr(tela[chave]);
    }
    return tela;
};

const cartao = { background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' };
const rotuloCampo = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' };
const estiloCampo = { width: '100%', padding: '0.6rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box', background: 'white' };

const resumoEnvio = (envio) => `WhatsApp: ${envio.whatsapp} · E-mail: ${envio.email}`;
const algumCanalFalhou = (envio) =>
    String(envio.whatsapp).startsWith('falhou') || String(envio.email).startsWith('falhou');

export default function GeradorNda({ leadId, addHistory }) {
    const { showAlert, showConfirm } = useUI();
    const { branding } = useBranding();

    const [lead, setLead] = useState(null);
    const [signatures, setSignatures] = useState([]);
    const [opts, setOpts] = useState(paraTela());
    const [minutaSalva, setMinutaSalva] = useState('');
    const [draft, setDraft] = useState('');
    const [gerandoMinuta, setGerandoMinuta] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [cancelando, setCancelando] = useState(null);

    const lerLead = useCallback(async () => {
        const { data, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
        if (error) throw error;
        setLead(data);
        return data;
    }, [leadId]);

    const lerAssinaturas = useCallback(async () => {
        const { data, error } = await supabase
            .from('signatures')
            .select('*')
            .eq('signer_id', leadId)
            .eq('signer_type', 'lead')
            .eq('document_type', 'nda')
            .order('created_at', { ascending: false });
        if (error) throw error;
        setSignatures(data || []);
    }, [leadId]);

    useEffect(() => {
        if (!leadId) return undefined;
        let cancelado = false;
        (async () => {
            try {
                const [l] = await Promise.all([lerLead(), lerAssinaturas()]);
                if (cancelado) return;
                const { minuta, ...campos } = l?.contract_terms?.nda || {};
                setOpts(paraTela(campos));
                setMinutaSalva(minuta || '');
                setDraft('');
            } catch (e) {
                console.error('Erro ao carregar o NDA do lead:', e);
                if (!cancelado) showAlert('Erro ao carregar o NDA: ' + e.message, 'error');
            }
        })();
        return () => { cancelado = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leadId]);

    const textoGerado = useMemo(() => (lead ? montarTextoNda(lead, opts) : ''), [lead, opts]);

    // O que está sendo digitado, depois a minuta gravada, por último o automático.
    const texto = draft || minutaSalva || textoGerado;
    const minutaEditada = texto !== textoGerado;
    const ehPJ = rotuloDocumento(lead?.cpf_cnpj) === 'CNPJ';
    const modelo = MODELOS_NDA[opts.modelo] || MODELOS_NDA.investidor;

    const mudar = (chave, valor) => { setOpts(prev => ({ ...prev, [chave]: valor })); setDraft(''); };

    const camposParaGravar = (minuta) => {
        const gravar = {};
        for (const chave of ['modelo', 'nacionalidade', 'nascimento', 'representante', 'representanteCpf', 'foro', 'cidade']) {
            if (String(opts[chave] ?? '').trim()) gravar[chave] = opts[chave];
        }
        for (const campo of CAMPOS_NUMERICOS) {
            const n = paraNumero(opts[campo.key]);
            if (Number.isFinite(n)) gravar[campo.key] = n;
        }
        if (minuta) gravar.minuta = minuta;
        return gravar;
    };

    // Reescreve só a chave `nda`: outros termos que o lead venha a ter em
    // `contract_terms` não podem ser apagados por este painel.
    const gravarTermos = async (minuta) => {
        const termos = { ...(lead?.contract_terms || {}), nda: camposParaGravar(minuta) };
        const { error } = await supabase.from('leads').update({ contract_terms: termos }).eq('id', lead.id);
        if (error) throw error;
        setLead(prev => ({ ...prev, contract_terms: termos }));
    };

    const nomeArquivo = (sufixo) => `NDA_${(lead?.name || 'lead').replace(/\s+/g, '_')}_${sufixo}.pdf`;

    const gerarMinuta = async () => {
        setGerandoMinuta(true);
        try {
            const editada = minutaEditada;
            if (editada) {
                setDraft(texto);
            } else {
                await lerLead();
                setDraft('');
            }
            // Só minuta escrita à mão é gravada; a automática acompanha os campos.
            await gravarTermos(editada ? texto : '');
            setMinutaSalva(editada ? texto : '');

            await baixarPdfNda(nomeArquivo('MINUTA'));
            showAlert(editada
                ? 'Minuta editada salva no lead e PDF baixado para análise.'
                : 'Minuta refeita com o cadastro atual e PDF baixado para análise.', 'success');
        } catch (e) {
            console.error('Erro ao gerar a minuta do NDA:', e);
            showAlert('Erro ao gerar a minuta: ' + e.message, 'error');
        } finally {
            setGerandoMinuta(false);
        }
    };

    const descartarEdicoes = async () => {
        setDraft('');
        setMinutaSalva('');
        try { await gravarTermos(''); } catch (e) { console.error('Erro ao descartar a minuta do NDA:', e); }
    };

    const mensagem = (link) =>
        `Olá ${lead.name}, aqui é a B2W Energia. ⚡\n\n` +
        `Segue o ${modelo.rotulo.startsWith('NDA') ? 'Termo de Confidencialidade e Não Divulgação (NDA)' : 'Termo de Confidencialidade'} para assinatura digital. 📄\n\n` +
        `${link}\n\n` +
        `Qualquer dúvida sobre as cláusulas, é só responder esta mensagem.`;

    /** Cada canal falha por conta própria; nenhum invalida o documento já criado. */
    const enviarLink = async (link) => {
        const texto = mensagem(link);
        const resultado = { whatsapp: null, email: null };

        if (!lead.phone) {
            resultado.whatsapp = 'não enviado (sem telefone cadastrado)';
        } else {
            try {
                let instanceName = 'default';
                const { data: config } = await supabase
                    .from('integrations_config').select('variables').eq('service_name', 'evolution_api').single();
                if (config?.variables?.instance_name) instanceName = config.variables.instance_name;
                await sendWhatsapp(normalizePhoneDdi(lead.phone), texto, null, null, null, instanceName);
                resultado.whatsapp = 'enviado';
            } catch (waErr) {
                console.error('Erro ao enviar WhatsApp do NDA:', waErr);
                resultado.whatsapp = `falhou: ${waErr.message}`;
            }
        }

        if (!lead.email) {
            resultado.email = 'não enviado (sem e-mail cadastrado)';
        } else {
            try {
                const { error } = await supabase.functions.invoke('send-email', {
                    body: { to: lead.email, subject: `${TITULO_EMAIL} - B2W Energia`, text: texto }
                });
                if (error) throw error;
                resultado.email = 'enviado';
            } catch (emailErr) {
                console.error('Erro ao enviar e-mail do NDA:', emailErr);
                resultado.email = `falhou: ${emailErr.message}`;
            }
        }
        return resultado;
    };

    const registrar = (acao, detalhes, conteudo) => {
        if (addHistory && lead?.id) addHistory('lead', lead.id, acao, detalhes, conteudo);
    };

    const enviarParaAssinatura = async () => {
        if (!lead.name?.trim()) { showAlert('Preencha o nome do lead: ele assina o termo.', 'warning'); return; }
        if (!lead.cpf_cnpj) { showAlert('Preencha o CPF/CNPJ do lead (aba de dados) e salve: ele qualifica a parte no termo.', 'warning'); return; }
        if (!lead.phone && !lead.email) { showAlert('Cadastre telefone ou e-mail do lead antes de enviar.', 'warning'); return; }
        if (ehPJ && (!String(opts.representante || '').trim() || !String(opts.representanteCpf || '').trim())) {
            showAlert('Lead com CNPJ: preencha o representante legal e o CPF dele.', 'warning');
            return;
        }
        const ok = await showConfirm(
            `Enviar o termo para ${lead.name} assinar na Autentique? O link vai por WhatsApp e e-mail.`,
            'Enviar NDA'
        );
        if (!ok) return;

        setEnviando(true);
        try {
            const textoFinal = texto;
            setDraft(textoFinal);

            const pdfBase64 = await gerarPdfNdaBase64();
            const fileName = nomeArquivo(Date.now());
            const ultimaPagina = dividirEmPaginasNda(textoFinal).length;

            const result = await createAutentiqueDocument({
                documentName: fileName,
                fileBase64: pdfBase64,
                // Sem e-mail: a Autentique devolve o link e nós o entregamos.
                signers: [{ name: lead.name, action: 'SIGN', positions: [{ x: 50, y: 78, z: ultimaPagina }] }],
                signerId: lead.id,
                signerType: 'lead'
            });
            if (result.error) throw new Error(result.error);
            if (!result?.documentId) throw new Error('Falha ao criar documento na Autentique: ID não retornado.');
            if (result.signingLinkFound === false) {
                throw new Error('A Autentique não devolveu link de assinatura. O documento foi criado, mas o link não pode ser enviado — verifique no painel dela.');
            }

            let finalLink = result.url;
            try {
                const curto = await shortenLink(
                    result.url,
                    `nda-${lead.id.substring(0, 5)}-${Date.now().toString().slice(-4)}`,
                    `NDA - ${lead.name}`
                );
                if (curto.success && curto.shortUrl) finalLink = curto.shortUrl;
            } catch (e) {
                console.warn('Falha ao encurtar link do NDA:', e);
            }

            await supabase.from('signatures')
                .update({ short_url: finalLink, document_type: 'nda' })
                .eq('autentique_doc_id', result.documentId);

            // O que foi assinado tem de ficar gravado como foi enviado.
            await gravarTermos(minutaEditada ? textoFinal : '');

            const envio = await enviarLink(finalLink);
            showAlert(
                algumCanalFalhou(envio)
                    ? `NDA criado, mas houve falha no envio. ${resumoEnvio(envio)}`
                    : `NDA gerado e enviado. ${resumoEnvio(envio)}`,
                algumCanalFalhou(envio) ? 'warning' : 'success'
            );
            lerAssinaturas();
            registrar('envio_nda', {
                document_name: fileName, autentique_doc_id: result.documentId, modelo: opts.modelo, envio
            }, `${modelo.rotulo} enviado para assinatura. ${resumoEnvio(envio)}`);
        } catch (error) {
            console.error('Erro ao enviar o NDA:', error);
            showAlert('Erro ao enviar o NDA: ' + error.message, 'error');
        } finally {
            setEnviando(false);
        }
    };

    const cancelar = async (sig) => {
        const ok = await showConfirm(
            'Cancelar este termo na Autentique? O link de assinatura deixa de valer e o documento é removido de lá. Não dá para desfazer.',
            'Cancelar NDA'
        );
        if (!ok) return;
        setCancelando(sig.id);
        try {
            const res = await cancelAutentiqueDocument(sig.id);
            if (res?.error) throw new Error(res.error);
            showAlert(res?.jaCancelado ? 'Este termo já estava cancelado.' : 'Termo cancelado.', 'success');
            lerAssinaturas();
            registrar('cancelamento_nda', { signature_id: sig.id }, 'NDA cancelado na Autentique.');
        } catch (error) {
            showAlert('Erro ao cancelar: ' + error.message, 'error');
        } finally {
            setCancelando(null);
        }
    };

    const reenviar = async (sig) => {
        const ok = await showConfirm('Reenviar o link de assinatura por WhatsApp e e-mail?', 'Reenviar link');
        if (!ok) return;
        try {
            const envio = await enviarLink(sig.short_url || sig.autentique_url);
            showAlert(
                algumCanalFalhou(envio) ? `Falha no reenvio. ${resumoEnvio(envio)}` : `Link reenviado. ${resumoEnvio(envio)}`,
                algumCanalFalhou(envio) ? 'warning' : 'success'
            );
            registrar('reenvio_nda', { signature_id: sig.id, envio }, `Link do NDA reenviado. ${resumoEnvio(envio)}`);
        } catch (error) {
            showAlert('Erro ao reenviar: ' + error.message, 'error');
        }
    };

    if (!leadId) {
        return (
            <div style={{ ...cartao, display: 'flex', gap: '0.5rem', color: '#92400e', background: '#fffbeb', borderColor: '#fde68a' }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} /> Salve o lead para gerar NDA e termos de confidencialidade.
            </div>
        );
    }
    if (!lead) return <div style={{ ...cartao, color: '#94a3b8', fontSize: '0.9rem' }}>Carregando gerador de documentos...</div>;

    const ocupado = gerandoMinuta || enviando;
    const botao = (cor, borda) => ({ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.6rem 1rem', background: 'white', color: cor, border: `1px solid ${borda}`, borderRadius: '8px', fontWeight: 600, cursor: ocupado ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: ocupado ? 0.6 : 1 });

    return (
        <div style={cartao}>
            <h4 style={{ margin: '0 0 0.35rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                <FileLock2 size={18} style={{ color: '#3b82f6' }} /> Gerador de documentos — NDA e Termo de Confidencialidade
            </h4>
            <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#64748b' }}>
                Nome, CPF/CNPJ, cidade e e-mail vêm do cadastro do lead. Assinatura pela Autentique; o link vai por WhatsApp e e-mail.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.85rem' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                    <label style={rotuloCampo}>Modelo</label>
                    <select
                        style={estiloCampo}
                        value={opts.modelo}
                        onChange={e => {
                            const m = MODELOS_NDA[e.target.value];
                            setOpts(prev => ({ ...prev, modelo: e.target.value, naoConcorrenciaAnos: numeroBr(m.naoConcorrenciaAnos) }));
                            setDraft('');
                        }}
                    >
                        {Object.entries(MODELOS_NDA).map(([chave, m]) => <option key={chave} value={chave}>{m.rotulo}</option>)}
                    </select>
                </div>

                {ehPJ ? (
                    <>
                        <div>
                            <label style={rotuloCampo}>Representante legal</label>
                            <input style={estiloCampo} value={opts.representante ?? ''} onChange={e => mudar('representante', e.target.value)} />
                        </div>
                        <div>
                            <label style={rotuloCampo}>CPF do representante</label>
                            <input style={estiloCampo} value={opts.representanteCpf ?? ''} onChange={e => mudar('representanteCpf', e.target.value)} />
                        </div>
                    </>
                ) : (
                    <>
                        <div>
                            <label style={rotuloCampo}>Nacionalidade</label>
                            <input style={estiloCampo} value={opts.nacionalidade ?? ''} onChange={e => mudar('nacionalidade', e.target.value)} />
                        </div>
                        <div>
                            <label style={rotuloCampo}>Nascimento (opcional)</label>
                            <input style={estiloCampo} placeholder="dd/mm/aaaa" value={opts.nascimento ?? ''} onChange={e => mudar('nascimento', e.target.value)} />
                        </div>
                    </>
                )}

                {CAMPOS_NUMERICOS.map(campo => (
                    <div key={campo.key}>
                        <label style={rotuloCampo}>{campo.label}</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            style={estiloCampo}
                            value={opts[campo.key] ?? ''}
                            onChange={e => mudar(campo.key, e.target.value.replace(/\D/g, ''))}
                        />
                    </div>
                ))}
                <div>
                    <label style={rotuloCampo}>Foro (comarca)</label>
                    <input style={estiloCampo} value={opts.foro ?? ''} onChange={e => mudar('foro', e.target.value)} />
                </div>
                <div>
                    <label style={rotuloCampo}>Local da assinatura</label>
                    <input style={estiloCampo} value={opts.cidade ?? ''} onChange={e => mudar('cidade', e.target.value)} />
                </div>
            </div>

            {!lead.cpf_cnpj && (
                <div style={{ marginTop: '0.85rem', padding: '0.7rem 0.9rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '0.8rem', color: '#92400e', display: 'flex', gap: '0.5rem' }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} /> Lead sem CPF/CNPJ salvo: o termo sai com lacuna e não pode ser enviado.
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1.25rem 0 0.6rem', flexWrap: 'wrap', gap: '0.6rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    Minuta
                    {minutaEditada && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.55rem', borderRadius: '999px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '0.7rem', fontWeight: 700 }}>
                            <AlertCircle size={12} /> editada à mão, não acompanha os campos
                        </span>
                    )}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {minutaEditada && (
                        <button type="button" onClick={descartarEdicoes} style={botao('#92400e', '#fde68a')}>Descartar edições</button>
                    )}
                    <button type="button" disabled={ocupado} onClick={gerarMinuta} title="Salva a minuta como está e baixa o PDF" style={botao('#3b82f6', '#bfdbfe')}>
                        {gerandoMinuta ? <><Loader2 size={15} className="spin-animation" /> Gerando...</> : <><RefreshCcw size={15} /> Gerar minuta (salva e baixa PDF)</>}
                    </button>
                    <button
                        type="button"
                        disabled={ocupado}
                        onClick={enviarParaAssinatura}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.6rem 1.1rem', background: ocupado ? '#94a3b8' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: ocupado ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                    >
                        {enviando ? <><Loader2 size={15} className="spin-animation" /> Enviando...</> : <><Send size={15} /> Enviar para assinatura</>}
                    </button>
                </div>
            </div>

            <textarea
                value={texto}
                onChange={e => setDraft(e.target.value)}
                spellCheck={false}
                style={{ width: '100%', minHeight: '300px', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem', lineHeight: 1.6, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />

            <div style={{ marginTop: '1.25rem' }}>
                <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', marginBottom: '0.6rem' }}>Termos enviados</div>
                {signatures.length === 0 ? (
                    <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>Nenhum NDA enviado para este lead.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {signatures.map(sig => {
                            const cor = sig.status === 'signed' ? '#16a34a'
                                : sig.status === 'rejected' || sig.status === 'canceled' ? '#dc2626' : '#d97706';
                            const Icone = sig.status === 'signed' ? CheckCircle : sig.status === 'pending' ? Clock : AlertCircle;
                            return (
                                <div key={sig.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.75rem 0.9rem', border: '1px solid #f1f5f9', borderRadius: '10px', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                                        <Icone size={18} color={cor} />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {sig.document_name || 'NDA'}
                                            </div>
                                            <div style={{ fontSize: '0.76rem', color: cor, fontWeight: 600 }}>
                                                {sig.status === 'signed' ? 'Assinado' : sig.status === 'pending' ? 'Aguardando assinatura' : sig.status === 'rejected' ? 'Recusado' : 'Cancelado'}
                                                {' · '}{new Date(sig.created_at).toLocaleDateString('pt-BR')}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.45rem' }}>
                                        <a href={sig.short_url || sig.autentique_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#3b82f6', textDecoration: 'none', fontSize: '0.78rem', fontWeight: 600 }}>
                                            <ExternalLink size={13} /> Abrir
                                        </a>
                                        {sig.status === 'pending' && (
                                            <button type="button" onClick={() => reenviar(sig)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', color: '#64748b', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                                                <Send size={13} /> Reenviar
                                            </button>
                                        )}
                                        {sig.status === 'pending' && (
                                            <button type="button" disabled={cancelando === sig.id} onClick={() => cancelar(sig)} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.75rem', border: '1px solid #fecaca', borderRadius: '8px', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                                                {cancelando === sig.id ? <><Loader2 size={13} className="spin-animation" /> Cancelando...</> : <><Ban size={13} /> Cancelar</>}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {ocupado && <ContratoNda texto={texto} branding={branding} />}
        </div>
    );
}

const TITULO_EMAIL = 'Termo de Confidencialidade e Não Divulgação';
