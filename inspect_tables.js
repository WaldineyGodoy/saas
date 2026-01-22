
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspect() {
    const { data, error } = await supabase.rpc('get_tables'); // Try a common RPC or just query info_schema if possible, but JS client usually relies on known tables.
    // Better: Query information_schema via SQL if I could.
    // Or just try to select from likely names.

    const likelynames = ['commissions', 'financial_records', 'financial_movements', 'payments', 'transactions'];

    for (const name of likelynames) {
        const { count, error } = await supabase.from(name).select('*', { count: 'exact', head: true });
        console.log(`Table '${name}': exists? ${!error}, count: ${count}, error: ${error?.message}`);
    }
}

inspect();
