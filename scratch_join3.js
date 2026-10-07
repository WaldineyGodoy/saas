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
            *,
            planos_assinatura_energia(desconto_assinante)
        `)
        .eq('id', 'd5ded9b9-aedc-4e18-bdc9-5939d9054751')
        .single();
        
    console.log("Result:", JSON.stringify(data, null, 2));
    if (error) console.log("Error:", error);
}

test();
