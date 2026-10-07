# Runbook OCPP 1.6-J (B2W Charge)

Spec: `docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md`. Plano: `docs/superpowers/plans/2026-10-04-ocpp-comunicacao-eletroposto.md`. Homologação com o Joult: `docs/ocpp/homologacao-joult.md`.

> **ANTES DO MERGE NA `main`** (merge = deploy do frontend pelo `.github/workflows/deploy.yml`)
>
> O frontend novo chama colunas e RPCs que só existem depois das migrações, e o webhook novo depende do checkout novo. Faça **toda** a sequência da seção 8.1 em produção e só depois faça o merge:
> 1. migrações `20261007a` → `e` no SQL Editor, cada uma seguida do seu teste `SANDBOX_OK`;
> 2. segredos das funções (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` vêm do projeto) e **Pix ativado** no painel da Stripe;
> 3. deploy de `create-charging-checkout`, `refund-charging`, `stop-charging`; esvaziar as recargas `pending_payment` do checkout antigo; deploy de `stripe-charging-webhook --no-verify-jwt`; endpoint da Stripe assinando `payment_intent.succeeded` e `payment_intent.payment_failed`;
> 4. só então o merge.
>
> Sem isso: salvar qualquer plano falha (`tarifa_motorista_kwh` inexistente), a tela `/recarga` quebra (RPCs inexistentes) e pagamentos do checkout antigo entram no webhook novo sem destino.

Peças: **CSMS** (`services/ocpp-csms`, Node 22, porta 9220) · **emulador** (`tools/ocpp-emulator`, Python 3.13) · **ambiente local integrado** (Supabase local + CSMS em Docker + substituto do estorno) · **E2E** da tela `/recarga` (Playwright).

## 1. Rodar o RC-01 em menos de 15 min

Pré-requisitos: Docker em execução, Node 22, Python 3.13, ~5 GB livres em disco. Na raiz do repositório:

**PowerShell**

```powershell
npm install
cd services\ocpp-csms; npm ci; cd ..\..
cd tools\ocpp-emulator
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
cd ..\..
npm run test:ocpp -- -k RC01
```

**bash**

```bash
npm install
(cd services/ocpp-csms && npm ci)
(cd tools/ocpp-emulator && python3.13 -m venv .venv && .venv/bin/python -m pip install -e '.[dev]')
npm run test:ocpp -- -k RC01
```

O `npm run test:ocpp` (`scripts/ocpp-local/test-ocpp.mjs`) faz tudo, em ordem: sobe o Supabase local (na primeira vez baixa as imagens, é o trecho lento) · aplica `scripts/ocpp-local-bootstrap.sql` + as migrações OCPP · aplica `scripts/ocpp-seed.sql` · roda os testes SQL (`SANDBOX_OK`) · sobe CSMS + `estorno-stub` (`docker-compose.ocpp.yml`) · roda `pytest tools/ocpp-emulator/tests/integration`. Argumentos depois de `--` vão para o pytest. Com tudo já de pé, o RC-01 leva ~20 s. Esperado: `1 passed`.

Sem `-k`, roda o catálogo L3b inteiro (37 testes). `--down` derruba o compose no fim (o Supabase local continua de pé).

Por que não `supabase db reset`: as 124 migrações do repo não reproduzem o banco do zero. O stack sobe com `SUPABASE_DB_MIGRATIONS_ENABLED=false` e o script aplica só o bootstrap + as migrações OCPP, verbatim (lista em `scripts/ocpp-local/db.mjs`).

**Recuperação.** `migrar()` não é atômico: se falhar no meio, o banco local fica pela metade. Recupere com `npx supabase stop --no-backup` e rode `npm run test:ocpp` de novo. Para só liberar memória sem perder dados: `npx supabase stop` (sem `--no-backup`) e `docker compose -f docker-compose.ocpp.yml stop`.

## 2. Subir as peças separadamente

| Peça | Comando |
|---|---|
| Testes unitários do CSMS (L1/L3a, sem Docker) | `cd services/ocpp-csms && npm test` (e `npm run typecheck`) |
| CSMS em dev (sem Docker) | `cd services/ocpp-csms && npm run dev` (variáveis da seção 4) |
| Testes unitários do emulador | `cd tools/ocpp-emulator && .venv/Scripts/python -m pytest tests/unit` (Linux: `.venv/bin/python`) |
| Só banco local + seed + testes SQL | `node scripts/ocpp-local/db.mjs migrar`, `... seed`, `... testes-sql` |
| CSMS + estorno-stub | `docker compose -f docker-compose.ocpp.yml up -d --build` (precisa de `SUPABASE_SERVICE_ROLE_KEY` do Supabase **local** no ambiente; o `test:ocpp` obtém de `npx supabase status -o env`) |
| E2E da tela `/recarga` | `npm run test:e2e` (Playwright; stack local de pé; usa o Chromium já instalado, não rodar `playwright install`). O spec de pagamento Stripe pula sem `VITE_STRIPE_PUBLISHABLE_KEY`/`STRIPE_SECRET_KEY` (chaves de teste) |

CI: `.github/workflows/ocpp.yml` (job rápido em PR; L3b só por `workflow_dispatch`).

## 3. Rodar um cenário isolado

Com o CSMS local de pé (seção 1) e o seed aplicado (`CP_EMU_01`, senha local `emu-local-senha`, válida **só** neste ambiente):

```
cd tools/ocpp-emulator
.venv/Scripts/python -m emulator --list-scenarios
.venv/Scripts/python -m emulator --id CP_EMU_01 --url ws://127.0.0.1:9220/ocpp --password emu-local-senha --scenario happy_path --log-frames
```

(Linux/macOS: `.venv/bin/python`.) Sem `--scenario`, o emulador só fica conectado. Opções úteis: `--plug-delay never` (RC-03), `--reject RemoteStartTransaction` (RC-02), `--no-response <Ação>`, `--delay <Ação>=<seg>`, `--drop-after`/`--offline-for` (RS-01), `--meter-unit kWh`, `--meter-regress`, `--time-scale 60` (acelera a energia), `--meter-interval`, `--stop-after-wh`. Cenários: `happy_path, local_start, local_stop, emergency_stop, ground_failure, invalid_tag, drop_during_charge, offline_stop, never_plug, reject_remote_start, no_response, delayed_response, meter_kwh, meter_regress, meter_no_measurand` (ver `emulator/scenarios.py`).

Os cenários que dependem de uma recarga **paga** (RC-01..RC-05) são dirigidos pelos testes, que fazem o checkout, o webhook e a parada pelo app: `npm run test:ocpp -- -k "RC01 or RC03"`. Iniciar à mão um `RemoteStartTransaction` com um idTag avulso **não** serve: o CSMS só aceita idTag ligado a uma recarga (`ocpp_id_tags.recarga_id`) e encerra a transação com `DeAuthorized` (verificado em 05/10/2026). Comandos de operador (`Reset`, `GetConfiguration`, `ChangeConfiguration`, `ChangeAvailability`, `UnlockConnector`, `TriggerMessage`) funcionam à mão pela fila (seção 6).

## 4. Variáveis de ambiente do CSMS

Nomes em `services/ocpp-csms/.env.example`. Valores só no ambiente de execução, nunca no repositório.

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | 9220 | Porta do WebSocket OCPP e do `GET /health` |
| `OCPP_AUTH` | — | `basic` = HTTP Basic por carregador (**produção**); `off` = sem senha (**só local**) |
| `CONNECTION_TIMEOUT_S` | 120 | Recarga com RemoteStart aceito sem `StartTransaction` → `canceled` + estorno total |
| `CALL_TIMEOUT_S` | 30 | Espera pela resposta de um comando ao carregador |
| `OFFLINE_CHECK_S` | 30 | Período da verificação de carregador offline (sem contato por 3 × heartbeat) |
| `SUPABASE_URL` | — | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Chave service role (segredo; o CSMS é o único que lê `senha_hash`) |

`GET /health` → `{"status":"ok","carregadores_conectados":N}`. Imagem: `docker build services/ocpp-csms` (usuário não-root, healthcheck embutido). O CSMS fala `ws://`; o TLS (`wss://`) termina no proxy/hospedagem. Segurança: Security Profile 1 (Basic Auth sobre TLS).

## 5. Cadastrar um carregador real e gerar a senha

1. Gere uma senha forte (≥ 20 caracteres aleatórios) e o hash scrypt. A senha **não** vai para o repositório nem para o banco:

   ```
   cd services/ocpp-csms
   npx tsx -e "import {gerarSenhaHash} from './src/server/auth.ts'; console.log(gerarSenhaHash(process.argv[1]))" 'SENHA_AQUI'
   ```

   Guarde a senha em cofre de senhas (ela vai só para o painel do carregador). O hash tem o formato `scrypt$N$r$p$salt$hash`.
2. No SQL Editor, cadastre (o `ocpp_id` é a identidade configurada no carregador: `[A-Za-z0-9_-]{1,48}`; é o último segmento da URL):

   ```sql
   insert into public.eletroposto_carregadores (eletroposto_id, ocpp_id, senha_hash)
   values ('<uuid do eletroposto>', '<ocpp_id>', '<hash gerado>');
   ```

   A linha em `eletroposto_conectores` nasce no primeiro `StatusNotification` e o gatilho da migração `20261007c` **atribui o `numero` público sozinho** (maior número do eletroposto + 1). Confira o número atribuído (é o que vai no QR/URL `/recarga?posto=..&conector=<numero>`) e mude **só se precisar**:

   ```sql
   select k.connector_id, k.numero, k.status
   from public.eletroposto_conectores k
   join public.eletroposto_carregadores c on c.id = k.carregador_id
   where c.ocpp_id = '<ocpp_id>' order by k.connector_id;
   -- só se precisar trocar (o numero deve estar livre no eletroposto, senão 23505):
   -- update public.eletroposto_conectores set numero = <livre>
   -- where carregador_id = (select id from public.eletroposto_carregadores where ocpp_id = '<ocpp_id>') and connector_id = 1;
   ```
3. No carregador: Central System URL `wss://<host>/ocpp/<ocpp_id>`, usuário = `<ocpp_id>`, senha = a gerada, Security Profile 1.
4. Trocar a senha: gere novo hash e `update public.eletroposto_carregadores set senha_hash = '<novo>' where ocpp_id = '<ocpp_id>';` (vale no próximo handshake; reinicie o carregador para derrubar a conexão atual).

## 6. Enviar comandos de operador

Insira na fila; o CSMS envia, valida o payload contra o schema OCA e grava `status`/`resposta`:

```sql
insert into public.ocpp_comandos (carregador_id, acao, payload)
select id, 'GetConfiguration', '{}'::jsonb from public.eletroposto_carregadores where ocpp_id = '<ocpp_id>';
-- Reset:               'Reset', '{"type":"Hard"}'   (ou Soft)
-- ChangeConfiguration: 'ChangeConfiguration', '{"key":"MeterValueSampleInterval","value":"10"}'

select acao, status, tentativas, resposta, erro, created_at
from public.ocpp_comandos
where carregador_id = (select id from public.eletroposto_carregadores where ocpp_id = '<ocpp_id>')
order by created_at desc limit 10;
```

Tentativas por comando: 1 envio + até 3 reenvios (espera 2/4/8 s após cada timeout de `CALL_TIMEOUT_S`); `expira_em` padrão 2 min. Conector `Faulted` com `GroundFailure`/`OverCurrentFailure`, ou emergência, fica `bloqueado_ate_reset` e só libera após `Reset` aceito + novo Boot.

## 7. Depurar com `ocpp_mensagens`

Todo frame (entrada = do carregador, saída = do CSMS) é gravado, retenção de 30 dias. A leitura exige papel interno (SQL Editor ou usuário interno).

**Por carregador e intervalo** (ajuste `<ocpp_id>` e as datas, horário UTC):

```sql
select m.criado_em, m.direcao, m.tipo, m.acao, m.unique_id, m.payload
from public.ocpp_mensagens m
where m.ocpp_id = '<ocpp_id>'
  and m.criado_em >= '2026-10-05 12:00+00' and m.criado_em < '2026-10-05 13:00+00'
order by m.criado_em, m.id;
-- só problemas: acrescente  and (m.tipo = 4 or m.acao = 'StatusNotification')
-- tipo: 2 CALL, 3 CALLRESULT, 4 CALLERROR, nulo = evento de conexão (handshake recusado tem carregador_id nulo)
```

**Trilha completa de uma recarga** (recarga → transação → medições, comandos e mensagens):

```sql
with r as (
  select id, ocpp_transacao_id, ocpp_id_tag, status, kwh_limite, kwh_consumido, valor_final, valor_estornado, motivo_fim
  from public.recargas_eletroposto where id = '<recarga_id>'
), t as (
  select t.*, c.ocpp_id
  from public.ocpp_transacoes t join public.eletroposto_carregadores c on c.id = t.carregador_id
  where t.recarga_id = '<recarga_id>'
)
select 'recarga' as origem, null::timestamptz as em, to_jsonb(r) as dado from r
union all select 'transacao', t.inicio_em, to_jsonb(t) - 'chave_idempotencia' from t
union all select 'comando', c.created_at,
       jsonb_build_object('acao', c.acao, 'status', c.status, 'tentativas', c.tentativas, 'resposta', c.resposta, 'erro', c.erro)
  from public.ocpp_comandos c where c.recarga_id = '<recarga_id>'
union all select 'medicao', md.medido_em,
       jsonb_build_object('measurand', md.measurand, 'valor', md.valor, 'unidade', md.unidade, 'contexto', md.contexto)
  from public.ocpp_medicoes md join t on t.id = md.transacao_id
union all select 'mensagem', m.criado_em,
       jsonb_build_object('direcao', m.direcao, 'tipo', m.tipo, 'acao', m.acao, 'payload', m.payload)
  from public.ocpp_mensagens m
  join t on t.ocpp_id = m.ocpp_id
       and m.criado_em >= t.inicio_em - interval '2 minutes'
       and m.criado_em <= coalesce(t.fim_em, now()) + interval '2 minutes'
order by em nulls first;
```

Se a recarga não chegou a ter transação (cancelada ou falhou antes do `StartTransaction`), use a consulta por carregador no intervalo entre `created_at` e `updated_at` da recarga.

Primeiros suspeitos: `tipo = 4` (CALLERROR; `acao` e `payload` dizem o motivo); handshake recusado (`carregador_id` nulo: `ocpp_id` não cadastrado = 404, senha errada = 401); comando `rejeitado` ou `expirado` em `ocpp_comandos`; carregador com `online = false`.

## 8. Deploy em produção

Migrações **ainda não aplicadas** em produção. O `apply_migration` em produção é bloqueado: o dono aplica no SQL Editor. Os comandos de CLI abaixo assumem `npx supabase link --project-ref <ref>` já feito.

### 8.1 Sequência obrigatória antes do merge na `main`

O merge na `main` publica o frontend (`.github/workflows/deploy.yml` roda em todo push na `main`). Por isso **tudo abaixo vem antes do merge**, nesta ordem:

1. **Migrações**, no SQL Editor, cada uma inteira e seguida do seu teste (bloco `DO` que termina em `RAISE EXCEPTION 'SANDBOX_OK'`: o erro é o sucesso, tudo é desfeito, é seguro em produção):

   | # | Migração | Teste |
   |---|---|---|
   | a | `supabase/migrations/20261007a_recarga_seguranca.sql` | `supabase/tests/recarga_seguranca.test.sql` |
   | b | `supabase/migrations/20261007b_ocpp_estrutura.sql` | `supabase/tests/ocpp_estrutura.test.sql` |
   | c | `supabase/migrations/20261007c_conector_numero.sql` | `supabase/tests/conector_numero.test.sql` |
   | d | `supabase/migrations/20261007d_recarga_publica_tarifa.sql` | sem arquivo próprio: **rodar de novo** `recarga_seguranca.test.sql` (cobre `tarifa_kwh_aplicada` de `fn_recarga_publica`) |
   | e | `supabase/migrations/20261007e_recarga_estorno_tardio.sql` | `supabase/tests/recarga_estorno_tardio.test.sql` e de novo `conector_numero.test.sql` (a `e` substitui `fn_confirmar_inicio`) |

2. **Segredos das Edge Functions** (Painel → Edge Functions → Secrets, ou `npx supabase secrets set NOME=valor`; valores nunca no repositório):

   | Segredo | Usado por |
   |---|---|
   | `STRIPE_SECRET_KEY` | `create-charging-checkout`, `stripe-charging-webhook`, `stop-charging`, `refund-charging` |
   | `STRIPE_WEBHOOK_SECRET` | `stripe-charging-webhook` (sem ele, todo evento é recusado com 400) |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | as quatro; o Supabase injeta sozinho nas Edge Functions hospedadas. Conferir que existem; não sobrescrever |

3. **Stripe (painel)**:
   - Ative **Pix** em Settings → Payment methods. O checkout cria o PaymentIntent com `payment_method_types: ['card', 'pix']` e o QR do Pix vence em 10 min (junto com a reserva do conector). Se a conta não tiver Pix, o checkout repete só com cartão e registra `Pix indisponivel` no log da função: as vendas não param, mas o Pix some da tela.
   - Webhook endpoint `https://<ref>.supabase.co/functions/v1/stripe-charging-webhook` assinando **exatamente** `payment_intent.succeeded` e `payment_intent.payment_failed`. O segredo de assinatura desse endpoint é o `STRIPE_WEBHOOK_SECRET`.

4. **Deploy das funções**, uma por uma:

   ```
   npx supabase functions deploy create-charging-checkout
   npx supabase functions deploy refund-charging
   npx supabase functions deploy stop-charging
   ```

5. **Esvaziar as recargas do checkout antigo** antes do webhook novo. Recargas criadas pelo checkout antigo não têm `carregador_id`; se forem pagas depois do webhook novo, viram `failed` + estorno total (`sem_destino`): seguro, mas devolve o dinheiro de quem queria carregar. Logo depois do passo 4, no SQL Editor:

   ```sql
   -- quem ainda pode pagar pelo checkout antigo
   select id, created_at, valor, stripe_payment_intent_id
   from public.recargas_eletroposto
   where status = 'pending_payment' and carregador_id is null
   order by created_at;
   ```

   Cancele cada PaymentIntent listado na Stripe (Dashboard → Payments → Cancel, ou `stripe payment_intents cancel <pi>`) e então `update public.recargas_eletroposto set status = 'canceled' where status = 'pending_payment' and carregador_id is null;`. Se algum PaymentIntent já estiver `succeeded`, deixe a recarga como está: o webhook novo a trata (estorno total).

6. **Deploy do webhook** com verify_jwt desligado (a Stripe não envia JWT; a autenticidade vem da assinatura):

   ```
   npx supabase functions deploy stripe-charging-webhook --no-verify-jwt
   ```

   O `supabase/config.toml` já tem `[functions.stripe-charging-webhook] verify_jwt = false`; o comando explícito evita depender dele. Confira no painel (Edge Functions) e mande um evento de teste pelo painel da Stripe: a resposta deve ser 200.

7. Em cada plano de eletroposto, preencha `tarifa_motorista_kwh`; sem ela o posto mostra "Recarga indisponível neste posto" e nenhum valor é reservado. Confira o `numero` dos conectores (seção 5).

8. **Só agora** faça o merge na `main` (deploy do frontend).

Publicar o CSMS (Dockerfile em `services/ocpp-csms`) com as variáveis da seção 4, `OCPP_AUTH=basic`, **uma instância só** (a fila de comandos só entrega ao carregador conectado nessa instância) e proxy com TLS. Hospedagem: **decisão pendente** (seção 9). Sem CSMS no ar nenhum estorno automático acontece (a varredura vive nele): não venda recarga em produção antes disso.

### 8.2 Notas sobre as funções

- `create-charging-checkout` e `stop-charging` ficam com `verify_jwt = true` (padrão): a tela pública chama com a chave anon, que é um JWT válido; a autorização real é feita dentro de cada função (token do usuário, se houver, e posse do PaymentIntent). Se o projeto passar a usar chaves `sb_publishable_` (que não são JWT), as duas precisarão de `verify_jwt = false`.
- `refund-charging` compara o bearer com `SUPABASE_SERVICE_ROLE_KEY` (só o CSMS chama). Se o projeto migrar para as chaves novas `sb_secret_`, **revisar** essa comparação.
- Cartão recusado (`payment_intent.payment_failed`) **não** encerra a recarga: o motorista tenta de novo no mesmo pagamento; se desistir, a reserva de 10 min vence sozinha.

### 8.3 Estornos e alertas (operação)

O CSMS repete a cada varredura (5 s) os estornos ainda não confirmados:

- recarga `failed`/`canceled` com `metadata.estorno_total_pendente = true` → estorno do valor inteiro (RemoteStart recusado, plug que não veio, conector tomado por outro, recarga sem destino, pagamento que chegou depois de a recarga encerrar);
- recarga `completed` **com transação OCPP**, `valor_estornado > 0` e `stripe_refund_id` nulo → estorno parcial de `valor_estornado` (nesse status, `valor_estornado` = quanto devolver; a `refund-charging` grava `stripe_refund_id` quando a Stripe confirma).

**Estorno feito à mão no painel da Stripe:** grave o id do refund em `recargas_eletroposto.stripe_refund_id` na mesma hora, senão a varredura pede de novo.

Alertas novos em `notification_logs` (canal `sistema`, `metadata.tipo`): `estorno_falhou` (o pedido do `StopTransaction` falhou; a varredura repete) e `parada_rearmada` (um `RemoteStopTransaction` anterior terminou `expirado`/`rejeitado`/`erro` e foi reenfileirado pelo app ou pelo corte pré-pago). `parada_rearmada` repetido para a mesma recarga = o carregador não está parando: intervenha no local ou com `Reset`.

## 9. Decisões do dono (spec §10)

1. **CSMS próprio (D1)** em vez do broker da Joult ou de um CSMS SaaS. *Dono: construir o CSMS próprio (feito neste PR).*
2. **Hospedagem do CSMS**: *Dono (06/10): VPS da Contabo, publicada pelo Easy Panel* (imagem Docker de `services/ocpp-csms`).

Decididas também: tarifa ao motorista = coluna `tarifa_motorista_kwh` do plano (§4.9); estorno mínimo = R$ 0,50.

### 9.1 Ordem dos próximos passos (dono, 06/10)

1. Configurar a VPS Contabo + Easy Panel e subir o CSMS (WSS com domínio e TLS).
2. Só depois: sequência §8.1 em produção e merge do PR.
3. Homologação com o Joult real e pagamento real: aguardam a entrega do equipamento.
4. Telas de operação no CRM **dentro do modal do eletroposto** (cadastro de carregadores/conectores e senha, status ao vivo, histórico de recargas/estornos, comandos do operador, alertas). Antes de começar: corrigir o `UPDATE` de drenagem do §8.1 (restringir aos PaymentIntents cancelados).
5. Fluxo de recarga no app do motorista (`saas-mobile`): depois do item 4.

## 10. Desvios aceitos registrados durante o trabalho

- **RS-01** (queda de rede no meio da recarga) é testado com **10 s** offline, não 30 s (spec §8.4); o teste com o Joult real usa 2 min (`homologacao-joult.md`).
- O job L3b do CI (`.github/workflows/ocpp.yml`, `workflow_dispatch`) **nunca rodou no GitHub**; só foi validado localmente com `npm run test:ocpp`.
- O E2E que **paga com cartão pela Stripe nunca rodou** (sem chaves de teste); o restante de `e2e/recarga.spec.ts` roda contra o stack local, com JWT local reassinado HS256 só para o gateway local.
- Tentativas de comando = **1 envio + até 3 reenvios** (decisão do dono, 04/10).
- `OverCurrentFailure` **bloqueia o conector até `Reset`**, igual a `GroundFailure` (decisão do dono).
- **Parada de emergência** é modelada como `Faulted` + `OtherError` com `info`/`vendorErrorCode` contendo "emerg", porque `EmergencyStop` não é `ChargePointErrorCode` válido no 1.6 (`reason=EmergencyStop` existe só no `StopTransaction`).
- O banco local **não** é criado pelas migrações do CLI (seção 1): usa bootstrap + migrações OCPP verbatim.

## 11. Conformidade (L5): emulador × SteVe

**Status: NÃO RODADO (motivo: disco).** O SteVe (`steve-community/steve`) não publica imagem oficial (verificado em 05/10/2026: `docker manifest inspect` em `steve-community/steve` e `ghcr.io/steve-community/steve` devolveu `denied`). A imagem é construída do código-fonte (JDK + Maven), e a máquina de desenvolvimento tinha 5,5 GB livres no C: (o Docker já ocupa ~9,9 GB de imagens), o que deixaria menos de 3 GB. Rodar na primeira máquina com ~3 GB livres. Divergência é bug do **emulador**: corrigir em `tools/ocpp-emulator` com teste unitário antes de culpar o CSMS.

Procedimento:

1. `docker compose -f tools/ocpp-emulator/steve/docker-compose.yml up -d --build` (compose escrito, **não validado**; se o build do SteVe pedir outras variáveis ou branch, ajuste e anote aqui; `STEVE_REF` escolhe branch/tag).
2. Abrir `http://localhost:8180/steve/manager` (login padrão do projeto `admin` / `1234`; conferir no README do SteVe). **Data Management → Charge Points → Add**: ChargeBox ID `CP_EMU_01`. Em **OCPP Tags**, cadastrar um idTag (até 20 caracteres).
3. Emulador (sem `--password`; a Basic Auth do SteVe é opcional):

   ```
   cd tools/ocpp-emulator
   .venv/Scripts/python -m emulator --id CP_EMU_01 --url ws://localhost:8180/steve/websocket/CentralSystemService --scenario happy_path --log-frames --keep-running
   ```
4. Na UI do SteVe: **Operations → Remote Start** (CP_EMU_01, connector 1, o idTag cadastrado), depois **Remote Stop** e, por fim, **Reset** (Soft e Hard).
5. Conferir e registrar abaixo: Boot `Accepted`; a transação aparece em **Transactions** (ativa, depois encerrada com `meterStop`); os `MeterValues` chegam (detalhes da transação); o `Reset` leva a novo Boot e conector `Available`.
6. Derrubar: `docker compose -f tools/ocpp-emulator/steve/docker-compose.yml down` (e `docker image prune` do que foi construído, se faltar disco).

Resultado:

| Verificação | Resultado | Divergência / correção no emulador |
|---|---|---|
| Boot aceito | NÃO RODADO | |
| Transação aparece | NÃO RODADO | |
| Medições chegam | NÃO RODADO | |
| RemoteStart / RemoteStop | NÃO RODADO | |
| Reset | NÃO RODADO | |
