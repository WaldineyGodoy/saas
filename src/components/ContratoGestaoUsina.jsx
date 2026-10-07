import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { useBranding } from '../contexts/BrandingContext';
import { createAutentiqueDocument, cancelAutentiqueDocument, shortenLink, sendWhatsapp } from '../lib/api';
import {
    AlertCircle, Ban, CheckCircle, Clock, Copy, ExternalLink, FileSignature,
    History, Loader2, RefreshCcw, Send, Zap
} from 'lucide-react';
import ContratoFornecedor from './ContratoFornecedor';
import {
    baixarPdfContratoFornecedor, DEFAULTS_FORNECEDOR, dividirEmPaginasFornecedor,
    gerarPdfContratoFornecedorBase64, montarTextoContratoFornecedor
} from '../lib/contratoFornecedor';
import { numeroBr, paraNumero } from '../lib/contratoBase';

/**
 * Contrato de Administração e Gestão de Créditos Energéticos, na aba
 * Contratos da usina.
 *
 * Morava no cadastro do fornecedor. Mudou de lugar, não de natureza: o
 * contrato continua sendo DO FORNECEDOR. As condições comerciais ficam em
 * `suppliers.contract_terms` (a minuta editada à mão em
 * `contract_terms.minutas.gestao`), a assinatura é do fornecedor e o
 * Anexo II lista todas as usinas dele. Por isso o painel carrega o
 * fornecedor da usina por conta própria, em vez de depender do estado do
 * PowerPlantModal: o que ele grava é o registro do fornecedor, e quem abre
 * qualquer usina do mesmo fornecedor enxerga o mesmo contrato.
 *
 * A data de assinatura (`suppliers.contrato_assinado_em`) segue vindo do
 * webhook da Autentique, que reconhece este contrato por
 * `signatures.document_type = 'gestao'`.
 */

/**
 * Condições comerciais do contrato de gestão.
 *
 * A validação de envio e o formulário usam a mesma lista: duas cópias é
 * como um campo novo entra na tela sem entrar na checagem.
 */
const CAMPOS_CONDICOES = [
    { key: 'desconto', label: 'Desconto ao consumidor (%)' },
    { key: 'percentualRecorrente', label: 'Remuneração recorrente (%)' },
    { key: 'taxaAdmin', label: 'Taxa de administração (R$)' },
    { key: 'taxaRecuperacao', label: 'Taxa de recuperação (%)' },
    { key: 'diaCorte', label: 'Dia de corte' },
    { key: 'diaRepasse', label: 'Dia do repasse' },
    { key: 'prazoTransferencia', label: 'Prazo de transferência (dias)' },
    { key: 'prazoHonorarios', label: 'Prazo de honorários (dias)' }
];

/**
 * Condições vindas do banco no formato da tela.
 *
 * O jsonb guarda número (17.5) e os campos são texto em pt-BR; sem esta
 * conversão o desconto aparecia como "17.5", com ponto, para quem digita
 * com vírgula.
 */
const condicoesParaTela = (termos) => {
    const tela = { ...DEFAULTS_FORNECEDOR, ...(termos || {}) };
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

export default function ContratoGestaoUsina({ usina, supplierId, registrarHistorico }) {
    const { showAlert, showConfirm } = useUI();
    const { branding } = useBranding();

    const [supplier, setSupplier] = useState(null);
    const [usinas, setUsinas] = useState([]);
    const [signatures, setSignatures] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [opts, setOpts] = useState(DEFAULTS_FORNECEDOR);
    // Rascunho editável: o texto gerado pode ser ajustado antes de subir.
    const [draft, setDraft] = useState('');
    const [gerandoMinuta, setGerandoMinuta] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [cancelando, setCancelando] = useState(null);

    const lerFornecedor = useCallback(async () => {
        const { data, error } = await supabase.from('suppliers').select('*').eq('id', supplierId).maybeSingle();
        if (error) throw error;
        setSupplier(data);
        return data;
    }, [supplierId]);

    // O Anexo II lista as usinas do contrato, então precisamos de mais que
    // id/name/status: sem UC geradora e potência o anexo sai vazio.
    const lerUsinas = useCallback(async () => {
        const { data, error } = await supabase
            .from('usinas')
            .select('id, name, status, unidade_geradora, potencia_kwp, concessionaria, modalidade_gd, gestao_percentual, address')
            .eq('supplier_id', supplierId);
        if (error) throw error;
        setUsinas(data || []);
        return data || [];
    }, [supplierId]);

    // Só os contratos de gestão. Os de Compra e Venda, Arrendamento e O&M
    // também têm o fornecedor como signatário, mas aparecem na lista da
    // usina a que pertencem. Contrato sem tipo e sem usina é anterior à
    // marcação de `document_type` e era sempre o de gestão.
    const lerAssinaturas = useCallback(async () => {
        const { data, error } = await supabase
            .from('signatures')
            .select('*')
            .eq('signer_id', supplierId)
            .eq('signer_type', 'supplier')
            .or('document_type.eq.gestao,and(document_type.is.null,usina_id.is.null)')
            .order('created_at', { ascending: false });
        if (error) throw error;
        setSignatures(data || []);
        return data || [];
    }, [supplierId]);

    useEffect(() => {
        if (!supplierId) {
            setSupplier(null); setUsinas([]); setSignatures([]);
            return undefined;
        }
        let cancelado = false;
        (async () => {
            setCarregando(true);
            try {
                const [forn, lista] = await Promise.all([lerFornecedor(), lerUsinas(), lerAssinaturas()]);
                if (cancelado) return;

                // Condições gravadas mandam sobre o padrão. A Remuneração
                // Recorrente do contrato é a mesma taxa de gestão cadastrada
                // na usina, e digitá-la de novo é como o contrato e o
                // fechamento mensal acabam divergindo — mas só como
                // sugestão: valor já gravado no fornecedor vence.
                const tela = condicoesParaTela(forn?.contract_terms);
                const gestao = Number((lista.find(u => u.id === usina?.id) || lista[0])?.gestao_percentual);
                if (gestao > 0 && forn?.contract_terms?.percentualRecorrente === undefined) {
                    tela.percentualRecorrente = numeroBr(gestao);
                }
                setOpts(tela);
                setDraft('');
            } catch (e) {
                console.error('Erro ao carregar o contrato de gestão:', e);
                if (!cancelado) showAlert('Erro ao carregar o contrato de gestão: ' + e.message, 'error');
            } finally {
                if (!cancelado) setCarregando(false);
            }
        })();
        return () => { cancelado = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supplierId, usina?.id]);

    // Memoizado porque cada tecla digitada chega aqui, e remontar 16 mil
    // caracteres a cada uma não tem por quê.
    const textoGerado = useMemo(
        () => (supplier ? montarTextoContratoFornecedor(supplier, usinas, opts) : ''),
        [supplier, usinas, opts]
    );

    // Ordem de precedência: o que está sendo digitado agora, depois a minuta
    // gravada, e por último o texto montado a partir dos campos.
    const minutaSalva = (opts.minutas || {}).gestao || '';
    const texto = draft || minutaSalva || textoGerado;

    // A minuta na tela não é mais a que os campos produzem. Enquanto durar,
    // ela ignora os campos — e sem aviso isso se parece com "o campo não salvou".
    const minutaEditada = texto !== textoGerado;

    /**
     * Condições no formato que vai para o banco.
     *
     * Os campos são texto para aceitar a vírgula, então "17,5" precisa virar
     * 17.5 antes de gravar. Campo ilegível não é gravado: o gerador cai no
     * padrão.
     */
    const condicoesParaGravar = () => {
        const gravar = { foro: opts.foro };
        for (const campo of CAMPOS_CONDICOES) {
            const n = paraNumero(opts[campo.key]);
            if (Number.isFinite(n)) gravar[campo.key] = n;
        }
        // A minuta editada à mão não está em CAMPOS_CONDICOES e seria apagada
        // por quem reescreve `contract_terms` inteiro.
        if (opts.minutas && Object.keys(opts.minutas).length) gravar.minutas = opts.minutas;
        return gravar;
    };

    const nomeArquivo = (sufixo) =>
        `Contrato_Gestao_${(supplier?.name || 'fornecedor').replace(/\s+/g, '_')}_${sufixo}.pdf`;

    /**
     * Grava a minuta como ela está na tela e baixa o PDF.
     *
     * A edição à mão manda: vai para `contract_terms.minutas.gestao`, volta
     * ao reabrir e é o que sai no PDF e na Autentique. Sem edição nada é
     * gravado em `minutas`, e o fornecedor e as usinas do Anexo II são
     * relidos antes de montar o texto. Para voltar ao automático existe
     * "Descartar edições".
     */
    const gerarMinuta = async () => {
        if (!supplier?.id) { showAlert('Vincule um fornecedor à usina antes de gerar a minuta.', 'warning'); return; }

        setGerandoMinuta(true);
        try {
            const editada = minutaEditada;

            if (editada) {
                setDraft(texto);
            } else {
                // O texto se refaz sozinho na renderização seguinte, com o
                // cadastro recém-lido — e é ele que a folha do PDF imprime.
                await Promise.all([lerFornecedor(), lerUsinas()]);
                setDraft('');
            }

            // Só minuta escrita à mão é gravada. Guardar uma cópia do texto
            // automático congelaria o contrato: ele pararia de acompanhar os
            // campos, e apareceria "editada à mão" sem ninguém ter editado.
            const minutas = { ...(opts.minutas || {}) };
            if (editada) minutas.gestao = texto;

            const { error } = await supabase.from('suppliers')
                .update({ contract_terms: { ...condicoesParaGravar(), minutas } })
                .eq('id', supplier.id);
            if (error) throw error;
            setOpts(prev => ({ ...prev, minutas }));

            await baixarPdfContratoFornecedor(nomeArquivo('MINUTA'));

            showAlert(editada
                ? 'Minuta editada salva no fornecedor e PDF baixado para análise.'
                : 'Minuta refeita com o cadastro atual e PDF baixado para análise.', 'success');
        } catch (e) {
            console.error('Erro ao gerar minuta do contrato de gestão:', e);
            showAlert('Erro ao gerar a minuta: ' + e.message, 'error');
        } finally {
            setGerandoMinuta(false);
        }
    };

    /** Joga fora a minuta editada — a da tela e a gravada — e volta ao automático. */
    const descartarEdicoes = async () => {
        const minutas = { ...(opts.minutas || {}) };
        delete minutas.gestao;
        setDraft('');
        setOpts(prev => ({ ...prev, minutas }));
        if (!supplier?.id) return;
        const { error } = await supabase.from('suppliers')
            .update({ contract_terms: { ...condicoesParaGravar(), minutas } })
            .eq('id', supplier.id);
        if (error) console.error('Erro ao descartar a minuta salva:', error);
    };

    const mensagemContrato = (link) =>
        `Olá ${supplier.name}, aqui é a B2W Energia. ⚡\n\n` +
        `Segue o Contrato de Administração e Gestão de Créditos Energéticos da sua usina para assinatura digital. 📄\n\n` +
        `${link}\n\n` +
        `Qualquer dúvida sobre as cláusulas, é só responder esta mensagem.`;

    /**
     * Dispara o link por WhatsApp e e-mail e devolve o resultado de cada canal.
     *
     * Cada canal falha por conta própria: e-mail recusado não pode impedir o
     * WhatsApp de sair, e nenhum dos dois invalida o contrato que já subiu
     * para a Autentique. O resultado sobe para o histórico — falhar em
     * silêncio obrigava a perguntar ao cliente se a mensagem chegou.
     */
    const enviarLink = async (link) => {
        const mensagem = mensagemContrato(link);
        const resultado = { whatsapp: null, email: null };

        if (!supplier.phone) {
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

                await sendWhatsapp(supplier.phone.replace(/\D/g, ''), mensagem, null, null, null, instanceName);
                resultado.whatsapp = 'enviado';
            } catch (waErr) {
                console.error('Erro ao enviar WhatsApp:', waErr);
                resultado.whatsapp = `falhou: ${waErr.message}`;
            }
        }

        if (!supplier.email) {
            resultado.email = 'não enviado (sem e-mail cadastrado)';
        } else {
            try {
                // `functions.invoke` devolve o erro em `error`, não lança. Sem
                // checar isto, e-mail recusado passava como enviado.
                const { error } = await supabase.functions.invoke('send-email', {
                    body: {
                        to: supplier.email,
                        subject: 'Contrato de Gestão de Créditos Energéticos - B2W Energia',
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

    /** O mesmo registro vai para o histórico da usina de onde se enviou e do fornecedor. */
    const registrar = (acao, detalhes, conteudo) => {
        if (!registrarHistorico) return;
        if (usina?.id) registrarHistorico('usina', usina.id, acao, detalhes, conteudo);
        if (supplier?.id) registrarHistorico('supplier', supplier.id, acao, detalhes, conteudo);
    };

    const enviarContrato = async () => {
        if (!supplier?.id) {
            showAlert('Vincule um fornecedor à usina antes de gerar o contrato.', 'warning');
            return;
        }
        if (!supplier.phone && !supplier.email) {
            showAlert('Cadastre telefone ou e-mail do fornecedor antes de enviar o contrato.', 'warning');
            return;
        }

        // Condição em branco ou ilegível não pode ir para assinatura: o gerador
        // cai no padrão para não imprimir NaN, e o contrato sairia prometendo
        // 20% sem ninguém ver a troca.
        const invalidos = CAMPOS_CONDICOES
            .filter(campo => !Number.isFinite(paraNumero(opts[campo.key])))
            .map(campo => campo.label);
        if (invalidos.length) {
            showAlert(`Preencha com um número: ${invalidos.join(', ')}.`, 'warning');
            return;
        }

        setEnviando(true);
        try {
            // Congela o texto que está na tela para que o PDF capturado seja
            // exatamente o que o usuário revisou.
            const textoFinal = texto;
            setDraft(textoFinal);

            const pdfBase64 = await gerarPdfContratoFornecedorBase64();
            const fileName = nomeArquivo(Date.now());

            // O bloco de assinatura fica no fim do texto, então a marca vai na
            // última folha — que varia com o tamanho do contrato. Número fixo
            // aqui coloca a assinatura no meio de uma cláusula.
            const ultimaPagina = dividirEmPaginasFornecedor(textoFinal).length;

            const result = await createAutentiqueDocument({
                documentName: fileName,
                fileBase64: pdfBase64,
                signers: [
                    {
                        // Sem `email`: com e-mail a Autentique entrega o
                        // documento por conta dela e não devolve link público,
                        // e a função cai num fallback que aponta para a página
                        // de gestão do documento — 404 para quem vai assinar.
                        // Quem entrega o link somos nós, por WhatsApp e e-mail.
                        name: supplier.name,
                        action: 'SIGN',
                        positions: [{ x: 50, y: 82, z: ultimaPagina }]
                    }
                ],
                signerId: supplier.id,
                signerType: 'supplier'
            });

            if (result.error) throw new Error(result.error);
            if (!result?.documentId) throw new Error('Falha ao criar documento na Autentique: ID não retornado.');
            if (result.signingLinkFound === false) {
                throw new Error('A Autentique não devolveu link de assinatura para este documento. O documento foi criado, mas o link não pode ser enviado — verifique o documento no painel da Autentique.');
            }

            let finalLink = result.url;
            try {
                const shortRes = await shortenLink(
                    result.url,
                    `contrato-usina-${supplier.id.substring(0, 5)}-${Date.now().toString().slice(-4)}`,
                    `Contrato de Gestão - ${supplier.name}`
                );
                if (shortRes.success && shortRes.shortUrl) finalLink = shortRes.shortUrl;
            } catch (shortErr) {
                // Link longo assina igual: encurtar é conveniência, não requisito.
                console.warn('Falha ao encurtar link do contrato:', shortErr);
            }

            // As condições vão junto: o contrato que acabou de subir para
            // assinatura foi montado com elas, e o banco não pode continuar
            // dizendo outra coisa se ninguém salvou antes de enviar.
            await supabase
                .from('suppliers')
                .update({ signature_link: finalLink, contract_terms: condicoesParaGravar() })
                .eq('id', supplier.id);

            // `document_type` é o que faz o webhook reconhecer a Gestão: sem
            // ele, o fornecedor era promovido por qualquer documento. Sem
            // `usina_id` de propósito — o contrato é do fornecedor, e a
            // marca de usina é a que separa os de Compra e Venda.
            await supabase
                .from('signatures')
                .update({ short_url: finalLink, document_type: 'gestao' })
                .eq('autentique_doc_id', result.documentId);

            const envio = await enviarLink(finalLink);

            showAlert(
                algumCanalFalhou(envio)
                    ? `Contrato criado, mas houve falha no envio. ${resumoEnvio(envio)}`
                    : `Contrato gerado e enviado. ${resumoEnvio(envio)}`,
                algumCanalFalhou(envio) ? 'warning' : 'success'
            );
            lerFornecedor();
            lerAssinaturas();
            registrar('envio_contrato', {
                document_name: fileName,
                autentique_doc_id: result.documentId,
                tipo: 'gestao',
                condicoes: opts,
                envio
            }, `Contrato de Gestão enviado para assinatura. ${resumoEnvio(envio)}`);
        } catch (error) {
            console.error('Erro ao enviar contrato de gestão:', error);
            showAlert('Erro ao enviar contrato: ' + error.message, 'error');
        } finally {
            setEnviando(false);
        }
    };

    /**
     * Cancela o contrato na Autentique e marca a assinatura como cancelada.
     *
     * O contrato pendente que ninguém vai assinar — enviado por engano, ou
     * com link quebrado — ficava "aguardando assinatura" para sempre, e o
     * documento seguia vivo do lado da Autentique.
     */
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
            lerFornecedor();
            lerAssinaturas();
        } catch (error) {
            showAlert('Erro ao cancelar contrato: ' + error.message, 'error');
        } finally {
            setCancelando(null);
        }
    };

    const reenviarLink = async (sig) => {
        const ok = await showConfirm('Deseja reenviar o link de assinatura para o fornecedor?', 'Reenviar Link');
        if (!ok) return;

        try {
            let finalLink = sig.short_url || sig.autentique_url;

            if (!sig.short_url) {
                try {
                    const shortRes = await shortenLink(sig.autentique_url, `reenvio-usina-${sig.id.substring(0, 5)}`, `Reenvio Contrato - ${supplier.name}`);
                    if (shortRes.success && shortRes.shortUrl) {
                        finalLink = shortRes.shortUrl;
                        await supabase.from('signatures').update({ short_url: finalLink }).eq('id', sig.id);
                    }
                } catch (e) {
                    console.warn('Falha no encurtamento durante reenvio:', e);
                }
            }

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

    if (!supplierId) {
        return (
            <div style={{ ...cartao, display: 'flex', gap: '0.5rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a' }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                Vincule um fornecedor à usina (aba Geral) para gerar o Contrato de Gestão.
            </div>
        );
    }

    if (carregando && !supplier) {
        return <div style={{ ...cartao, color: '#94a3b8', fontSize: '0.9rem' }}>Carregando...</div>;
    }

    if (!supplier) {
        return <div style={{ ...cartao, color: '#b91c1c', fontSize: '0.9rem' }}>Fornecedor não encontrado.</div>;
    }

    const ocupado = gerandoMinuta || enviando;

    return (
        <>
            <div style={cartao}>
                <h4 style={{ margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                    <FileSignature size={20} color="#3b82f6" /> Condições Comerciais
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                    {CAMPOS_CONDICOES.map(campo => (
                        <div key={campo.key}>
                            <label style={rotuloCampo}>{campo.label}</label>
                            <input
                                // Texto, e não `type="number"`: o campo de número recusa a
                                // vírgula do teclado brasileiro — ao digitar "17,5" o
                                // navegador devolve string vazia, e o campo parece não
                                // aceitar o valor. A conversão é feita por paraNumero().
                                type="text"
                                inputMode="decimal"
                                style={estiloCampo}
                                value={opts[campo.key] ?? ''}
                                onChange={e => {
                                    // Só dígitos, vírgula e ponto: barra letra digitada por
                                    // engano sem brigar com quem está no meio de "17,".
                                    const limpo = e.target.value.replace(/[^\d.,]/g, '');
                                    setOpts({ ...opts, [campo.key]: limpo });
                                    // Condição alterada invalida o rascunho: o texto precisa
                                    // ser remontado com o número novo.
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

                <div style={{ marginTop: '1rem', padding: '0.8rem 1rem', background: usinas.length ? '#f0f9ff' : '#fffbeb', border: `1px solid ${usinas.length ? '#bae6fd' : '#fde68a'}`, borderRadius: '10px', fontSize: '0.83rem', color: usinas.length ? '#0369a1' : '#92400e', display: 'flex', gap: '0.5rem' }}>
                    {usinas.length ? <Zap size={18} style={{ flexShrink: 0 }} /> : <AlertCircle size={18} style={{ flexShrink: 0 }} />}
                    <span>
                        {usinas.length
                            ? <>Este contrato é do fornecedor <strong>{supplier.name}</strong> e vale para todas as usinas dele, listadas no Anexo II: {usinas.map(u => u.name).join(', ')}. As condições acima são as do fornecedor, e não só desta usina.</>
                            : 'Nenhuma usina vinculada: o Anexo II sairá sem centrais geradoras.'}
                        {supplier.contrato_assinado_em && (
                            <> Contrato de Gestão assinado em {new Date(supplier.contrato_assinado_em).toLocaleDateString('pt-BR')}.</>
                        )}
                    </span>
                </div>
            </div>

            <div style={cartao}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b', flexWrap: 'wrap' }}>
                        Minuta
                        {/*
                          O rascunho editado à mão vence o texto gerado, e isso era
                          invisível: dava para trocar uma condição, ver a minuta não
                          mudar e concluir que o campo não salvou. A tela diz qual
                          dos dois está à frente, e oferece a saída.
                        */}
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
                    O texto acima é o que será impresso no PDF enviado à Autentique. Alterar uma condição comercial acima remonta a minuta.
                </p>
            </div>

            <div style={cartao}>
                <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                    <History size={20} color="#3b82f6" /> Contratos de gestão enviados
                </h4>

                {signatures.length === 0 ? (
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Nenhum contrato de gestão enviado para assinatura.</p>
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
                                                {sig.document_name || 'Contrato de Gestão'}
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

                {supplier.signature_link && (
                    <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: '#64748b' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{supplier.signature_link}</span>
                        <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(supplier.signature_link); showAlert('Link copiado.', 'success'); }}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.6rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', cursor: 'pointer', color: '#64748b' }}
                        >
                            <Copy size={13} /> Copiar
                        </button>
                    </div>
                )}
            </div>

            {/*
              Folhas do contrato, fora da tela, prontas para o html2canvas.
              Montadas só durante a geração do PDF: são 12 folhas A4 que
              ninguém vê antes de clicar em enviar. O gerador espera 1500ms
              antes de varrer o DOM, tempo de sobra para o React montar isto.
            */}
            {ocupado && (
                <ContratoFornecedor
                    supplier={supplier}
                    usinas={usinas}
                    branding={branding}
                    texto={texto}
                />
            )}
        </>
    );
}
