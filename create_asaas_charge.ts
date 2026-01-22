
// Siga estas instruções para implantar:
// 1. No Painel do Supabase, vá em "Edge Functions".
// 2. Clique em "Create a new Function".
// 3. Nome: "create-asaas-charge".
// 4. Copie e cole este código no editor.
// 5. Vá em "Manage Secrets" (ou .env) e adicione:
//    - ASAAS_API_KEY: (Cole seu token aqui)
//    - ASAAS_API_URL: https://sandbox.asaas.com/api/v3 (Para homologação) ou https://www.asaas.com/api/v3 (Para produção)

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

        const { invoice_id, subscriber_id } = await req.json()
        const asaasUrl = Deno.env.get('ASAAS_API_URL') || 'https://sandbox.asaas.com/api/v3';
        const asaasKey = Deno.env.get('ASAAS_API_KEY');

        if (!asaasKey) throw new Error('ASAAS_API_KEY não configurada.');

        let invoicesToCharge = [];
        let subscriber = null;

        // 1. Buscar Faturas e Assinante
        if (invoice_id) {
            // Cobrança Individual
            const { data: inv, error: invErr } = await supabase
                .from('invoices')
                .select(`
            *,
            consumer_units (
                subscriber:subscribers (*)
            )
        `)
                .eq('id', invoice_id)
                .single();

            if (invErr) throw invErr;
            invoicesToCharge = [inv];
            subscriber = inv.consumer_units?.subscriber;

        } else if (subscriber_id) {
            // Cobrança Consolidada (Todas as faturas 'pendentes' do assinante)
            const { data: invs, error: invsErr } = await supabase
                .from('invoices')
                .select(`
                *,
                consumer_units!inner (
                    subscriber_id,
                    subscriber:subscribers (*)
                )
            `)
                .eq('consumer_units.subscriber_id', subscriber_id)
                .neq('status', 'pago') // Ajuste conforme seus status (ex: 'aberta', 'pendente')
                .is('asaas_payment_id', null); // Apenas as que ainda não tem boleto

            if (invsErr) throw invsErr;
            if (!invs || invs.length === 0) throw new Error("Nenhuma fatura pendente encontrada para este assinante.");

            invoicesToCharge = invs;
            subscriber = invs[0].consumer_units.subscriber;
        } else {
            throw new Error("Parâmetros inválidos. Informe invoice_id ou subscriber_id.");
        }

        if (!subscriber) throw new Error("Assinante não encontrado.");

        // 2. Garantir Cliente no Asaas
        let asaasCustomerId = subscriber.asaas_customer_id;

        if (!asaasCustomerId) {
            console.log("Criando cliente no Asaas...");
            const customerData = {
                name: subscriber.name,
                cpfCnpj: subscriber.cpf_cnpj?.replace(/\D/g, ''),
                email: subscriber.email,
                phone: subscriber.phone?.replace(/\D/g, ''),
                notificationDisabled: false
            };

            // Buscar cliente existente por CPF/Email primeiro para evitar duplicidade no Asaas?
            // O Asaas permite buscar. Vamos tentar criar direto, se der erro de duplicidade tratamos? 
            // Melhor buscar.
            const searchRes = await fetch(`${asaasUrl}/customers?cpfCnpj=${customerData.cpfCnpj}`, {
                headers: { access_token: asaasKey }
            });
            const searchData = await searchRes.json();

            if (searchData.data && searchData.data.length > 0) {
                asaasCustomerId = searchData.data[0].id;
            } else {
                const createRes = await fetch(`${asaasUrl}/customers`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        access_token: asaasKey
                    },
                    body: JSON.stringify(customerData)
                });
                const createData = await createRes.json();
                if (createData.errors) throw new Error(`Erro Asaas Customer: ${createData.errors[0].description}`);
                asaasCustomerId = createData.id;
            }

            // Salvar no banco
            await supabase.from('subscribers').update({ asaas_customer_id: asaasCustomerId }).eq('id', subscriber.id);
        }

        // 3. Gerar Cobrança (Boleto)
        // Somar valor total
        const totalValue = invoicesToCharge.reduce((acc, inv) => acc + Number(inv.valor_a_pagar || 0), 0);
        // Usar a menor data de vencimento ou a do primeiro? Vamos usar a do primeiro.
        const dueDate = invoicesToCharge[0].vencimento || new Date().toISOString().split('T')[0];

        const billingData = {
            customer: asaasCustomerId,
            billingType: 'BOLETO',
            value: totalValue,
            dueDate: dueDate,
            description: `Fatura de Energia - Ref: ${invoicesToCharge.map(i => i.mes_referencia).join(', ')}`,
            postalService: false
        };

        const chargeRes = await fetch(`${asaasUrl}/payments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                access_token: asaasKey
            },
            body: JSON.stringify(billingData)
        });

        const chargeData = await chargeRes.json();
        if (chargeData.errors) throw new Error(`Erro Asaas Payment: ${chargeData.errors[0].description}`);

        const boletoUrl = chargeData.bankSlipUrl || chargeData.invoiceUrl; // Às vezes bankSlipUrl

        // 4. Atualizar Faturas com o ID do pagamento
        const invoiceIds = invoicesToCharge.map(i => i.id);
        await supabase.from('invoices')
            .update({
                asaas_payment_id: chargeData.id,
                asaas_boleto_url: boletoUrl,
                asaas_status: 'PENDING'
            })
            .in('id', invoiceIds);


        return new Response(
            JSON.stringify({ success: true, url: boletoUrl, paymentId: chargeData.id }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
