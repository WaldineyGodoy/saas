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

        const { token_amount, price, user_id } = await req.json()

        if (!token_amount || !price || !user_id) {
            throw new Error('Faltam parâmetros obrigatórios.')
        }

        const { data: configData, error: configError } = await supabase
            .from('integrations_config')
            .select('api_key, endpoint_url, sandbox_api_key, sandbox_endpoint_url, environment')
            .eq('service_name', 'financial_api')
            .single()

        if (configError) throw new Error('Integração Asaas não configurada.')

        const isSandbox = configData.environment === 'sandbox';
        const asaasKey = isSandbox ? configData.sandbox_api_key : configData.api_key;
        const asaasUrl = isSandbox ? configData.sandbox_endpoint_url : configData.endpoint_url;

        // Fetch User Profile
        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user_id)
            .single();

        if (profileErr || !profile) {
            throw new Error('Perfil de usuário não encontrado.');
        }

        // Try getting customer id from subscribers if they also have a subscriber account
        let asaasCustomerId = null;
        const { data: subData } = await supabase
            .from('subscribers')
            .select('asaas_customer_id')
            .eq('cpf_cnpj', profile.cpf_cnpj)
            .maybeSingle();
        
        if (subData && subData.asaas_customer_id) {
            asaasCustomerId = subData.asaas_customer_id;
        }

        if (!asaasCustomerId) {
            // Create Customer
            const customerData = {
                name: profile.name,
                cpfCnpj: profile.cpf_cnpj?.replace(/\D/g, ''),
                email: profile.email,
                phone: profile.phone?.replace(/\D/g, ''),
                notificationDisabled: true
            };
            
            let foundInAsaas = false;
            if (customerData.cpfCnpj) {
                const searchRes = await fetch(`${asaasUrl}/customers?cpfCnpj=${customerData.cpfCnpj}`, { headers: { access_token: asaasKey } });
                const searchData = await searchRes.json();
                if (searchData.data && searchData.data.length > 0) {
                    asaasCustomerId = searchData.data[0].id;
                    foundInAsaas = true;
                }
            }

            if (!foundInAsaas) {
                const createRes = await fetch(`${asaasUrl}/customers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', access_token: asaasKey },
                    body: JSON.stringify(customerData)
                });
                const createData = await createRes.json();
                if (createData.errors) {
                    throw new Error(`Erro Asaas Customer: ${createData.errors[0].description}`);
                }
                asaasCustomerId = createData.id;
            }
        }

        if (!asaasCustomerId) {
            throw new Error("Erro Asaas: Não foi possível obter ou criar o ID do cliente.");
        }

        // Create Pix Payment
        const paymentPayload = {
            customer: asaasCustomerId,
            billingType: 'UNDEFINED',
            value: price,
            dueDate: new Date().toISOString().split('T')[0],
            description: `Recarga de ${token_amount} Tokens - Antigravity`,
        };

        const chargeRes = await fetch(`${asaasUrl}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', access_token: asaasKey },
            body: JSON.stringify(paymentPayload)
        });

        const chargeData = await chargeRes.json();

        if (chargeData.errors) throw new Error(`Erro Asaas Payment: ${chargeData.errors[0].description}`);

        // Register in token_transactions
        const { error: txErr } = await supabase.from('token_transactions').insert({
            profile_id: user_id,
            amount: token_amount,
            type: 'recharge',
            status: 'pending',
            asaas_payment_id: chargeData.id,
            description: `Recarga de ${token_amount} Tokens`
        });

        if (txErr) {
            console.error('Error inserting token transaction:', txErr);
            throw txErr;
        }
        
        let qrCode = null;
        let pixPayload = null;
        let invoiceUrl = chargeData.invoiceUrl;

        try {
            const qrRes = await fetch(`${asaasUrl}/payments/${chargeData.id}/pixQrCode`, {
                headers: { access_token: asaasKey }
            });
            if (qrRes.ok) {
                const qrData = await qrRes.json();
                qrCode = qrData.encodedImage;
                pixPayload = qrData.payload;
            }
        } catch(e) {
            console.error("Error getting QR code", e);
        }

        return new Response(
            JSON.stringify({ success: true, paymentId: chargeData.id, invoiceUrl, qrCode, pixPayload }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error("Edge function error:", error.message);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    }
})
