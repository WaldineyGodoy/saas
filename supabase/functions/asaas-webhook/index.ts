
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // 1. Get Financial Config for Security and API access
        const { data: finConfig, error: finError } = await supabase
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'financial_api')
            .single();

        if (finError || !finConfig) {
            console.error('Financial integration not configured');
            throw new Error('Financial integration not configured');
        }

        // Security Check: Validate Asaas Webhook Token
        const receivedToken = req.headers.get('asaas-access-token');
        if (finConfig.secret_key && receivedToken !== finConfig.secret_key) {
            console.error('Invalid Asaas access token');
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const eventData = await req.json();
        const { event, payment } = eventData;

        console.log(`Webhook Event: ${event}`, payment);

        if (!payment || !payment.id) {
            return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 2. Identify Invoice Type (Individual or Consolidated)
        let invoicesToProcess = [];
        let isConsolidated = false;

        // Try individual first
        const { data: individualInvoice } = await supabase
            .from('invoices')
            .select(`*, consumer_units (*)`)
            .eq('asaas_payment_id', payment.id)
            .maybeSingle();

        if (individualInvoice) {
            invoicesToProcess = [individualInvoice];
        } else {
            // Try consolidated
            const { data: consolidatedInvoice } = await supabase
                .from('consolidated_invoices')
                .select('*')
                .eq('asaas_payment_id', payment.id)
                .maybeSingle();

            if (consolidatedInvoice) {
                isConsolidated = true;
                // Update consolidated status
                if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event)) {
                    await supabase.from('consolidated_invoices').update({ status: 'paid' }).eq('id', consolidatedInvoice.id);
                }

                // Get linked individual invoices
                const { data: linkedInvoices } = await supabase
                    .from('invoices')
                    .select(`*, consumer_units (*)`)
                    .eq('consolidated_invoice_id', consolidatedInvoice.id);
                
                invoicesToProcess = linkedInvoices || [];
            }
        }

        if (invoicesToProcess.length === 0) {
            console.warn(`No invoice found for payment.id: ${payment.id}`);
            return new Response(JSON.stringify({ received: true, status: 'ignored' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 3. Update Invoice Status
        let newStatus = '';
        let asaasStatus = '';

        if (event === 'PAYMENT_CONFIRMED') {
            newStatus = 'confirmado';
            asaasStatus = 'CONFIRMED';
        } else if (event === 'PAYMENT_RECEIVED') {
            newStatus = 'pago';
            asaasStatus = 'RECEIVED';
        } else if (['PAYMENT_OVERDUE'].includes(event)) {
            newStatus = 'atrasado';
            asaasStatus = 'OVERDUE';
        }

        if (newStatus) {
            const { error: updateError } = await supabase
                .from('invoices')
                .update({ status: newStatus, asaas_status: asaasStatus })
                .in('id', invoicesToProcess.map(i => i.id));
            
            if (updateError) console.error('Error updating invoices:', updateError);

            // NEW: Register Consolidated Bank Fee if applicable (Only on definitive payment)
            if (event === 'PAYMENT_RECEIVED' && isConsolidated) {
                const { data: consolidated } = await supabase
                    .from('consolidated_invoices')
                    .select('id')
                    .eq('asaas_payment_id', payment.id)
                    .single();

                if (consolidated) {
                    const taxaValue = (new Date() < new Date('2026-04-19')) ? 0.99 : 1.99;
                    await supabase.rpc('register_consolidated_fee', {
                        p_consolidated_invoice_id: consolidated.id,
                        p_amount: taxaValue,
                        p_is_sandbox: finConfig.environment === 'sandbox'
                    });
                }
            }
        }

        // 4. Automation: Auto Payment of Energy Bill (STRICTLY ON PAYMENT_RECEIVED)
        if (event === 'PAYMENT_RECEIVED') {
            const isAutoPaymentEnabled = finConfig?.variables?.auto_payment === true;

            if (isAutoPaymentEnabled) {
                const isSandbox = finConfig.environment === 'sandbox';
                const asaasKey = isSandbox ? finConfig.sandbox_api_key : finConfig.api_key;
                const asaasUrl = isSandbox ? finConfig.sandbox_endpoint_url : finConfig.endpoint_url;

                for (const inv of invoicesToProcess) {
                    // Criteria Check
                    const isAutoConsumo = inv.consumer_units?.modalidade === 'auto_consumo_remoto';
                    const hasLinhaDigitavel = !!inv.linha_digitavel;

                    if (isAutoConsumo && hasLinhaDigitavel) {
                        try {
                            const valorParaPagar = Number(inv.valor_concessionaria) || (
                                (Number(inv.iluminacao_publica) || 0) + 
                                (Number(inv.tarifa_minima) || 0) + 
                                (Number(inv.outros_lancamentos) || 0) + 
                                (Number(inv.consumo_reais) || 0)
                            );

                            if (valorParaPagar <= 0) throw new Error('Valor inválido para pagamento');

                            console.log(`Processing Auto Payment for Invoice ${inv.id} - Value: ${valorParaPagar}`);

                            const billResponse = await fetch(`${asaasUrl}/bill`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'access_token': asaasKey
                                },
                                body: JSON.stringify({
                                    identificationField: inv.linha_digitavel,
                                    scheduleDate: new Date().toISOString().split('T')[0], // Immediate
                                    description: `Pagamento Automático Concessionária - UC ${inv.consumer_units?.numero_uc}`,
                                    value: valorParaPagar
                                })
                            });

                            let billData;
                            const responseText = await billResponse.text();
                            
                            try {
                                billData = responseText ? JSON.parse(responseText) : {};
                            } catch (e) {
                                throw new Error(`Resposta inválida do Asaas (Status ${billResponse.status}): ${responseText || 'Corpo vazio'}`);
                            }

                            if (!billResponse.ok || billData.errors) {
                                const errorMsg = billData.errors ? billData.errors[0].description : `Erro ${billResponse.status}`;
                                throw new Error(errorMsg);
                            }

                            // Success History
                            await supabase.from('crm_history').insert({
                                entity_type: 'invoice',
                                entity_id: inv.id,
                                content: `Pagamento automático da conta de energia realizado via Asaas. Protocolo: ${billData.id}`,
                                metadata: { asaas_id: billData.id, value: valorParaPagar }
                            });

                            // NEW: Register Liquidation in Ledger
                            const { error: ledgerError } = await supabase.rpc('liquidate_concessionaria_payment', {
                                p_invoice_id: inv.id,
                                p_amount: valorParaPagar
                            });
                            
                            if (ledgerError) console.error(`Ledger Liquidation Error for ${inv.id}:`, ledgerError);

                        } catch (err) {
                            console.error(`Auto Payment Failed for Invoice ${inv.id}:`, err.message);
                            
                            // Update Status to Error
                            await supabase.from('invoices').update({ status: 'erro' }).eq('id', inv.id);

                            // Failure History
                            await supabase.from('crm_history').insert({
                                entity_type: 'invoice',
                                entity_id: inv.id,
                                content: `FALHA no pagamento automático: ${err.message}. Status alterado para ERRO.`,
                                metadata: { error: err.message, status: 'erro' }
                            });
                        }
                    }
                }
            }
        }

        return new Response(
            JSON.stringify({ received: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Webhook processing error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
