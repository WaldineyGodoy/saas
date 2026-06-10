const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function test() {
    const env = fs.readFileSync('.env', 'utf8');
    const urlMatch = env.match(/VITE_SUPABASE_URL=(.*)/);
    const keyMatch = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/);
    const url = urlMatch[1].trim();
    const key = keyMatch[1].trim();
    
    console.log("Calling", url);
    const res = await fetch(`${url}/functions/v1/transfer-asaas-pix`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            amount: 100,
            pixKey: '12345678909',
            pixKeyType: 'CPF',
            supplierId: 'test-supplier'
        })
    });
    console.log(res.status, res.statusText);
    console.log(await res.text());
}
test();
