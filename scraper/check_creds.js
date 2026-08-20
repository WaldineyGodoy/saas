/**
 * Diagnóstico de credenciais de portal para uma UC.
 *
 * Responde a uma pergunta só: com qual titular o robô vai logar, e existe
 * senha guardada para ele? Nunca imprime o valor da senha — nem um pedaço.
 *
 *   node check_creds.js 7030003955
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const UC_ALVO = process.argv[2] || '7030003955';

async function check() {
    console.log('--- DIAGNÓSTICO DE CREDENCIAIS ---');
    console.log(`UC: ${UC_ALVO}\n`);

    const { data: uc, error: ucError } = await supabase
        .from('consumer_units')
        .select(`
            id,
            numero_uc,
            subscriber_id,
            titular_fatura_id,
            subscriber:subscriber_id ( id, name, portal_credentials, portal_password_secret_id ),
            titular_fatura:titular_fatura_id ( id, name, portal_credentials, portal_password_secret_id )
        `)
        .eq('numero_uc', UC_ALVO)
        .single();

    if (ucError) {
        console.error('Erro ao buscar UC:', ucError.message);
        return;
    }

    const descreve = (rotulo, sub) => {
        if (!sub) return console.log(`- ${rotulo}: não vinculado`);
        const login = sub.portal_credentials?.login;
        console.log(`- ${rotulo}: ${sub.name}`);
        console.log(`    login: ${login ? login : 'AUSENTE'} | senha no Vault: ${sub.portal_password_secret_id ? 'sim' : 'NÃO'}`);
    };

    console.log(`ID da UC: ${uc.id}`);
    descreve('Assinante', uc.subscriber);
    descreve('Titular da fatura', uc.titular_fatura);

    // O robô loga com o titular da fatura quando ele existe.
    const efetivo = uc.titular_fatura || uc.subscriber;

    console.log('\n--- CONCLUSÃO ---');
    if (!efetivo) {
        console.log('ERRO: a UC não tem assinante nem titular de fatura.');
        return;
    }

    const { data, error } = await supabase.rpc('fn_get_portal_credentials', {
        p_entidade: 'subscribers',
        p_id: efetivo.id,
    });

    if (error) {
        console.log(`ERRO ao ler as credenciais: ${error.message}`);
        console.log('(esta RPC só responde para o service_role — confira a SUPABASE_KEY do .env)');
        return;
    }

    const cred = data?.[0];
    if (cred?.login && cred?.senha) {
        console.log(`OK: o robô vai logar como "${efetivo.name}" (login ${cred.login}, senha de ${cred.senha.length} caracteres).`);
    } else {
        console.log(`ERRO: falta ${!cred?.login ? 'o login' : 'a senha'} de "${efetivo.name}".`);
        console.log('Preencher no CRM: Assinante -> credenciais do portal.');
    }
}

check();
