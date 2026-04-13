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

        // 1. Buscar configuração da Autentique
        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'autentique_api')
            .single();

        if (configError || !config) {
            throw new Error('Configuração da Autentique não encontrada.');
        }

        const isSandbox = config.environment === 'sandbox';
        const endpoint = isSandbox ? config.sandbox_endpoint_url : config.endpoint_url;
        const apiKey = isSandbox ? config.sandbox_api_key : config.api_key;

        // 2. Preparar o arquivo
        const binaryString = atob(fileBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const fileBlob = new Blob([bytes], { type: 'application/pdf' });

        // 3. Mutation de Criação
        const createMutation = `
            mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
                createDocument(sandbox: ${isSandbox}, document: $document, signers: $signers, file: $file) {
                    id
                    signatures {
                        public_id
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
        if (result.errors) throw new Error(`Autentique Create Error: ${result.errors[0].message}`);

        const docData = result.data.createDocument;
        const documentId = docData.id;
        const firstSignature = docData.signatures?.[0];
        let signingLink = firstSignature?.link?.short_link;

        // 4. Lógica de Resiliência para capturar o short_link (assina.ae)
        if (!signingLink && firstSignature?.public_id) {
            // Aguardar um pouco para processamento interno da Autentique
            await sleep(1500);

            // TENTATIVA 2: Mutation createLinkToSignature
            try {
                const linkMutation = `
                    mutation GenerateLink($public_id: String!) {
                        createLinkToSignature(public_id: $public_id) {
                            short_link
                        }
                    }
                `;

                const linkRes = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: linkMutation, variables: { public_id: firstSignature.public_id } })
                });

                const linkData = await linkRes.json();
                signingLink = linkData.data?.createLinkToSignature?.short_link;
            } catch (e) {
                console.error('Tentativa 2 falhou:', e);
            }

            // TENTATIVA 3: Query Document redundante
            if (!signingLink) {
                try {
                    const queryDoc = `
                        query GetDoc($id: String!) {
                            document(id: $id) {
                                signatures {
                                    link {
                                        short_link
                                    }
                                }
                            }
                        }
                    `;
                    const queryRes = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: queryDoc, variables: { id: documentId } })
                    });
                    const queryData = await queryRes.json();
                    signingLink = queryData.data?.document?.signatures?.[0]?.link?.short_link;
                } catch (e) {
                    console.error('Tentativa 3 falhou:', e);
                }
            }
        }

        // Se após tudo ainda for nulo, usamos o link do dashboard (não ideal, mas evita blank)
        const finalUrl = signingLink || `https://autentique.com.br/v2/documentos/${documentId}`;

        // 5. Salvar na tabela signatures
        const { error: dbError } = await supabaseAdmin
            .from('signatures')
            .insert({
                signer_id: signerId,
                signer_type: signerType,
                autentique_doc_id: documentId,
                autentique_url: finalUrl,
                status: 'pending',
                metadata: { ...docData, environment: config.environment, captured_link: !!signingLink }
            });

        if (dbError) throw dbError;

        return new Response(JSON.stringify({ success: true, documentId, url: finalUrl }), {
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
