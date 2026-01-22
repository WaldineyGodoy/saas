
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// Load env
const envConfig = dotenv.parse(fs.readFileSync('.env'));
const supabaseUrl = envConfig.VITE_SUPABASE_URL;
const supabaseKey = envConfig.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('Inspecting generation_production...');
    // Fetch a single row (or empty) to get structure if possible, 
    // but better to just try to select standard columns or infer from error.
    // Actually, Supabase JS 'select' doesn't return column types directly.
    // We will try to insert a dummy row with all keys we expect and see if it fails, OR just reliance on previous knowledge.
    // Better yet, let's just create the TABLE columns blindly with "IF NOT EXISTS" in a migration,
    // but first let's see if we can read ANY data or if the table exists.

    const { data: genData, error: genError } = await supabase.from('generation_production').select('*').limit(1);

    if (genError) {
        console.error('Error fetching generation_production:', genError.message);
    } else {
        console.log('generation_production exists. Sample keys:', genData.length > 0 ? Object.keys(genData[0]) : 'Table empty');
    }

    console.log('Inspecting invoices...');
    const { data: invData, error: invError } = await supabase.from('invoices').select('*').limit(1);
    if (invError) {
        console.error('Error fetching invoices:', invError.message);
    } else {
        console.log('invoices exists. Sample keys:', invData.length > 0 ? Object.keys(invData[0]) : 'Table empty');
    }
}

inspect();
