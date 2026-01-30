import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { amount, pixKey, pixKeyType, description, usinaId } = await req.json()

        // 1. Validation
        if (!amount || !pixKey) {
            throw new Error('Missing required fields: amount or pixKey')
        }

        // 2. Auth Check (Mocked or Real)
        // In a real scenario, check if user is admin via Supabase Auth context

        // 3. Call Asaas API (Simulated if no API Key, but code structure is real)
        const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY')
        const ASAAS_URL = Deno.env.get('ASAAS_API_URL') || 'https://sandbox.asaas.com/api/v3'

        let transferId = 'simulated_' + crypto.randomUUID();
        let status = 'DONE';

        if (ASAAS_API_KEY) {
            // Real Call
            const transferPayload = {
                value: amount,
                pixAddressKey: pixKey,
                pixAddressKeyType: pixKeyType, // 'CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'
                description: description || 'Repasse Usina',
                operationType: 'PIX'
            };

            const response = await fetch(`${ASAAS_URL}/transfers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'access_token': ASAAS_API_KEY
                },
                body: JSON.stringify(transferPayload)
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.errors?.[0]?.description || 'Asaas Transfer Failed');
            }

            transferId = data.id;
            status = data.status; // 'PENDING' usually
        } else {
            console.log("Simulating Asaas Transfer:", { amount, pixKey });
            // Simulate delay
            await new Promise(r => setTimeout(r, 1000));
        }

        return new Response(
            JSON.stringify({
                success: true,
                transferId,
                status,
                message: 'Transferência iniciada com sucesso'
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            }
        )
    }
})
