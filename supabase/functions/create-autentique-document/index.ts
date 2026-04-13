import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const body = await req.json().catch(() => ({}));
        const { documentName, signers, fileBase64, signerId, signerType } = body;

        if (!documentName || !signers || !fileBase64 || !signerId || !signerType) {
            throw new Error('Parâmetros obrigatórios ausentes.');
        }

        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'autentique_api')
            .single();

        if (configError || !config) throw new Error('Configuração da Autentique não encontrada.');

        const isSandbox = config.environment === 'sandbox';
        const endpoint = isSandbox ? config.sandbox_endpoint_url : config.endpoint_url;
        const apiKey = isSandbox ? config.sandbox_api_key : config.api_key;

        const binaryString = atob(fileBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const fileBlob = new Blob([bytes], { type: 'application/pdf' });

        const createMutation = `
            mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
                createDocument(sandbox: ${isSandbox}, document: $document, signers: $signers, file: $file) {
                    id
                    signatures {
                        public_id
                        name
                        link {
                            short_link
                        }
                    }
                }
            }
        `;

        const formData = new FormData();
        formData.append('operations', JSON.stringify({
            query: createMutation,
            variables: { document: { name: documentName }, signers: signers, file: null }
        }));
        formData.append('map', JSON.stringify({ "0": ["variables.file"] }));
        formData.append('0', fileBlob, `${documentName}.pdf`);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const result = await response.json();
        if (result.errors) throw new Error(`Autentique: ${result.errors[0].message}`);

        const docData = result.data.createDocument;
        const firstSignature = docData.signatures?.[0];
        
        let signingLink = firstSignature?.link?.short_link;
        
        // CONSTRUÇÃO MANUAL (Backup 1): Caso o objeto link venha nulo mas o public_id exista
        if (!signingLink && firstSignature?.public_id) {
            signingLink = `https://assina.ae/${firstSignature.public_id}`;
            console.log('Link construído manualmente via public_id:', signingLink);
        }

        // TENTATIVA DE RECUPERAÇÃO (Backup 2): Se ainda nulo, tenta a mutação específica
        if (!signingLink && firstSignature?.public_id) {
            await sleep(1000);
            try {
                const linkMutation = `mutation { createLinkToSignature(public_id: "${firstSignature.public_id}") { short_link } }`;
                const lRes = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: linkMutation })
                });
                const lData = await lRes.json();
                signingLink = lData.data?.createLinkToSignature?.short_link || signingLink;
            } catch (e) { console.error('Rescue failed', e); }
        }

        // FALLBACK FINAL (Último recurso): URL do documento/dashboard
        const finalUrl = signingLink || `https://autentique.com.br/v2/documentos/${docData.id}`;

        const { error: dbError } = await supabaseAdmin
            .from('signatures')
            .insert({
                signer_id: signerId,
                signer_type: signerType,
                autentique_doc_id: docData.id,
                autentique_url: finalUrl,
                status: 'pending',
                metadata: { ...docData, signing_link: signingLink }
            });

        if (dbError) throw dbError;

        return new Response(JSON.stringify({ success: true, documentId: docData.id, url: finalUrl }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('Edge Function Error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });
    }
})
