import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split(/\r?\n/).forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        envVars[match[1].trim()] = match[2].trim();
    }
});

const supabase = createClient(envVars['VITE_SUPABASE_URL'], envVars['VITE_SUPABASE_ANON_KEY']);

async function checkInvoice() {
    const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('uc_id', '36d7f014-7572-4193-b002-ea14771821ad')
        .eq('mes_referencia', '2026-03-01');

    if (error) console.error(error);
    else console.log(JSON.stringify(data, null, 2));
}

checkInvoice();
