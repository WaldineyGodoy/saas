import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import {
    descreverFaltantes, escolherLink, keywordAdesao, keywordTermos,
    urlTermos, textoWhatsappContrato, textoOriginador,
} from '../_shared/onboarding-regras.ts'
import { htmlEmailContrato } from '../_shared/email-contrato.ts'

/**
 * Fecha a adesao publica sem passar por admin (v4).
 *
 * POST { token, pdf_base64, paginas_termo }
 *   200 { success, signature_link, contrato_url, contrato_url_curta, reenviado, avisos }
 *   400 paginas_termo/pdf invalidos | 401 token | 409 { error, faltantes } | 502 { error: 'contrato_indisponivel' }
 *
 * 1. token -> assinante (fn_onboarding_assinante_por_token); nulo = 401.
 * 2. documentos obrigatorios (fn_onboarding_documentos_faltantes); falta = 409.
 * 3. idempotencia: ja existe assinatura pendente com short_url -> nao cria
 *    documento, reenvia WhatsApp + e-mail com O MESMO link curto da pagina
 *    de termos do primeiro envio. Esse link fica gravado em
 *    crm_history.metadata.contrato_url_curta (junto do autentique_doc_id).
 *    Nao usamos signatures.metadata porque o autentique-webhook sobrescreve
 *    essa coluna com o payload do evento.
 * 4. conta de acesso + profile.
 * 5-6. documento na Autentique com signatario SEM e-mail (so assim ela
 *    devolve link publico); sem link -> 502 e nada e enviado.
 * 7-9. encurta assinatura e pagina de termos; WhatsApp e e-mail com o mesmo
 *    link curto da pagina de termos.
 * 10. aviso ao originador.
 *
 * ATENCAO: todo texto que chega ao CLIENTE fica em \u escapes (uma versao
 * anterior foi publicada com os acentos removidos). Este arquivo e ASCII.
 * Mensagens de erro internas ficam no log; o chamador e anonimo e so recebe
 * rotulos genericos.
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PAGINA_TERMOS = 'https://www.b2wenergia.com.br/contrato/';
const ASSUNTO_EMAIL = 'Seu contrato B2W Energia est\u00e1 pronto para assinar';

const soDigitos = (v: string | null | undefined) => (v || '').replace(/\D/g, '');
const msg = (e: unknown) => (e as Error)?.message ?? String(e);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status
});

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const avisos: string[] = [];

    /** Encurta no YOURLS; devolve null (e registra aviso) se nao encurtar. */
    const encurtar = async (url: string, keyword: string, title: string, rotulo: string): Promise<string | null> => {
        try {
            const { data, error } = await supabaseAdmin.functions.invoke('yourls-shorten', {
                body: { url, keyword, title }
            });
            if (error) throw error;
            if (data?.success && data.shortUrl) return data.shortUrl as string;
            console.error(`onboarding-finalizar: YOURLS (${rotulo}) sem shortUrl`, data);
        } catch (e) {
            console.error(`onboarding-finalizar: YOURLS (${rotulo})`, e);
        }
        avisos.push(`YOURLS nao encurtou ${rotulo}.`);
        return null;
    };

    /** WhatsApp + e-mail ao assinante, os dois com o MESMO link. */
    const enviarAoAssinante = async (
        sub: Record<string, any>,
        link: string,
        uc0: Record<string, any> | undefined
    ) => {
        const envio = { whatsapp: false, email: false };

        if (sub.phone) {
            try {
                const { data, error } = await supabaseAdmin.functions.invoke('send-whatsapp', {
                    body: { phone: soDigitos(sub.phone), text: textoWhatsappContrato(sub.name, link) }
                });
                if (error || data?.error) throw error ?? new Error(String(data.error));
                envio.whatsapp = true;
            } catch (e) {
                console.error('onboarding-finalizar: WhatsApp', e);
                avisos.push('WhatsApp nao enviado.');
            }
        } else {
            avisos.push('Assinante sem telefone: WhatsApp nao enviado.');
        }

        if (sub.email) {
            try {
                const { data, error } = await supabaseAdmin.functions.invoke('send-email', {
                    body: {
                        to: sub.email,
                        subject: ASSUNTO_EMAIL,
                        html: htmlEmailContrato({
                            nome: sub.name,
                            link,
                            desconto: uc0?.desconto_assinante ?? null,
                            concessionaria: uc0?.concessionaria || ''
                        })
                    }
                });
                if (error || data?.error) throw error ?? new Error(String(data.error));
                envio.email = true;
            } catch (e) {
                console.error('onboarding-finalizar: e-mail', e);
                avisos.push('E-mail nao enviado.');
            }
        } else {
            avisos.push('Assinante sem e-mail: e-mail nao enviado.');
        }

        return envio;
    };

    try {
        const body = await req.json().catch(() => ({}));
        const { token, pdf_base64, paginas_termo } = body ?? {};

        // 1. Token -> assinante
        if (!token || typeof token !== 'string') {
            return json({ error: 'Link de ades\u00e3o inv\u00e1lido ou expirado.' }, 401);
        }
        const { data: subscriberId, error: tokErr } = await supabaseAdmin
            .rpc('fn_onboarding_assinante_por_token', { p_token: token });
        if (tokErr) console.error('onboarding-finalizar: token', tokErr);
        if (!subscriberId) {
            return json({ error: 'Link de ades\u00e3o inv\u00e1lido ou expirado.' }, 401);
        }
        const subscriber_id = subscriberId as string;

        // 2. Documentos obrigatorios
        const { data: faltantes, error: faltErr } = await supabaseAdmin
            .rpc('fn_onboarding_documentos_faltantes', { p_subscriber: subscriber_id });
        if (faltErr) throw faltErr;
        if (Array.isArray(faltantes) && faltantes.length > 0) {
            return json({
                error: `Envie os documentos que faltam: ${descreverFaltantes(faltantes)}.`,
                faltantes
            }, 409);
        }

        const { data: sub, error: subErr } = await supabaseAdmin
            .from('subscribers')
            .select('*')
            .eq('id', subscriber_id)
            .single();
        if (subErr || !sub) throw subErr ?? new Error('assinante nao encontrado');

        // F2: fora de 'ativacao' (cancelado, ou assinado na mao/gov.br) ->
        // recusa antes de tocar em qualquer coisa (idempotencia ou Autentique).
        if (sub.status !== 'ativacao') {
            return json({ error: 'Esta ades\u00e3o n\u00e3o est\u00e1 mais aguardando contrato.' }, 409);
        }

        const { data: ucs } = await supabaseAdmin
            .from('consumer_units')
            .select('numero_uc, concessionaria, desconto_assinante, created_at')
            .eq('subscriber_id', subscriber_id)
            .order('created_at', { ascending: true });
        const uc0 = ucs?.[0];

        // 3. Idempotencia: contrato pendente ja enviado -> reenvia o mesmo link
        const { data: pendente } = await supabaseAdmin
            .from('signatures')
            .select('id, autentique_doc_id, short_url, created_at')
            .eq('signer_id', subscriber_id)
            .eq('signer_type', 'subscriber')
            .eq('status', 'pending')
            .not('short_url', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (pendente?.short_url) {
            const { data: hist } = await supabaseAdmin
                .from('crm_history')
                .select('metadata')
                .eq('entity_type', 'subscriber')
                .eq('entity_id', subscriber_id)
                .eq('metadata->>autentique_doc_id', pendente.autentique_doc_id)
                .not('metadata->>contrato_url_curta', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const contratoUrl: string = hist?.metadata?.contrato_url || urlTermos(PAGINA_TERMOS, {
                link: pendente.short_url,
                nome: sub.name || '',
                concessionaria: uc0?.concessionaria || '',
                desconto: uc0?.desconto_assinante ?? null
            });

            // Sem registro do primeiro envio (ex.: contrato mandado pelo CRM),
            // encurta agora e grava abaixo: os proximos reenvios reusam este.
            let termosCurta: string | null = hist?.metadata?.contrato_url_curta ?? null;
            if (!termosCurta) {
                termosCurta = await encurtar(contratoUrl, keywordTermos(subscriber_id, new Date()),
                    `Termos do contrato - ${sub.name}`, 'a pagina de termos') ?? contratoUrl;
            }

            const envio = await enviarAoAssinante(sub, termosCurta, uc0);

            await supabaseAdmin.from('crm_history').insert({
                entity_type: 'subscriber',
                entity_id: subscriber_id,
                content: 'Ades\u00e3o p\u00fablica: contrato pendente reenviado por WhatsApp e e-mail (mesmo link).',
                metadata: {
                    autentique_doc_id: pendente.autentique_doc_id,
                    signature_link: pendente.short_url,
                    contrato_url: contratoUrl,
                    contrato_url_curta: termosCurta,
                    reenviado: true,
                    envio,
                    avisos
                }
            });

            return json({
                success: true,
                subscriber_id,
                signature_link: pendente.short_url,
                contrato_url: contratoUrl,
                contrato_url_curta: termosCurta,
                reenviado: true,
                avisos
            });
        }

        // Validacao do corpo so e necessaria quando vamos criar o documento
        const paginas = Number(paginas_termo);
        if (!Number.isInteger(paginas) || paginas < 1) {
            return json({ error: 'paginas_termo deve ser um inteiro maior ou igual a 1.' }, 400);
        }
        if (!pdf_base64 || typeof pdf_base64 !== 'string') {
            return json({ error: 'pdf_base64 \u00e9 obrigat\u00f3rio.' }, 400);
        }

        // 4. Conta de acesso - profile_id / user_id
        let userId: string | null = sub.user_id || sub.profile_id || null;

        if (!userId && sub.email) {
            try {
                const { data: existente } = await supabaseAdmin
                    .rpc('fn_auth_user_id_por_email', { p_email: sub.email });

                if (existente) {
                    userId = existente as string;
                } else {
                    const { data: criado, error: authErr } = await supabaseAdmin.auth.admin.createUser({
                        email: sub.email,
                        email_confirm: true,
                        user_metadata: {
                            name: sub.name,
                            role: 'subscriber',
                            cpf_cnpj: sub.cpf_cnpj,
                            phone: sub.phone
                        }
                    });
                    if (authErr) throw authErr;
                    userId = criado.user?.id ?? null;
                }
            } catch (e) {
                console.error('onboarding-finalizar: conta de acesso', e);
                avisos.push('Conta de acesso nao criada.');
            }
        }

        if (userId) {
            const { error: profErr } = await supabaseAdmin.from('profiles').upsert({
                id: userId,
                name: sub.name,
                cpf_cnpj: sub.cpf_cnpj,
                email: sub.email,
                phone: sub.phone,
                role: 'subscriber',
                address: {
                    cep: sub.cep, rua: sub.rua, numero: sub.numero,
                    complemento: sub.complemento, bairro: sub.bairro,
                    cidade: sub.cidade, uf: sub.uf
                }
            }, { onConflict: 'id' });

            if (profErr) {
                console.error('onboarding-finalizar: profile', profErr);
                avisos.push('Profile nao gravado.');
            }

            const { error: linkErr } = await supabaseAdmin
                .from('subscribers')
                .update({ profile_id: userId, user_id: userId })
                .eq('id', subscriber_id);

            if (linkErr) {
                console.error('onboarding-finalizar: vinculo', linkErr);
                avisos.push('Vinculo do assinante com a conta nao gravado.');
            }
        }

        // 5. Documento na Autentique. Signatario SEM e-mail: com e-mail a
        // Autentique entrega por conta propria e nao devolve link publico.
        // Posicoes: mesma regra do SubscriberModal.handleSendContract (fim do
        // termo + procuracao na pagina seguinte).
        const nomeArquivo = `Contrato_${(sub.name || 'Assinante').replace(/\s+/g, '_')}_${subscriber_id.slice(0, 8)}.pdf`;

        let autentique: Record<string, any> | null = null;
        try {
            const { data, error: autErr } = await supabaseAdmin.functions.invoke(
                'create-autentique-document',
                {
                    body: {
                        documentName: nomeArquivo,
                        fileBase64: pdf_base64,
                        signers: [{
                            name: sub.name,
                            action: 'SIGN',
                            positions: [
                                { x: 50, y: 82, z: paginas },
                                { x: 50, y: 82, z: paginas + 1 }
                            ]
                        }],
                        signerId: subscriber_id,
                        signerType: 'subscriber'
                    }
                }
            );
            if (autErr) throw autErr;
            if (data?.error) throw new Error(String(data.error));
            autentique = data;
        } catch (e) {
            console.error('onboarding-finalizar: Autentique', e);
        }

        // 6. Sem link de assinatura -> nada e enviado
        const escolha = escolherLink(autentique ?? {});
        if (!escolha.ok) {
            // A linha 'pending'/short_url NULL que create-autentique-document
            // ja gravou fica orfa: sem isto, fn_onboarding_estado marcava
            // 'enviado' mesmo sem nada enviado (ver 20260922b).
            if (autentique?.documentId) {
                const { error: cancelErr } = await supabaseAdmin
                    .from('signatures')
                    .update({ status: 'canceled' })
                    .eq('autentique_doc_id', autentique.documentId);
                if (cancelErr) {
                    console.error('onboarding-finalizar: cancelar assinatura orfa', cancelErr);
                    avisos.push('Assinatura pendente sem link nao cancelada.');
                }
            }
            await supabaseAdmin.from('crm_history').insert({
                entity_type: 'subscriber',
                entity_id: subscriber_id,
                content: 'Ades\u00e3o p\u00fablica: Autentique sem link de assinatura; contrato N\u00c3O enviado.',
                metadata: {
                    autentique_doc_id: autentique?.documentId ?? null,
                    motivo: escolha.motivo,
                    conta_criada: !!userId,
                    avisos
                }
            });
            return json({ error: 'contrato_indisponivel' }, 502);
        }

        const linkAssinatura = escolha.url;

        // 7. Encurta o link de assinatura (nao bloqueante)
        const linkFinal = await encurtar(linkAssinatura, keywordAdesao(subscriber_id, new Date()),
            `Contrato de Adesao - ${sub.name}`, 'o link de assinatura') ?? linkAssinatura;

        await supabaseAdmin.from('subscribers')
            .update({ signature_link: linkFinal })
            .eq('id', subscriber_id);

        await supabaseAdmin.from('signatures')
            .update({ short_url: linkFinal, document_name: nomeArquivo })
            .eq('autentique_doc_id', autentique!.documentId);

        // 8. Pagina de termos (sem CPF/endereco na URL) e seu link curto
        const contratoUrl = urlTermos(PAGINA_TERMOS, {
            link: linkFinal,
            nome: sub.name || '',
            concessionaria: uc0?.concessionaria || '',
            desconto: uc0?.desconto_assinante ?? null
        });

        const termosCurta = await encurtar(contratoUrl, keywordTermos(subscriber_id, new Date()),
            `Termos do contrato - ${sub.name}`, 'a pagina de termos') ?? contratoUrl;

        // 9. WhatsApp + e-mail com o mesmo link curto
        const envio = await enviarAoAssinante(sub, termosCurta, uc0);

        // 10. Originador
        let originadorAvisado = false;
        if (sub.originator_id) {
            try {
                const { data: orig } = await supabaseAdmin
                    .from('originators_v2')
                    .select('phone')
                    .eq('id', sub.originator_id)
                    .maybeSingle();
                if (orig?.phone) {
                    const { data, error } = await supabaseAdmin.functions.invoke('send-whatsapp', {
                        body: { phone: soDigitos(orig.phone), text: textoOriginador(sub.name) }
                    });
                    if (error || data?.error) throw error ?? new Error(String(data.error));
                    originadorAvisado = true;
                }
            } catch (e) {
                console.error('onboarding-finalizar: originador', e);
                avisos.push('Originador nao avisado.');
            }
        }

        // 11. Historico (e fonte do link para reenvios)
        await supabaseAdmin.from('crm_history').insert({
            entity_type: 'subscriber',
            entity_id: subscriber_id,
            content: 'Ades\u00e3o p\u00fablica conclu\u00edda: conta criada e contrato enviado para assinatura.',
            metadata: {
                autentique_doc_id: autentique!.documentId,
                signature_link: linkFinal,
                contrato_url: contratoUrl,
                contrato_url_curta: termosCurta,
                conta_criada: !!userId,
                envio,
                originador_avisado: originadorAvisado,
                avisos
            }
        });

        return json({
            success: true,
            subscriber_id,
            user_id: userId,
            signature_link: linkFinal,
            contrato_url: contratoUrl,
            contrato_url_curta: termosCurta,
            reenviado: false,
            avisos
        });

    } catch (error) {
        console.error('onboarding-finalizar:', msg(error), error);
        return json({
            error: 'N\u00e3o foi poss\u00edvel concluir a ades\u00e3o agora. Tente novamente em instantes.',
            avisos
        }, 500);
    }
})
