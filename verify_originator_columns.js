
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

const supabase = createClient(envConfig.VITE_SUPABASE_URL, envConfig.VITE_SUPABASE_ANON_KEY);

async function verify() {
    console.log('Verifying email column in originators...');

    // Attempt 1: Select specific column
    const { data, error } = await supabase.from('originators').select('email').limit(1);

    if (error) {
        console.error('❌ Select "email" FAILED:', error.message);
    } else {
        console.log('✅ Select "email" SUCCESS. Columns are accesssible.');
        console.log('Data:', data);
    }

    // Attempt 2: Try to Insert
    console.log('\nAttempting Insert...');
    const { data: insertData, error: insertError } = await supabase.from('originators').insert({
        name: 'Test Node',
        email: 'test@test.com'
    }).select();

    if (insertError) {
        console.error('❌ Insert FAILED:', insertError.message);
    } else {
        console.log('✅ Insert SUCCESS:', insertData);
        // Clean up
        if (insertData && insertData[0]?.id) {
            await supabase.from('originators').delete().eq('id', insertData[0].id);
        }
    }
}

verify();
