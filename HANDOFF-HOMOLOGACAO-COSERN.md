# Handoff — Automação da Homologação Cosern (e o papel do Scrapling)

> Pergunta que originou este documento: *"como esse repositório pode nos ajudar na homologação
> Cosern, para evitar ter que logar no Chrome e digitar o captcha toda vez?"* — com indicação do
> [Scrapling](https://github.com/D4Vinci/Scrapling) como possível ferramenta.
>
> Escrito em 18/09/2026. Complementa `HANDOFF-PARTE-B-ROBO.md` (robô de contas) — a homologação
> é o **segundo serviço** no mesmo portal, e deve reaproveitar a mesma infraestrutura.

---

## TL;DR

1. **O repositório já resolve a maior parte do problema.** Existe um robô Playwright em produção
   (`scraper/`) que loga sozinho no portal da Neoenergia/Cosern com as credenciais do banco, passa
   pelo WAF Akamai e baixa faturas. A homologação não precisa de stack nova — precisa de um
   **driver/rotina nova dentro da arquitetura que já existe**.
2. **O "logar toda vez" não é limitação do portal: é decisão de arquitetura do nosso robô.** Cada
   execução abre um contexto de navegador limpo e joga a sessão fora no fim. Ninguém salva os
   cookies. Persistir a sessão (`storageState` / `user_data_dir`) é o que elimina o login
   repetido — e é uma capacidade **nativa do Playwright que já temos**.
3. **O Scrapling NÃO resolve o captcha.** O que ele resolve automaticamente é **Cloudflare
   Turnstile/Interstitial** (`solve_cloudflare=True`). O portal da Neoenergia é protegido por
   **Akamai**, não Cloudflare — está documentado no nosso próprio workflow. Se o captcha da
   homologação for reCAPTCHA ou hCaptcha, o Scrapling não tem solver para nenhum dos dois.
4. **O Scrapling tem, sim, duas ideias que valem roubar** (patchright e seletores adaptativos),
   mas o custo de adotá-lo inteiro é alto: ele é Python, e nosso scraper é Node — significaria
   **duas implementações do mesmo portal**, exatamente o erro que já recusamos conscientemente
   quando decidimos não reimplementar a extração de PDF no backend.

**Recomendação: estender `scraper/` com persistência de sessão + um driver de homologação. Não
migrar para Scrapling.**

---

## 1. Inventário — o que já existe e serve

| Peça | Onde | O que faz | Serve para homologação? |
|---|---|---|:---:|
| Orquestrador Playwright | `scraper/scraper.js` | Agrupa UCs por driver → titular → estado, abre 1 navegador por portal, trata erros e grava no banco | ✅ direto |
| Driver Neoenergia | `scraper/drivers/neoenergia.js` | Login, seleção de estado, navegação da SPA Angular por hash, download | ✅ login e navegação reaproveitáveis |
| Contrato de driver | `scraper/drivers/index.js` | `login / selecionarEscopo / capturarFatura / encerrarSessao` + resolução por concessionária | ✅ é onde entra a homologação |
| Runner com WAF resolvido | `.github/workflows/scraper.yml` | Chromium **headful** dentro de `xvfb-run` — a combinação que passa pelo Akamai | ✅ |
| Disparo | `pg_cron` → GitHub API (`repository_dispatch`) | Agenda fora do GitHub, porque o `schedule:` do Actions falhou silenciosamente por dias | ✅ |
| Credenciais | Vault, via RPC `fn_get_portal_credentials` | Senha cifrada, `EXECUTE` só para `service_role`; o jsonb `portal_credentials` ficou como fallback de transição | ✅ |
| Modelo de dados | `rateio_lists` + `protocols` (`linked_entity_type = 'rateio_list'`) | Lista de rateio com `protocolo`, `status`, `ucs_snapshot`, `status_dates` e timeline | ✅ o robô só preenche o que já existe |

**Conclusão do inventário:** a homologação hoje é manual não por barreira técnica, mas porque
ninguém escreveu a rotina. O login automatizado **já roda em produção todo dia** no fluxo de
contas, sem operador e sem captcha.

---

## 2. Diagnóstico honesto do captcha

Aqui é preciso separar o que eu sei do que eu não sei.

**O que está provado pelo código:**
`drivers/neoenergia.js:173-260` faz login preenchendo CPF/CNPJ + senha e clicando em ENTRAR.
**Não há nenhum tratamento de captcha em lugar nenhum do robô** — e ele funciona em produção.
Logo, **a Agência Virtual não exige captcha no login em condições normais**.

**O que a operação relata:** captcha ao fazer homologação. Isso só pode ser uma destas coisas:

| Hipótese | Como confirmar | Consequência |
|---|---|---|
| **A.** O serviço de homologação/GD fica em **outro portal**, com captcha próprio | Abrir o fluxo manual e anotar a URL + o tipo de captcha (`grep` no HTML por `recaptcha`, `hcaptcha`, `turnstile`) | Precisa de driver novo, não só rotina nova |
| **B.** É o **Akamai desafiando** por fingerprint ruim, e o captcha aparece de forma intermitente | Ver se o captcha some quando o operador já está logado há algum tempo no mesmo perfil do Chrome | Resolve-se com sessão persistente + stealth — sem solver |
| **C.** O captcha é do login mesmo, mas só para **usuário/IP marcado** | Comparar: o robô do CI loga sem captcha; o operador no Chrome de casa recebe captcha | Idem B |

👉 **Primeira tarefa de quem pegar isso: identificar qual é o caso, e qual o provedor do captcha.**
É uma inspeção de 10 minutos no navegador e muda completamente a solução. Este documento cobre as
três hipóteses, mas a hipótese B/C é a mais provável — porque o robô já loga sem captcha.

---

## 3. A causa real do "toda vez": a sessão é descartada

`scraper.js:373-375`:

```js
const browser = await chromium.launch(driver.launchOptions());
const context = await browser.newContext(driver.contextOptions());   // ← contexto LIMPO
const page = await context.newPage();
```

`newContext()` sem `storageState` cria um navegador **sem histórico, sem cookies, sem
localStorage** — um visitante novo em folha, toda execução. É por isso que:

- todo ciclo refaz o login completo;
- o Akamai vê um cliente sem nenhum cookie de reputação (`_abck`, `bm_sz`) e trata como suspeito —
  que é exatamente o cenário que gera desafio/captcha;
- `encerrarSessao()` (`neoenergia.js:573`) fecha tudo e **não salva nada**.

O Playwright resolve isso nativamente de duas formas:

| Mecanismo | O que guarda | Melhor para |
|---|---|---|
| `context.storageState({ path })` + `newContext({ storageState })` | cookies + localStorage, em JSON | rodar em CI / serverless, sessão viaja no banco |
| `chromium.launchPersistentContext(userDataDir, opts)` | perfil inteiro do Chrome (cache, IndexedDB, fingerprint estável) | rodar em máquina fixa; **muito mais convincente para o Akamai** |

Ou seja: **o recurso que o Scrapling vende como `user_data_dir` é literalmente
`launchPersistentContext` do Playwright, que já está instalado aqui.**

### ⚠️ Ressalva importante sobre o GitHub Actions

Cookies do Akamai são amarrados a **IP + fingerprint**. O runner do GitHub Actions entrega um
**IP diferente a cada execução**, então uma sessão salva tende a ser invalidada assim que o IP
muda. Isso não inviabiliza a ideia, mas define onde a homologação deve rodar:

> Para o fluxo de homologação, o host certo é uma **máquina de IP estável** — VPS pequena ou
> self-hosted runner — com `user_data_dir` em disco. Para o fluxo de contas, o Actions continua
> bom, porque lá o login automático já funciona e não há captcha.

---

## 4. O que o Scrapling resolve e o que não resolve

Avaliado sobre o código real da versão **0.4.15** (repositório clonado e lido, não a partir do
material de divulgação).

### ✅ O que ele realmente entrega

| Recurso | Verificado em | Relevância aqui |
|---|---|---|
| **patchright** como engine (Chromium "despatchado", sem os vazamentos de CDP que os WAFs detectam) | `scrapling/engines/_browsers/_stealth.py:7-8` | 🟢 **Alta.** É a única coisa do Scrapling que ataca o Akamai de frente. Pode permitir rodar **headless de verdade** e aposentar o `xvfb` |
| `user_data_dir` / contexto persistente | `_stealth.py:94` (`chromium.launch_persistent_context`) | 🟡 Útil, mas é o Playwright nativo com outro nome — já temos |
| `real_chrome=True` (usa o Chrome instalado, não o Chromium) | `docs/fetching/dynamic.md:85` | 🟡 O Playwright faz com `channel: 'chrome'` |
| Seletores adaptativos (`adaptive=True`) que reencontram o elemento quando o site muda | `docs/parsing/adaptive.md` | 🟢 **Alta.** A SPA Angular do portal quebra seletor com frequência — veja a quantidade de seletor defensivo empilhado em `neoenergia.js:191` |
| Servidor MCP + agent skill | `docs/ai/mcp-server.md`, `agent-skill/` | 🟡 Bom para exploração assistida do portal, não para produção |
| `solve_cloudflare=True` | `_stealth.py:19` (`__CF_PATTERN__` casa só com `challenges.cloudflare.com`) | 🔴 **Nula.** O portal é Akamai |

### ❌ O que ele não entrega

- **Não resolve reCAPTCHA. Não resolve hCaptcha.** O solver é exclusivo de Cloudflare — o próprio
  README (linha 134) manda procurar serviço pago de terceiro para proteções mais pesadas.
- **Não resolve Akamai.** Reduz a chance de *ser desafiado* (via patchright), mas não quebra
  desafio nenhum.
- **Não é Node.** Adotá-lo significa Python 3.10+ no runner, um segundo conjunto de seletores para
  o mesmo portal e duas rotinas de login para manter sincronizadas.

### Custo de adoção, dito com todas as letras

Já recusamos duplicar regra de negócio uma vez — no `HANDOFF-PARTE-B-ROBO.md`, seção 3:

> *"Reimplementá-la em Edge Function criaria duas implementações da mesma regra de negócio — que
> divergem com o tempo."*

Trazer o Scrapling para o fluxo Cosern cai na mesma armadilha, com o agravante de ser em outra
linguagem. **O mesmo ganho está disponível em Node**, sem fork de stack:

| Ideia do Scrapling | Equivalente em Node, hoje |
|---|---|
| patchright (Chromium não detectável) | [`patchright`](https://www.npmjs.com/package/patchright) (npm, v1.63.0) — drop-in do `playwright`, troca só o `require` |
| `user_data_dir` | `chromium.launchPersistentContext()` |
| `real_chrome=True` | `channel: 'chrome'` no `launchOptions()` |
| Seletores adaptativos | Implementável em ~50 linhas no driver: guardar assinatura do elemento e reencontrar por similaridade quando o seletor falha |

**Onde o Scrapling ganharia:** se a investigação da seção 2 revelar que o captcha é **Cloudflare
Turnstile**. Aí `solve_cloudflare=True` resolve de graça o que custaria serviço pago. É o único
cenário que justifica trazer Python para cá — e é justamente o cenário que a evidência atual
(Akamai) torna improvável.

---

## 5. Desenho proposto

### 5.1 Sessão persistente por titular (a peça central) — ✅ IMPLEMENTADO

Entregue em `scraper/lib/sessao.js`, com testes em `scraper/lib/sessao.test.js`
(`npm test`, dentro de `scraper/`). O que mudou de fato:

- o contexto do navegador passou a nascer **por titular**, dentro do laço, em vez de um único
  contexto compartilhado com `clearCookies()` entre um e outro (`scraper.js`);
- `encerrarSessao()` do driver não limpa mais cookie nenhum — o isolamento agora é o próprio
  contexto, e limpar apagaria justamente o que se quer guardar (`drivers/neoenergia.js`);
- o driver ganhou `sessaoValida(page, ctx)`: sonda que vai até `meus-imoveis` e espera o campo de
  busca de UC montar. Olhar só o hash não serve — o Angular renderiza `#/home` com cookie morto e
  só quebra na primeira chamada autenticada;
- o `storageState` é gravado **depois do trabalho**, não logo após o login: o WAF rotaciona cookie
  durante a navegação, e o estado do fim da rodada é o que tem mais chance de ser aceito depois;
- bucket privado `portal-sessions`, criado em `supabase/migrations/20260918a_bucket_portal_sessions.sql`,
  **sem nenhuma policy** — com RLS ligado, isso significa que só o `service_role` alcança;
- `SESSAO_PERSISTENTE=false` desliga tudo sem reverter código, e qualquer falha (bucket ausente,
  JSON corrompido, sonda muda) cai no login completo de antes. O pior caso é o comportamento
  atual mais alguns segundos de sonda.

Esboço original, mantido como registro da intenção:

```js
// Sessão viva por titular. Reaproveita cookies entre execuções para que o login
// (e um eventual captcha) aconteça UMA vez a cada expiração, não a cada rodada.
//
// Guardamos em bucket PRIVADO: storageState contém cookie de sessão autenticada —
// tem o mesmo peso de uma senha.

async function abrirContexto(browser, driver, subscriberId, ctx) {
    const state = await baixarSessao(subscriberId);          // Storage privado
    const context = await browser.newContext({
        ...driver.contextOptions(),
        ...(state ? { storageState: state } : {})
    });
    const page = await context.newPage();

    if (state && await driver.sessaoValida(page, ctx)) {
        ctx.log('   [Sessão] Reaproveitada — login pulado.');
        return { context, page, relogou: false };
    }

    ctx.log('   [Sessão] Expirada ou ausente — autenticando.');
    await driver.login(page, creds, ctx);
    await salvarSessao(subscriberId, await context.storageState());
    return { context, page, relogou: true };
}
```

Novo método no contrato do driver (`drivers/index.js`):

```js
/** Sessão ainda vale? Navega a uma rota autenticada e confere se não caiu no login. */
async sessaoValida(page, ctx) {
    await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(4000);
    const hash = await page.evaluate(() => location.hash);
    return hash.includes('meus-imoveis') || hash.includes('selecionar-estado');
}
```

E `encerrarSessao()` passa a **salvar antes de fechar**, em vez de descartar.

**Ganho imediato, independente da homologação:** o robô de contas também para de relogar 3 vezes
por dia, reduzindo a superfície de desafio do Akamai.

### 5.2 Login assistido — a saída para qualquer captcha

Se a seção 2 confirmar captcha real e não-automatizável, esta é a resposta, e ela **atende o
pedido original**: o operador não deixa de digitar captcha — ele deixa de digitar **toda vez**.

```
CRM: botão "Abrir sessão Cosern"  (1x por semana, ou quando a sessão cai)
   └─ sobe navegador headful com user_data_dir do titular
   └─ operador digita senha + captcha    ← único ponto humano
   └─ storageState salvo em bucket privado + validade registrada
   └─ a partir daqui, TODA homologação do período roda sozinha
```

Se o robô rodar em VPS, o mesmo efeito se obtém com um navegador remoto via `cdp_url` e um visor
ao vivo (browserless/noVNC), sem o operador precisar ter o ambiente na máquina dele.

### 5.3 Rotina de homologação

Seguindo o padrão de `capturarFatura`, um método novo no driver — **o orquestrador nunca conhece
seletor de portal**:

```js
/**
 * Submete a lista de rateio e devolve o protocolo.
 *   { resultado: 'protocolado', protocolo, comprovantePath }
 *   { resultado: 'ja_existe',   protocolo }        // idempotência
 *   { resultado: 'rejeitado',   motivo }
 *   { resultado: 'captcha',     screenshot }       // exige login assistido
 */
async submeterRateio(page, rateio, ctx) { ... }
```

Gravação (o CRM já tem os campos — não inventar coluna):

```js
await supabase.from('rateio_lists')
  .update({ protocolo, status: 'processando', updated_at: new Date().toISOString() })
  .eq('id', rateio.id);

await supabase.from('protocols').insert({
  protocol_number: protocolo,
  linked_entity_type: 'rateio_list',
  linked_entity_id: rateio.id,
  title: `Homologação rateio — ${rateio.usina_name}`,
});
```

O CSV da lista de UCs **já é gerado** em `RateioListModal.jsx:226` — é o mesmo artefato que o
robô vai anexar no portal. Nada a reimplementar.

### 5.4 Consulta de andamento (o ganho que ninguém pediu mas todo mundo quer)

Com sessão persistente, consultar o status do protocolo fica barato. Um job diário varre os
`rateio_lists` em `processando` e move para `concluida` / `reprovada` sozinho — hoje isso é
alguém abrindo o portal para conferir.

---

## 6. Riscos e cuidados

- **`storageState` é credencial.** Bucket privado, service role, nunca commitado, nunca em
  artefato do Actions. Mesmo tratamento de senha.
- **A sessão é um segredo a mais por titular.** A senha já saiu do jsonb e vive cifrada no Vault,
  legível só pela RPC `fn_get_portal_credentials` com EXECUTE para `service_role` — o alerta do
  `HANDOFF-PARTE-B-ROBO.md` §9 já foi endereçado. O `storageState` entra agora no mesmo nível de
  sigilo: quem tem o arquivo entra como o titular **sem precisar da senha**.
- **Idempotência é obrigatória.** Homologação protocolada duas vezes gera protocolo duplicado na
  concessionária — coisa que não se desfaz com `DELETE`. Conferir protocolo existente **antes** de
  submeter, e tratar `resultado: 'ja_existe'` como sucesso.
- **Não reutilizar sessão entre titulares.** Um `user_data_dir`/`storageState` por
  `subscriber_id`. Vazar sessão entre titulares homologa rateio na conta errada.
- **Trocar `playwright` por `patchright` mexe no robô de faturas que está em produção.**
  Fazer em PR separado, com o `xvfb` mantido até provar que headless passa.
- **Não confiar em `schedule:` do GitHub Actions** — o workflow de contas documenta que ele parou
  por dias sem aviso. Agendar pelo `pg_cron`, como já é feito.

---

## 7. Ordem sugerida

1. **Identificar o captcha** (seção 2): qual URL, qual provedor. Bloqueia todo o resto — 10 min.
2. ~~**Sessão persistente** (5.1) no fluxo de contas~~ — ✅ feito. Falta **aplicar a migração do
   bucket** e ler o log da primeira rodada: `[Sessão] Reaproveitada` x `[Sessão] Expirada` diz se
   o IP variável do runner inviabiliza o reuso lá (ver ressalva na seção 3).
3. **Login assistido** (5.2) — só se o passo 1 confirmar captcha inevitável.
4. **`submeterRateio`** (5.3), piloto com **uma** lista de rateio antes de liberar.
5. **Consulta de andamento** (5.4).
6. **Avaliar `patchright`** em PR isolado, para tentar aposentar o `xvfb`.

O Scrapling entra em apenas um ponto desta lista: se o passo 1 disser "Cloudflare Turnstile".
Em qualquer outro desfecho, o caminho é o que já está montado aqui.
