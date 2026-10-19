/**
 * Filler da Troca de Titularidade (TT) na Agência Virtual Neoenergia.
 *
 * Quem pede a TT é o CESSIONÁRIO: o robô entra com a credencial da UG (a
 * mesma que o Faturista usa para ler a conta) e digita o número da UC cedente.
 * Roteiro do dono (19/10/2026):
 *
 *   Unidades Consumidoras → ⋮ (ao lado de "Ligação Nova") → Troca de Titularidade → Iniciar
 *   1/8 Dados do Titular ......... confirmar e Continuar
 *   2/8 Dados da UC .............. digitar o número da UC cedente → Pesquisar
 *   3/8 Solicitação .............. conferir o endereço mascarado contra a UC; Motivo = Outros
 *   4/8 Resumo ................... conferir cedente (UC) e cessionário (titular da UG)
 *   5/8 Entrega da Fatura ........ conferir o e-mail; marcar a declaração de descadastramento
 *   6/8 Forma de Pagamento ....... pop-up de débito automático → Não cadastrar
 *   7/8 Data de Vencimento ....... a data mais próxima do dia 15; Ciente; Cadastrar
 *   8/8 Envio .................... ~30 s processando; o pop-up pode fechar sozinho sem
 *                                  confirmar — aí um 2º Cadastrar mostra a confirmação;
 *                                  Finalizar
 *   Conferência .................. a UC (mesmo número) passa a constar na lista da UG
 *
 * Débito na UG: o portal mostra um aviso ao Iniciar. O robô clica Finalizar e
 * REPORTA o débito (bloqueada_por_debito); nunca retenta sozinho.
 *
 * O "Cadastrar" protocola de verdade, então é sempre confirmado por uma pessoa
 * no terminal, com o resumo do que vai ser enviado. Sem confirmação, nada é
 * enviado e a TT volta para 'erro' com o motivo, à espera de nova tentativa.
 *
 * Uso:
 *   node tt_filler.js                 # todas as TTs em 'a_iniciar'
 *   node tt_filler.js --tt <uuid>     # só uma
 *   node tt_filler.js --tt <uuid> --ate-resumo   # ensaio: para no passo 4, não envia
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

const neoenergia = require('./drivers/neoenergia');

// Sem .env (ex.: ao testar as regras puras), o módulo ainda carrega.
const supabase = process.env.SUPABASE_URL ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY) : null;
const DEBUG_DIR = './downloads/debug/tt';
const MEUS_IMOVEIS = '#/home/meus-imoveis';

const args = process.argv.slice(2);
const argTt = args.includes('--tt') ? args[args.indexOf('--tt') + 1] : null;
const ATE_RESUMO = args.includes('--ate-resumo');

// ------------------------------------------------------------------ utilidades

const so = (s) => String(s || '').replace(/\D/g, '');
const espera = (page, ms) => page.waitForTimeout(ms);

function normalizar(s) {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/[^A-Z0-9* ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function perguntar(texto) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r.trim()); }));
}

/** Erro que encerra a TT com um motivo legível para a pessoa que for revisar. */
class ParadaTT extends Error {
    constructor(motivo, { debito = null } = {}) { super(motivo); this.debito = debito; }
}

async function print(page, nome) {
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const base = `${DEBUG_DIR}/${nome}_${Date.now()}`;
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    await fs.promises.writeFile(`${base}.html`, await page.content().catch(() => '')).catch(() => {});
    return `${base}.png`;
}

/** Texto visível do corpo, sem espaços repetidos. */
async function textoDaTela(page) {
    return (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
}

/** "Passo N de 8" atual, ou null. */
async function passoAtual(page) {
    const m = (await textoDaTela(page)).match(/Passo\s+(\d)\s+de\s+8/i);
    return m ? Number(m[1]) : null;
}

async function esperarPasso(page, n, timeout = 45000) {
    const ate = Date.now() + timeout;
    while (Date.now() < ate) {
        if (await passoAtual(page) === n) return;
        await espera(page, 1000);
    }
    throw new ParadaTT(`Não cheguei ao passo ${n} de 8 (tela atual: passo ${await passoAtual(page) ?? '?'}).`);
}

/**
 * Clica no elemento clicável VISÍVEL cujo texto é exatamente `rotulo`
 * (sem diferenciar maiúsculas). Por JS: os botões do Angular Material saem da
 * viewport e o locator.click recusa (ver memória do Faturista).
 */
async function clicarTexto(page, rotulo, { timeout = 20000, ultimo = false } = {}) {
    const ate = Date.now() + timeout;
    while (Date.now() < ate) {
        const ok = await page.evaluate(({ rotulo, ultimo }) => {
            const alvo = rotulo.toUpperCase();
            const visivel = (el) => {
                const r = el.getBoundingClientRect();
                const st = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
            };
            const cands = [...document.querySelectorAll('button, a, [role=button], [role=menuitem], li, span, div')]
                .filter((el) => (el.innerText || '').replace(/\s+/g, ' ').trim().toUpperCase() === alvo)
                .filter(visivel)
                .filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true');
            if (!cands.length) return false;
            // O mais interno: um <span> dentro do <button> herda o mesmo texto.
            const internos = cands.filter((el) => !cands.some((o) => o !== el && el.contains(o)));
            const el = ultimo ? internos[internos.length - 1] : internos[0];
            (el.closest('button, a, [role=button], [role=menuitem]') || el).click();
            return true;
        }, { rotulo, ultimo });
        if (ok) return;
        await espera(page, 800);
    }
    throw new ParadaTT(`Botão "${rotulo}" não apareceu na tela.`);
}

/**
 * Acha o input (checkbox ou radio) ligado ao texto `trecho`. O texto pode estar
 * FORA do mat-checkbox (passo 5: a declaração é um parágrafo ao lado da caixa,
 * com link para o Termo de Adesão), então sobe pelos ancestrais do elemento
 * que tem o texto até achar um container com o input.
 */
const ACHAR_INPUT = `(trecho, tipo) => {
    const t = trecho.toUpperCase();
    const folhas = [...document.querySelectorAll('body *')].filter((el) =>
        (el.innerText || el.textContent || '').toUpperCase().includes(t) &&
        ![...el.children].some((c) => (c.innerText || c.textContent || '').toUpperCase().includes(t)));
    for (const folha of folhas) {
        let caixa = folha;
        for (let i = 0; i < 6 && caixa; i++, caixa = caixa.parentElement) {
            const inputs = caixa.querySelectorAll('input[type=' + tipo + ']');
            if (inputs.length === 1) return inputs[0];
            if (inputs.length > 1) break;
        }
    }
    return null;
}`;

async function marcarInput(page, trecho, tipo) {
    const nome = tipo === 'radio' ? 'Opção' : 'Caixa';
    const achou = await page.evaluate(({ src, trecho, tipo }) => {
        const input = eval(src)(trecho, tipo);
        if (!input) return false;
        if (!input.checked) {
            const alvo = input.closest('mat-checkbox, mat-radio-button')?.querySelector('label') || input;
            alvo.click();
        }
        return true;
    }, { src: ACHAR_INPUT, trecho, tipo });
    if (!achou) throw new ParadaTT(`${nome} "${trecho}" não encontrada.`);
    await espera(page, 800);
    const marcado = await page.evaluate(({ src, trecho, tipo }) => !!eval(src)(trecho, tipo)?.checked,
        { src: ACHAR_INPUT, trecho, tipo });
    if (!marcado) throw new ParadaTT(`${nome} "${trecho}" não ficou marcada.`);
}

const marcarCheckbox = (page, trecho) => marcarInput(page, trecho, 'checkbox');
const marcarRadio = (page, trecho) => marcarInput(page, trecho, 'radio');

/** Abre o mat-select (ou <select>) rotulado por `trechoRotulo` e devolve as opções. */
async function abrirSelect(page, trechoRotulo) {
    const nativo = await page.evaluate((t) => {
        t = t.toUpperCase();
        for (const sel of document.querySelectorAll('select')) {
            const rot = (sel.closest('mat-form-field, div')?.innerText || '').toUpperCase();
            if (rot.includes(t)) return [...sel.options].map((o) => o.text.trim()).filter(Boolean);
        }
        return null;
    }, trechoRotulo);
    if (nativo) return { nativo: true, opcoes: nativo };

    const abriu = await page.evaluate((t) => {
        t = t.toUpperCase();
        for (const ff of document.querySelectorAll('mat-form-field')) {
            if (!(ff.innerText || '').toUpperCase().includes(t)) continue;
            const trig = ff.querySelector('mat-select, .mat-select-trigger, .mat-mdc-select-trigger, [role=combobox]');
            if (trig) { trig.click(); return true; }
        }
        return false;
    }, trechoRotulo);
    if (!abriu) throw new ParadaTT(`Campo "${trechoRotulo}" não encontrado.`);
    await espera(page, 1000);
    const opcoes = await page.evaluate(() =>
        [...document.querySelectorAll('mat-option, [role=option]')].map((o) => (o.innerText || '').trim()).filter(Boolean));
    return { nativo: false, opcoes };
}

async function escolherOpcao(page, trechoRotulo, opcao) {
    const { nativo } = await abrirSelect(page, trechoRotulo);
    const ok = await page.evaluate(({ t, opcao, nativo }) => {
        t = t.toUpperCase();
        if (nativo) {
            for (const sel of document.querySelectorAll('select')) {
                if (!(sel.closest('mat-form-field, div')?.innerText || '').toUpperCase().includes(t)) continue;
                const o = [...sel.options].find((x) => x.text.trim() === opcao);
                if (!o) return false;
                sel.value = o.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }
        const o = [...document.querySelectorAll('mat-option, [role=option]')].find((x) => (x.innerText || '').trim() === opcao);
        if (!o) return false;
        o.click();
        return true;
    }, { t: trechoRotulo, opcao, nativo });
    if (!ok) throw new ParadaTT(`Opção "${opcao}" não encontrada em "${trechoRotulo}".`);
    await espera(page, 1000);
}

// ------------------------------------------------------------------ regras de conferência

/**
 * O portal mostra o endereço da UC mascarado ("AV CA**OS SA*ES 901 SL 2702 TI*OL NA*AL RN")
 * e com abreviações próprias ("RO BR 101"), então não dá para comparar letra a
 * letra com o cadastro. Conferimos o que é confiável: o NÚMERO do imóvel e a
 * CIDADE (palavra a palavra, com * valendo qualquer letra). Qualquer dúvida
 * vira pergunta à pessoa na confirmação final, nunca aprovação automática.
 */
function conferirEndereco(mascarado, endereco) {
    const tela = normalizar(mascarado);
    const palavrasTela = tela.split(' ');
    const achados = [];
    const numero = so(endereco?.numero);
    if (numero) achados.push({ item: `número ${numero}`, ok: palavrasTela.some((p) => so(p) === numero) });

    const cidade = normalizar(endereco?.cidade);
    if (cidade) {
        // A última palavra da tela pode vir cortada: "SA* GO***LO DO AM****" é
        // São Gonçalo do AMARANTE (19/10/2026). Nela, basta casar o começo.
        const ultima = palavrasTela.length - 1;
        const casa = (palavra, padrao, cortada) =>
            (palavra.length === padrao.length || (cortada && padrao.length < palavra.length)) &&
            [...padrao].every((c, i) => c === '*' || c === palavra[i]);
        const pals = cidade.split(' ').filter((p) => p.length > 2);
        achados.push({ item: `cidade ${endereco.cidade}`, ok: pals.every((p) => palavrasTela.some((t, i) => casa(p, t, i === ultima))) });
    }
    return { tela: mascarado, ok: achados.length > 0 && achados.every((a) => a.ok), achados };
}

/** Das datas oferecidas, a mais próxima do dia 15 (empate: a anterior). */
function vencimentoPreferido(opcoes) {
    const comDia = opcoes.map((o) => ({ o, dia: Number((o.match(/\d{1,2}/) || [])[0]) })).filter((x) => x.dia >= 1 && x.dia <= 31);
    if (!comDia.length) return null;
    comDia.sort((a, b) => Math.abs(a.dia - 15) - Math.abs(b.dia - 15) || a.dia - b.dia);
    return comDia[0].o;
}

function valorDoDebito(texto) {
    const m = texto.match(/R\$\s*([\d.]+,\d{2})/);
    return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
}

// ------------------------------------------------------------------ banco

async function rpc(nome, params) {
    const { data, error } = await supabase.rpc(nome, params);
    if (error) throw new Error(`${nome}: ${error.message}`);
    return data;
}

async function carregarTTs() {
    let q = supabase.from('uc_transferencias_titularidade')
        .select(`id, status, numero_uc_origem, cessionario_id,
                 uc:consumer_units!uc_transferencias_titularidade_uc_id_fkey (id, numero_uc, address, titular_conta),
                 ug:consumer_units!uc_transferencias_titularidade_ug_id_fkey (id, numero_uc, concessionaria, address, titular_fatura_id, subscriber_id),
                 cessionario:subscribers!uc_transferencias_titularidade_cessionario_id_fkey (id, name, cpf_cnpj)`);
    q = argTt ? q.eq('id', argTt) : q.eq('status', 'a_iniciar');
    const { data, error } = await q.order('criado_em');
    if (error) throw new Error(`Leitura das TTs: ${error.message}`);
    return data || [];
}

async function credencialDaUG(tt) {
    const titular = tt.ug.titular_fatura_id || tt.ug.subscriber_id;
    if (titular !== tt.cessionario_id) {
        throw new ParadaTT('O titular da UG no cadastro não é o cessionário da TT; confira antes de protocolar.');
    }
    const data = await rpc('fn_get_portal_credentials', { p_entidade: 'subscribers', p_id: titular });
    if (!data?.length || !data[0].senha) throw new ParadaTT('Credencial do portal da UG não cadastrada.');
    return { login: data[0].login, password: data[0].senha };
}

// ------------------------------------------------------------------ portal

/** Unidades Consumidoras → ⋮ → Troca de Titularidade → Iniciar. Devolve o débito, se houver. */
async function abrirTT(page) {
    await page.evaluate((r) => { location.hash = r; }, MEUS_IMOVEIS);
    await espera(page, 4000);

    // O ⋮ fica à direita do botão "Ligação Nova": é o botão de ícone vizinho.
    const abriu = await page.evaluate(() => {
        const ln = [...document.querySelectorAll('button, a')].find((b) => /LIGA[ÇC][ÃA]O NOVA/i.test(b.innerText || ''));
        if (!ln) return false;
        let caixa = ln.parentElement;
        for (let i = 0; i < 4 && caixa; i++, caixa = caixa.parentElement) {
            const kebab = [...caixa.querySelectorAll('button, [role=button]')].find((b) => b !== ln && !(b.innerText || '').replace(/more_vert|⋮/g, '').trim());
            if (kebab) { kebab.click(); return true; }
        }
        return false;
    });
    if (!abriu) throw new ParadaTT('Não achei o menu ⋮ ao lado de "Ligação Nova".');
    await espera(page, 1000);
    await clicarTexto(page, 'Troca de Titularidade');
    await espera(page, 3000);
    await clicarTexto(page, 'Iniciar', { ultimo: true });
    await espera(page, 4000);

    const texto = await textoDaTela(page);
    if (/d[ée]bito/i.test(texto) && await passoAtual(page) === null) {
        return { debito: true, valor: valorDoDebito(texto), texto: texto.slice(0, 600) };
    }
    return { debito: false };
}

async function lerProtocolo(page) {
    const m = (await textoDaTela(page)).match(/PROTOCOLO:?\s*(\d{8,})/i);
    return m ? m[1] : null;
}

/** Digita no campo `seletor` (CSS). Só dígitos; relê o valor. */
async function digitarCampo(page, seletor, valor) {
    const campo = page.locator(seletor).first();
    for (let t = 1; t <= 3; t++) {
        await campo.click({ force: true });
        await espera(page, 1500);
        await campo.fill(valor);
        await campo.press('Tab');
        await espera(page, 1500);
        if (so(await campo.inputValue()) === so(valor)) return;
    }
    throw new ParadaTT(`O campo ${seletor} não ficou com ${valor}.`);
}

async function lerCampo(page, trecho) {
    return page.evaluate((t) => {
        t = t.toUpperCase();
        for (const ff of document.querySelectorAll('mat-form-field')) {
            if (!(ff.innerText || '').toUpperCase().includes(t)) continue;
            const i = ff.querySelector('input, textarea');
            if (i) return i.value;
        }
        return null;
    }, trecho);
}

async function preencherWizard(page, tt, confirmar) {
    const numeroUC = so(tt.numero_uc_origem);
    const r = { protocolo: null };

    // 1/8 — Dados do Titular
    await esperarPasso(page, 1);
    r.protocolo = await lerProtocolo(page);
    await clicarTexto(page, 'Continuar');

    // 2/8 — Dados da UC
    await esperarPasso(page, 2);
    // Rótulo com acento ("Código"); o formcontrolname é estável (visto em 19/10/2026).
    await digitarCampo(page, 'input[formcontrolname="codCliente"]', numeroUC);
    await clicarTexto(page, 'Pesquisar');
    let endereco = null;
    for (let t = 0; t < 20 && !endereco; t++) { await espera(page, 1000); endereco = await lerCampo(page, 'Endere'); }
    if (!endereco) {
        const aviso = (await textoDaTela(page)).slice(0, 400);
        throw new ParadaTT(`O portal não devolveu o endereço da UC ${numeroUC}. Tela: ${aviso}`);
    }
    r.endereco = conferirEndereco(endereco, tt.uc.address);
    await print(page, `tt_${numeroUC}_p2`);
    await clicarTexto(page, 'Continuar');

    // 3/8 — Solicitação: motivo "Outros"
    await esperarPasso(page, 3);
    await escolherOpcao(page, 'Motivo', 'Outros');
    await clicarTexto(page, 'Continuar');

    // 4/8 — Resumo: cedente e cessionário
    await esperarPasso(page, 4);
    const resumo = await textoDaTela(page);
    r.resumoTemUC = so(resumo).includes(numeroUC);
    const primeiroNome = normalizar(tt.cessionario.name).split(' ')[0];
    r.resumoTemCessionario = normalizar(resumo).includes(primeiroNome);
    r.printResumo = await print(page, `tt_${numeroUC}_p4_resumo`);
    if (!r.resumoTemUC) throw new ParadaTT(`O Resumo não mostra a UC ${numeroUC} como cedente.`);
    if (ATE_RESUMO) return { ...r, ensaio: true };
    await clicarTexto(page, 'Continuar');

    // 5/8 — Entrega da fatura: e-mail da área logada + declaração de descadastramento
    await esperarPasso(page, 5);
    // Tela real (19/10/2026): rádio "E-mail da área logada" | "outro e-mail";
    // sem escolha o botão é "Pular", não "Continuar".
    r.email = (await textoDaTela(page)).match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] || '(não lido)';
    await marcarRadio(page, 'rea logada');
    await marcarCheckbox(page, 'descadastramento');
    await print(page, `tt_${numeroUC}_p5`);
    // O botão do passo 5 é "Cadastrar" (cadastra a fatura digital, não a TT);
    // o Cadastrar que protocola é o do passo 7, atrás da confirmação.
    await clicarTexto(page, 'Cadastrar');

    // 6/8 — Forma de pagamento: recusar o débito automático. Tela real
    // (19/10/2026): página com dados bancários e botão "Pular"; o pop-up
    // "Não cadastrar" pode vir antes ou depois dele.
    await esperarPasso(page, 6);
    await clicarTexto(page, 'Não cadastrar', { timeout: 5000 }).catch(() => {});
    if (await passoAtual(page) === 6) {
        await clicarTexto(page, 'Pular');
        await clicarTexto(page, 'Não cadastrar', { timeout: 10000 }).catch(() => {});
    }

    // 7/8 — Vencimento: a data mais próxima do dia 15 + ciente
    await esperarPasso(page, 7);
    await print(page, `tt_${numeroUC}_p7_inicio`);
    // As datas podem vir como rádios (como o passo 5) ou como lista suspensa.
    const radios = await page.evaluate(() => [...document.querySelectorAll('input[type=radio]')]
        .map((i) => (i.closest('mat-radio-button, label')?.innerText || i.value || '').trim()).filter(Boolean));
    if (radios.length) {
        r.vencimento = vencimentoPreferido(radios);
        if (!r.vencimento) throw new ParadaTT(`Datas de vencimento não reconhecidas: ${radios.join(', ')}`);
        await marcarRadio(page, r.vencimento);
    } else {
        const { opcoes } = await abrirSelect(page, 'Vencimento');
        await page.keyboard.press('Escape').catch(() => {});
        r.vencimento = vencimentoPreferido(opcoes);
        if (!r.vencimento) throw new ParadaTT(`Datas de vencimento não reconhecidas: ${opcoes.join(', ')}`);
        await escolherOpcao(page, 'Vencimento', r.vencimento);
    }
    await marcarCheckbox(page, 'Ciente');
    r.printAntesDeEnviar = await print(page, `tt_${numeroUC}_p7`);

    // Daqui em diante protocola de verdade.
    if (!await confirmar(r)) throw new ParadaTT('Envio não confirmado pela pessoa no terminal; nada foi enviado.');

    await clicarTexto(page, 'Cadastrar');
    // ~30 s processando. Defeito conhecido do portal: o pop-up fecha sem
    // confirmar; um 2º Cadastrar então mostra a confirmação (não reenvia).
    let finalizar = await esperarTexto(page, /FINALIZAR/i, 60000);
    if (!finalizar) {
        console.log('   [TT] Processamento fechou sem confirmação; clicando Cadastrar de novo (comportamento conhecido do portal).');
        await clicarTexto(page, 'Cadastrar');
        finalizar = await esperarTexto(page, /FINALIZAR/i, 60000);
    }
    r.printEnvio = await print(page, `tt_${numeroUC}_p8_envio`);
    if (!finalizar) throw new ParadaTT('Sem confirmação depois de 2 cliques em Cadastrar. CONFIRA NO PORTAL antes de tentar de novo.');
    r.protocolo = (await lerProtocolo(page)) || r.protocolo;
    await clicarTexto(page, 'Finalizar');
    await espera(page, 4000);
    return r;
}

async function esperarTexto(page, regex, timeout) {
    const ate = Date.now() + timeout;
    while (Date.now() < ate) {
        const tem = await page.evaluate((src) => {
            const re = new RegExp(src, 'i');
            return [...document.querySelectorAll('button, a, [role=button]')].some((b) => re.test(b.innerText || '') && b.getBoundingClientRect().width > 0);
        }, regex.source);
        if (tem) return true;
        await espera(page, 1500);
    }
    return false;
}

/**
 * Número de 11 ou 12 dígitos (padrão novo da ANEEL) não muda na TT. O número
 * antigo (9–10 dígitos, começa com 7 ou 007) MUDA: a UC volta com número novo
 * na lista da UG (dono, 19/10/2026).
 */
function numeroMudaNaTT(numero) {
    const d = so(numero).replace(/^00/, '');
    return d.length < 11;
}

/** Números de UC listados em Unidades Consumidoras ("2.289.895.032-69" → "228989503269"). */
async function numerosNaLista(page) {
    await page.evaluate((r) => { location.hash = r; }, MEUS_IMOVEIS);
    await espera(page, 5000);
    const texto = await textoDaTela(page);
    const achados = texto.match(/UNIDADE CONSUMIDORA\s*([\d.\-]{9,20})/gi) || [];
    return new Set(achados.map((a) => so(a)));
}

/** A TT só conta como feita se a UC (mesmo número) passar a constar na lista da UG. */
async function ucNaLista(page, numeroUC) {
    await page.evaluate((r) => { location.hash = r; }, MEUS_IMOVEIS);
    await espera(page, 4000);
    const campo = page.locator('input[placeholder*="Unidade Consumidora"]').first();
    await campo.fill(numeroUC);
    await clicarTexto(page, 'Pesquisar').catch(() => campo.press('Enter'));
    await espera(page, 5000);
    return so(await textoDaTela(page)).includes(numeroUC);
}

// ------------------------------------------------------------------ orquestração

function confirmarNoTerminal(tt) {
    return async (r) => {
        console.log('\n================ CONFERÊNCIA ANTES DE ENVIAR ================');
        console.log(` UC cedente ........ ${tt.numero_uc_origem} (${tt.uc.titular_conta || 'sem nome'})`);
        console.log(` Cessionário ....... ${tt.cessionario.name} (UG ${tt.ug.numero_uc})`);
        console.log(` Protocolo ......... ${r.protocolo || '(não lido)'}`);
        console.log(` Endereço no portal  ${r.endereco.tela}`);
        for (const a of r.endereco.achados) console.log(`   ${a.ok ? 'OK ' : 'DIVERGE'} ${a.item}`);
        console.log(` Resumo cita o cessionário: ${r.resumoTemCessionario ? 'sim' : 'NÃO'}`);
        console.log(` E-mail da fatura .. ${r.email}`);
        console.log(` Vencimento ........ ${r.vencimento}`);
        console.log(` Print ............. ${r.printAntesDeEnviar}`);
        console.log('=============================================================');
        const resp = await perguntar('Digite ENVIAR para protocolar a TT (qualquer outra coisa cancela): ');
        return resp === 'ENVIAR';
    };
}

async function processar(browser, tt) {
    const numeroUC = so(tt.numero_uc_origem);
    console.log(`\n=== TT ${tt.id} — UC ${numeroUC} → ${tt.cessionario?.name} ===`);

    // Só sai de 'a_iniciar'. Uma TT em 'erro' ou com débito volta para lá pelo
    // botão "Tentar de novo" do painel (fn_tt_retentar), nunca por aqui.
    if (!await rpc('fn_tt_reivindicar', { p_tt_id: tt.id })) {
        console.log(`   [TT] Status '${tt.status}': só executo TT em 'a_iniciar'. Use "Tentar de novo" no painel da UC.`);
        return;
    }

    const context = await browser.newContext(neoenergia.contextOptions());
    const page = await context.newPage();
    const ctx = { log: (m) => console.log(m), screenshot: (n) => print(page, n), downloadDir: './downloads' };
    try {
        const creds = await credencialDaUG(tt);
        await neoenergia.login(page, creds, ctx);
        const estado = neoenergia.resolverEscopo({ uf: tt.ug.address?.uf, concessionaria: tt.ug.concessionaria });
        await neoenergia.selecionarEscopo(page, estado, ctx);

        // Retrato da lista ANTES: com número antigo, a UC volta com número novo
        // e só a diferença entre as listas o revela.
        const antes = numeroMudaNaTT(numeroUC) ? await numerosNaLista(page) : null;

        const abertura = await abrirTT(page);
        if (abertura.debito) {
            await print(page, `tt_${numeroUC}_debito`);
            await clicarTexto(page, 'Finalizar').catch(() => {});
            throw new ParadaTT('Débito na UG.', { debito: abertura });
        }

        const r = await preencherWizard(page, tt, confirmarNoTerminal(tt));
        if (r.ensaio) {
            console.log(`   [TT] Ensaio parou no Resumo (protocolo ${r.protocolo}). Nada enviado.`);
            await rpc('fn_tt_registrar_erro', { p_tt_id: tt.id, p_erro: `Ensaio (--ate-resumo) até o passo 4; nada enviado. Protocolo do rascunho: ${r.protocolo}` });
            return;
        }

        let numeroFinal = null;   // número da UC na lista da UG depois da TT
        if (antes) {
            const novos = [...await numerosNaLista(page)].filter((n) => !antes.has(n));
            if (novos.length === 1) numeroFinal = novos[0];
            else console.log(`   [TT] Número antigo: esperava 1 UC nova na lista da UG, vieram ${novos.length} (${novos.join(', ') || 'nenhuma'}).`);
        } else if (await ucNaLista(page, numeroUC)) {
            numeroFinal = numeroUC;
        }
        await print(page, `tt_${numeroUC}_lista`);
        await rpc('fn_tt_protocolar', { p_tt_id: tt.id, p_protocolo: r.protocolo || 'sem-numero' });
        if (numeroFinal) {
            await rpc('fn_concluir_tt', { p_tt_id: tt.id, p_numero_uc_novo: numeroFinal === numeroUC ? null : numeroFinal });
            console.log(`   [TT] Concluída: UC ${numeroFinal}${numeroFinal !== numeroUC ? ` (antes ${numeroUC})` : ''} consta na lista da UG. Protocolo ${r.protocolo}.`);
        } else {
            console.log(`   [TT] Protocolada (${r.protocolo}), mas não confirmei a UC na lista da UG. Ficou como 'protocolada' para conferência.`);
        }
    } catch (e) {
        await print(page, `tt_${numeroUC}_parada`);
        if (e.debito) {
            await rpc('fn_tt_registrar_debito', { p_tt_id: tt.id, p_valor: e.debito.valor, p_detalhe: e.debito.texto });
            console.log(`   [TT] Débito na UG reportado (${e.debito.valor ?? 'valor não lido'}). A TT espera a quitação.`);
        } else {
            await rpc('fn_tt_registrar_erro', { p_tt_id: tt.id, p_erro: e.message }).catch((x) => console.error(x.message));
            console.log(`   [TT] Parada: ${e.message}`);
        }
    } finally {
        await context.close().catch(() => {});
    }
}

/**
 * --conferir <protocolo>: o envio foi feito na janela, por uma pessoa (19/10/2026,
 * 1º caso real). Só entra, procura a UC na lista da UG e registra o desfecho.
 * Exige a TT em 'em_execucao' (o filler interrompido antes de enviar a deixa assim).
 */
async function conferir(browser, tt, protocolo) {
    const numeroUC = so(tt.numero_uc_origem);
    if (tt.status !== 'em_execucao') throw new Error(`TT em '${tt.status}'; --conferir só vale para 'em_execucao'.`);
    if (numeroMudaNaTT(numeroUC)) throw new Error('Número antigo: o novo só aparece pela diferença da lista; confira à mão.');
    const context = await browser.newContext(neoenergia.contextOptions());
    const page = await context.newPage();
    const ctx = { log: (m) => console.log(m), screenshot: (n) => print(page, n), downloadDir: './downloads' };
    try {
        await neoenergia.login(page, await credencialDaUG(tt), ctx);
        await neoenergia.selecionarEscopo(page, neoenergia.resolverEscopo({ uf: tt.ug.address?.uf, concessionaria: tt.ug.concessionaria }), ctx);
        const achou = await ucNaLista(page, numeroUC);
        console.log(`   [TT] Print da busca: ${await print(page, `tt_${numeroUC}_conferencia`)}`);
        await rpc('fn_tt_protocolar', { p_tt_id: tt.id, p_protocolo: protocolo });
        if (achou) {
            await rpc('fn_concluir_tt', { p_tt_id: tt.id, p_numero_uc_novo: null });
            console.log(`   [TT] Concluída: UC ${numeroUC} consta na lista da UG. Protocolo ${protocolo}.`);
        } else {
            console.log(`   [TT] UC ${numeroUC} ainda NÃO aparece na lista da UG. TT registrada como 'protocolada' (${protocolo}).`);
        }
    } finally {
        await context.close().catch(() => {});
    }
}

async function main() {
    if (args.includes('--conferir')) {
        const protocolo = args[args.indexOf('--conferir') + 1];
        if (!argTt || !protocolo) throw new Error('Uso: --tt <uuid> --conferir <protocolo>');
        const [tt] = await carregarTTs();
        if (!tt) throw new Error('TT não encontrada.');
        const browser = await chromium.launch(neoenergia.launchOptions());
        try { await conferir(browser, tt, protocolo); } finally { await browser.close().catch(() => {}); }
        return;
    }
    const tts = await carregarTTs();
    if (!tts.length) { console.log('Nenhuma TT a executar.'); return; }
    console.log(`${tts.length} TT(s) a executar${ATE_RESUMO ? ' (ENSAIO até o Resumo)' : ''}.`);
    const browser = await chromium.launch(neoenergia.launchOptions());
    try {
        // Uma por vez, na ordem: a confirmação de cada envio é feita por uma pessoa.
        for (const tt of tts) await processar(browser, tt);
    } finally {
        await browser.close().catch(() => {});
    }
    console.log('\nFila de TT encerrada. Se todas da usina concluíram, o card da Lista de Rateio já foi gerado/renovado.');
}

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { conferirEndereco, vencimentoPreferido, valorDoDebito, numeroMudaNaTT };
