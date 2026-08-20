/**
 * Recuperação do estágio 2 — completa faturas cujo PDF já está guardado mas
 * cujos campos nunca foram lidos.
 *
 * Existe porque o robô passou meses baixando a conta e parando ali: PDF no
 * storage, valor do portal gravado, todo o resto em branco. Também serve para
 * reprocessar quando a extração melhora (foi assim com o separador de milhar).
 *
 * Não abre navegador e não fala com portal nenhum — só storage e banco.
 *
 *   node recuperar.js              # simula, não grava
 *   node recuperar.js --aplicar    # grava
 *   node recuperar.js --uc 7030765324 --aplicar
 *   node recuperar.js --todas --aplicar   # inclui as que já têm consumo
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const { extrairFatura } = require('./extrator');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const TODAS = args.includes('--todas');
const UC_ALVO = args.includes('--uc') ? args[args.indexOf('--uc') + 1] : null;
const LIMITE = args.includes('--limite') ? parseInt(args[args.indexOf('--limite') + 1], 10) : 200;

const brl = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

/** Traz o PDF, seja ele caminho no storage ou URL completa (entradas antigas). */
async function baixarPdf(ref) {
    if (/^https?:\/\//i.test(ref)) {
        const res = await fetch(ref);
        if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar o PDF`);
        return Buffer.from(await res.arrayBuffer());
    }
    const { data, error } = await supabase.storage.from('energy-bills').download(ref);
    if (error) throw new Error(`storage: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
}

async function run() {
    console.log(`Recuperação do estágio 2 — modo ${APLICAR ? 'APLICAR (grava)' : 'SIMULAÇÃO (não grava)'}`);

    let query = supabase
        .from('invoices')
        .select('id, uc_id, mes_referencia, valor_concessionaria, consumo_kwh, concessionaria_pdf_url, reading_status, consumer_units!inner (numero_uc)')
        .not('concessionaria_pdf_url', 'is', null)
        .neq('concessionaria_pdf_url', '')
        .order('mes_referencia', { ascending: false })
        .limit(LIMITE);

    // O alvo natural é a fatura que nunca passou pela extração.
    if (!TODAS) query = query.is('consumo_kwh', null);
    if (UC_ALVO) query = query.eq('consumer_units.numero_uc', UC_ALVO);

    const { data: faturas, error } = await query;
    if (error) throw error;

    if (!faturas || faturas.length === 0) {
        console.log('Nenhuma fatura pendente de extração.');
        return;
    }

    console.log(`${faturas.length} fatura(s) na fila.\n`);

    let ok = 0, conferir = 0, falhou = 0;

    for (const f of faturas) {
        const uc = f.consumer_units?.numero_uc || f.uc_id;
        const [ano, mes] = String(f.mes_referencia).split('-');
        const refAlvo = `${mes}/${ano}`;
        const etiqueta = `UC ${uc} ${refAlvo}`;

        try {
            const pdf = await baixarPdf(f.concessionaria_pdf_url);
            const ex = await extrairFatura(pdf, {
                supabaseUrl: process.env.SUPABASE_URL,
                supabaseKey: process.env.SUPABASE_KEY,
                valorPortal: f.valor_concessionaria,
                refAlvo,
            });

            const c = ex.colunas;
            const resumo = `${c.consumo_kwh} kWh | compensado ${c.consumo_compensado} | injetada ${c.energia_injetada} | CIP ${brl(c.iluminacao_publica)} | leitura ${c.data_leitura} | venc ${c.vencimento_concessionaria}`;

            if (ex.veredito.ok) {
                ok++;
                console.log(`✓ ${etiqueta}  ${brl(ex.veredito.totalPdf)} confere`);
            } else {
                conferir++;
                console.log(`! ${etiqueta}  CONFERIR: ${ex.veredito.problemas.join('; ')}`);
            }
            console.log(`    ${resumo}`);

            if (APLICAR) {
                const { error: upErr } = await supabase
                    .from('invoices')
                    .update({ ...c, reading_checked_at: new Date().toISOString() })
                    .eq('id', f.id);
                if (upErr) throw new Error(`gravação: ${upErr.message}`);
                console.log('    gravado.');
            }
        } catch (err) {
            falhou++;
            console.error(`✗ ${etiqueta}  ${err.message}`);
            if (APLICAR) {
                await supabase
                    .from('invoices')
                    .update({
                        reading_status: 'error',
                        reading_error: `Falha na leitura do PDF: ${err.message}`.substring(0, 500),
                        reading_checked_at: new Date().toISOString(),
                    })
                    .eq('id', f.id);
            }
        }
    }

    console.log(`\nResumo: ${ok} conferem, ${conferir} para revisão, ${falhou} falharam.`);
    if (!APLICAR) console.log('Nada foi gravado. Repita com --aplicar para gravar.');
}

run().catch((err) => {
    console.error('Erro fatal:', err.message);
    process.exit(1);
});
