import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import { corsHeaders } from "../_shared/cors.ts"
import { requireUser } from "../_shared/auth.ts"

/**
 * Tabela de precos do servidor, espelhando PACKAGES de
 * src/pages/StandaloneRecharge.jsx.
 *
 * Enquanto os pacotes viverem so' no cliente, e' aqui que eles viram fato:
 * preco vindo do corpo da requisicao e' preco escolhido por quem paga. O
 * pacote 30 (renovacao mensal do plano Free) nao entra: o botao dele e'
 * desabilitado na tela e cobrar R$ 0 no Asaas nao faz sentido.
 */
const PACKAGES: Record<number, { tokens: number; price: number }> = {
    50: { tokens: 50, price: 49.90 },
    100: { tokens: 100, price: 89.90 },
    200: { tokens: 200, price: 159.90 },
}

const MAX_QUANTITY = 100

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Portao de usuario, nao de admin: esta e' a tela de recarga do proprio
    // saldo. Exigir admin aqui quebraria a funcionalidade para todo mundo.
    const auth = await requireUser(req, supabase)
    if (!auth.ok) {
        return new Response(
            JSON.stringify({ success: false, error: auth.error }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: auth.status }
        )
    }

    try {
        const { package_id, quantity } = await req.json()

        const pkg = PACKAGES[Number(package_id)]
        if (!pkg) {
            throw new Error(`Pacote ${package_id} nao existe ou nao esta a venda.`)
        }

        const qty = Number(quantity ?? 1)
        if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) {
            throw new Error(`Quantidade invalida: informe um inteiro entre 1 e ${MAX_QUANTITY}.`)
        }

        // Preco e quantidade de tokens sao do servidor. O corpo nao opina.
        const token_amount = pkg.tokens * qty
        const price = Number((pkg.price * qty).toFixed(2))

        // O dono da recarga e' quem esta logado, nunca quem o corpo diz ser.
        const user_id = auth.userId

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
