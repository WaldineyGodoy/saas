import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"

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

        const { invoice_id, type = 'invoice' } = await req.json()

        if (!invoice_id) {
            throw new Error("ID da fatura não fornecido.");
        }

        const table = type === 'consolidated_invoice' ? 'consolidated_invoices' : 'invoices';

        // 1. Buscar a fatura para verificar status e asaas_payment_id
        const { data: invoice, error: invoiceError } = await supabase
            .from(table)
            .select('status, asaas_payment_id')
            .eq('id', invoice_id)
            .single()

        if (invoiceError || !invoice) {
            throw new Error("Fatura não encontrada.");
        }

        // Bloquear cancelamento de faturas já liquidadas ou confirmadas
        if (['confirmado', 'pago'].includes(invoice.status)) {
            throw new Error(`Não é possível cancelar uma fatura com status "${invoice.status}".`);
        }

        // 2. Se houver asaas_payment_id e o status NÃO for 'ag_emissao_boleto', tentar cancelar no Asaas
        if (invoice.asaas_payment_id && invoice.status !== 'ag_emissao_boleto') {
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

                    // Se não for 200, logamos. Se o erro for "Pagamento não encontrado", podemos ignorar.
                    if (!deleteRes.ok && deleteData.errors?.[0]?.code !== 'not_found' && deleteRes.status !== 404) {
                        const errMsg = deleteData.errors?.[0]?.description?.toLowerCase() || '';
                        if (!errMsg.includes('já está cancelado') && !errMsg.includes('already cancelled')) {
                            throw new Error(`Erro Asaas: ${deleteData.errors?.[0]?.description || 'Falha ao cancelar no Asaas'}`);
                        }
                    }
                }
            }
        }

        // 3. Atualizar status no Banco de Dados e limpar metadados do Asaas
        const updatePayload = {
            status: type === 'consolidated_invoice' ? 'canceled' : 'cancelado',
            asaas_status: 'CANCELLED',
            asaas_payment_id: null,
            asaas_boleto_url: null,
            linha_digitavel: null,
            pix_string: null
        };
        
        // Se for consolidada, ela não tem linha_digitavel/pix_string/asaas_status na tabela atualmente
        if (type === 'consolidated_invoice') {
             delete updatePayload.linha_digitavel;
             delete updatePayload.pix_string;
             delete updatePayload.asaas_status;
        }

        const { error: updateError } = await supabase
            .from(table)
            .update(updatePayload)
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
