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
        const body = await req.json()
        const amount = body.amount ?? body.value
        const pixKey = body.pixKey ?? body.pix_key
        const pixKeyType = body.pixKeyType ?? body.pix_key_type
        const description = body.description
        const usinaId = body.usinaId ?? body.usina_id
        const supplierId = body.supplierId ?? body.supplier_id
        const destinationType = body.destinationType ?? (supplierId ? 'supplier' : 'usina')
        const destinationId = supplierId ?? usinaId

        // 1. Validation
        if (!amount || !pixKey) {
            throw new Error('Missing required fields: amount or pixKey')
        }

        // 2. Initialize Supabase Client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

        // 2.5 Anti-Fraud Throttle (2 minutes)
        if (destinationId) {
            const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
            const { data: recentTransfers } = await supabase
                .from('financial_transfers')
                .select('id')
                .eq('destination_type', destinationType)
                .eq('destination_id', destinationId)
                .gte('created_at', twoMinutesAgo)
                .limit(1);
                
            if (recentTransfers && recentTransfers.length > 0) {
                throw new Error('Bloqueio de segurança: Resgate já solicitado recentemente. Aguarde alguns minutos.');
            }
        }

        // 3. Get Asaas Config from DB
        const { data: configData, error: configError } = await supabase
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'financial_api')
            .single()

        if (configError || !configData) {
            throw new Error('Integração Financeira não configurada no painel CRM.')
        }

        const isSandbox = configData.environment === 'sandbox'
        const ASAAS_API_KEY = isSandbox ? configData.sandbox_api_key : configData.api_key
        const ASAAS_URL = isSandbox 
            ? (configData.sandbox_endpoint_url || 'https://sandbox.asaas.com/api/v3') 
            : (configData.endpoint_url || 'https://api.asaas.com/v3')

        let transferId = 'simulated_' + crypto.randomUUID();
        let status = 'PENDING';

        // Map Pix Key Type to Asaas Format
        let formattedPixKeyType = 'CPF';
        if (pixKeyType) {
            const t = pixKeyType.toUpperCase();
            if (t === 'TELEFONE' || t === 'CELULAR') formattedPixKeyType = 'PHONE';
            else if (t === 'ALEATORIA') formattedPixKeyType = 'EVP';
            else formattedPixKeyType = t;
        }

        if (ASAAS_API_KEY) {
            // Real Call
            const transferPayload = {
                value: amount,
                pixAddressKey: pixKey,
                pixAddressKeyType: formattedPixKeyType, // 'CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'
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
            status = data.status; // 'PENDING' or 'DONE' / 'CONFIRMED'
        } else {
            console.log("Simulating Asaas Transfer:", { amount, pixKey });
            // Simulate delay
            await new Promise(r => setTimeout(r, 1000));
            status = 'DONE'; // Sandbox finishes immediately in simulation
        }

        // 4. Record the transfer request in the database
        const dbStatus = (status === 'DONE' || status === 'CONFIRMED') ? 'completed' : 'pending';
        const { data: dbRecord, error: dbError } = await supabase
            .from('financial_transfers')
            .insert({
                amount: amount,
                destination_type: destinationType,
                destination_id: destinationId,
                status: dbStatus,
                asaas_transfer_id: transferId
            })
            .select()
            .single();

        if (dbError) {
            console.error('Error inserting financial_transfer:', dbError);
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
