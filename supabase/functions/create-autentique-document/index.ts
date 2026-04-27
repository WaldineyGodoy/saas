import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const extractSigningLink = (signatures: any[]) => {
    if (!signatures || !Array.isArray(signatures)) return null;
    // Buscamos em toda a lista pela primeira assinatura que possua um link curto válido
    const sigWithLink = signatures.find(s => s.link && s.link.short_link);
    return sigWithLink ? sigWithLink.link.short_link : null;
};

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

        console.log(`Recebido documento: ${documentName} (${fileBase64?.length || 0} chars base64)`);

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

        // 1. Criar o Documento
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
        const documentId = docData.id;
        
        let signingLink = extractSigningLink(docData.signatures);
        let capturedVia = signingLink ? 'immediate_scan' : 'none';

        // 2. BACKUP: Se não encontrou de imediato, tenta consulta redundante
        let debugSignatures = null;
        if (!signingLink) {
            await sleep(3500);
            try {
                const queryDoc = `
                    query GetDoc($id: String!) {
                        document(id: $id) {
                            signatures {
                                name
                                link {
                                    short_link
                                }
                            }
                        }
                    }
                `;
                const qRes = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: queryDoc, variables: { id: documentId } })
                });
                const qData = await qRes.json();
                debugSignatures = qData.data?.document?.signatures;
                signingLink = extractSigningLink(debugSignatures);
                if (signingLink) capturedVia = 'post_query_scan';
            } catch (e) { console.error('Redundancy check failed', e); }
        }

        // 3. Fallback final
        const finalUrl = signingLink || `https://autentique.com.br/v2/documentos/${documentId}`;

        // 4. Salvar na tabela signatures
        const { error: dbError } = await supabaseAdmin
            .from('signatures')
            .insert({
                signer_id: signerId,
                signer_type: signerType,
                autentique_doc_id: documentId,
                autentique_url: finalUrl,
                status: 'pending',
                metadata: { 
                    ...docData, 
                    debug_signatures: debugSignatures,
                    captured_via: signingLink ? capturedVia : 'fallback'
                }
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
