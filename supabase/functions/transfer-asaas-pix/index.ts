import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import { corsHeaders } from "../_shared/cors.ts"
import { requireAdmin } from "../_shared/auth.ts"

const json = (body: unknown, status: number) => new Response(
    JSON.stringify(body),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
)

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    // Portão de identidade ANTES de ler o corpo da requisição.
    //
    // verify_jwt=true no config.toml não bastaria: a chave anon é um JWT
    // assinado e público, e passa pelo gateway. Só auth.getUser prova usuário.
    const auth = await requireAdmin(req, supabase)
    if (!auth.ok) {
        return json({ error: auth.error }, auth.status)
    }

    try {
        const body = await req.json()
        const amount = body.amount ?? body.value
        const description = body.description
        const usinaId = body.usinaId ?? body.usina_id
        const supplierId = body.supplierId ?? body.supplier_id

        if (!amount || Number(amount) <= 0) {
            throw new Error('Valor da transferencia ausente ou nao positivo.')
        }

        // O destino vem do cadastro, nunca do corpo da requisicao. pixKey e
        // pixKeyType enviados pelo cliente sao ignorados de proposito: aceitar
        // destino arbitrario foi o que transformou esta funcao num saque.
        let destinationType: string
        let destinationId: string
        let supplierRow: { pix_key: string | null; pix_key_type: string | null } | null = null

        if (supplierId) {
            destinationType = 'supplier'
            destinationId = supplierId
            const { data } = await supabase
                .from('suppliers')
                .select('pix_key, pix_key_type')
                .eq('id', supplierId)
                .single()
            supplierRow = data
        } else if (usinaId) {
            destinationType = 'usina'
            destinationId = usinaId
            const { data: usina } = await supabase
                .from('usinas')
                .select('supplier_id')
                .eq('id', usinaId)
                .single()
            if (!usina?.supplier_id) {
                throw new Error('Usina sem fornecedor vinculado - nao ha destino cadastrado.')
            }
            const { data } = await supabase
                .from('suppliers')
                .select('pix_key, pix_key_type')
                .eq('id', usina.supplier_id)
                .single()
            supplierRow = data
        } else {
            throw new Error('Informe supplierId ou usinaId. Transferencia sem destino cadastrado nao e permitida.')
        }

        if (!supplierRow?.pix_key) {
            throw new Error('Destino sem chave PIX cadastrada.')
        }

        const pixKey = supplierRow.pix_key
        const pixKeyType = supplierRow.pix_key_type

        // 2.5 Anti-Fraud Throttle (2 minutes)
        // Sem `if`: destinationId e obrigatorio desde a validacao acima. O
        // throttle antigo vivia dentro de um `if (destinationId)` e quem
        // omitisse o destino pulava a protecao inteira.
        {
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
