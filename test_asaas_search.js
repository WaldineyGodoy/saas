
import fetch from 'node-fetch';

const asaasKey = '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjBiZDJiNjE0LTAyMWUtNDEzMS05YTYyLTk0ZWY4NGJkOTg3NDo6JGFhY2hfMjRjMmFhZmUtMDRiMC00NDQ2LTk1NGQtYmYzOGU4ZmM0NzRk';
const asaasUrl = 'https://sandbox.asaas.com/api/v3';

async function testSearch(cpfCnpj) {
    const cleanDoc = cpfCnpj.replace(/\D/g, '');
    console.log(`Testing search for: ${cleanDoc}`);

    try {
        const res = await fetch(`${asaasUrl}/customers?cpfCnpj=${cleanDoc}`, {
            headers: { access_token: asaasKey }
        });
        const data = await res.json();
        console.log('Status:', res.status);
        console.log('Data:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error:', e);
    }
}

testSearch('000.000.000-00'); // Replace with a real-ish one if needed
