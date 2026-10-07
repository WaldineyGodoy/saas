import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const { data, error } = await supabase
        .from('consumer_units')
        .select(`
            id,
            plano_assinatura_id,
            planos_assinatura_energia ( nome, desconto_assinante )
        `)
        .limit(1);
        
    console.log("Result:", JSON.stringify(data, null, 2));
    console.log("Error:", error);
}

test();
