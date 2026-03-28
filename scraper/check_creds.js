const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function check() {
    console.log('--- DIAGNÓSTICO DE CREDENCIAIS ---');
    console.log('UC: 7030003955');

    const { data: uc, error: ucError } = await supabase
        .from('consumer_units')
        .select(`
            id, 
            numero_uc, 
            subscriber_id,
            titular_fatura_id,
            subscriber:subscriber_id ( id, name, portal_credentials ),
            titular_fatura:titular_fatura_id ( id, name, portal_credentials )
        `)
        .eq('numero_uc', '7030003955')
        .single();

    if (ucError) {
        console.error('Erro ao buscar UC:', ucError.message);
        return;
    }

    console.log('\nDados da UC:');
    console.log(`- ID: ${uc.id}`);
    console.log(`- Assinante (subscriber_id): ${uc.subscriber?.name || 'Não vinculado'}`);
    console.log(`- Credenciais Assinante:`, uc.subscriber?.portal_credentials || 'Vazio');
    
    console.log(`\n- Titular da Fatura (titular_fatura_id): ${uc.titular_fatura?.name || 'Não vinculado'}`);
    console.log(`- Credenciais Titular:`, uc.titular_fatura?.portal_credentials || 'Vazio');

    const effectiveSub = uc.titular_fatura || uc.subscriber;
    const creds = effectiveSub?.portal_credentials;

    console.log('\n--- CONCLUSÃO ---');
    if (creds?.login && creds?.password) {
        console.log(`Credencial que será usada: Login: ${creds.login}, Senha: ${creds.password.substring(0, 2)}***`);
    } else {
        console.log('ERRO: Nenhuma credencial configurada em nenhum vínculo.');
    }
}

check();
