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

        const { invoice_id, value, dueDate } = await req.json()

        if (!invoice_id) {
            throw new Error("ID da fatura não fornecido.");
        }

        // 1. Buscar a fatura para pegar o asaas_payment_id
        const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .select('asaas_payment_id, status')
            .eq('id', invoice_id)
            .single()

        if (invoiceError || !invoice) {
            throw new Error("Fatura não encontrada.");
        }

        // 2. Só atualizar se houver asaas_payment_id
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

            // Validar dados
            if (!value || value <= 0) {
                console.warn(`Tentativa de atualizar pagamento ${invoice.asaas_payment_id} com valor inválido: ${value}`);
                // Não lançamos erro aqui, apenas não enviamos ao Asaas se o valor for zero ou nulo
                // Mas geralmente o Asaas exige valor positivo.
            }

            console.log(`Sync Asaas: Atualizando ${invoice.asaas_payment_id} | Valor: ${value} | Vencimento: ${dueDate}`);

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
            console.log(`Asaas Response (${updateRes.status}): ${responseText}`);

            let resultData;
            try {
                resultData = JSON.parse(responseText);
            } catch (e) {
                resultData = { error: responseText };
            }

            if (!updateRes.ok) {
                // Extrair descrição amigável do erro do Asaas
                const asaasError = resultData.errors?.[0]?.description || resultData.error || 'Erro desconhecido no Asaas';
                throw new Error(`Asaas: ${asaasError}`);
            }
        }

        return new Response(
            JSON.stringify({ success: true, message: "Sincronização com Asaas concluída." }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Erro na Edge Function update-asaas-charge:', error.message)
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
