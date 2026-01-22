
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const signature = req.headers.get('asaas-access-token'); // Or custom header if configured
        // In real prod, verify signature if Asaas sends one, or use a secret token in URL

        const eventData = await req.json();
        const { event, payment } = eventData;

        console.log(`Webhook Event: ${event}`, payment);

        if (!payment || !payment.id) {
            return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // Map Status
        let newStatus = '';
        let asaasStatus = '';

        if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event)) {
            newStatus = 'pago';
            asaasStatus = 'PAID';
        } else if (['PAYMENT_OVERDUE'].includes(event)) {
            newStatus = 'atrasado';
            asaasStatus = 'OVERDUE';
        } else {
            // Other events (CREATED, UPDATED, DELETED, etc.) - maybe just log or update asaas_status reference
            // For now, only care about payment/overdue
            return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Update Invoice
        const { error } = await supabase
            .from('invoices')
            .update({
                status: newStatus,
                asaas_status: asaasStatus,
                // Maybe update payment date?
            })
            .eq('asaas_payment_id', payment.id);

        if (error) {
            console.error('Error updating invoice:', error);
            throw error;
        }

        return new Response(
            JSON.stringify({ received: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error(error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
