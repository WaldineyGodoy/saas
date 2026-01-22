
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envConfig = {};
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) envConfig[key.trim()] = value.trim();
});

const supabase = createClient(envConfig.VITE_SUPABASE_URL, envConfig.VITE_SUPABASE_ANON_KEY);

async function inspect() {
    console.log('--- Consumer Units ---');
    const { data: ucs, error: err1 } = await supabase.from('consumer_units').select('*').limit(1);
    if (err1) console.error(err1);
    else console.log('Keys:', Object.keys(ucs[0] || {}));

    console.log('\n--- Usinas ---');
    const { data: usinas, error: err2 } = await supabase.from('usinas').select('*').limit(1);
    if (err2) console.error(err2);
    else console.log('Keys:', Object.keys(usinas[0] || {}));

    console.log('\n--- Invoices ---');
    const { data: inv, error: err3 } = await supabase.from('invoices').select('*').limit(1);
    if (err3) console.error(err3);
    else console.log('Keys:', Object.keys(inv[0] || {}));

    // Check for status columns specifically values if possible by grouping (if small data)
    // Or just infer from column names.
}

inspect();
