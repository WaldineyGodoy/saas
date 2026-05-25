
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
                .select('*, consumer_units (*, subscriber:subscribers!subscriber_id (*))')
                .eq('id', invoice_id)
                .single();
            if (invErr) throw invErr;
            invoicesToCharge = [inv];
            subscriber = inv.consumer_units?.subscriber;

            // Fallback: busca direta caso o join não tenha retornado o subscriber
            if (!subscriber && inv.consumer_units?.subscriber_id) {
                const { data: subDirect } = await supabase
                    .from('subscribers')
                    .select('*')
                    .eq('id', inv.consumer_units.subscriber_id)
                    .single();
                subscriber = subDirect;
            }
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
            subscriber = invs[0].consumer_units?.subscriber;

            // Fallback: busca direta caso o join não tenha retornado o subscriber
            if (!subscriber) {
                const { data: subDirect } = await supabase
                    .from('subscribers')
                    .select('*')
                    .eq('id', subscriber_id)
                    .single();
                subscriber = subDirect;
            }
        }

        if (!subscriber) throw new Error("Assinante não encontrado.");


        console.log(`[Asaas Charge] isSandbox: ${isSandbox}, asaasUrl: ${asaasUrl}`);
        console.log(`[Asaas Charge] subscriber: ${subscriber.name} (${subscriber.cpf_cnpj}), existing customer ID: ${subscriber.asaas_customer_id}`);

        // Garantir Cliente no Asaas
        let asaasCustomerId = subscriber.asaas_customer_id;

        // Se asaasCustomerId existir no banco, validar se existe no Asaas
        if (asaasCustomerId) {
            try {
                console.log(`[Asaas Charge] Validando ID de cliente existente: ${asaasCustomerId}`);
                const checkRes = await fetch(`${asaasUrl}/customers/${asaasCustomerId}`, {
                    headers: { access_token: asaasKey }
                });
                console.log(`[Asaas Charge] Resposta de validação: Status ${checkRes.status}`);
                if (!checkRes.ok) {
                    console.log(`[Asaas Charge] Cliente ${asaasCustomerId} não é válido no Asaas (Status ${checkRes.status}). Limpando ID e buscando/criando de novo.`);
                    asaasCustomerId = null;
                }
            } catch (err) {
                console.error(`[Asaas Charge] Erro ao validar cliente no Asaas:`, err.message);
                // No caso de erro de rede ou similar, mantemos o ID para evitar re-criações errôneas
            }
        }

        if (!asaasCustomerId) {
            const customerData = {
                name: subscriber.name,
                cpfCnpj: subscriber.cpf_cnpj?.replace(/\D/g, ''),
                email: subscriber.email,
                phone: subscriber.phone?.replace(/\D/g, ''),
                notificationDisabled: true
            };
            console.log(`[Asaas Charge] Buscando/Criando cliente com cpfCnpj: ${customerData.cpfCnpj}`);
            
            let foundInAsaas = false;
            if (customerData.cpfCnpj) {
                const searchRes = await fetch(`${asaasUrl}/customers?cpfCnpj=${customerData.cpfCnpj}`, { headers: { access_token: asaasKey } });
                const searchData = await searchRes.json();
                console.log(`[Asaas Charge] Busca por CPF/CNPJ retornou ${searchData.data?.length || 0} resultados`);
                if (searchData.data && searchData.data.length > 0) {
                    asaasCustomerId = searchData.data[0].id;
                    foundInAsaas = true;
                    console.log(`[Asaas Charge] Encontrado ID existente no Asaas: ${asaasCustomerId}`);
                }
            }

            if (!foundInAsaas) {
                console.log(`[Asaas Charge] Criando novo cliente no Asaas...`);
                const createRes = await fetch(`${asaasUrl}/customers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', access_token: asaasKey },
                    body: JSON.stringify(customerData)
                });
                const createData = await createRes.json();
                if (createData.errors) {
                    console.error(`[Asaas Charge] Erro na criação de cliente:`, JSON.stringify(createData.errors));
                    throw new Error(`Erro Asaas Customer: ${createData.errors[0].description}`);
                }
                asaasCustomerId = createData.id;
                console.log(`[Asaas Charge] Novo cliente criado com ID: ${asaasCustomerId}`);
            }
            
            if (asaasCustomerId) {
                console.log(`[Asaas Charge] Atualizando ID do cliente no banco de dados: ${asaasCustomerId}`);
                await supabase.from('subscribers').update({ asaas_customer_id: asaasCustomerId }).eq('id', subscriber.id);
            }
        }

        if (!asaasCustomerId) {
            throw new Error("Erro Asaas: Não foi possível obter ou criar o ID do cliente.");
        }

        const totalValue = invoicesToCharge.reduce((acc, inv) => acc + Number(inv.valor_a_pagar || 0), 0);
        
        let dueDate = customDueDate;
        if (!dueDate && invoicesToCharge[0]) {
            const refMonth = invoicesToCharge[0].mes_referencia;
            const dueDay = invoicesToCharge[0].consumer_units?.dia_vencimento;
            if (refMonth && dueDay) {
                const [yStr, mStr] = refMonth.split('-');
                let year = parseInt(yStr, 10);
                let month = parseInt(mStr, 10);
                
                let nextMonth = month + 1;
                let nextYear = year;
                if (nextMonth > 12) {
                    nextMonth = 1;
                    nextYear = year + 1;
                }
                
                const formattedDay = String(dueDay).padStart(2, '0');
                let formattedMonth = String(nextMonth).padStart(2, '0');
                
                let calculatedDateStr = `${nextYear}-${formattedMonth}-${formattedDay}`;
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const [curY, curM, curD] = today.toISOString().split('T')[0].split('-');
                const todayObj = new Date(Number(curY), Number(curM) - 1, Number(curD));
                
                const calcDateObj = new Date(nextYear, nextMonth - 1, dueDay);
                
                if (calcDateObj < todayObj) {
                    nextMonth += 1;
                    if (nextMonth > 12) {
                        nextMonth = 1;
                        nextYear += 1;
                    }
                    formattedMonth = String(nextMonth).padStart(2, '0');
                    calculatedDateStr = `${nextYear}-${formattedMonth}-${formattedDay}`;
                }
                
                dueDate = calculatedDateStr;
            } else {
                dueDate = invoicesToCharge[0].vencimento;
            }
        }
        if (!dueDate) {
            dueDate = new Date().toISOString().split('T')[0];
        }

        // Garantir valor com no máximo duas casas decimais
        const roundedValue = Number(totalValue.toFixed(2));

        const paymentPayload = {
            customer: asaasCustomerId,
            billingType: 'BOLETO',
            value: roundedValue,
            dueDate: dueDate,
            description: isConsolidated ? `Fatura Consolidada - ${invoicesToCharge.length} UCs` : `Fatura de Energia - Ref: ${invoicesToCharge[0].mes_referencia}`,
        };

        console.log(`[Asaas Charge] Criando cobrança com payload:`, JSON.stringify(paymentPayload));

        const chargeRes = await fetch(`${asaasUrl}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', access_token: asaasKey },
            body: JSON.stringify(paymentPayload)
        });

        const chargeData = await chargeRes.json();
        console.log(`[Asaas Charge] Resposta de cobrança: Status ${chargeRes.status}`, JSON.stringify(chargeData));

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
