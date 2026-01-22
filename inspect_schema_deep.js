
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env vars manually
const envPath = path.resolve('.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envConfig = {};
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
        envConfig[key.trim()] = value.trim();
    }
});

const supabaseUrl = envConfig.VITE_SUPABASE_URL;
const supabaseKey = envConfig.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('Inspecting Tables matching "originator"...');

    // 1. List Tables
    const { data: tables, error: tableError } = await supabase
        .rpc('list_tables_debug');

    // Standard RPC might not exist. Let's try direct query if RLS allows, 
    // or just try to select from likely candidates.

    // Alternative: Try to select from "originators" and "Originators" and see which one works.

    const attempts = ['originators', 'Originators', 'ORIGINATORS'];

    for (const table of attempts) {
        console.log(`\nTesting table: "${table}"`);
        const { data, error } = await supabase.from(table).select('*').limit(1);

        if (error) {
            console.log(`❌ Error: ${error.message}`);
        } else {
            console.log(`✅ Success! Table found.`);
            console.log('Sample Row Keys:', data.length > 0 ? Object.keys(data[0]) : 'No data, but table exists.');
        }
    }
}

inspect();
