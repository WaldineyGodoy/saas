import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

/**
 * Fecha a adesão pública sem passar por admin.
 *
 * Antes, o assinante criado pelo site ficava parado em `ativacao` até
 * alguém abrir o SubscriberModal e clicar em "Gerar e Enviar para
 * Assinatura Eletrônica". E nunca ganhava conta de acesso: 12 dos 13
 * assinantes estavam sem `profile_id` e 11 sem `user_id`.
 *
 * Esta função faz as duas coisas de uma vez, logo após a adesão:
 *   1. cria a conta de auth + profile e vincula ao assinante;
 *   2. cria o documento na Autentique, encurta no YOURLS e manda o link
 *      pelo WhatsApp, devolvendo a URL da página de termos.
 *
 * Cada etapa é tolerante à falha da outra: se a Autentique cair, a conta
 * já foi criada e não se perde; se a conta falhar, o contrato ainda sai.
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PAGINA_TERMOS = 'https://www.b2wenergia.com.br/contrato/';

const soDigitos = (v: string | null | undefined) => (v || '').replace(/\D/g, '');

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const avisos: string[] = [];

    try {
        const { subscriber_id, pdf_base64 } = await req.json().catch(() => ({}));

        if (!subscriber_id) throw new Error('subscriber_id é obrigatório.');
        if (!pdf_base64) throw new Error('pdf_base64 é obrigatório.');

        // ------------------------------------------------------------------
        // 0. Carrega o assinante e suas UCs
        // ------------------------------------------------------------------
        const { data: sub, error: subErr } = await supabaseAdmin
            .from('subscribers')
            .select('*')
            .eq('id', subscriber_id)
            .single();

        if (subErr || !sub) throw new Error('Assinante não encontrado.');

        const { data: ucs } = await supabaseAdmin
            .from('consumer_units')
            .select('numero_uc, concessionaria, address')
            .eq('subscriber_id', subscriber_id);

        // ------------------------------------------------------------------
        // 1. Conta de acesso — profile_id / user_id
        // ------------------------------------------------------------------
        let userId: string | null = sub.user_id || sub.profile_id || null;

        if (!userId && sub.email) {
            try {
                // Reaproveita a conta se o e-mail já tiver uma: criar de novo
                // devolveria erro e abortaria o contrato junto.
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
                avisos.push(`conta de acesso: ${(e as Error).message}`);
            }
        }

        if (userId) {
            // O profile é o que dá papel ao usuário. Sem ele o assinante
            // loga e cai no papel padrão 'lead', sem enxergar nada.
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

            if (profErr) avisos.push(`profile: ${profErr.message}`);

            const { error: linkErr } = await supabaseAdmin
                .from('subscribers')
                .update({ profile_id: userId, user_id: userId })
                .eq('id', subscriber_id);

            if (linkErr) avisos.push(`vínculo do assinante: ${linkErr.message}`);
        }

        // ------------------------------------------------------------------
        // 2. Documento na Autentique
        // ------------------------------------------------------------------
        const nomeArquivo = `Contrato_${(sub.name || 'Assinante').replace(/\s+/g, '_')}_${subscriber_id.slice(0, 8)}.pdf`;

        const { data: autentique, error: autErr } = await supabaseAdmin.functions.invoke(
            'create-autentique-document',
            {
                body: {
                    documentName: nomeArquivo,
                    fileBase64: pdf_base64,
                    signers: [{
                        name: sub.name,
                        email: sub.email,
                        action: 'SIGN',
                        positions: [
                            { x: 50, y: 82, z: 3 }, // página 3 — Associado
                            { x: 50, y: 82, z: 4 }  // página 4 — Procuração
                        ]
                    }],
                    signerId: subscriber_id,
                    signerType: 'subscriber'
                }
            }
        );

        if (autErr) throw new Error(`Autentique: ${autErr.message}`);
        if (autentique?.error) throw new Error(`Autentique: ${autentique.error}`);
        if (!autentique?.url) throw new Error('Autentique não devolveu link de assinatura.');

        const linkAssinatura: string = autentique.url;

        // ------------------------------------------------------------------
        // 3. Encurtamento no YOURLS (não bloqueante)
        // ------------------------------------------------------------------
        let linkFinal = linkAssinatura;
        try {
            const { data: curto } = await supabaseAdmin.functions.invoke('yourls-shorten', {
                body: {
                    url: linkAssinatura,
                    keyword: `adesao-${subscriber_id.slice(0, 8)}`,
                    title: `Contrato de Adesão - ${sub.name}`
                }
            });
            if (curto?.success && curto.shortUrl) linkFinal = curto.shortUrl;
            else avisos.push('YOURLS não encurtou; usando o link longo da Autentique.');
        } catch (e) {
            avisos.push(`YOURLS: ${(e as Error).message}`);
        }

        await supabaseAdmin.from('subscribers')
            .update({ signature_link: linkFinal })
            .eq('id', subscriber_id);

        await supabaseAdmin.from('signatures')
            .update({ short_url: linkFinal, document_name: nomeArquivo })
            .eq('autentique_doc_id', autentique.documentId);

        // ------------------------------------------------------------------
        // 4. Página de termos que hospeda o link de assinatura
        // ------------------------------------------------------------------
        const endereco = [sub.rua, sub.numero, sub.bairro, sub.cidade && `${sub.cidade}/${sub.uf || ''}`]
            .filter(Boolean).join(', ');

        const params = new URLSearchParams({
            Linkdocontrato: linkFinal,
            nome: sub.name || '',
            cpf: sub.cpf_cnpj || '',
            endereco,
            concessionaria: ucs?.[0]?.concessionaria || ''
        });

        const urlTermos = `${PAGINA_TERMOS}?${params.toString()}`;

        // Encurta a própria página de termos para o WhatsApp.
        //
        // O link da Autentique já vinha curto, mas ele é só UM dos cinco
        // parâmetros desta URL — nome, CPF e endereço vão junto, e o texto
        // final passava de 300 caracteres. Numa mensagem de WhatsApp isso
        // quebra em várias linhas e parece golpe.
        let urlTermosCurta = urlTermos;
        try {
            const { data: curtoTermos } = await supabaseAdmin.functions.invoke('yourls-shorten', {
                body: {
                    url: urlTermos,
                    keyword: `contrato-${subscriber_id.slice(0, 8)}`,
                    title: `Termos do contrato - ${sub.name}`
                }
            });
            if (curtoTermos?.success && curtoTermos.shortUrl) urlTermosCurta = curtoTermos.shortUrl;
            else avisos.push('YOURLS não encurtou a página de termos; o WhatsApp saiu com a URL longa.');
        } catch (e) {
            avisos.push(`YOURLS (termos): ${(e as Error).message}`);
        }

        // ------------------------------------------------------------------
        // 5. WhatsApp com o link
        // ------------------------------------------------------------------
        if (sub.phone) {
            try {
                await supabaseAdmin.functions.invoke('send-whatsapp', {
                    body: {
                        phone: soDigitos(sub.phone),
                        text: `Olá, ${sub.name}! ⚡\n\nSua adesão à B2W Energia foi registrada. Falta só assinar o contrato — leva menos de 2 minutos e é 100% digital. ✍️\n\nEntenda os termos e assine aqui:\n${urlTermosCurta}\n\nQualquer dúvida, é só responder esta mensagem.`
                    }
                });
            } catch (e) {
                avisos.push(`WhatsApp: ${(e as Error).message}`);
            }
        }

        await supabaseAdmin.from('crm_history').insert({
            entity_type: 'subscriber',
            entity_id: subscriber_id,
            content: 'Adesão pública concluída: conta criada e contrato enviado para assinatura.',
            metadata: {
                autentique_doc_id: autentique.documentId,
                signature_link: linkFinal,
                conta_criada: !!userId,
                avisos
            }
        });

        return new Response(JSON.stringify({
            success: true,
            subscriber_id,
            user_id: userId,
            signature_link: linkFinal,
            contrato_url: urlTermos,
            avisos
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('onboarding-finalizar:', error);
        return new Response(JSON.stringify({
            error: (error as Error).message,
            avisos
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });
    }
})
