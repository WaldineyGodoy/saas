import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

/**
 * Cancela um contrato pendente na Autentique.
 *
 * Sem isto, um contrato enviado por engano — ou com link quebrado — ficava
 * "aguardando assinatura" para sempre no modal do cliente, e o documento
 * seguia assinável do lado da Autentique. Histórico falso dos dois lados.
 *
 * A Autentique não tem mutation de "cancelar": tem `deleteDocument`, que é
 * o mesmo que apagar pelo painel. Para um documento pendente é o efeito
 * desejado — o link morre e ninguém assina.
 *
 * Duas travas deliberadas:
 *  - só cancela quem está 'pending'. Apagar um contrato já assinado
 *    destruiria a prova da assinatura, e não é o que "cancelar" quer dizer.
 *  - exige admin de verdade. `verify_jwt` sozinho não serve aqui: a chave
 *    anônima é um JWT válido, e esta função apaga documento.
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PAPEIS_ADMIN = ['admin', 'super_admin', 'superadmin'];

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status
        });

    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // --- Portão: precisa ser um usuário admin, não a chave anônima ---
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) throw new Error('Missing Authorization header');

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) throw new Error('Unauthorized: token inválido.');

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (!profile || !PAPEIS_ADMIN.includes(String(profile.role))) {
            throw new Error(`Unauthorized: só admin cancela contrato. Seu papel: ${profile?.role}`);
        }

        const { signatureId } = await req.json().catch(() => ({}));
        if (!signatureId) throw new Error('Parâmetro obrigatório ausente: signatureId.');

        const { data: assinatura, error: sigError } = await supabaseAdmin
            .from('signatures')
            .select('*')
            .eq('id', signatureId)
            .single();

        if (sigError || !assinatura) throw new Error('Contrato não encontrado.');

        if (assinatura.status === 'canceled') {
            return json({ success: true, jaCancelado: true, message: 'Contrato já estava cancelado.' });
        }
        if (assinatura.status !== 'pending') {
            throw new Error(`Só é possível cancelar contrato aguardando assinatura. Este está como "${assinatura.status}".`);
        }

        // --- Configuração da Autentique ---
        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'autentique_api')
            .single();

        if (configError || !config) throw new Error('Configuração da Autentique não encontrada.');

        const isSandbox = config.environment === 'sandbox';
        const endpoint = isSandbox ? config.sandbox_endpoint_url : config.endpoint_url;
        const apiKey = isSandbox ? config.sandbox_api_key : config.api_key;

        const mutation = `mutation DeleteDocument($id: UUID!) { deleteDocument(id: $id) }`;

        const resposta = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: mutation, variables: { id: assinatura.autentique_doc_id } })
        });

        const resultado = await resposta.json();
        if (resultado.errors) {
            throw new Error(`Autentique: ${resultado.errors[0].message}`);
        }

        // A Autentique responde `true`. Um `false` significa que ela não
        // apagou — carimbar 'canceled' aqui deixaria o CRM dizendo uma coisa
        // e a Autentique outra, que é justamente o histórico falso que esta
        // função existe para acabar.
        if (resultado.data?.deleteDocument !== true) {
            throw new Error('A Autentique não confirmou o cancelamento do documento.');
        }

        const { error: updateError } = await supabaseAdmin
            .from('signatures')
            .update({
                status: 'canceled',
                updated_at: new Date().toISOString(),
                metadata: { ...(assinatura.metadata || {}), canceled_at: new Date().toISOString(), canceled_by: user.id }
            })
            .eq('id', signatureId);

        if (updateError) throw updateError;

        // O atalho `signature_link` aponta para o contrato vigente. Deixá-lo
        // apontando para um documento apagado é oferecer um link morto na
        // tela e no reenvio.
        const tabela = assinatura.signer_type === 'supplier' ? 'suppliers'
            : assinatura.signer_type === 'subscriber' ? 'subscribers'
                : null;

        if (tabela) {
            await supabaseAdmin
                .from(tabela)
                .update({ signature_link: null })
                .eq('id', assinatura.signer_id)
                .in('signature_link', [assinatura.short_url, assinatura.autentique_url].filter(Boolean));

            await supabaseAdmin.from('crm_history').insert({
                entity_type: assinatura.signer_type,
                entity_id: assinatura.signer_id,
                content: 'Contrato cancelado na Autentique. O link de assinatura deixou de valer.',
                metadata: {
                    autentique_doc_id: assinatura.autentique_doc_id,
                    signature_id: assinatura.id,
                    origem: 'cancel-autentique-document',
                    canceled_by: user.id
                }
            });
        }

        return json({ success: true, documentId: assinatura.autentique_doc_id });

    } catch (error) {
        console.error('cancel-autentique-document:', error);
        return json({ error: (error as Error).message }, 400);
    }
})
