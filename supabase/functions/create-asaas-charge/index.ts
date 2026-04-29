
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

        const { invoice_id, subscriber_id, invoice_ids, dueDate: customDueDate } = await req.json()

        const { data: configData, error: configError } = await supabase
            .from('integrations_config')
            .select('api_key, endpoint_url, sandbox_api_key, sandbox_endpoint_url, environment')
            .eq('service_name', 'financial_api')
            .single()

        if (configError) throw new Error('Integração Asaas não configurada.')

        const isSandbox = configData.environment === 'sandbox';
        const asaasKey = isSandbox ? configData.sandbox_api_key : configData.api_key;
        const asaasUrl = isSandbox ? configData.sandbox_endpoint_url : configData.endpoint_url;

        let invoicesToCharge = [];
        let subscriber = null;
        let isConsolidated = false;

        if (invoice_id) {
            const { data: inv, error: invErr } = await supabase
                .from('invoices')
                .select('*, consumer_units (subscriber:subscribers!subscriber_id (*))')
                .eq('id', invoice_id)
                .single();
            if (invErr) throw invErr;
            invoicesToCharge = [inv];
            subscriber = inv.consumer_units?.subscriber;
        } else if (subscriber_id) {
            isConsolidated = true;
            let query = supabase
                .from('invoices')
                .select('*, consumer_units!inner (subscriber_id, subscriber:subscribers!subscriber_id (*))')
                .eq('consumer_units.subscriber_id', subscriber_id)
                .neq('status', 'pago')
                .neq('status', 'cancelado') // CRITICAL: Excluir canceladas
                .is('asaas_payment_id', null);

            if (invoice_ids && invoice_ids.length > 0) {
                query = query.in('id', invoice_ids);
            }

            const { data: invs, error: invsErr } = await query;
            if (invsErr) throw invsErr;
            if (!invs || invs.length === 0) 
                throw new Error("Nenhuma fatura pendente/ativa e sem cobrança prévia encontrada para este assinante.");

            invoicesToCharge = invs;
            subscriber = invs[0].consumer_units.subscriber;
        }

        if (!subscriber) throw new Error("Assinante não encontrado.");

        // Garantir Cliente no Asaas
        let asaasCustomerId = subscriber.asaas_customer_id;
        if (!asaasCustomerId) {
            const customerData = {
                name: subscriber.name,
                cpfCnpj: subscriber.cpf_cnpj?.replace(/\D/g, ''),
                email: subscriber.email,
                phone: subscriber.phone?.replace(/\D/g, '')
            };
            const searchRes = await fetch(`${asaasUrl}/customers?cpfCnpj=${customerData.cpfCnpj}`, { headers: { access_token: asaasKey } });
            const searchData = await searchRes.json();
            if (searchData.data && searchData.data.length > 0) {
                asaasCustomerId = searchData.data[0].id;
            } else {
                const createRes = await fetch(`${asaasUrl}/customers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', access_token: asaasKey },
                    body: JSON.stringify(customerData)
                });
                const createData = await createRes.json();
                if (createData.errors) throw new Error(`Erro Asaas Customer: ${createData.errors[0].description}`);
                asaasCustomerId = createData.id;
            }
            await supabase.from('subscribers').update({ asaas_customer_id: asaasCustomerId }).eq('id', subscriber.id);
        }

        const totalValue = invoicesToCharge.reduce((acc, inv) => acc + Number(inv.valor_a_pagar || 0), 0);
        const dueDate = customDueDate || invoicesToCharge[0].vencimento || new Date().toISOString().split('T')[0];

        const chargeRes = await fetch(`${asaasUrl}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', access_token: asaasKey },
            body: JSON.stringify({
                customer: asaasCustomerId,
                billingType: 'BOLETO',
                value: totalValue,
                dueDate: dueDate,
                description: isConsolidated ? `Fatura Consolidada - ${invoicesToCharge.length} UCs` : `Fatura de Energia - Ref: ${invoicesToCharge[0].mes_referencia}`,
            })
        });

        const chargeData = await chargeRes.json();
        if (chargeData.errors) throw new Error(`Erro Asaas Payment: ${chargeData.errors[0].description}`);

        const boletoUrl = chargeData.bankSlipUrl || chargeData.invoiceUrl;
        const invoiceIds = invoicesToCharge.map(i => i.id);

        let consolidatedId = null;
        if (isConsolidated) {
            const { data: cons, error: consErr } = await supabase.from('consolidated_invoices').insert({
                subscriber_id: subscriber.id,
                total_value: totalValue,
                due_date: dueDate,
                asaas_payment_id: chargeData.id,
                asaas_boleto_url: boletoUrl,
                status: 'pending'
            }).select().single();
            if (consErr) throw consErr;
            consolidatedId = cons.id;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [y, m, d] = dueDate.split('-');
        const dueDateObj = new Date(Number(y), Number(m) - 1, Number(d));
        const newStatus = dueDateObj < today ? 'atrasado' : 'a_vencer';

        await supabase.from('invoices')
            .update({
                asaas_payment_id: chargeData.id,
                asaas_boleto_url: boletoUrl,
                asaas_status: 'PENDING',
                consolidated_invoice_id: consolidatedId,
                vencimento: dueDate, // Sincronizar data de vencimento
                status: newStatus // Transição automática de status
            })
            .in('id', invoiceIds);

        // --- REMOVIDO: A captura proativa do PDF bruto causava o download incompleto (apenas boleto) ---
        // O PDF completo (Resumo + Boleto + Contas) será gerado e persistido no primeiro download/notificação.

        // Registrar no Histórico
        const historyEntries = invoiceIds.map(id => ({
            entity_type: 'invoice',
            entity_id: id,
            action: 'payment_issued',
            details: { asaas_id: chargeData.id, consolidated: isConsolidated, value: totalValue }
        }));

        if (isConsolidated) {
            historyEntries.push({
                entity_type: 'consolidated_invoice',
                entity_id: consolidatedId,
                action: 'created',
                details: { asaas_id: chargeData.id, total_value: totalValue, invoices_count: invoiceIds.length }
            });
        }

        await supabase.from('entity_history').insert(historyEntries);

        return new Response(
            JSON.stringify({ success: true, url: boletoUrl, paymentId: chargeData.id, consolidatedId }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})

// Função auxiliar para baixar o PDF do Asaas com retentativas
async function downloadAsaasPdf(url: string, apiKey: string): Promise<ArrayBuffer | null> {
    let retries = 5;
    const headers = { 
        'access_token': apiKey,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    while (retries > 0) {
        try {
            const res = await fetch(url, { headers });
            if (res.ok) {
                const contentType = res.headers.get('content-type');
                if (contentType && contentType.includes('application/pdf')) {
                    return await res.arrayBuffer();
                } else if (contentType && contentType.includes('text/html')) {
                    console.warn(`Asaas retornou HTML (página de carregamento). Retentando em 5s... (${retries} restantes)`);
                }
            } else {
                console.warn(`Erro ao baixar PDF (Status ${res.status}). Retentando...`);
            }
        } catch (err) {
            console.error('Erro de rede na captura do PDF:', err.message);
        }
        
        await new Promise(r => setTimeout(r, 5000)); // Espera 5s entre retentativas
        retries--;
    }
    return null;
}
