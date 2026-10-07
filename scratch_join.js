import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const { data, error } = await supabase
        .from('consumer_units')
        .select(`
            id, numero_uc, desconto_assinante, plano_assinatura_id,
            planos_assinatura_energia(desconto_assinante)
        `)
        .limit(5);
        
    console.log("Result:", JSON.stringify(data, null, 2));
    if (error) console.log("Error:", error);
}

test();
