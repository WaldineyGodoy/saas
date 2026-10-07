import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const { data: matchedUc, error } = await supabase
        .from('consumer_units')
        .select(`
            id, numero_uc, concessionaria, titular_conta, status,
            tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento, subscriber_id,
            plano_assinatura_id,
            planos_assinatura_energia(desconto_assinante),
            subscribers!consumer_units_subscriber_id_fkey(name),
            titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name)
        `)
        .eq('numero_uc', '3242600015') // From the user's trace
        .maybeSingle();
        
    console.log("matchedUc:", JSON.stringify(matchedUc, null, 2));
    if (error) console.log("Error:", error);
}

test();
