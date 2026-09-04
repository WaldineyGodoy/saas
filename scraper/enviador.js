/**
 * Enviador — entrega autônoma da fatura ao assinante.
 *
 * Terceiro robô da casa, irmão do faturista (scraper.js) e do recuperador
 * (recuperar.js). Ele não emite cobrança nenhuma: pega o que já tem boleto e
 * ainda não chegou ao cliente, monta o PDF completo e manda.
 *
 * Por que existe: até 01/09/2026 o boleto só chegava ao assinante se alguém
 * clicasse em "Gerar Faturamento" na tela — emissão e envio eram o mesmo
 * clique. Quem emitisse por outro caminho deixava o cliente sem aviso até a
 * fatura vencer, e aí ele descobria pelos três gatilhos de cobrança de uma vez.
 *
 * O que o robô faz, por fatura:
 *   1. lê a decomposição gravada  (fn_demonstrativo_fatura — mesma fonte do boleto)
 *   2. renderiza o demonstrativo em PDF  (Chromium, página A4 de verdade)
 *   3. gruda boleto e conta(s) de energia  (Edge Function merge-pdf)
 *   4. manda por WhatsApp e e-mail
 *   5. marca a fatura como entregue
 *
 * Segurança, porque aqui a saída é para cliente real:
 *   - SIMULA por padrão. Só envia com --aplicar.
 *   - Teto por execução (LIMITE_PADRAO), para um engano não virar disparo em massa.
 *   - Nunca envia duas vezes: `fatura_enviada_em` é o cadeado, e a tentativa é
 *     contada ANTES do disparo — processo que morre no meio volta para a fila
 *     com uma tentativa a menos, nunca com o contador intacto.
 *   - Não envia demonstrativo que não fecha com o boleto (a fila já barra).
 *   - Ambiente sandbox redireciona tudo para o telefone/e-mail de teste.
 *
 * Uso:
 *   node enviador.js                 # simula, mostra o que sairia
 *   node enviador.js --aplicar       # envia de verdade
 *   node enviador.js --fatura <uuid> # uma só
 *   node enviador.js --limite 5
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const LIMITE_PADRAO = 30;
const PORTAL = 'https://app.b2wenergia.com.br';

// ---------------------------------------------------------------- argumentos
const argv = process.argv.slice(2);
const APLICAR = argv.includes('--aplicar');
const opcao = (nome) => {
    const i = argv.indexOf(nome);
    return i >= 0 ? argv[i + 1] : null;
};
const FATURA_ALVO = opcao('--fatura');
const LIMITE = Number(opcao('--limite')) || LIMITE_PADRAO;

// ------------------------------------------------------------------ formato
const moeda = (v) =>
    Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataBR = (iso) => {
    if (!iso) return '—';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
};

const kwh = (v) => `${Math.round(Number(v) || 0).toLocaleString('pt-BR')} kWh`;

// Texto vindo do banco entra no HTML do demonstrativo. Nome de titular com "&"
// ou "<" quebraria a página — e um nome que alguém digitou é entrada, não
// marcação.
const escapar = (s) =>
    String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

// A concessionaria devolve o titular mascarado ("U***", "THIJS ***") e o robo
// grava como veio. Mostrar isso ao lado da UC nao informa nada e parece defeito
// de renderizacao -- o nome do assinante ja esta no cabecalho.
const nomeTitular = (nome) => (nome && !String(nome).includes('*') ? nome : '');

const enderecoDaUC = (addr) => {
    if (!addr || typeof addr !== 'object') return '';
    const partes = [];
    if (addr.rua) partes.push(addr.numero ? `${addr.rua}, ${addr.numero}` : addr.rua);
    if (addr.bairro) partes.push(addr.bairro);
    if (addr.cidade) partes.push(addr.uf ? `${addr.cidade}/${addr.uf}` : addr.cidade);
    return partes.join(' — ');
};

// ------------------------------------------------------------ o demonstrativo
/**
 * A página que o assinante lê antes do boleto.
 *
 * Os números NÃO são recalculados aqui. Vêm decompostos da
 * `fn_demonstrativo_fatura`, que lê as mesmas colunas gravadas de onde saiu o
 * valor do boleto — é a única forma de o demonstrativo não ter como discordar
 * da cobrança. A versão da tela (`renderHiddenInvoiceDetail`) faz o contrário:
 * refaz a conta a partir de `consumo_kwh × tarifa`, e por isso mostra zero
 * quando a tarifa da UC está zerada, com o boleto cobrando o valor certo.
 */
function montarHtml({ demonstrativos, assinante, referencia, vencimento, total, branding }) {
    const consolidado = demonstrativos.length > 1;
    const cor = branding.primary_color || '#003366';
    const destaque = branding.secondary_color || '#FF6600';

    const economiaTotal = demonstrativos.reduce((s, d) => s + Number(d.desconto || 0), 0);

    const bloco = (d) => {
        const linhas = [
            ['Energia compensada', kwh(d.compensado_kwh), moeda(d.compensada_bruta)],
            Number(d.desconto) > 0
                ? [`Desconto B2W (${d.percentual_desconto}%)`, '—', `− ${moeda(d.desconto)}`]
                : null,
            Number(d.tarifa_minima) > 0
                ? ['Tarifa mínima / excedentes',
                   Number(d.nao_compensado_kwh) > 0 ? kwh(d.nao_compensado_kwh) : '—',
                   moeda(d.tarifa_minima)]
                : null,
            Number(d.iluminacao_publica) > 0
                ? ['Iluminação pública', '—', moeda(d.iluminacao_publica)] : null,
            Number(d.outros_lancamentos) > 0
                ? ['Outros lançamentos', '—', moeda(d.outros_lancamentos)] : null,
            Number(d.parcelamento) > 0
                ? ['Parcelamento', '—', moeda(d.parcelamento)] : null,
        ].filter(Boolean);

        return `
        <section class="uc">
            <header class="uc-head">
                <div>
                    <span class="uc-num">UC ${escapar(d.numero_uc)}</span>
                    <span class="uc-titular">${escapar(nomeTitular(d.titular_conta))}</span>
                </div>
                <div class="uc-total">${moeda(d.total)}</div>
            </header>
            ${enderecoDaUC(d.uc_address)
                ? `<p class="uc-end">${escapar(enderecoDaUC(d.uc_address))}</p>` : ''}
            <table>
                <thead><tr><th>Descrição</th><th class="c">Quantidade</th><th class="r">Valor</th></tr></thead>
                <tbody>
                    ${linhas.map(([rot, qtd, val]) => `
                    <tr>
                        <td>${rot}</td>
                        <td class="c">${qtd}</td>
                        <td class="r">${val}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <p class="leitura">Leitura de ${dataBR(d.data_leitura_anterior)} a ${dataBR(d.data_leitura)}
               · consumo total ${kwh(d.consumo_kwh)}</p>
        </section>`;
    };

    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
           color:#1e293b; font-size:11px; background:#fff; }
    .top { display:flex; justify-content:space-between; align-items:flex-start;
           border-bottom:3px solid ${cor}; padding-bottom:10px; margin-bottom:14px; }
    .marca { font-size:19px; font-weight:800; color:${cor}; letter-spacing:-.3px; }
    .marca small { display:block; font-size:10px; font-weight:500; color:#64748b;
                   letter-spacing:.4px; text-transform:uppercase; margin-top:2px; }
    .ref { text-align:right; font-size:10px; color:#64748b; }
    .ref b { display:block; font-size:15px; color:#1e293b; }
    .cliente { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;
               padding:10px 12px; margin-bottom:14px; }
    .cliente .nome { font-size:13px; font-weight:700; }
    .cliente .sub { font-size:10px; color:#64748b; margin-top:2px; }
    .resumo { display:flex; gap:8px; margin-bottom:16px; }
    .card { flex:1; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; }
    .card span { display:block; font-size:9px; text-transform:uppercase;
                 letter-spacing:.5px; color:#64748b; margin-bottom:3px; }
    .card b { font-size:15px; }
    .card.pagar { background:${cor}; border-color:${cor}; }
    .card.pagar span { color:rgba(255,255,255,.75); }
    .card.pagar b { color:#fff; }
    .card.economia b { color:#16a34a; }
    section.uc { border:1px solid #e2e8f0; border-radius:8px; padding:12px;
                 margin-bottom:10px; page-break-inside:avoid; }
    .uc-head { display:flex; justify-content:space-between; align-items:baseline; }
    .uc-num { font-weight:700; font-size:12px; }
    .uc-titular { color:#64748b; margin-left:8px; font-size:10px; }
    .uc-total { font-weight:700; font-size:13px; }
    .uc-end { color:#94a3b8; font-size:9px; margin:2px 0 8px; }
    table { width:100%; border-collapse:collapse; margin-top:6px; }
    th { text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.4px;
         color:#94a3b8; border-bottom:1px solid #e2e8f0; padding:0 0 4px; font-weight:600; }
    td { padding:5px 0; border-bottom:1px solid #f1f5f9; }
    .c { text-align:center; } .r { text-align:right; font-variant-numeric:tabular-nums; }
    .leitura { color:#94a3b8; font-size:9px; margin:8px 0 0; }
    .rodape { margin-top:16px; padding-top:10px; border-top:1px solid #e2e8f0;
              font-size:9px; color:#64748b; display:flex; justify-content:space-between; }
    .rodape b { color:${destaque}; }
</style></head><body>

<div class="top">
    <div class="marca">${escapar(branding.company_name || 'B2W Energia')}
        <small>Demonstrativo de energia por assinatura</small></div>
    <div class="ref">Referência<b>${escapar(referencia)}</b>
        Vencimento ${dataBR(vencimento)}</div>
</div>

<div class="cliente">
    <div class="nome">${escapar(assinante)}</div>
    <div class="sub">${consolidado
        ? `Fatura consolidada — ${demonstrativos.length} unidades consumidoras`
        : `Unidade consumidora ${escapar(demonstrativos[0].numero_uc)}`}</div>
</div>

<div class="resumo">
    <div class="card pagar"><span>Total a pagar</span><b>${moeda(total)}</b></div>
    <div class="card economia"><span>Você economizou</span><b>${moeda(economiaTotal)}</b></div>
    <div class="card"><span>Vencimento</span><b>${dataBR(vencimento)}</b></div>
</div>

${demonstrativos.map(bloco).join('')}

<div class="rodape">
    <span>Acompanhe sua economia em <b>${PORTAL.replace('https://', '')}</b></span>
    <span>Boleto e conta da concessionária nas páginas seguintes</span>
</div>

</body></html>`;
}

// --------------------------------------------------------------- ferramentas
async function chamarFuncao(nome, corpo) {
    const resp = await fetch(`${process.env.SUPABASE_URL}/functions/v1/${nome}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
            apikey: process.env.SUPABASE_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
    });

    // merge-pdf devolve o PDF cru; as demais devolvem JSON.
    const tipo = resp.headers.get('content-type') || '';
    if (tipo.includes('application/pdf')) {
        if (!resp.ok) throw new Error(`${nome}: HTTP ${resp.status}`);
        return Buffer.from(await resp.arrayBuffer());
    }

    const texto = await resp.text();
    let dados = {};
    try { dados = JSON.parse(texto); } catch (_) { dados = { raw: texto }; }
    if (!resp.ok || dados.error) {
        throw new Error(`${nome}: ${dados.error || dados.raw || `HTTP ${resp.status}`}`);
    }
    return dados;
}

/** Caminho no Storage vira URL assinada; link externo passa direto. */
async function urlAssinada(caminho, bucket = 'energy-bills') {
    if (!caminho) return null;
    let alvo = caminho;
    if (caminho.startsWith('http')) {
        const m = caminho.match(/\/object\/(?:public|authenticated)\/([^/]+)\/(.+)$/);
        if (!m) return caminho;
        bucket = m[1];
        alvo = decodeURIComponent(m[2]);
    }
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(alvo, 3600);
    if (error) {
        console.warn(`   [aviso] conta de energia sem URL assinada (${error.message})`);
        return null;
    }
    return data?.signedUrl || null;
}

function textoWhatsapp({ empresa, assinante, vencimento, valor, consolidado, qtdUCs }) {
    return `Sua fatura da *${empresa}* chegou! ⚡

Olá, *${assinante}*.

Sua fatura${consolidado ? ` referente a ${qtdUCs} unidades consumidoras` : ''} vence em *${dataBR(vencimento)}*, no valor de *${moeda(valor)}*.

Em anexo vai o PDF completo: demonstrativo, boleto e a conta da concessionária. 📄

Veja quanto você economizou este mês em ${PORTAL}

*${empresa}* ☀️`;
}

// -------------------------------------------------------------------- envio
async function enviarUm(item, navegador, contexto) {
    const { branding, config } = contexto;
    const rotulo = `${item.subscriber_name} · ${item.referencia} · ${moeda(item.valor)}`;

    if (item.impedimento) {
        console.log(`   [pulado] ${rotulo} — ${item.impedimento}`);
        return { estado: 'pulado' };
    }

    // 1. decomposição gravada de cada UC
    const demonstrativos = [];
    for (const invoiceId of item.invoice_ids) {
        const { data, error } = await supabase.rpc('fn_demonstrativo_fatura', { p_invoice_id: invoiceId });
        if (error) throw new Error(`demonstrativo ${invoiceId}: ${error.message}`);
        if (!data) throw new Error(`demonstrativo ${invoiceId}: fatura nao encontrada`);
        demonstrativos.push(data);
    }

    const somaBlocos = demonstrativos.reduce((s, d) => s + Number(d.total || 0), 0);
    if (Math.abs(somaBlocos - Number(item.valor)) > 0.05) {
        throw new Error(
            `demonstrativo ${moeda(somaBlocos)} nao fecha com o boleto ${moeda(item.valor)}`
        );
    }

    if (!APLICAR) {
        const canais = [item.subscriber_phone && 'whatsapp', item.subscriber_email && 'e-mail']
            .filter(Boolean).join(' + ');
        console.log(`   [simulado] ${rotulo} -> ${canais || 'NENHUM CANAL'}`);
        demonstrativos.forEach((d) =>
            console.log(`        UC ${d.numero_uc}: ${moeda(d.total)} (economia ${moeda(d.desconto)})`));
        return { estado: 'simulado' };
    }

    // A tentativa é contada antes do disparo. Se o processo morrer entre o
    // envio e a marcação, o cliente recebe uma vez e a fatura não volta para
    // a fila cinco vezes.
    await supabase.rpc('fn_registrar_tentativa_envio', { p_tipo: item.tipo, p_id: item.id });

    // 2. demonstrativo -> PDF
    const pagina = await navegador.newPage();
    let demonstrativoBase64;
    try {
        await pagina.setContent(
            montarHtml({
                demonstrativos,
                assinante: item.subscriber_name,
                referencia: item.referencia,
                vencimento: item.vencimento,
                total: item.valor,
                branding,
            }),
            { waitUntil: 'load' }
        );
        const pdf = await pagina.pdf({ format: 'A4', printBackground: true });
        demonstrativoBase64 = pdf.toString('base64');
    } finally {
        await pagina.close();
    }

    // 3. gruda boleto e conta(s) de energia
    const contas = [];
    for (const d of demonstrativos) {
        const url = await urlAssinada(d.concessionaria_pdf_url);
        if (url) contas.push(url);
    }

    const nomeArquivo = `Fatura_${String(item.subscriber_name).normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_')}_${item.referencia.replace('/', '_')}.pdf`;

    const pdfCompleto = await chamarFuncao('merge-pdf', {
        summaryBase64: demonstrativoBase64,
        asaasUrl: item.boleto_url,
        energyBillUrls: contas,
        fileName: nomeArquivo,
    });
    const anexoBase64 = pdfCompleto.toString('base64');

    // 4. canais. Em sandbox tudo é desviado para os contatos de teste — a mesma
    //    regra da tela, repetida aqui porque este robô não passa por ela.
    const sandbox = config.asaas?.environment === 'sandbox';
    const telefoneTeste = config.evolution?.variables?.test_phone;
    const emailTeste = config.resend?.variables?.test_email;

    const telefone = sandbox ? telefoneTeste : item.subscriber_phone;
    const email = sandbox ? emailTeste : item.subscriber_email;

    const resultados = { whatsapp: null, email: null };

    if (telefone) {
        try {
            await chamarFuncao('send-whatsapp', {
                phone: String(telefone).replace(/\D/g, ''),
                text: textoWhatsapp({
                    empresa: branding.company_name || 'B2W Energia',
                    assinante: item.subscriber_name,
                    vencimento: item.vencimento,
                    valor: item.valor,
                    consolidado: item.tipo === 'consolidada',
                    qtdUCs: demonstrativos.length,
                }),
                mediaBase64: `data:application/pdf;base64,${anexoBase64}`,
                fileName: nomeArquivo,
            });
            resultados.whatsapp = 'enviado';
        } catch (e) {
            resultados.whatsapp = `falhou: ${e.message}`;
        }
    } else {
        resultados.whatsapp = 'sem telefone';
    }

    if (email) {
        try {
            await chamarFuncao('send-email', {
                to: email,
                subject: 'Sua fatura B2W Energia chegou!',
                attachments: [{ filename: nomeArquivo, content: anexoBase64 }],
                variables: {
                    nome: item.subscriber_name,
                    vencimento: dataBR(item.vencimento),
                    valor: moeda(item.valor),
                },
            });
            resultados.email = 'enviado';
        } catch (e) {
            resultados.email = `falhou: ${e.message}`;
        }
    } else {
        resultados.email = 'sem e-mail';
    }

    const waOk = resultados.whatsapp === 'enviado';
    const emailOk = resultados.email === 'enviado';
    const algumSaiu = waOk || emailOk;

    // 5. marcação e histórico
    //
    // Os canais vão SEPARADOS. `fatura_enviada_em` continua significando "algum
    // canal saiu" — é dele que a fila do enviador depende — mas ele nunca
    // respondeu "o WhatsApp foi?", e essa pergunta apareceu três vezes numa
    // semana. Agora `enviado_whatsapp_em` e `enviado_email_em` respondem.
    await supabase.rpc('fn_marcar_fatura_enviada', {
        p_tipo: item.tipo,
        p_id: item.id,
        p_invoice_ids: item.invoice_ids,
        p_erro: algumSaiu ? null : `WhatsApp ${resultados.whatsapp} | E-mail ${resultados.email}`,
        p_whatsapp_ok: waOk,
        p_whatsapp_erro: waOk ? null : resultados.whatsapp,
        p_email_ok: emailOk,
        p_email_erro: emailOk ? null : resultados.email,
    });

    await supabase.from('crm_history').insert({
        entity_type: 'subscriber',
        entity_id: item.subscriber_id,
        content: `Envio automático de fatura ${item.referencia}: WhatsApp [${resultados.whatsapp}] | E-mail [${resultados.email}]`,
        metadata: {
            origem: 'enviador',
            tipo: item.tipo,
            referencia: item.referencia,
            valor: Number(item.valor),
            invoice_ids: item.invoice_ids,
            sandbox,
            resultados,
        },
    });

    console.log(`   ${algumSaiu ? '[enviado]' : '[FALHOU]'} ${rotulo}`
        + ` — WhatsApp ${resultados.whatsapp} | E-mail ${resultados.email}`);

    return { estado: algumSaiu ? 'enviado' : 'falhou' };
}

// ---------------------------------------------------------------------- main
// ------------------------------------------------------------------ rastro
/**
 * Registro da execução, no mesmo formato do emissor.
 *
 * Em 04/09/2026 nem o emissor nem o enviador escreviam nada ao rodar, e quando
 * nada saiu foi impossível saber se tinham sido acionados. `envio_tentativas`
 * respondia só pela fatura; não respondia pelo robô.
 */
const origemDaExecucao = () =>
    process.env.GITHUB_ACTIONS === 'true' ? (process.env.GITHUB_EVENT_NAME || 'ci') : 'local';

async function abrirExecucao() {
    const { data, error } = await supabase
        .from('robo_execucoes')
        .insert({ robo: 'enviador', aplicou: APLICAR, detalhe: { origem: origemDaExecucao() } })
        .select('id')
        .single();
    if (error) {
        console.log(`[aviso] não consegui registrar a execução: ${error.message}`);
        return null;
    }
    return data.id;
}

/** Fecha pela RPC, para os dois carimbos virem do relógio do banco. */
async function fecharExecucao(id, campos = {}) {
    if (!id) return;
    const { error } = await supabase.rpc('fn_fechar_execucao_robo', {
        p_id: id,
        p_processados: campos.processados ?? 0,
        p_sucesso: campos.sucesso ?? 0,
        p_falha: campos.falha ?? 0,
        p_bloqueados: campos.bloqueados ?? 0,
        p_erro: campos.erro ?? null,
        p_detalhe: campos.detalhe ?? null,
    });
    if (error) console.log(`[aviso] não consegui fechar o registro: ${error.message}`);
}

async function run(execucaoId) {
    console.log(`\nEnviador de faturas — ${APLICAR ? 'ENVIO REAL' : 'SIMULAÇÃO (use --aplicar para enviar)'}`);

    const { data: fila, error } = await supabase.rpc('fn_fila_envio_faturas', { p_limite: LIMITE });
    if (error) throw new Error(`fila: ${error.message}`);

    let itens = fila || [];
    if (FATURA_ALVO) {
        itens = itens.filter((i) => i.id === FATURA_ALVO || (i.invoice_ids || []).includes(FATURA_ALVO));
    }

    if (itens.length === 0) {
        console.log('Nada na fila. Toda fatura com boleto já foi entregue.\n');
        await fecharExecucao(execucaoId, {
            detalhe: { origem: origemDaExecucao(), motivo: 'fila vazia' },
        });
        return;
    }

    console.log(`${itens.length} fatura(s) na fila (teto de ${LIMITE} por execução).\n`);

    const [{ data: branding }, { data: configs }] = await Promise.all([
        supabase.from('branding_settings').select('company_name, primary_color, secondary_color').single(),
        supabase.from('integrations_config').select('service_name, environment, variables')
            .in('service_name', ['financial_api', 'evolution_api', 'resend_api']),
    ]);

    const contexto = {
        branding: branding || {},
        config: {
            asaas: (configs || []).find((c) => c.service_name === 'financial_api'),
            evolution: (configs || []).find((c) => c.service_name === 'evolution_api'),
            resend: (configs || []).find((c) => c.service_name === 'resend_api'),
        },
    };

    if (contexto.config.asaas?.environment === 'sandbox') {
        console.log('[sandbox] destinatários serão desviados para os contatos de teste.\n');
    }

    const navegador = await chromium.launch({ headless: true });
    const contagem = { enviado: 0, falhou: 0, pulado: 0, simulado: 0, erro: 0 };

    try {
        for (const item of itens) {
            try {
                const r = await enviarUm(item, navegador, contexto);
                contagem[r.estado] = (contagem[r.estado] || 0) + 1;
            } catch (e) {
                contagem.erro += 1;
                console.error(`   [erro] ${item.subscriber_name} · ${item.referencia}: ${e.message}`);
                if (APLICAR) {
                    await supabase.rpc('fn_marcar_fatura_enviada', {
                        p_tipo: item.tipo,
                        p_id: item.id,
                        p_invoice_ids: item.invoice_ids,
                        p_erro: e.message,
                    }).catch(() => {});
                }
            }
        }
    } finally {
        await navegador.close();
    }

    console.log(`\nResumo: ${Object.entries(contagem)
        .filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'nada a fazer'}\n`);

    await fecharExecucao(execucaoId, {
        processados: contagem.enviado + contagem.simulado + contagem.falhou + contagem.erro,
        sucesso: contagem.enviado + contagem.simulado,
        falha: contagem.falhou + contagem.erro,
        bloqueados: contagem.pulado,
        detalhe: { origem: origemDaExecucao(), contagem },
    });

    if (contagem.falhou > 0 || contagem.erro > 0) process.exitCode = 1;
}

// Exposto para inspecao do demonstrativo sem disparar envio nenhum
// (scripts de conferencia renderizam o HTML e olham o PDF).
module.exports = { montarHtml, moeda, dataBR };

// So roda quando chamado direto. Sem esta guarda, um `require` deste arquivo
// para inspecionar o demonstrativo dispararia a fila inteira.
if (require.main === module) {
    // O registro abre ANTES de tudo que pode falhar, para que morte precoce
    // também deixe rastro.
    abrirExecucao().then((id) =>
        run(id).catch(async (e) => {
            console.error('Erro fatal no enviador:', e.message);
            await fecharExecucao(id, { erro: String(e.message).slice(0, 1000) });
            process.exit(1);
        })
    );
}
