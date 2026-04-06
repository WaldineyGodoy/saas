import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: headers })
    }

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { invoice_id, value, dueDate } = await req.json()

        if (!invoice_id) {
            throw new Error("ID da fatura não fornecido.");
        }

        const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .select('asaas_payment_id, status')
            .eq('id', invoice_id)
            .single()

        if (invoiceError || !invoice) {
            throw new Error("Fatura não encontrada.");
        }

        if (invoice.asaas_payment_id) {
            const { data: configData, error: configError } = await supabase
                .from('integrations_config')
                .select('api_key, endpoint_url, sandbox_api_key, sandbox_endpoint_url, environment')
                .eq('service_name', 'financial_api')
                .single()

            if (configError) throw new Error("Configuração de integração financeira não encontrada.");

            const isSandbox = configData.environment === 'sandbox';
            const asaasKey = isSandbox ? configData.sandbox_api_key : configData.api_key;
            const asaasUrl = isSandbox ? configData.sandbox_endpoint_url : configData.endpoint_url;

            if (!asaasKey || !asaasUrl) {
                throw new Error("Credenciais do Asaas não configuradas.");
            }

            console.log(`Sync Asaas: Atualizando ${invoice.asaas_payment_id}`);

            const updateData: any = {};
            if (value !== undefined && value !== null) updateData.value = value;
            if (dueDate) updateData.dueDate = dueDate;

            const updateRes = await fetch(`${asaasUrl}/payments/${invoice.asaas_payment_id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    access_token: asaasKey
                },
                body: JSON.stringify(updateData)
            });

            const responseText = await updateRes.text();
            console.log(`Asaas Response (${updateRes.status}):`, responseText);

            let resultData;
            try {
                resultData = JSON.parse(responseText);
            } catch (e) {
                resultData = { error: responseText };
            }

            if (!updateRes.ok) {
                const asaasError = resultData.errors?.[0]?.description || resultData.error || 'Erro desconhecido no Asaas';
                const lowerError = asaasError.toLowerCase();

                // Detecção robusta de cobrança removida ou inválida
                const isRemoved = 
                    lowerError.includes('removida') || 
                    lowerError.includes('não encontrada') || 
                    lowerError.includes('not found') || 
                    lowerError.includes('inexistente') ||
                    updateRes.status === 404;
                
                if (isRemoved) {
                    console.warn(`Limpando ID inválido no CRM: ${invoice.asaas_payment_id}`);
                    
                    await supabase.from('invoices')
                        .update({
                            asaas_payment_id: null,
                            asaas_boleto_url: null,
                            asaas_status: null
                        })
                        .eq('id', invoice_id);

                    return new Response(
                        JSON.stringify({ 
                            success: true, 
                            warning: "O boleto anterior foi removido no Asaas. O CRM limpou o vínculo e permitiu o salvamento.",
                            cleared: true 
                        }),
                        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
                    )
                }

                throw new Error(`Asaas: ${asaasError}`);
            }
        }

        return new Response(
            JSON.stringify({ success: true, message: "Sincronização concluída." }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error: any) {
        console.error('Update Asaas Error:', error.message);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
