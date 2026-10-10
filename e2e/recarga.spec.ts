import { test, expect } from '@playwright/test';
import {
  ambienteLocal, apagarPosto, apagarUsuarioTeste, aguardar, criarPosto, criarUsuarioTeste, db,
  entregarWebhookPagamento, iniciarEmulador, recargaPaga, semearConector,
  type Emulador, type Posto, type UsuarioTeste,
} from './support/local';

// Tela /recarga ao vivo (Tarefa 11; spec OCPP §5.4 e §8.7: UI-01..03). Contra o stack local:
// Supabase (API + Edge Functions), CSMS na 9220 e o emulador Python em happy_path.

let posto: Posto | null = null;
let emulador: Emulador | null = null;
let usuario: UsuarioTeste | null = null;

// A 1a chamada a cada Edge Function local sobe o worker (segundos, as vezes 5xx sem corpo).
// Aquece antes dos testes para a falha nao parecer bug da tela.
test.beforeAll(async () => {
  test.setTimeout(240_000);
  const { url, anon } = ambienteLocal();
  for (const fn of ['create-charging-checkout', 'stop-charging']) {
    await aguardar(async () => {
      try {
        const r = await fetch(`${url}/functions/v1/${fn}`, {
          method: 'POST',
          headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(60_000),
        });
        return r.status >= 400 && r.status < 500 && (await r.json().then(() => true, () => false));
      } catch {
        return false;
      }
    }, 180_000, `Edge Function ${fn} responder`);
  }
});

test.afterEach(async ({}, testInfo) => {
  if (emulador && testInfo.status !== testInfo.expectedStatus) console.log(`[emulador]
${emulador.saida()}`);
  await emulador?.parar();
  if (process.env.E2E_MANTER_DADOS) return; // depuracao: deixa o posto e a recarga no banco
  if (posto) await apagarPosto(posto);
  if (usuario) await apagarUsuarioTeste(usuario);
  posto = emulador = usuario = null;
});

// ---------------------------------------------------------------------------------------------
// UI-01: conector indisponivel. Sem Stripe: a recusa 409 acontece antes do PaymentIntent.
// ---------------------------------------------------------------------------------------------
for (const c of [
  { motivo: 'offline', status: 'Unavailable', online: false, trecho: /offline/i },
  { motivo: 'ocupado', status: 'Charging', online: true, trecho: /em uso/i },
]) {
  test(`UI-01: conector ${c.motivo} mostra a mensagem e desabilita o pagamento`, async ({ page }) => {
    posto = await criarPosto();
    await semearConector(posto, 1, c.status, c.online);

    await page.goto(`/recarga?posto=${posto.eletropostoId}&conector=1`);
    await expect(page.getByTestId('station-card')).toContainText(`Posto ${posto.ocppId}`);
    await page.getByPlaceholder('Ex: João da Silva').fill('Motorista E2E');
    await page.getByPlaceholder('seu.email@exemplo.com').fill('motorista@teste.invalid');

    const botao = page.getByTestId('start-checkout-button');
    await expect(botao).toBeEnabled();
    await botao.click();

    await expect(page.getByRole('alert')).toContainText(c.trecho);
    await expect(botao).toBeDisabled();
    await expect(page.getByTestId('stripe-container')).toHaveCount(0);
  });
}

// ---------------------------------------------------------------------------------------------
// UI-02 + UI-03 sem Stripe: recarga paga pelas mesmas funcoes do webhook (fn_reservar_recarga ->
// fn_marcar_recarga_paga -> fn_confirmar_inicio -> idTag + start:<recarga>), tela retomada por
// /recarga?recarga=<id> (so andamento, via fn_recarga_publica). Prova de posse do "Parar": usuario
// descartavel do Auth LOCAL dono da recarga, cujo JWT o supabase-js envia ao stop-charging.
// (O caminho do client_secret exige o PaymentIntent real da Stripe: coberto no spec abaixo.)
// ---------------------------------------------------------------------------------------------
test('UI-02/UI-03: Conecte o cabo -> Carregando (kWh > 0) -> Parar -> resumo (sem Stripe)', async ({ page }) => {
  posto = await criarPosto();
  usuario = await criarUsuarioTeste();
  emulador = iniciarEmulador(posto.ocppId, { plugDelayS: 2, timeScale: 200 });

  // conector 1 disponivel no banco = Boot + StatusNotification processados pelo CSMS
  await aguardar(async () => {
    const [car] = await db.get('eletroposto_carregadores', `id=eq.${posto!.carregadorId}&select=online`);
    const [con] = await db.get('eletroposto_conectores', `carregador_id=eq.${posto!.carregadorId}&numero=eq.1&select=status`);
    return car?.online && con?.status === 'Available';
  }, 30_000, `emulador conectado.\n${emulador.saida()}`);

  const recarga = await recargaPaga(posto, 100, usuario.id);

  await page.addInitScript(([chave, sessao]) => localStorage.setItem(chave as string, JSON.stringify(sessao)),
    [usuario.chaveStorage, usuario.sessao]);

  // as chamadas vao ao Supabase LOCAL (o .env do repo aponta para outro lugar)
  const { url } = ambienteLocal();
  const consultas: string[] = [];
  page.on('request', (r) => r.url().includes('fn_recarga_publica') && consultas.push(r.url()));
  await page.goto(`/recarga?recarga=${recarga.id}`);

  // paga, ainda sem comando de inicio: "Conecte o cabo", sem botao de parar
  await expect(page.getByTestId('recarga-titulo')).toHaveText('Conecte o cabo ao veículo');
  await expect(page.getByTestId('parar-recarga')).toHaveCount(0);

  await recarga.iniciar(); // o webhook manda o RemoteStart; o emulador pluga o cabo em 2 s

  await expect(page.getByTestId('recarga-titulo')).toHaveText('Carregando', { timeout: 90_000 });
  await expect.poll(async () => {
    const txt = (await page.getByTestId('kwh-consumido').textContent()) || '0';
    return Number(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  }, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('valor-parcial')).toHaveText(/R\$ [1-9]\d*,\d{2}/);
  expect(consultas.every((u) => u.startsWith(url))).toBe(true);

  await page.getByRole('button', { name: 'Parar recarga' }).click();

  await expect(page.getByTestId('recarga-titulo')).toHaveText('Recarga concluída', { timeout: 90_000 });
  await expect(page.getByTestId('valor-final')).toHaveText(/R\$ \d+,\d{2}/);
  const [final] = await db.get('recargas_eletroposto', `id=eq.${recarga.id}&select=status,valor,valor_final,valor_estornado`);
  expect(final.status).toBe('completed');
  expect(Number(final.valor_final)).toBeGreaterThan(0);
  expect(Number(final.valor_final)).toBeLessThan(Number(final.valor));
  // o servidor recebeu o RemoteStop pedido pela tela
  const comandos = await db.get('ocpp_comandos', `recarga_id=eq.${recarga.id}&acao=eq.RemoteStopTransaction&select=chave_idempotencia`);
  expect(comandos.map((x) => x.chave_idempotencia)).toContain(`stop:${recarga.id}`);
});

// ---------------------------------------------------------------------------------------------
// UI-02 completo com a Stripe em modo teste (cartao 4242 no Payment Element). Precisa de chaves
// de TESTE: VITE_STRIPE_PUBLISHABLE_KEY (frontend), STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET no
// ambiente das Edge Functions locais (supabase/functions/.env) e aqui. Sem elas: pulado com aviso.
// ---------------------------------------------------------------------------------------------
const chavesStripe = {
  pk: process.env.VITE_STRIPE_PUBLISHABLE_KEY,
  sk: process.env.STRIPE_SECRET_KEY,
  whsec: process.env.STRIPE_WEBHOOK_SECRET,
};
const faltam = Object.entries({ VITE_STRIPE_PUBLISHABLE_KEY: chavesStripe.pk, STRIPE_SECRET_KEY: chavesStripe.sk, STRIPE_WEBHOOK_SECRET: chavesStripe.whsec })
  .filter(([, v]) => !v).map(([k]) => k);
if (faltam.length) {
  console.warn(`[e2e] spec com Stripe PULADO: faltam ${faltam.join(', ')} (chaves de teste da Stripe).`);
}

test('UI-02/UI-03: pagar com cartao 4242 (Stripe teste) e acompanhar ate o resumo', async ({ page }) => {
  test.skip(faltam.length > 0, `faltam ${faltam.join(', ')}: sem chaves de teste da Stripe este spec nao roda`);

  posto = await criarPosto();
  emulador = iniciarEmulador(posto.ocppId, { plugDelayS: 3, timeScale: 200, atrasoStartS: 3 });
  await aguardar(async () => {
    const [con] = await db.get('eletroposto_conectores', `carregador_id=eq.${posto!.carregadorId}&numero=eq.1&select=status`);
    return con?.status === 'Available';
  }, 30_000, `emulador conectado.\n${emulador.saida()}`);

  await page.goto(`/recarga?posto=${posto.eletropostoId}&conector=1`);
  await page.getByPlaceholder('Ex: João da Silva').fill('Motorista E2E');
  await page.getByPlaceholder('seu.email@exemplo.com').fill('motorista@teste.invalid');
  await page.getByTestId('start-checkout-button').click();

  const stripe = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
  await stripe.locator('input[name="number"]').fill('4242424242424242');
  await stripe.locator('input[name="expiry"]').fill('1234');
  await stripe.locator('input[name="cvc"]').fill('123');
  await page.getByTestId('pay-submit-button').click();

  // o webhook real chega por `stripe listen --forward-to`; aqui entregamos o evento assinado
  const piId = await aguardar(async () => {
    const [r] = await db.get('recargas_eletroposto', `eletroposto_id=eq.${posto!.eletropostoId}&select=stripe_payment_intent_id`);
    return r?.stripe_payment_intent_id as string | undefined;
  }, 30_000, 'PaymentIntent da recarga');
  await entregarWebhookPagamento(piId, chavesStripe.whsec!);

  await expect(page.getByTestId('recarga-titulo')).toHaveText('Conecte o cabo ao veículo');
  await expect(page.getByTestId('recarga-titulo')).toHaveText('Carregando', { timeout: 90_000 });
  await expect.poll(async () => {
    const txt = (await page.getByTestId('kwh-consumido').textContent()) || '0';
    return Number(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  }, { timeout: 60_000 }).toBeGreaterThan(0);

  // motorista avulso: a prova de posse do stop-charging e o client_secret do PaymentIntent
  await page.getByRole('button', { name: 'Parar recarga' }).click();
  await expect(page.getByTestId('recarga-titulo')).toHaveText('Recarga concluída', { timeout: 90_000 });
  await expect(page.getByTestId('valor-final')).toBeVisible();
});
