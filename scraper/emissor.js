/**
 * Emissor — emissão autônoma da cobrança ao assinante.
 *
 * Quarto robô da casa, depois do faturista (scraper.js), do recuperador
 * (recuperar.js) e do enviador (enviador.js). Fecha o ciclo: o faturista traz a
 * conta, o emissor cria o boleto, o enviador entrega.
 *
 * ------------------------------------------------------------------ o portão
 *
 * `create-asaas-charge` exige sessão de administrador (requireAdmin). Isso é
 * deliberado e não se contorna: a chave anon é um JWT válido que viaja no
 * bundle público do front, e até 01/09/2026 dava para criar cobrança real com
 * ela. O caminho fácil aqui seria usar a service_role para pular o portão — e
 * seria destruir a própria proteção, além de apagar o `emitido_por` do
 * histórico: ninguém saberia depois se a cobrança foi de gente ou de máquina.
 *
 * Então o robô tem identidade própria. Faz login como um usuário de verdade
 * (ROBO_EMAIL/ROBO_SENHA) e usa o JWT dele. O portão passa sem alteração
 * nenhuma, e o histórico registra o robô como autor.
 *
 * ------------------------------------------------------------------- a guarda
 *
 * Emitir é mais perigoso que enviar: cobrança errada não se desfaz sozinha.
 * Quem decide o que pode sair é `fn_fila_emissao_faturas`, que só libera ciclo
 * FECHADO — toda UC do assinante ou apurada, ou já cobrada, ou dispensada com
 * motivo escrito.
 *
 * O que isso evita, concretamente: em 03/09/2026 a Guanabara tinha R$ 1.660,80
 * "prontos". Emitir esse valor teria fechado julho com 4 das 8 UCs a R$ 0,00 —
 * as que a Cosern não postou — e essas 4 ficariam marcadas como cobradas para
 * sempre. Foi o que aconteceu com a UC 1.979.411.032-86 do Mirantes: conta real
 * de R$ 31,69 sepultada a zero num consolidado já pago.
 *
 * Um ciclo por assinante por execução, o mais antigo primeiro, cada um em
 * boleto próprio. Fatura retroativa que aparecer depois — porque a
 * concessionária corrigiu a indisponibilidade — sai identificada pelo mês dela,
 * nunca somada às escondidas no boleto do mês corrente.
 *
 * ---------------------------------------------------------------- segurança
 *   - SIMULA por padrão. Só emite com --aplicar.
 *   - Teto de itens por execução e teto de valor por boleto.
 *   - Reconfere no banco, imediatamente antes de emitir, que nenhuma das
 *     faturas ganhou cobrança no meio do caminho.
 *   - `fn_auditar_fatura` em cada fatura; severidade 'erro' barra o ciclo.
 *   - Não envia nada ao cliente. A entrega é do enviador, que roda depois.
 *
 * Uso:
 *   node emissor.js                        # simula
 *   node emissor.js --aplicar              # emite de verdade
 *   node emissor.js --assinante <uuid>
 *   node emissor.js --limite 5 --teto 20000
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const LIMITE_PADRAO = 10;
const TETO_VALOR_PADRAO = 50000;

// ---------------------------------------------------------------- argumentos
const argv = process.argv.slice(2);
const APLICAR = argv.includes('--aplicar');
const opcao = (nome) => {
    const i = argv.indexOf(nome);
    return i >= 0 ? argv[i + 1] : null;
};
const ASSINANTE_ALVO = opcao('--assinante');
const LIMITE = Number(opcao('--limite')) || LIMITE_PADRAO;
const TETO_VALOR = Number(opcao('--teto')) || TETO_VALOR_PADRAO;

// ------------------------------------------------------------------ formato
const moeda = (v) =>
    Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataBR = (iso) => {
    if (!iso) return '—';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
};

const mesBR = (iso) => {
    if (!iso) return '—';
    const [a, m] = String(iso).slice(0, 10).split('-');
    return `${m}/${a}`;
};

// ------------------------------------------------------------------ sessão
/**
 * Login do robô. Sem isto não há emissão — e é assim que tem que ser.
 *
 * Usa a chave ANON de propósito: `signInWithPassword` é operação de usuário
 * comum, e passar service_role aqui não autenticaria ninguém, só devolveria um
 * token sem dono, que é exatamente o que o portão barra.
 */
async function autenticar() {
    const email = process.env.ROBO_EMAIL;
    const senha = process.env.ROBO_SENHA;

    // `apikey` e `Authorization` são coisas diferentes, e a distinção é o
    // ponto todo. O apikey só autoriza a requisição a chegar no GoTrue —
    // qualquer chave do projeto serve, inclusive a service_role. Quem prova
    // identidade é o access_token que volta deste login, e ELE pertence ao
    // usuário do robô, não à chave. Por isso cair para SUPABASE_KEY aqui não é
    // contornar o portão: o que viaja depois no Authorization continua sendo o
    // JWT de um usuário real, que o requireAdmin resolve em `profiles`.
    const chaveGateway = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

    if (!email || !senha || !chaveGateway) {
        throw new Error(
            'Faltam ROBO_EMAIL, ROBO_SENHA ou chave do projeto. ' +
            'O emissor precisa de identidade própria — não use service_role no Authorization para contornar.'
        );
    }

    const cliente = createClient(process.env.SUPABASE_URL, chaveGateway);
    const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha });
    if (error) throw new Error(`Login do robô falhou: ${error.message}`);

    const { data: perfil } = await supabase
        .from('profiles').select('role').eq('id', data.user.id).single();

    if (!perfil || !['admin', 'super_admin'].includes(perfil.role)) {
        throw new Error(
            `O usuário ${email} tem papel "${perfil?.role ?? 'nenhum'}". ` +
            'A emissão exige admin — ajuste o papel em profiles, não o portão.'
        );
    }

    return data.session.access_token;
}

async function emitirCobranca(token, corpo) {
    const resp = await fetch(`${process.env.SUPABASE_URL}/functions/v1/create-asaas-charge`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
    });

    const texto = await resp.text();
    let dados = {};
    try { dados = JSON.parse(texto); } catch (_) { dados = { raw: texto }; }
    if (!resp.ok || dados.error) {
        throw new Error(dados.error || dados.raw || `HTTP ${resp.status}`);
    }
    return dados;
}

// ------------------------------------------------------------ reconferências
/**
 * Última checagem antes de criar dinheiro.
 *
 * A fila foi lida no começo da execução; entre ela e este ponto alguém pode ter
 * emitido pela tela. Reler é barato, cobrança duplicada não.
 */
async function reconferir(item) {
    const { data: faturas, error } = await supabase
        .from('invoices')
        .select('id, valor_a_pagar, asaas_payment_id, consolidated_invoice_id, status, mes_referencia')
        .in('id', item.invoice_ids);

    if (error) throw new Error(`releitura falhou: ${error.message}`);
    if (!faturas || faturas.length !== item.invoice_ids.length) {
        throw new Error('a fila tem faturas que sumiram do banco');
    }

    const jaCobrada = faturas.find((f) => f.asaas_payment_id || f.consolidated_invoice_id);
    if (jaCobrada) {
        throw new Error(`fatura ${jaCobrada.id} ganhou cobrança depois da fila — alguém emitiu pela tela`);
    }

    const soma = faturas.reduce((a, f) => a + Number(f.valor_a_pagar || 0), 0);
    if (Math.abs(soma - Number(item.total)) > 0.02) {
        throw new Error(`soma mudou: fila dizia ${moeda(item.total)}, banco diz ${moeda(soma)}`);
    }

    const foraDoCiclo = faturas.find(
        (f) => String(f.mes_referencia).slice(0, 7) !== String(item.ciclo).slice(0, 7)
    );
    if (foraDoCiclo) {
        throw new Error(`fatura ${foraDoCiclo.id} é de outro ciclo (${mesBR(foraDoCiclo.mes_referencia)})`);
    }

    return soma;
}

/** Auditoria por fatura. Aviso passa e fica registrado; erro barra o ciclo. */
async function auditar(item) {
    const avisos = [];
    for (const id of item.invoice_ids) {
        const { data, error } = await supabase.rpc('fn_auditar_fatura', { p_invoice_id: id });
        if (error) throw new Error(`auditoria falhou: ${error.message}`);
        for (const achado of data || []) {
            if (achado.severidade === 'erro') {
                throw new Error(`auditoria barrou: ${achado.mensagem}`);
            }
            avisos.push(achado.mensagem);
        }
    }
    return avisos;
}

// --------------------------------------------------------------------- fila
/**
 * Um ciclo por assinante por execução, o mais antigo primeiro.
 *
 * Assinante com três meses em aberto não recebe três boletos na mesma manhã —
 * recebe um por dia de execução, o que dá tempo de alguém ver que há algo
 * errado antes do terceiro sair.
 */
function escolherUmCicloPorAssinante(fila) {
    const porAssinante = new Map();
    for (const item of fila) {
        if (item.impedimento) continue;
        if (!item.invoice_ids || item.invoice_ids.length === 0) continue;
        const atual = porAssinante.get(item.subscriber_id);
        if (!atual || String(item.ciclo) < String(atual.ciclo)) {
            porAssinante.set(item.subscriber_id, item);
        }
    }
    return [...porAssinante.values()].sort((a, b) => String(a.ciclo).localeCompare(String(b.ciclo)));
}

// --------------------------------------------------------------------- run
async function run() {
    console.log(APLICAR ? '=== EMISSOR (APLICANDO) ===' : '=== EMISSOR (simulação) ===');

    const { data: fila, error } = await supabase.rpc('fn_fila_emissao_faturas', { p_limite: 200 });
    if (error) throw new Error(`fila falhou: ${error.message}`);

    let candidatos = escolherUmCicloPorAssinante(fila || []);
    if (ASSINANTE_ALVO) candidatos = candidatos.filter((i) => i.subscriber_id === ASSINANTE_ALVO);

    const bloqueados = (fila || []).filter((i) => i.impedimento);
    if (bloqueados.length) {
        console.log(`\n--- ${bloqueados.length} ciclo(s) bloqueado(s) ---`);
        for (const b of bloqueados) {
            console.log(`  [bloqueado] ${b.subscriber_name} · ${mesBR(b.ciclo)} — ${b.impedimento}`);
        }
    }

    if (!candidatos.length) {
        console.log('\nNada a emitir.');
        return;
    }

    // Tenta autenticar SEMPRE, inclusive na simulação. Se o login só
    // acontecesse com --aplicar, a primeira vez que a credencial seria
    // exercitada de verdade era numa emissão real — descobrir ali que a senha
    // expirou é descobrir tarde. O ensaio diário prova a corrente inteira sem
    // criar nada.
    //
    // Falta de credencial só é fatal na emissão: em simulação avisa e segue,
    // para que dê para inspecionar a fila numa máquina sem a senha do robô.
    let token = null;
    try {
        token = await autenticar();
        console.log(`\nRobô autenticado como ${process.env.ROBO_EMAIL}.`);
    } catch (e) {
        if (APLICAR) throw e;
        console.log(`\n[ATENÇÃO] Login do robô falhou: ${e.message}`);
        console.log('          A simulação segue, mas com --aplicar isto seria fatal.');
    }

    console.log(`\n--- ${candidatos.length} ciclo(s) prontos (teto da execução: ${LIMITE}) ---`);

    let emitidos = 0;
    let falhas = 0;

    for (const item of candidatos.slice(0, LIMITE)) {
        const rotulo = `${item.subscriber_name} · ${mesBR(item.ciclo)}${item.retroativo ? ' (RETROATIVO)' : ''}`;
        const cabecalho = `${rotulo} · ${item.prontas} UC · ${moeda(item.total)} · venc ${dataBR(item.vencimento_sugerido)}`;

        if (Number(item.total) > TETO_VALOR) {
            console.log(`  [barrado] ${cabecalho} — acima do teto de ${moeda(TETO_VALOR)}`);
            falhas++;
            continue;
        }

        try {
            const soma = await reconferir(item);
            const avisos = await auditar(item);

            if (!APLICAR) {
                console.log(`  [simulado] ${cabecalho}`);
                if (item.observacao) console.log(`             obs: ${item.observacao}`);
                for (const a of avisos) console.log(`             aviso: ${a}`);
                emitidos++;
                continue;
            }

            const res = await emitirCobranca(token, {
                subscriber_id: item.subscriber_id,
                invoice_ids: item.invoice_ids,
                dueDate: item.vencimento_sugerido,
            });

            console.log(`  [emitido] ${cabecalho} — ${moeda(soma)} · ${res.payment_id || res.id || 'ok'}`);
            for (const a of avisos) console.log(`            aviso: ${a}`);
            emitidos++;
        } catch (e) {
            console.log(`  [falhou] ${rotulo} — ${e.message}`);
            falhas++;
        }
    }

    console.log(`\n${APLICAR ? 'Emitidos' : 'Simulados'}: ${emitidos} · falhas: ${falhas}`);
    if (!APLICAR && emitidos > 0) {
        console.log('Nada foi criado. Rode com --aplicar para emitir de verdade.');
    }
}

module.exports = { escolherUmCicloPorAssinante, moeda, mesBR, dataBR };

if (require.main === module) {
    run().catch((e) => {
        console.error('ERRO:', e.message);
        process.exit(1);
    });
}
