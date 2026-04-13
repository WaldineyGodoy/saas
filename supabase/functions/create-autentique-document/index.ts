import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
            throw new Error('Parâmetros obrigatórios ausentes: documentName, signers, fileBase64, signerId, signerType.');
        }

        // 1. Buscar configuração da Autentique
        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'autentique_api')
            .single();

        if (configError || !config) {
            throw new Error('Configuração da Autentique não encontrada no banco de dados.');
        }

        const isSandbox = config.environment === 'sandbox';
        const endpoint = isSandbox ? config.sandbox_endpoint_url : config.endpoint_url;
        const apiKey = isSandbox ? config.sandbox_api_key : config.api_key;

        if (!endpoint || !apiKey) {
            throw new Error('Endpoint ou API Key da Autentique não configurados para o ambiente atual.');
        }

        // 2. Preparar o arquivo (decode base64)
        const binaryString = atob(fileBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const fileBlob = new Blob([bytes], { type: 'application/pdf' });

        // 3. Montar a Mutation GraphQL para criação do documento
        const query = `
            mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
                createDocument(sandbox: ${isSandbox}, document: $document, signers: $signers, file: $file) {
                    id
                    name
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
            query: query,
            variables: {
                document: { name: documentName },
                signers: signers,
                file: null
            }
        }));
        formData.append('map', JSON.stringify({ "0": ["variables.file"] }));
        formData.append('0', fileBlob, `${documentName}.pdf`);

        // 4. Chamada para a Autentique (Criação do Documento)
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            body: formData
        });

        const result = await response.json();

        if (result.errors) {
            console.error('Autentique API Errors (Create):', result.errors);
            throw new Error(result.errors[0].message);
        }

        const docData = result.data.createDocument;
        let signingLink = docData.signatures?.[0]?.link?.short_link;

        // 4.1 Se o short_link estiver ausente (comum no modo LINK sem email), geramos ele agora
        if (!signingLink && docData.signatures?.[0]?.public_id) {
            try {
                const linkMutation = `
                    mutation GenerateLink($public_id: String!) {
                        createLinkToSignature(public_id: $public_id) {
                            short_link
                        }
                    }
                `;

                const linkResponse = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        query: linkMutation,
                        variables: { public_id: docData.signatures[0].public_id }
                    })
                });

                const linkResult = await linkResponse.json();
                if (linkResult.data?.createLinkToSignature?.short_link) {
                    signingLink = linkResult.data.createLinkToSignature.short_link;
                }
            } catch (linkError) {
                console.error('Erro ao gerar link de assinatura secundário:', linkError);
            }
        }

        // Fallback final caso tudo falhe (link do dashboard - privado)
        const finalUrl = signingLink || `https://autentique.com.br/v2/documentos/${docData.id}`;

        // 5. Salvar na tabela signatures
        const { error: dbError } = await supabaseAdmin
            .from('signatures')
            .insert({
                signer_id: signerId,
                signer_type: signerType,
                autentique_doc_id: docData.id,
                autentique_url: finalUrl,
                status: 'pending',
                metadata: { ...docData, environment: config.environment }
            });

        if (dbError) throw dbError;

        return new Response(JSON.stringify({ 
            success: true, 
            documentId: docData.id, 
            url: finalUrl 
        }), {
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
