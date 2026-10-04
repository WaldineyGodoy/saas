# B2W Charge — Comunicação App ↔ Eletroposto (OCPP 1.6-J) — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar superpowers:executing-plans (ou superpowers:subagent-driven-development) para executar este plano tarefa a tarefa. Passos em checkbox (`- [ ]`). TDD: em toda tarefa o teste vem antes do código e precisa **falhar** antes de passar.

**Objetivo:** Ligar o pagamento da recarga ao carregador por OCPP 1.6-J e provar essa comunicação com um emulador e um catálogo de cenários automatizados (fluxo feliz, falhas de hardware, queda de rede, timeouts, segurança).

**Arquitetura:** CSMS próprio em Node/TS (`services/ocpp-csms`, lib `ocpp-rpc` em strict mode) persistindo no Supabase; ponte app → CSMS por fila `ocpp_comandos`; emulador independente em Python (`tools/ocpp-emulator`, lib `ocpp` 2.1); testes em seis camadas (L1–L6).

**Spec:** `docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md` — os IDs de cenário (CP-, ST-, RC-, RS-, MV-, SG-, UI-) vêm do §8 da spec.

**Stack:** Node 22, TypeScript, `ocpp-rpc@2.2`, vitest; Python 3.11, `ocpp==2.1.0`, `websockets`, pytest, pytest-asyncio; Supabase (Postgres + Realtime + Edge Functions Deno); Stripe (modo teste); Docker Compose; Playwright.

## Restrições globais

- **Branch:** todo o trabalho na branch designada da sessão; nunca direto na `main`.
- **Banco de produção:** o dono aplica migrações no SQL Editor (o `apply_migration` em produção é bloqueado). Testes SQL seguem o padrão `SANDBOX_OK` de `supabase/tests/` (bloco `DO`, tudo desfeito no fim).
- **Segredos:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, senhas de carregador **nunca** no repositório nem no frontend. `.env.example` só com nomes.
- **Protocolo:** só OCPP 1.6-J. Todo frame enviado ou recebido pelo CSMS é validado contra o schema oficial (strict mode). `idTag` ≤ 20 caracteres. `transactionId` é inteiro.
- **Tarefa 1 bloqueia o resto:** nenhum comando OCPP é ligado ao status `paid` antes de corrigir a RLS e o webhook.
- **Escopo do repo:** `.agents/AGENTS.md` restringe agentes ao módulo Standalone "a menos que explicitamente solicitado" — este trabalho foi pedido explicitamente pelo dono (B2W Charge).

## Mapa de arquivos

```
supabase/migrations/20261004a_recarga_seguranca.sql          (T1)
supabase/migrations/20261004b_ocpp_estrutura.sql             (T2)
supabase/tests/recarga_seguranca.test.sql                    (T1)
supabase/tests/ocpp_estrutura.test.sql                       (T2)
supabase/functions/_shared/recarga.ts                        (T1, T9)  regras puras compartilhadas
supabase/functions/stripe-charging-webhook/index.ts          (T1, T9)
supabase/functions/create-charging-checkout/index.ts         (T9)
supabase/functions/stop-charging/index.ts                    (T9, novo)
supabase/functions/refund-charging/index.ts                  (T9, novo)
services/ocpp-csms/                                          (T3–T7, novo)
  package.json  tsconfig.json  vitest.config.ts  Dockerfile  .env.example
  src/domain/{medicao,idtag,recarga,estorno,backoff}.ts
  src/repo/{types,memory,supabase}.ts
  src/server/{index,auth,handlers,comandos,timers}.ts
  src/main.ts
  test/unit/*.test.ts        (L1)
  test/integration/*.test.ts (L3a)
tools/ocpp-emulator/                                         (T8, novo)
  pyproject.toml  emulator/{__init__,charge_point,faults,scenarios,__main__}.py
  tests/unit/  tests/integration/  conftest.py
docker-compose.ocpp.yml                                      (T10)
tests/charging-recarga.test.ts                               (T9, vitest raiz)
tests/ChargingCheckout.test.jsx                              (T11, ampliar)
e2e/recarga.spec.ts  playwright.config.ts                    (T11)
docs/ocpp/RUNBOOK.md  docs/ocpp/homologacao-joult.md         (T12)
```

---

### Tarefa 1: Fechar a liberação de energia forjável (pré-requisito)

**Arquivos:** criar `supabase/migrations/20261004a_recarga_seguranca.sql`, `supabase/tests/recarga_seguranca.test.sql`, `supabase/functions/_shared/recarga.ts`, `tests/charging-recarga.test.ts`; modificar `supabase/functions/stripe-charging-webhook/index.ts`, `src/pages/public/ChargingCheckout.jsx`, `src/services/stripeChargingService.js`.
**Cenários:** SG-01, SG-02, SG-03, RC-10 (parte do banco).

- [ ] **1.1 Teste SQL primeiro.** Em `supabase/tests/recarga_seguranca.test.sql` (padrão `SANDBOX_OK`), com `set local role anon`:
  - `update recargas_eletroposto set status='paid'` afeta 0 linhas (SG-01);
  - `select count(*) from recargas_eletroposto` = 0 para `anon` (SG-02);
  - `fn_recarga_publica(id)` devolve só `status, kwh_estimado, kwh_consumido, valor, valor_final, valor_estornado, conector_numero, nome_posto` — sem `motorista_*` (SG-02);
  - `fn_marcar_recarga_paga(pi_id)` chamada duas vezes → primeira devolve `true`, segunda `false` (RC-10).
  Rodar pelo MCP `execute_sql`. **Esperado agora:** falha (políticas antigas e funções inexistentes).
- [ ] **1.2 Migração.** `20261004a_recarga_seguranca.sql`:
  ```sql
  drop policy if exists "Permitir leitura da recarga" on public.recargas_eletroposto;
  drop policy if exists "Permitir criacao de solicitacao de recarga" on public.recargas_eletroposto;
  drop policy if exists "Permitir atualizacao da recarga" on public.recargas_eletroposto;
  revoke all on public.recargas_eletroposto from anon;

  create policy recargas_interno on public.recargas_eletroposto
      for all to authenticated
      using (public.fn_papel_interno()) with check (public.fn_papel_interno());
  create policy recargas_motorista_le on public.recargas_eletroposto
      for select to authenticated using (user_id = auth.uid());

  -- leitura do motorista avulso: só quem tem o uuid da recarga, sem dados pessoais
  create or replace function public.fn_recarga_publica(p_recarga_id uuid)
  returns table (...) language sql stable security definer set search_path = public, pg_temp as $$ ... $$;
  grant execute on function public.fn_recarga_publica(uuid) to anon, authenticated;

  -- transição idempotente usada pelo webhook (service role)
  create or replace function public.fn_marcar_recarga_paga(p_payment_intent_id text)
  returns uuid ... -- update ... set status='paid' where stripe_payment_intent_id = p and status = 'pending_payment' returning id
  ```
  O Realtime de `postgres_changes` deixa de entregar para `anon` (RLS); a tela passa a usar **broadcast** no canal `recarga:<id>` emitido pelas Edge Functions/CSMS **ou** polling de `fn_recarga_publica` a cada 3 s. Decisão do plano: polling de 3 s (simples, sem vazar linhas) — registrar no código.
- [ ] **1.3 Regra pura + teste.** `supabase/functions/_shared/recarga.ts` exporta `exigirAssinatura(secret, sig)` (lança se algum faltar) e `RECARGA_TRANSICOES` (mapa de status → próximos válidos, conforme spec §4.8). `tests/charging-recarga.test.ts` (vitest raiz) cobre: sem secret → lança; sem assinatura → lança; transições válidas e inválidas. Rodar `npm test -- charging-recarga` → **falha**, implementar → **passa**.
- [ ] **1.4 Webhook.** Remover o ramo `else { event = JSON.parse(rawBody) }`; sem assinatura válida → 400 (SG-03). `succeeded` chama `rpc('fn_marcar_recarga_paga')`; se devolver nulo (já pago), responde 200 sem efeito.
- [ ] **1.5 Front.** `stripeChargingService.js` ganha `buscarRecargaPublica(id)` (RPC). `ChargingCheckout.jsx` troca o canal `postgres_changes` por polling de `fn_recarga_publica` (3 s, para em status terminal). Atualizar `tests/ChargingCheckout.test.jsx` e `tests/stripeChargingService.test.js` para o novo contrato.
- [ ] **1.6 Verificar.** `npm test` verde; `npm run lint` sem erros novos; teste SQL devolve `SANDBOX_OK`.
- [ ] **1.7 Commit.** `fix(b2w-charge): recarga so vira paga por webhook assinado e anon nao le nem altera recargas`

---

### Tarefa 2: Estrutura OCPP no banco

**Arquivos:** criar `supabase/migrations/20261004b_ocpp_estrutura.sql`, `supabase/tests/ocpp_estrutura.test.sql`.
**Cenários:** base de todos; testes L2 de dedupe (RS-01, RS-03), idempotência de comando (RC-10), transições (spec §4.8).

- [ ] **2.1 Teste SQL primeiro** (`SANDBOX_OK`), cobrindo:
  - `ocpp_id` fora de `^[A-Za-z0-9_-]{1,48}$` → erro 23514;
  - `(carregador_id, connector_id)` duplicado → 23505;
  - `ocpp_id_tags.id_tag` com 21 caracteres → 23514;
  - medição repetida `(transacao, medido_em, measurand, phase)` com `on conflict do nothing` → 1 linha;
  - `ocpp_transacoes.chave_idempotencia` duplicada → 23505;
  - `ocpp_comandos.chave_idempotencia` duplicada → 23505;
  - recarga `pending_payment → charging` direto → erro do gatilho `fn_recarga_transicao_valida`; `paid → starting → charging → completed` passa;
  - `anon` lê zero linhas de todas as tabelas `ocpp_*` e `eletroposto_carregadores/_conectores`;
  - fornecedor do eletroposto lê o carregador do seu eletroposto e não lê de outro.
  **Esperado agora:** falha (tabelas inexistentes).
- [ ] **2.2 Migração** com as tabelas do §4.1–4.7 da spec, alterações do §4.8 em `recargas_eletroposto` (incluir `starting` no CHECK, novas colunas), gatilho de transição, `updated_at`, índices (`ocpp_comandos (status, proxima_tentativa_em)`, `ocpp_medicoes (transacao_id, medido_em)`, `ocpp_mensagens (carregador_id, criado_em)`), RLS no padrão de `20260929a` (`fn_papel_interno()` escreve/lê; fornecedor lê via `fn_eletroposto_do_fornecedor`), `revoke all ... from anon`. Publicar `ocpp_comandos` no Realtime: `alter publication supabase_realtime add table public.ocpp_comandos;`. Cron de limpeza de `ocpp_mensagens` > 30 dias (padrão `20260904e_cron_faturista.sql`).
- [ ] **2.3 Verificar:** teste SQL → `SANDBOX_OK`.
- [ ] **2.4 Commit.** `feat(ocpp): tabelas de carregador, conector, transacao, medicao, comandos e trilha`

---

### Tarefa 3: Esqueleto do CSMS e domínio puro (L1)

**Arquivos:** criar `services/ocpp-csms/{package.json,tsconfig.json,vitest.config.ts,.env.example}`, `src/domain/*.ts`, `src/repo/types.ts`, `src/repo/memory.ts`, `test/unit/*.test.ts`.

- [ ] **3.1 Projeto.** `package.json` (`"type": "module"`, scripts `build: tsc`, `test: vitest run`, `dev: tsx watch src/main.ts`), deps `ocpp-rpc@^2.2.1`, `@supabase/supabase-js@^2`, devDeps `typescript`, `tsx`, `vitest`, `@types/node`. Rodar `npm install` em `services/ocpp-csms`. Conferir que o `vitest.config.js` da raiz (`include: tests/**`) não pega os testes do serviço.
- [ ] **3.2 Testes L1 primeiro** (`test/unit/`):
  - `medicao.test.ts`: `normalizar({value:'1.5', unit:'kWh', measurand:'Energy.Active.Import.Register'})` → `{valor:1500, unidade:'Wh'}`; `kW → W`; sem `measurand` → energia (MV-04); sem `unit` → Wh (default 1.6); valor não numérico → lança.
  - `idtag.test.ts`: `gerarIdTag()` casa `^RC[A-Z2-7]{18}$`, tamanho 20, 10 000 gerações sem colisão.
  - `recarga.test.ts`: `kwhLimite(50, 2.15)` = 23.25 (2 casas, para baixo); `deveCortar(kwhConsumido, limite)`; transições espelhando o gatilho SQL.
  - `estorno.test.ts`: `calcularFechamento({valor:50, tarifa:2.15, whStart:1000, whStop:11000})` → `valor_final 21.50, estorno 28.50`; consumo acima do limite → `valor_final = valor`, estorno 0; estorno < 0,50 → 0; `whStop < whStart` → `{revisar:true, estorno:0}` (MV-03).
  - `backoff.test.ts`: tentativas 1/2/3 → 2 s/4 s/8 s; após 3 → `null` (expira).
  `npx vitest run` → **falha**.
- [ ] **3.3 Implementar** `src/domain/*` (funções puras, sem I/O). → **passa**.
- [ ] **3.4 Contrato do repositório.** `src/repo/types.ts` define a interface `Repo` usada pelo servidor (ex.: `buscarCarregador(ocppId)`, `registrarBoot`, `registrarContato`, `upsertConector`, `buscarIdTag`, `criarOuObterTransacao(chave, dados)`, `gravarMedicoes`, `fecharTransacao`, `atualizarRecarga(id, patch, deStatus?)`, `proximosComandos(ocppIds)`, `atualizarComando`, `enfileirarComando`, `logMensagem`). `src/repo/memory.ts` implementa tudo em memória (usado pela L3a) **com as mesmas regras de unicidade do banco** (dedupe de medição, chave de idempotência, transições).
- [ ] **3.5 Commit.** `feat(ocpp-csms): esqueleto do servico, regras puras e repositorio em memoria`

---

### Tarefa 4: Conexão, registro e status (L3a)

**Arquivos:** criar `src/server/{index,auth,handlers}.ts`, `test/integration/conexao.test.ts`, `test/integration/helpers.ts`.
**Cenários:** CP-01…CP-08, ST-01, parte de ST-02/ST-03 (bloqueio).

- [ ] **4.1 Helper de teste.** `helpers.ts` sobe `criarServidor({repo: new MemoryRepo(seed), porta: 0, auth: 'basic'|'off', heartbeatS})` e um `carregadorFake(ocppId, senha?)` com `RPCClient` (`protocols: ['ocpp1.6'], strictMode: true`). Para CP-06/CP-07 usar um WebSocket cru (`ws`) que manda frames JSON à mão.
- [ ] **4.2 Testes primeiro** — um `it` por cenário, com o ID no título (`it('CP-01 boot aceito grava vendor e fica online')`). Para CP-05 usar `vi.useFakeTimers()` no verificador de offline. ST-01: status do conector 0 e 1 no repo. Bloqueio: `Faulted/GroundFailure` → `bloqueado_ate_reset = true`; Boot seguinte a um `Reset` aceito limpa. **Esperado:** falha.
- [ ] **4.3 Implementar.**
  - `auth.ts`: `server.auth((accept, reject, handshake) => …)` — `handshake.identity` → `repo.buscarCarregador`; inexistente → `reject(404)`; com `senha_hash` → compara `handshake.password` (scrypt, `timingSafeEqual`) → `reject(401)`.
  - `index.ts`: `new RPCServer({ protocols: ['ocpp1.6'], strictMode: true, callTimeoutMs: 30000 })`; mapa `ocppId → client` (CP-08: nova conexão fecha a antiga com `client.close({code: 4000})`); log de todo frame (`client.on('message', …)`) em `repo.logMensagem`.
  - `handlers.ts`: `BootNotification`, `Heartbeat`, `StatusNotification`, `DataTransfer`, `DiagnosticsStatusNotification`, `FirmwareStatusNotification` conforme spec §5.2. Ação não tratada → a lib já devolve `NotImplemented` (CP-07); conferir que o socket continua aberto.
  - Alerta interno em `Faulted` grave: `repo.alertar(...)` (no Supabase vira `notification_logs`).
- [ ] **4.4 Verificar:** `npx vitest run test/integration/conexao.test.ts` verde.
- [ ] **4.5 Commit.** `feat(ocpp-csms): handshake com auth, boot, heartbeat, status e trilha de frames`

---

### Tarefa 5: Autorização, transação e medição (L3a)

**Arquivos:** modificar `src/server/handlers.ts`; criar `test/integration/transacao.test.ts`.
**Cenários:** RC-05, RC-06, RC-07, RC-08, MV-01…MV-04, RS-02, RS-03, ST-02 (fechamento).

- [ ] **5.1 Testes primeiro** (repo em memória com uma recarga `starting` e idTag válido):
  - RC-06: `Authorize` → `Accepted`; `StartTransaction` → `Accepted` + `transactionId` inteiro; recarga `charging`, `kwh_limite` gravado.
  - RC-07: idTag desconhecido → `Invalid` em `Authorize` e em `StartTransaction` (com `transactionId` presente); recarga intocada.
  - RC-08: depois do `StopTransaction`, mesmo idTag → `Expired`.
  - RS-03: `StartTransaction` repetido com mesmo conteúdo → mesmo `transactionId`, 1 transação.
  - MV-01..04 pela API OCPP (não só a função pura): kWh e Wh dão o mesmo `kwh_consumido`; regressão ignorada + alerta; `meterStop < meterStart` → `metadata.revisar`.
  - RS-02: `StopTransaction` com `transactionData` (medições offline) grava as medições e fecha com o `timestamp` do carregador.
  - RC-05 / ST-02: `StopTransaction(reason=EVDisconnected|EmergencyStop)` → recarga `completed`, `valor_final`/`valor_estornado` pelo `calcularFechamento`, pedido de estorno registrado no repo (`repo.solicitarEstorno`).
  **Esperado:** falha.
- [ ] **5.2 Implementar** os handlers `Authorize`, `StartTransaction`, `MeterValues`, `StopTransaction` usando `src/domain/*` (spec §5.2). Corte por limite fica na Tarefa 6.
- [ ] **5.3 Verificar** verde. **Commit.** `feat(ocpp-csms): autorizacao por idTag efemero, transacao idempotente e medicao normalizada`

---

### Tarefa 6: Fila de comandos e temporizadores (L3a)

**Arquivos:** criar `src/server/{comandos,timers}.ts`, `test/integration/comandos.test.ts`.
**Cenários:** RC-01 (lado CSMS), RC-02, RC-03, RC-04, RS-04, RS-05, RS-06, ST-03, ST-04.

- [ ] **6.1 Testes primeiro** (carregador fake com handlers configuráveis; `vi.useFakeTimers()` onde houver espera):
  - RC-01: comando `RemoteStartTransaction` pendente → fake recebe `{connectorId, idTag}` → responde `Accepted` → comando `aceito`, recarga `starting`.
  - RC-02: fake responde `Rejected` → comando `rejeitado`, recarga `failed`, estorno total solicitado.
  - RC-03: aceito e nenhum `StartTransaction` em `CONNECTION_TIMEOUT_S` → recarga `canceled`, idTag `Expired`, estorno total.
  - RC-04: `MeterValues` atinge `kwh_limite` → exatamente **um** `RemoteStopTransaction` enfileirado mesmo com mais 3 amostras acima do limite.
  - RS-04: fake demora 10 s para responder `GetConfiguration` → `aceito`; socket aberto (`client.state === OPEN`).
  - RS-05: fake nunca responde → 3 tentativas (2/4/8 s após cada timeout de 30 s) → `expirado`; socket aberto; se `RemoteStart` → recarga `failed` + estorno.
  - RS-06: comando criado com carregador desconectado; fake conecta antes de `expira_em` → enviado; conecta depois → `expirado`.
  - ST-03: conector `bloqueado_ate_reset` → `RemoteStart` vira `rejeitado` **sem** chegar ao fake; `Reset{type:'Hard'}` aceito + novo Boot + `Available` → próximo `RemoteStart` chega.
  - ST-04: conector em `Charging` → `RemoteStart` `rejeitado` sem envio.
  **Esperado:** falha.
- [ ] **6.2 Implementar.** `comandos.ts`: `processarFila()` busca `pendente` com `proxima_tentativa_em <= now()` para carregadores conectados nesta instância; valida pré-condições; `client.call(acao, payload)`; trata `TimeoutError` (reagenda via `backoff`) e `RPCError` (CALLERROR → `erro`); aplica efeitos na recarga (spec §5.3). Gatilhos de execução: evento do repo (Realtime no Supabase / callback na memória), reconexão do carregador, e varredura a cada 5 s. Trava por comando (`update ... set status='enviado' where id=? and status='pendente'`) para duas instâncias não enviarem o mesmo comando. `timers.ts`: offline por heartbeat, `CONNECTION_TIMEOUT_S`, expiração de comandos.
- [ ] **6.3 Verificar** toda a suíte do serviço verde (`npx vitest run`). **Commit.** `feat(ocpp-csms): fila de comandos com timeout, backoff, bloqueio por falha e corte pre-pago`

---

### Tarefa 7: Repositório Supabase e processo executável

**Arquivos:** criar `src/repo/supabase.ts`, `src/main.ts`, `Dockerfile`, `.env.example`; criar `test/integration/supabase-repo.test.ts` (roda só com `SUPABASE_URL` definido — `describe.skipIf(!process.env.SUPABASE_URL)`).

- [ ] **7.1 Teste de contrato:** a mesma bateria de propriedades do `MemoryRepo` (função `contratoRepo(fabrica)` em `test/integration/contrato-repo.ts`) roda contra `MemoryRepo` (sempre) e `SupabaseRepo` (com Supabase local). Garante que a L3a não testa um repositório que se comporta diferente do banco.
- [ ] **7.2 Implementar** `SupabaseRepo` com service role (`@supabase/supabase-js`, `auth: {persistSession:false}`), usando `upsert ... onConflict` para dedupe e `rpc` para transições com guarda de status. Assinatura Realtime em `ocpp_comandos` (`postgres_changes` INSERT) chamando `processarFila`.
- [ ] **7.3 `main.ts`:** lê `PORT` (padrão 9220), `OCPP_AUTH` (`basic`|`off`), `CONNECTION_TIMEOUT_S`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; endpoint HTTP `GET /health` (200 + nº de carregadores conectados); encerra limpo em `SIGTERM`.
- [ ] **7.4 Dockerfile** multi-stage (`node:22-slim`, `npm ci`, `tsc`, usuário não-root, `EXPOSE 9220`).
- [ ] **7.5 Verificar:** `docker build services/ocpp-csms` ok; com `supabase start` rodando, `npx vitest run test/integration/supabase-repo.test.ts` verde. **Commit.** `feat(ocpp-csms): repositorio Supabase, realtime de comandos e imagem Docker`

---

### Tarefa 8: Emulador de carregador em Python

**Arquivos:** `tools/ocpp-emulator/pyproject.toml` (`ocpp==2.1.0`, `websockets>=13`, dev: `pytest`, `pytest-asyncio`), `emulator/{__init__,charge_point,faults,scenarios,__main__}.py`, `tests/unit/test_charge_point.py`.

- [ ] **8.1 Testes unitários primeiro** (sem rede: `ChargePoint` com conexão fake que grava frames enviados e injeta respostas):
  - máquina de estados do conector: `Available → Preparing → Charging → Finishing → Available`; transição inválida lança;
  - `RemoteStartTransaction` aceito agenda `StartTransaction` após `plug_delay_s`; `plug_delay_s=None` nunca pluga (RC-03);
  - `MeterValues` com `meter_unit='kWh'` manda `"value": "0.01"` e `"unit": "kWh"`; `meter_regress=True` manda valor menor (MV-02);
  - fila offline: mensagens geradas desconectado são enviadas na ordem ao reconectar (RS-01);
  - `faults.delay_response_s['GetConfiguration']=10` atrasa a resposta (RS-04); `reject['RemoteStartTransaction']` → `Rejected` (RC-02); `no_response` nunca responde (RS-05).
  `pytest tools/ocpp-emulator/tests/unit` → **falha**.
- [ ] **8.2 Implementar** partindo do `charge_point_emulator.py` do guia, com as correções da spec §6:
  - handlers com `@on("RemoteStartTransaction")`, `@on("RemoteStopTransaction")`, `@on("Reset")`, `@on("ChangeAvailability")`, `@on("GetConfiguration")`, `@on("ChangeConfiguration")`, `@on("UnlockConnector")`, `@on("TriggerMessage")` (strings, não enums — independe da grafia dos enums na versão da lib);
  - conexão com `websockets.connect(url, subprotocols=["ocpp1.6"], additional_headers={"Authorization": basic(...)})` quando houver senha;
  - `Reset Hard` → fecha socket, espera 2 s, reconecta e manda Boot + `StatusNotification` (ST-03);
  - reconexão automática com backoff e reenvio da fila offline;
  - `scenarios.py`: funções nomeadas (`happy_path`, `emergency_stop`, `ground_failure`, `invalid_tag`, `drop_during_charge`, ...) reutilizadas pela CLI e pelos testes L3b.
- [ ] **8.3 CLI:** `python -m emulator --id CP_EMU_01 --url ws://localhost:9220/ocpp --password ... --scenario happy_path --power-kw 7.4 --log-frames`. `--log-frames` imprime cada frame `[2,...]/[3,...]/[4,...]` (substitui o Wireshark do guia §5).
- [ ] **8.4 Verificar** `pytest tools/ocpp-emulator/tests/unit` verde. **Commit.** `feat(ocpp-emulator): emulador 1.6-J com handlers de comando, fila offline e injecao de falhas`

---

### Tarefa 9: Ponte app ↔ CSMS nas Edge Functions

**Arquivos:** modificar `supabase/functions/_shared/recarga.ts`, `create-charging-checkout/index.ts`, `stripe-charging-webhook/index.ts`; criar `stop-charging/index.ts`, `refund-charging/index.ts`; ampliar `tests/charging-recarga.test.ts`.
**Cenários:** ST-04/UI-01 (lado servidor), RC-01 (início), RC-09, RC-10, SG-04, estornos de RC-01/02/03/05.

- [ ] **9.1 Testes primeiro** (funções puras em `_shared/recarga.ts`, vitest raiz):
  - `conectorDisponivel({online, status, bloqueado})` → `{ok:false, motivo:'offline'|'ocupado'|'bloqueado'}` ou `{ok:true}`;
  - `comandoInicio(recarga, idTag)` → `{acao:'RemoteStartTransaction', payload:{connectorId, idTag}, chave_idempotencia:'start:<id>', expira_em}`;
  - `podeParar(recarga, {userId, clientSecret})` — dono por `user_id` ou por `client_secret` do PI (SG-04);
  - `valorEstornoCentavos(recarga)` coerente com `calcularFechamento` do CSMS (mesma tabela de casos — copiar os casos de `services/ocpp-csms/test/unit/estorno.test.ts`).
  **Esperado:** falha.
- [ ] **9.2 Implementar:**
  - `create-charging-checkout`: busca carregador/conector por `eletroposto_id` + `conector_numero`; recusa com 409 e motivo legível se `conectorDisponivel` falhar (antes de criar o PaymentIntent).
  - `stripe-charging-webhook`: após `fn_marcar_recarga_paga` devolver id, gera idTag, insere `ocpp_id_tags` e `ocpp_comandos` (`on conflict (chave_idempotencia) do nothing`). `payment_failed` não cria comando (RC-09).
  - `stop-charging`: valida posse (`podeParar`), insere `RemoteStopTransaction` (`chave stop:<recarga>`).
  - `refund-charging`: chamada só com service role (CSMS); `stripe.refunds.create({payment_intent, amount}, {idempotencyKey: 'refund:<recarga>'})`; grava `stripe_refund_id`, `valor_estornado`. Stripe com a mesma `apiVersion` das outras funções de recarga.
- [ ] **9.3 Verificar** `npm test` verde; `supabase functions serve` sobe as 4 funções sem erro de tipo. **Commit.** `feat(b2w-charge): pagamento confirmado vira RemoteStart, parada pelo app e estorno da diferenca`

---

### Tarefa 10: Ambiente integrado e catálogo de cenários (L3b)

**Arquivos:** `docker-compose.ocpp.yml`, `tools/ocpp-emulator/conftest.py`, `tools/ocpp-emulator/tests/integration/test_{conexao,status,recarga,resiliencia,medicao}.py`, `scripts/ocpp-seed.sql`.

- [ ] **10.1 Ambiente.** `supabase start` (stack local) + `docker compose -f docker-compose.ocpp.yml up csms` (CSMS apontando para o Supabase local, `OCPP_AUTH=basic`, `CONNECTION_TIMEOUT_S=5` para os testes). `scripts/ocpp-seed.sql` cria eletroposto de teste, carregador `CP_EMU_01` (senha de teste conhecida só do ambiente local), conectores 1 e 2, tarifa 2,15.
  **Risco conhecido:** as migrações antigas foram aplicadas à mão em produção; se `supabase db reset` falhar localmente, usar um **branch de desenvolvimento do Supabase** (MCP `create_branch`) como banco dos testes e registrar a decisão no RUNBOOK.
- [ ] **10.2 Fixtures (`conftest.py`):** `db` (cliente service role para semear/verificar), `recarga_paga(valor)` (insere recarga `pending_payment` e chama a mesma rotina do webhook — sem Stripe), `emulador(**faults)` (sobe `VirtualChargePoint` conectado), `aguardar(condicao, timeout)` (polling do banco, nunca `sleep` fixo).
- [ ] **10.3 Um teste por cenário do §8.1–8.5 da spec**, nome com o ID (`test_RS01_queda_durante_recarga_nao_duplica_medicoes`). Cada teste verifica o estado final no banco **e** os frames em `ocpp_mensagens`. Escrever todos primeiro e rodar: os que falharem por bug do CSMS voltam para a tarefa correspondente (T4–T6) antes de seguir.
- [ ] **10.4 Alvo único:** `npm run test:ocpp` na raiz → `supabase start` (se preciso) + compose + `pytest tools/ocpp-emulator/tests/integration -v`.
- [ ] **10.5 CI:** workflow `.github/workflows/ocpp.yml` (paths `services/ocpp-csms/**`, `tools/ocpp-emulator/**`, `supabase/**`) rodando L1 + L3a + testes unitários do emulador em toda PR; L3b em `workflow_dispatch` (precisa de Docker + Supabase local, é lento).
- [ ] **10.6 Verificar:** catálogo inteiro verde localmente. **Commit.** `test(ocpp): catalogo de cenarios ponta a ponta com emulador, CSMS e Supabase local`

---

### Tarefa 11: Tela da recarga ao vivo e E2E (UI, L4)

**Arquivos:** `src/pages/public/ChargingCheckout.jsx`, `src/services/stripeChargingService.js`, `tests/ChargingCheckout.test.jsx`, `e2e/recarga.spec.ts`, `playwright.config.ts`.
**Cenários:** UI-01, UI-02, UI-03.

- [ ] **11.1 Testes de componente primeiro** (`tests/ChargingCheckout.test.jsx`, com `fn_recarga_publica` mockado): conector indisponível (409 do checkout) → mensagem e botão desabilitado (UI-01); status `starting` → "Conecte o cabo ao veículo"; `charging` → kWh e R$ atualizando; `completed` → resumo com `valor_final` e `valor_estornado`; `canceled`/`failed` → mensagem de estorno total; botão "Parar recarga" chama `stop-charging` (UI-03). **Esperado:** falha.
- [ ] **11.2 Implementar** os estados na tela (polling de 3 s da Tarefa 1; intervalo para em estado terminal).
- [ ] **11.3 E2E (Playwright, Chromium pré-instalado — não rodar `playwright install`):** com `npm run dev`, Supabase local, CSMS e emulador em `happy_path` sem parada automática: abrir `/recarga?posto=<seed>&conector=1`, pagar com cartão 4242 no Payment Element (Stripe modo teste), disparar o webhook com `stripe listen --forward-to` **ou** chamar a função com evento assinado pelo segredo de teste, verificar "Conecte o cabo" → "Carregando" com kWh > 0 → clicar "Parar" → resumo. Requer `VITE_STRIPE_PUBLISHABLE_KEY`/`STRIPE_SECRET_KEY` de teste no `.env` local; sem eles o spec é pulado com aviso.
- [ ] **11.4 Verificar** `npm test` e `npx playwright test e2e/recarga.spec.ts` verdes; `npm run build` ok. **Commit.** `feat(b2w-charge): acompanhamento da recarga ao vivo com parada e resumo de estorno`

---

### Tarefa 12: Conformidade (L5), homologação (L6) e runbook

**Arquivos:** `docs/ocpp/RUNBOOK.md`, `docs/ocpp/homologacao-joult.md`, `tools/ocpp-emulator/steve/docker-compose.yml`.

- [ ] **12.1 L5 — emulador contra SteVe:** compose com SteVe (imagem oficial do projeto `steve-community/steve` + MariaDB), cadastrar `CP_EMU_01` na UI do SteVe, rodar `python -m emulator --url ws://localhost:8180/steve/websocket/CentralSystemService --scenario happy_path` e disparar `RemoteStart`/`RemoteStop`/`Reset` pela UI do SteVe. Registrar no RUNBOOK: Boot aceito, transação aparece, medições chegam. Divergência aqui = bug do **emulador** (corrigir na Tarefa 8 antes de culpar o CSMS).
- [ ] **12.2 `homologacao-joult.md`:** checklist da spec §9 com campos para preencher (firmware, data, resultado por cenário, kWh CSMS × display, observações), mais a lista de chaves `GetConfiguration` a conferir.
- [ ] **12.3 `RUNBOOK.md`:** como subir tudo localmente (comandos exatos das Tarefas 7, 10 e 11), como rodar um cenário isolado, como ler `ocpp_mensagens` para depurar (consulta SQL pronta por `carregador` e intervalo), como cadastrar um carregador real e gerar senha, variáveis de ambiente do CSMS, e as decisões pendentes da spec §10.
- [ ] **12.4 Commit.** `docs(ocpp): conformidade do emulador com SteVe, checklist de homologacao Joult e runbook`

---

## Ordem e dependências

```
T1 ─► T2 ─► T3 ─► T4 ─► T5 ─► T6 ─► T7 ─┐
                                         ├─► T9 ─► T10 ─► T11 ─► T12
                         T8 ─────────────┘
```

T8 (emulador) pode andar em paralelo com T3–T7: só depende da spec. T12.1 (SteVe) pode ser feito logo após T8 para validar o emulador cedo.

## Critério de pronto

- Catálogo §8 da spec 100% automatizado e verde (L3b), mais L1, L2, L3a e componentes de UI no CI.
- Nenhum caminho deixa `anon` mudar status de recarga ou ler dados de motorista (SG-01…04 verdes).
- Runbook permite a outra pessoa subir o ambiente e rodar RC-01 em menos de 15 minutos.
- Decisões da spec §10 respondidas pelo dono antes da homologação com o Joult real.
