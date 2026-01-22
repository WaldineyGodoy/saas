
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

async function checkConstraints() {
    console.log('Checking FKs for leads and subscribers...');

    // We can't easily query information_schema via JS client unless we used the SQL tool (which was broken).
    // But we can try to insert a dummy lead with a random UUID as originator_id.
    // If it fails with FK violation, we know there is a constraint.

    const randomId = '00000000-0000-0000-0000-000000000000';

    // Test Leads
    const { error: errorLead } = await supabase.from('leads').insert({
        name: 'Constraint Test',
        email: 'test@contraint.com',
        originator_id: randomId
    });

    if (errorLead) {
        console.log('Leads Insert Result:', errorLead.message);
    } else {
        console.log('Leads Insert Result: Success (No strict FK or FK allows this ID)');
        // Cleanup
        await supabase.from('leads').delete().eq('email', 'test@contraint.com');
    }

    // Test Subscribers
    const { error: errorSub } = await supabase.from('subscribers').insert({
        name: 'Constraint Test',
        cpf_cnpj: '00000000000',
        email: 'test@sub.com',
        status: 'ativacao',
        originator_id: randomId
    });

    if (errorSub) {
        console.log('Subscribers Insert Result:', errorSub.message);
    } else {
        console.log('Subscribers Insert Result: Success (No strict FK)');
        // Cleanup
        await supabase.from('subscribers').delete().eq('email', 'test@sub.com');
    }
}

checkConstraints();
