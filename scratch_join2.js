import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://abbysvxnnhwvvzhftoms.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const { data, error } = await supabase
        .from('consumer_units')
        .select(`
            id,
            planos_assinatura_energia(desconto_assinante)
        `)
        .eq('id', 'd5ded9b9-aedc-4e18-bdc9-5939d9054751')
        .single();
        
    console.log("Result:", JSON.stringify(data, null, 2));
    if (error) console.log("Error:", error);
}

test();
