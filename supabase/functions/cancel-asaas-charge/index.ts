import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { invoice_id } = await req.json()

        if (!invoice_id) {
            throw new Error("ID da fatura não fornecido.");
        }

        // 1. Buscar a fatura para pegar o asaas_payment_id
        const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .select('asaas_payment_id')
            .eq('id', invoice_id)
            .single()

        if (invoiceError || !invoice) {
            throw new Error("Fatura não encontrada.");
        }

        // 2. Se houver asaas_payment_id, tentar cancelar no Asaas
        if (invoice.asaas_payment_id) {
            const { data: configData, error: configError } = await supabase
                .from('integrations_config')
                .select('api_key, endpoint_url, sandbox_api_key, sandbox_endpoint_url, environment')
                .eq('service_name', 'financial_api')
                .single()

            if (!configError) {
                const isSandbox = configData.environment === 'sandbox';
                const asaasKey = isSandbox ? configData.sandbox_api_key : configData.api_key;
                const asaasUrl = isSandbox ? configData.sandbox_endpoint_url : configData.endpoint_url;

                if (asaasKey && asaasUrl) {
                    console.log(`Cancelando pagamento ${invoice.asaas_payment_id} no Asaas...`);
                    const deleteRes = await fetch(`${asaasUrl}/payments/${invoice.asaas_payment_id}`, {
                        method: 'DELETE',
                        headers: {
                            access_token: asaasKey
                        }
                    });

                    const deleteData = await deleteRes.json();

                    // Se não for 200, logamos mas prosseguimos com o cancelamento local? 
                    // Se o erro for "Pagamento não encontrado", podemos ignorar e seguir.
                    if (!deleteRes.ok && deleteData.errors?.[0]?.code !== 'not_found') {
                        throw new Error(`Erro Asaas: ${deleteData.errors?.[0]?.description || 'Falha ao cancelar no Asaas'}`);
                    }
                }
            }
        }

        // 3. Atualizar status no Banco de Dados
        const { error: updateError } = await supabase
            .from('invoices')
            .update({
                status: 'cancelado',
                asaas_status: 'CANCELLED'
            })
            .eq('id', invoice_id)

        if (updateError) throw updateError

        return new Response(
            JSON.stringify({ success: true, message: "Fatura e cobrança canceladas com sucesso." }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
