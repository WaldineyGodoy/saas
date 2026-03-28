const { firefox } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
    console.log('--- TESTE FATURISTA FINAL ---');
    console.log('UC ALVO: 7030003955');
    
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

    const effectiveSub = uc.titular_fatura || uc.subscriber;
    const credentials = effectiveSub?.portal_credentials;

    if (!credentials?.login || !credentials?.password) {
        console.error('ERRO: Credenciais não encontradas.');
        return;
    }

    console.log(`Titular: ${effectiveSub.name}`);
    console.log('Iniciando Firefox...');
    const browser = await firefox.launch({ headless: true }); 
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        acceptDownloads: true
    });
    const page = await context.newPage();

    try {
        console.log('Acessando portal Neoenergia...');
        await page.goto('https://agenciavirtual.neoenergia.com/#/login', { waitUntil: 'load', timeout: 60000 });

        let loggedIn = false;
        for (let i = 0; i < 20; i++) {
            await page.waitForTimeout(3000);
            const url = page.url();
            
            const userField = page.locator('input#userId');
            const passField = page.locator('input#password');
            const enterBtn = page.locator('button:has-text("ENTRAR")');
            const portalAccessBtn = page.locator('button[aria-label="Conectar-se a agência virtual"]');
            const rnCard = page.locator('mat-card:has-text("Rio Grande do Norte")');
            const checkOla = page.locator('text=Olá,').first();
            const searchInput = page.locator('input[placeholder*="Código"]').first();

            if (url.includes('/home') || await searchInput.isVisible()) {
                console.log('LOGIN REALIZADO COM SUCESSO (DASHBOARD)!');
                loggedIn = true;
                break;
            }

            if (await checkOla.isVisible()) {
                console.log('LOGIN PARCIAL OK (OLÁ VISÍVEL). Verificando botão de entrada...');
                const portalLoginBtn = page.locator('.mat-card button:has-text("LOGIN")').first();
                if (await portalLoginBtn.isVisible()) {
                    await portalLoginBtn.click();
                    await page.waitForTimeout(5000);
                    continue;
                }
                // Se não houver botão, talvez já possamos ir para /home
                await page.goto('https://agenciavirtual.neoenergia.com/#/home').catch(() => {});
                await page.waitForTimeout(5000);
                continue;
            }

            // FLUXO DE LOGIN
            if (await userField.isVisible()) {
                console.log('Preenchendo credenciais (Modo Humano)...');
                const cleanUser = credentials.login.replace(/\D/g, '');
                
                await userField.click();
                await page.keyboard.press('Control+A');
                await page.keyboard.press('Backspace');
                await userField.pressSequentially(cleanUser, { delay: 100 });
                
                await passField.click();
                await page.keyboard.press('Control+A');
                await page.keyboard.press('Backspace');
                await passField.pressSequentially(credentials.password, { delay: 100 });
                
                await page.waitForTimeout(2000);
                if (await enterBtn.isEnabled()) {
                    await enterBtn.click({ noWaitAfter: true }); // Não aguardar transição aqui para evitar timeout se o spinner carregar
                    await page.waitForTimeout(5000); // Aguarda o processamento
                } else {
                    console.log('Botão ENTRAR desabilitado, tentando forçar...');
                    await enterBtn.click({ force: true, noWaitAfter: true });
                }
                continue;
            }

            if (await rnCard.isVisible()) {
                console.log('Selecionando RN...');
                await rnCard.click();
                continue;
            }

            if (await portalAccessBtn.isVisible()) {
                console.log('Acessando Agência Virtual...');
                await portalAccessBtn.click();
                continue;
            }

            const genericLogin = page.locator('button:has-text("LOGIN")').first();
            if (await genericLogin.isVisible()) {
                await genericLogin.click();
                continue;
            }
        }

        if (!loggedIn) throw new Error('Falha no login ou timeout.');

        const paddedUC = uc.numero_uc.toString().padStart(12, '0');
        console.log(`Buscando UC: ${paddedUC}`);
        
        await page.goto('https://agenciavirtual.neoenergia.com/#/home').catch(() => {});
        await page.waitForTimeout(5000);

        const searchInput = page.locator('input[placeholder*="digo"], input[placeholder*="Código"]').first();
        await searchInput.waitFor({ state: 'visible', timeout: 30000 });
        await searchInput.clear();
        await searchInput.fill(paddedUC);
        await page.click('button[aria-label="Pesquisar"]');
        await page.waitForTimeout(6000);

        const ucCard = page.locator(`mat-card:has-text("${uc.numero_uc}"), mat-card:has-text("${paddedUC}")`).first();
        if (await ucCard.isVisible()) {
            await ucCard.click();
            console.log('Acessando área da UC...');
            await page.waitForSelector('mat-card:has-text("Faturas")', { timeout: 20000 });
            await page.click('mat-card:has-text("Faturas")');

            console.log('Listando faturas disponíveis...');
            await page.waitForSelector('mat-expansion-panel', { timeout: 40000 });
            const panels = await page.locator('mat-expansion-panel').all();
            
            let found = false;
            for (const panel of panels) {
                const mesRefStr = await panel.locator('.mat-content div:nth-child(2) span:nth-child(2)').innerText().catch(() => '');
                const statusText = await panel.locator('.mat-content div:nth-child(4) span:nth-child(2)').innerText().catch(() => '');
                
                console.log(`   - Fatura: ${mesRefStr.trim()} | Status: ${statusText.trim()}`);
                
                if (statusText.includes('Vencida') || statusText.includes('A Vencer') || statusText.includes('Pago')) {
                    console.log(`   -> Iniciando download de ${mesRefStr.trim()}...`);
                    const header = panel.locator('mat-expansion-panel-header');
                    await header.click();
                    await page.waitForTimeout(3000);

                    const downloadBtn = panel.locator('button[aria-label*="Download"], button:has-text("Baixar")').first();
                    if (await downloadBtn.isVisible()) {
                        const [dl] = await Promise.all([
                            page.waitForEvent('download'),
                            downloadBtn.click()
                        ]);
                        const fileName = `FATURISTA_${uc.numero_uc}_${mesRefStr.trim().replace('/', '-')}.pdf`;
                        const localPath = `./downloads/${fileName}`;
                        await dl.saveAs(localPath);
                        console.log(`   ARQUIVO SALVO: ${localPath}`);
                        
                        const { consumoKwh, cipValor } = await parseInvoicePdf(localPath);
                        console.log(`   DADOS EXTRAÍDOS: Consumo=${consumoKwh} kWh, CIP=R$ ${cipValor}`);
                        
                        found = true;
                        break; 
                    }
                    await header.click();
                }
            }

            if (found) console.log('\n--- TESTE FINALIZADO COM SUCESSO! ---');
            else console.log('\n--- NENHUMA FATURA ENCONTRADA PARA DOWNLOAD ---');
        } else {
            console.log('UC não encontrada na lista após pesquisa.');
            await page.screenshot({ path: './downloads/test_debug/uc_not_found.png' });
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: `./downloads/test_debug/last_error_${Date.now()}.png` });
    } finally {
        await browser.close();
    }
}

async function parseInvoicePdf(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    try {
        const data = await pdf(dataBuffer);
        const text = data.text;
        const consumptionMatch = text.match(/(?:Energia Ativa|Consumo Total|Total Consumo)[^\d]*(\d+)[^\d]*kWh/i) || 
                                 text.match(/kWh[^\d]*(\d+)/i) ||
                                 text.match(/(\d+)\s*kWh/i);
        const cipMatch = text.match(/(?:CONTR\.? ILUM\.? PUB\.?|COSIP|CIP-MUNICIP\.)[^\d]*([\d,.]+)/i) ||
                         text.match(/Ilum\.?\s*P[uú]bl\.?[^\d]*([\d,.]+)/i);
        let consumoKwh = 0;
        if (consumptionMatch) consumoKwh = parseInt(consumptionMatch[1].replace(/\D/g, ''));
        let cipValor = 0;
        if (cipMatch) {
            const rawCip = cipMatch[1];
            if (rawCip.includes(',') && rawCip.includes('.')) cipValor = parseFloat(rawCip.replace(/\./g, '').replace(',', '.'));
            else if (rawCip.includes(',')) cipValor = parseFloat(rawCip.replace(',', '.'));
            else cipValor = parseFloat(rawCip);
        }
        return { consumoKwh, cipValor };
    } catch (err) { return { consumoKwh: 0, cipValor: 0 }; }
}

run();
