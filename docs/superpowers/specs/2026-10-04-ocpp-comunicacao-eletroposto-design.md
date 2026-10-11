# B2W Charge — Comunicação App ↔ Eletroposto (OCPP 1.6-J): emulação e testes

- **Data:** 04/10/2026
- **Status:** Proposta (aguarda aprovação do dono — ver §10 "Decisões a confirmar")
- **Base:** guia "Emulação e Testes de Eletroposto (OCPP 1.6-J)" enviado pelo dono, `B2W Charge/ARQUITETURA_DOMINIO_B2W_CHARGE.md`, spec do checkout `2026-09-30-b2w-charge-checkout-design.md`
- **Plano:** `docs/superpowers/plans/2026-10-04-ocpp-comunicacao-eletroposto.md`

---

## 1. Por que

O checkout de recarga (`/recarga`) já cobra o motorista (Stripe, Pix/Cartão) e o webhook marca a recarga como `paid`. **Daí para frente não existe nada:** nenhum servidor fala OCPP, nenhum comando chega ao carregador, nenhuma medição volta para o app. A spec do checkout diz que o webhook "dispara a liberação de carga para o carregador (via broker OCPP Joult)", mas esse broker não existe no repositório.

Para testar a comunicação do app com o eletroposto antes de ter um Joult (60/80 kW) ligado, precisamos de três peças:

1. **CSMS** — o servidor OCPP central que o carregador (real ou emulado) conecta por WebSocket.
2. **Ponte app ↔ CSMS** — como o pagamento confirmado vira `RemoteStartTransaction` e como as medições voltam para a tela do motorista.
3. **Emulador de carregador + catálogo de cenários** — para reproduzir o fluxo feliz e as falhas de forma automática e repetível.

## 2. O que existe hoje (04/10/2026)

| Peça | Onde | Situação |
| :--- | :--- | :--- |
| Cadastro de eletropostos | `eletropostos`, `eletroposto_fornecedores` (migração `20260929a`) | Pronto. **Não tem identidade OCPP** (chargeBoxId), nem conectores, nem senha. |
| Recargas | `recargas_eletroposto` (migração `20260930`) | Status `pending_payment → paid → charging → completed / failed / canceled`. Só `pending_payment`, `paid` e `failed` são usados. |
| Checkout | `src/pages/public/ChargingCheckout.jsx`, `create-charging-checkout` | Cria PaymentIntent e escuta Realtime até `paid`. Não consulta disponibilidade do conector. |
| Webhook | `stripe-charging-webhook` | Marca `paid`/`failed`. Não dispara nada. |

### 2.1 Pré-requisitos de segurança (bloqueiam esta spec)

A partir desta spec, **`paid` libera energia de verdade**. Hoje isso pode ser forjado:

1. **RLS de `recargas_eletroposto`**: a política `"Permitir atualizacao da recarga"` é `FOR UPDATE USING (true)` para qualquer papel, inclusive `anon`. Qualquer pessoa com a chave pública do Supabase consegue fazer `update recargas_eletroposto set status = 'paid'`. A leitura `USING (true)` também expõe nome, e-mail e telefone de todos os motoristas.
2. **Webhook sem assinatura aceito**: se `STRIPE_WEBHOOK_SECRET` faltar ou o cabeçalho `stripe-signature` não vier, o corpo é aceito como evento legítimo. Um `POST` com `{"type":"payment_intent.succeeded", ...}` marca a recarga como paga.
3. **Webhook não é idempotente**: a Stripe reenvia eventos; com o disparo de comando, um reenvio não pode gerar um segundo `RemoteStartTransaction`.

Correção (tarefa 1 do plano): remover `UPDATE`/`INSERT`/`SELECT` amplos de `anon` (escrita só pelas Edge Functions com service role; leitura do motorista avulso por RPC `fn_recarga_publica(recarga_id)` que devolve só status, kWh e valores, sem dados pessoais), webhook recusa evento sem assinatura válida (400), e transição `pending_payment → paid` feita por `update ... where status = 'pending_payment'` (só a primeira entrega surte efeito).

## 3. Arquitetura

```
[ Motorista / /recarga ] ──(polling fn_recarga_publica, 3 s)──┐
          │ checkout                                          │
          ▼                                                   │
[ Edge: create-charging-checkout ] ──► Stripe ──► [ Edge: stripe-charging-webhook ]
          │ (consulta conector livre)                     │ paid (idempotente)
          ▼                                               ▼
[ Supabase Postgres ]  ◄──────── insere ocpp_comandos(RemoteStartTransaction)
   eletroposto_carregadores / _conectores                 │
   ocpp_transacoes / ocpp_medicoes / ocpp_id_tags          │ Realtime + varredura de segurança
   ocpp_comandos / ocpp_mensagens                          ▼
          ▲                              [ CSMS B2W (Node/TS, ocpp-rpc, strict) ]  services/ocpp-csms
          │ grava estado                          ▲
          └───────────────────────────────────────┤ OCPP 1.6-J (WS local / WSS + Basic Auth em produção)
                                                  ▼
                        [ Emulador Python (lib ocpp)  |  Joult real ]   tools/ocpp-emulator
```

### 3.1 Decisões

| # | Decisão | Por quê | Alternativa descartada |
| :--- | :--- | :--- | :--- |
| D1 | **CSMS próprio** em Node 22 + TypeScript (`services/ocpp-csms`), lib `ocpp-rpc` com `strictMode` (valida todo frame contra os schemas oficiais da OCA). | Edge Functions (Deno) não mantêm WebSocket persistente por horas. Precisamos ligar pagamento → comando → medição → estorno, o que um CSMS de prateleira não faz sem uma segunda camada de integração. | SteVe/CitrineOS como CSMS de produção. Ficam como **referência de conformidade** do emulador (§7, camada L5). |
| D2 | **Ponte por fila no banco** (`ocpp_comandos`). O app/webhook só grava a intenção; o CSMS consome, envia ao carregador e grava a resposta. | Desacopla Deno de WebSocket, sobrevive a restart do CSMS, dá trilha auditável e é testável sem rede. | Edge Function chamando HTTP do CSMS (perde comando se o CSMS estiver fora). |
| D3 | **Emulador em Python** (lib `ocpp` 2.1, mobilityhouse), conforme o guia, com cenários roteirizados e injeção de falhas. | É uma implementação OCPP **independente** da do CSMS (outra linguagem, outra lib): um bug de interpretação do protocolo não se esconde dos dois lados ao mesmo tempo. | Emulador em TS com a mesma `ocpp-rpc` (mais rápido de manter, mas compartilharia bugs). Usado só como "cliente fake" nos testes unitários do CSMS. |
| D4 | **idTag efêmero por recarga** (fluxo A do guia). | O OCPP não transporta pagamento; o idTag é o vínculo recarga ↔ transação. | idTag fixo por motorista (só faz sentido para RFID/cadastrados — fase posterior). |
| D5 | **Pré-pago com corte e estorno**: o pagamento é de um valor; o CSMS corta por `RemoteStopTransaction` ao atingir o limite de energia; ao final, a diferença é estornada na Stripe. | É o que o checkout já vende ("R$ 50 ≈ 25 kWh"). Sem corte e sem estorno, ou o motorista recebe energia de graça, ou paga pelo que não recebeu. | Pré-autorização + captura parcial (melhor para cartão, mas não existe para Pix). |
| D6 | **OCPP 1.6-J apenas** nesta spec. 2.0.1 fica para depois. | O Joult e o guia são 1.6-J. | — |

## 4. Modelo de dados (migração nova)

Todas as tabelas `ocpp_*` e de carregador: RLS ligada, **sem acesso `anon`**, escrita só por service role (CSMS e Edge Functions), leitura `fn_papel_interno()` e fornecedor do eletroposto (mesmo padrão de `eletropostos`).

### 4.1 `eletroposto_carregadores` (Charge Point)

| Coluna | Tipo | Regra |
| :--- | :--- | :--- |
| `id` | uuid pk | |
| `eletroposto_id` | uuid fk `eletropostos` | um eletroposto tem 1..n carregadores |
| `ocpp_id` | text unique | o `chargeBoxIdentity` (último segmento da URL). `^[A-Za-z0-9_-]{1,48}$` |
| `senha_hash` | text | Basic Auth (Security Profile 1). Hash, nunca a senha. Nulo = só ambiente local. |
| `vendor`, `modelo`, `serial`, `firmware` | text | preenchidos pelo `BootNotification` |
| `heartbeat_intervalo_s` | int default 60 | devolvido no Boot |
| `online` | bool default false | |
| `ultimo_boot_em`, `ultimo_contato_em` | timestamptz | `ultimo_contato_em` atualiza a cada frame recebido |
| `estado_registro` | text `pendente/aceito/rejeitado` | |

### 4.2 `eletroposto_conectores`

`carregador_id`, `connector_id int` (0 = estação inteira), `status` (enum `ChargePointStatus` do 1.6: Available, Preparing, Charging, SuspendedEVSE, SuspendedEV, Finishing, Reserved, Unavailable, Faulted), `error_code` (enum `ChargePointErrorCode`), `info`, `vendor_error_code`, `status_em` (timestamp do carregador), `bloqueado_ate_reset bool`. Único `(carregador_id, connector_id)`.

### 4.3 `ocpp_id_tags`

`id_tag text pk` (**máx. 20 caracteres** — `CiString20Type`; formato `RC` + 18 caracteres base32 aleatórios), `recarga_id`, `status` (`Accepted/Blocked/Expired/Invalid/ConcurrentTx`), `expira_em`, `usado_em`. Uso único: depois do `StopTransaction` o token vira `Expired`.

### 4.4 `ocpp_transacoes`

`id bigint generated identity` (é o `transactionId` OCPP, **inteiro**), `carregador_id`, `connector_id`, `recarga_id`, `id_tag`, `meter_start_wh`, `meter_stop_wh`, `inicio_em`, `fim_em`, `motivo_parada` (enum `Reason` do 1.6), `chave_idempotencia` unique (`carregador_id|connector_id|id_tag|timestamp` do StartTransaction — retransmissão devolve o mesmo id).

### 4.5 `ocpp_medicoes`

`transacao_id`, `connector_id`, `medido_em`, `measurand`, `phase`, `valor numeric`, `unidade` (normalizada: energia sempre em **Wh**, potência em **W**), `contexto`. Único `(transacao_id, medido_em, measurand, coalesce(phase,''))` → reenvio após queda não duplica (`on conflict do nothing`).

### 4.6 `ocpp_comandos` (fila app → CSMS)

| Coluna | Regra |
| :--- | :--- |
| `id` uuid, `carregador_id`, `acao` | `RemoteStartTransaction`, `RemoteStopTransaction`, `Reset`, `ChangeAvailability`, `GetConfiguration`, `ChangeConfiguration`, `UnlockConnector`, `TriggerMessage` |
| `payload jsonb` | validado pelo CSMS contra o schema OCA antes de enviar |
| `status` | `pendente → enviado → aceito / rejeitado / erro / expirado` |
| `tentativas int`, `proxima_tentativa_em`, `expira_em` | 1 envio + até 3 reenvios com espera 2s/4s/8s após cada timeout de 30 s (decisão do dono, 04/10); `expira_em` padrão 2 min, que na prática encerra antes do 4º timeout |
| `resposta jsonb`, `erro text` | resposta do carregador ou CALLERROR |
| `recarga_id` | opcional |
| `chave_idempotencia text unique` | ex.: `start:<recarga_id>` — webhook duplicado não cria 2º comando |

### 4.7 `ocpp_mensagens` (trilha de frames)

`carregador_id`, `direcao` (`entrada/saida`), `tipo` (2 CALL / 3 CALLRESULT / 4 CALLERROR), `unique_id`, `acao`, `payload jsonb`, `criado_em`. Retenção: 30 dias (cron de limpeza). É a fonte para depurar qualquer cenário — substitui o Wireshark do guia no dia a dia.

### 4.8 Mudanças em `recargas_eletroposto`

- Status novo: `starting` (comando de início enviado, aguardando `StartTransaction`). Estorno não é status: fica nas colunas abaixo, e o status final continua `completed`/`canceled`/`failed`.
  Máquina: `pending_payment → paid → starting → charging → completed`; saídas de erro: `paid/starting → failed` (comando rejeitado/expirado) e `starting → canceled` (motorista não plugou). Transições validadas por gatilho (`fn_recarga_transicao_valida`).
- Colunas: `ocpp_id_tag`, `ocpp_transacao_id`, `kwh_limite`, `kwh_consumido`, `valor_final`, `valor_estornado`, `stripe_refund_id`, `iniciada_em`, `finalizada_em`, `motivo_fim`.

### 4.9 Tarifa ao motorista (decisão do dono, 04/10/2026)

- `planos_assinatura_energia.tarifa_motorista_kwh numeric(10,4)` (> 0): preço por kWh cobrado do motorista, definido no **plano de eletroposto** e editado no `EletropostoPlanModal`. Todo eletroposto com o plano cobra o mesmo preço.
- O checkout lê `eletropostos.plano_id → tarifa_motorista_kwh` e grava a foto em `recargas_eletroposto.tarifa_kwh_aplicada`. Posto sem plano ou plano sem tarifa → checkout recusa. `kwh_limite`, `valor_final` e estorno usam **a foto**, nunca a tarifa atual do plano.
- `tarifa_investidor_kwh` volta a ser só o piso do investidor (projeto 2), fora do preço ao motorista.

## 5. Comportamento do CSMS (OCPP 1.6-J)

### 5.1 Conexão

- URL: `ws(s)://<host>/ocpp/<ocpp_id>`; subprotocolo obrigatório `ocpp1.6` (sem ele: handshake recusado).
- `ocpp_id` não cadastrado → handshake recusado (HTTP 404). Senha errada → 401. Local (`OCPP_AUTH=off`) aceita sem senha.
- Segunda conexão com o mesmo `ocpp_id` derruba a anterior (carregador reiniciou).
- Todo frame recebido/enviado vai para `ocpp_mensagens`.

### 5.2 Mensagens iniciadas pelo carregador

| Ação | Resposta / efeito |
| :--- | :--- |
| `BootNotification` | `Accepted`, `currentTime`, `interval = heartbeat_intervalo_s`. Grava vendor/modelo/firmware, `online = true`, limpa `bloqueado_ate_reset` se o boot veio depois de um `Reset` aceito. |
| `Heartbeat` | `currentTime` do servidor (UTC). Atualiza `ultimo_contato_em`. Sem contato por 3 × intervalo → `online = false`. |
| `StatusNotification` | Upsert em `eletroposto_conectores`. `Faulted` com `GroundFailure` ou `OverCurrentFailure` (mantido pelo dono), ou parada de emergência → `bloqueado_ate_reset = true`. `EmergencyStop` não é `ChargePointErrorCode` válido no 1.6: a emergência chega como `Faulted` + `OtherError` com `info`/`vendorErrorCode` contendo "emerg" e depois `StopTransaction(reason=EmergencyStop)` e alerta interno (`notification_logs`). |
| `Authorize` | Consulta `ocpp_id_tags`: válido, não usado, não expirado → `Accepted`; senão `Invalid`/`Expired`/`Blocked`. |
| `StartTransaction` | Valida idTag; cria (ou devolve, se retransmissão) `ocpp_transacoes`; recarga → `charging`, grava `kwh_limite = valor / tarifa`. idTag inválido → `idTagInfo.status = Invalid` e `transactionId` ainda é devolvido (o 1.6 exige); o carregador deve encerrar. |
| `MeterValues` | Normaliza unidade (kWh→Wh, kW→W), grava com dedupe, atualiza `recargas_eletroposto.kwh_consumido` (a tela lê por `fn_recarga_publica`). Se energia ≥ `kwh_limite` → enfileira `RemoteStopTransaction` (uma vez só). Registro de energia menor que o anterior → ignora e alerta. |
| `StopTransaction` | Fecha transação (aceita `transactionData` com medições offline), idTag → `Expired`, calcula `valor_final = min(valor, kwh × tarifa)`, recarga → `completed`, dispara estorno da diferença (> R$ 0,50) via Edge Function `refund-charging`. `meter_stop < meter_start` → recarga fica `completed` com `valor_final = valor` e marca `metadata.revisar = true`, sem estorno automático. |
| `DataTransfer`, `DiagnosticsStatusNotification`, `FirmwareStatusNotification` | Respostas mínimas válidas (`Accepted`/vazio) + registro. |
| Ação desconhecida / frame inválido | `CALLERROR` (`NotImplemented`, `FormationViolation`, `PropertyConstraintViolation`...) — **conexão mantida**. |

### 5.3 Comandos enviados pelo CSMS (via `ocpp_comandos`)

- Consumo: assinatura Realtime em `ocpp_comandos` (insert) + varredura a cada 5 s (garante entrega se o Realtime cair).
- Só envia se o carregador estiver conectado **nesta instância**; senão mantém `pendente` até `expira_em`.
- Timeout de resposta: 30 s (`callTimeoutMs`). Timeout → nova tentativa com backoff; **nunca fecha o WebSocket por timeout** (TC-05 do guia).
- `RemoteStartTransaction` para conector com `bloqueado_ate_reset` ou status diferente de `Available`/`Preparing` → comando `rejeitado` sem enviar.
- Efeitos na recarga: `RemoteStart` aceito → `starting`; rejeitado/expirado → `failed` + estorno total. `starting` sem `StartTransaction` em `CONNECTION_TIMEOUT_S` (padrão 120 s, alinhado ao `ConnectionTimeOut` do carregador) → `canceled` + estorno total.

### 5.4 Ponte com o app

- `create-charging-checkout`: antes de criar o PaymentIntent, recusa se o posto não estiver `operando`, se o conector (por `numero` público no posto) não existir, estiver offline, bloqueado, não `Available`/`Preparing`, ou **reservado** (decisão do dono, 04/10): recarga `pending_payment` com menos de 10 min ocupa o conector; checagem e inserção atômicas (`fn_reservar_recarga`, trava por conector). Pagamento tardio de reserva vencida com outra recarga no conector → recarga `failed` + estorno total, sem `RemoteStart` (`fn_confirmar_inicio`).
- Preço mostrado na tela = `tarifa_motorista_kwh` do plano, lido por RPC pública (`fn_eletroposto_publico`/`fn_eletropostos_publicos`, só postos `operando`, sem dados pessoais). Sem tarifa → "Recarga indisponível neste posto"; nenhum valor reserva.
- `stripe-charging-webhook`: em `payment_intent.succeeded` (só na primeira entrega), gera o idTag e insere `ocpp_comandos(RemoteStartTransaction, {connectorId, idTag}, chave start:<recarga>)`. `payment_intent.payment_failed` só registra (não encerra a recarga). Pagamento confirmado de recarga já encerrada sem energia, ou de recarga sem destino resolvido, vira estorno total pendente (revisão final, C1/I1). Métodos do PaymentIntent: `card` + `pix` explícitos (QR do Pix vence em 10 min, junto com a reserva).
- Parar pelo app: Edge Function `stop-charging` (motorista prova posse com o `client_secret` do PaymentIntent ou é o `user_id` logado) → insere `RemoteStopTransaction`. Se o `stop:<recarga>` anterior terminou sem aceite, é rearmado (pendente, novas tentativas) com alerta à operação.
- Tela `/recarga` após o pagamento: estados "Conecte o cabo" (`starting`) → "Carregando" com kWh/R$ ao vivo (`charging`) → resumo com valor final e estorno (`completed`) / mensagens de `failed`/`canceled`.

## 6. Emulador (`tools/ocpp-emulator`)

Evolução do script do guia, com correções:

- O script do guia **só envia** mensagens; um carregador real também **recebe** comandos. O emulador implementa handlers `@on` para `RemoteStartTransaction`, `RemoteStopTransaction`, `Reset`, `ChangeAvailability`, `GetConfiguration`, `ChangeConfiguration`, `UnlockConnector`, `TriggerMessage`.
- Máquina de estados por conector (Available → Preparing → Charging → Finishing → Available; Faulted) dirigida pelos comandos recebidos, não por `sleep` fixo.
- `RemoteStartTransaction` aceito → emulador espera o "cabo" (`plug_delay_s`, pode ser infinito para RC-03) → `StartTransaction` → loop de `MeterValues` com potência configurável → para por `RemoteStop`, por fim de energia (`stop_after_wh`) ou por evento local.
- Fila offline: mensagens geradas sem conexão são guardadas e reenviadas na reconexão, na ordem (requisito do 1.6 para transações).
- Injeção de falhas por parâmetro: `delay_response_s{acao}`, `reject{acao}`, `drop_connection_after_s`, `offline_for_s`, `fault(error_code)`, `meter_unit=kWh|Wh`, `meter_regress`.
- Uso: biblioteca (`from emulator import VirtualChargePoint`) para os testes `pytest`, e CLI (`python -m emulator --id CP_EMU_01 --url ws://localhost:9220/ocpp --scenario happy_path`) para testes manuais e para apontar para SteVe.

## 7. Estratégia de testes (camadas)

| Camada | Ferramenta | O que cobre | Onde roda |
| :--- | :--- | :--- | :--- |
| **L1 Unitário** | vitest (`services/ocpp-csms`) | Funções puras: normalização de medição, limite/estorno, idTag, máquina de estado da recarga, backoff. | `npm test` no serviço, CI |
| **L2 Banco** | SQL no padrão `SANDBOX_OK` (`supabase/tests/`) | Constraints, transições de status, RLS (anon não lê/escreve), dedupe de medição, idempotência de comando. | MCP `execute_sql` / SQL Editor |
| **L3a Integração rápida** | vitest + `RPCClient` da `ocpp-rpc` como carregador fake + repositório em memória | Handlers do CSMS e fila de comandos, sem rede externa nem banco. | CI |
| **L3b Integração real** | pytest + emulador Python + CSMS + Supabase local (`supabase start`) via `docker compose` | Catálogo de cenários §8 de ponta a ponta no protocolo. | local / CI com Docker |
| **L4 E2E** | Evento Stripe de teste assinado (`stripe trigger` ou assinatura gerada com o segredo de teste) → webhook local → emulador; Playwright em `/recarga` | Pagamento até a tela "Carregando" e o resumo final. | local |
| **L5 Conformidade** | Emulador contra **SteVe** em Docker | Garante que o emulador em si segue o 1.6 (se SteVe aceita, o erro está no nosso CSMS, não no emulador). | manual, antes da homologação |
| **L6 Campo** | Joult real apontado para o CSMS de homologação | Checklist §9. | presencial |

## 8. Catálogo de cenários

Cada cenário vira um teste automatizado (L3b, com o ID no nome do teste: `test_RC01_fluxo_feliz`). **Esperado** = estado verificado no banco e/ou resposta OCPP.

### 8.1 Conexão e registro (CP)

| ID | Ação do emulador | Esperado |
| :--- | :--- | :--- |
| CP-01 | Conecta e envia `BootNotification` | `Accepted`, `interval` = configurado; carregador `online`, vendor/modelo/firmware gravados |
| CP-02 | Conecta com `ocpp_id` não cadastrado | Handshake recusado (404); nada gravado em `ocpp_mensagens` além do log de recusa |
| CP-03 | Senha Basic Auth errada (perfil 1 ligado) | 401 |
| CP-04 | Conecta sem subprotocolo `ocpp1.6` | Handshake recusado |
| CP-05 | Envia `Heartbeat` e depois fica mudo por 3 × intervalo | `currentTime` UTC válido; depois `online = false` |
| CP-06 | Envia frame com campo obrigatório faltando (`StatusNotification` sem `errorCode`) | `CALLERROR` `FormationViolation`/`PropertyConstraintViolation`; conexão continua aberta |
| CP-07 | Envia ação inexistente | `CALLERROR` `NotImplemented`; conexão continua |
| CP-08 | Segunda conexão com o mesmo `ocpp_id` | Primeira é encerrada; segunda segue normal |

### 8.2 Status e falhas de hardware (ST)

| ID | Ação | Esperado |
| :--- | :--- | :--- |
| ST-01 | `StatusNotification` conector 0 e 1 | Upsert dos dois; conector 0 representa a estação |
| ST-02 (= TC-02 do guia) | Durante recarga: `Faulted` + `EmergencyStop`, depois `StopTransaction(reason=EmergencyStop)` | Conector bloqueado, alerta interno, recarga `completed` com valor proporcional e estorno; checkout recusa novo pagamento nesse conector |
| ST-03 (= TC-04) | `Faulted` + `GroundFailure`; app tenta iniciar; operador envia `Reset Hard`; emulador reinicia (novo Boot + `Available`) | Antes do reset: checkout recusa e `RemoteStart` é `rejeitado` sem envio. Depois: conector liberado |
| ST-04 | Conector em `Charging` de outra recarga | Checkout recusa ("conector em uso") |

### 8.3 Fluxo de recarga (RC)

| ID | Ação | Esperado |
| :--- | :--- | :--- |
| RC-01 | Fluxo feliz: pagamento R$ 50 → `RemoteStart` → plug → `StartTransaction` → 3 `MeterValues` → `RemoteStop` pelo app → `StopTransaction` → Finishing → Available | Recarga `paid → starting → charging → completed`; `kwh_consumido` = medição; `valor_final` = kWh × tarifa; estorno = R$ 50 − valor_final; idTag `Expired` |
| RC-02 | Emulador responde `RemoteStart` com `Rejected` | Comando `rejeitado`, recarga `failed`, estorno total |
| RC-03 | Emulador aceita `RemoteStart` mas nunca pluga | Após `CONNECTION_TIMEOUT_S`: recarga `canceled`, estorno total, idTag `Expired` |
| RC-04 | Energia chega ao limite pré-pago | Um único `RemoteStopTransaction` enfileirado; `valor_final` = valor pago (sem estorno, tolerância de medição documentada) |
| RC-05 | Parada local: `StopTransaction(reason=EVDisconnected)` sem comando | Recarga `completed`, estorno da diferença |
| RC-06 (opção 2 do guia — totem) | `Authorize(idTag válido)` → `StartTransaction` local | Aceito; mesmo fluxo de medição |
| RC-07 (= TC-03) | `Authorize("TAG_DESCONHECIDA_99")`, depois `StartTransaction` com ela | `Invalid` nos dois; emulador encerra; nenhuma recarga muda |
| RC-08 | Reusar idTag de recarga já concluída | `Expired` |
| RC-09 | `payment_intent.payment_failed` (cartão recusado), depois nova tentativa aprovada no **mesmo** PaymentIntent | Nenhum comando no `payment_failed` e a recarga **continua `pending_payment`** (revisão final, C1: o Payment Element segue aberto; se o motorista desistir, a reserva de 10 min vence sozinha). O `succeeded` posterior inicia a recarga normalmente |
| RC-09b | `succeeded` de recarga já `failed`/`canceled` sem transação OCPP nem estorno | `fn_marcar_estorno_pagamento_tardio` grava `estorno_total_pendente`; a varredura do CSMS estorna o valor inteiro; nenhum comando |
| RC-09c | Recarga paga sem destino resolvido (`carregador_id`/`ocpp_connector_id` nulos, checkout antigo) | `fn_confirmar_inicio` devolve `sem_destino`: recarga `failed` (`motivo_fim = sem_destino`) + estorno total; webhook responde 200 (sem laço de reenvio) |
| RC-05b | Estorno parcial falha no `StopTransaction` (refund-charging fora do ar) | Alerta `estorno_falhou`; a varredura repete o pedido enquanto `completed` + `ocpp_transacao_id` + `valor_estornado > 0` + `stripe_refund_id` nulo |
| RC-04b | `stop:<recarga>` anterior terminou `expirado`/`rejeitado`/`erro` e o motorista toca "Parar" (ou o corte pré-pago dispara de novo) | O mesmo comando volta a `pendente` por um UPDATE guardado (só um chamador rearma), alerta `parada_rearmada`; o carregador recebe o `RemoteStopTransaction` |
| RC-10 | Webhook `succeeded` entregue 2× | Um único comando `start:<recarga>`; um único `RemoteStart` chega ao emulador |

### 8.4 Resiliência (RS)

| ID | Ação | Esperado |
| :--- | :--- | :--- |
| RS-01 (= TC-01) | Durante a recarga, derruba o socket sem `StopTransaction`, acumula 30 s de `MeterValues` offline e reconecta | Medições retroativas aceitas, **sem duplicar**; transação e recarga continuam `charging`; telemetria retoma |
| RS-02 | `StopTransaction` gerado offline, enviado na reconexão com `transactionData` | Fechamento correto usando `timestamp` do carregador |
| RS-03 | `StartTransaction` retransmitido (mesmo conteúdo, após reconexão) | Mesmo `transactionId`; uma linha em `ocpp_transacoes` |
| RS-04 (= TC-05) | Emulador demora 10 s para responder `GetConfiguration`/`ChangeAvailability` | CSMS espera, recebe, comando `aceito`; socket não é fechado |
| RS-05 | Emulador nunca responde um comando | 3 tentativas com backoff, depois `expirado`; socket continua aberto; se for `RemoteStart` → recarga `failed` + estorno |
| RS-06 | Comando criado com carregador offline; carregador volta antes de `expira_em` | Comando enviado na reconexão |
| RS-07 | CSMS reinicia no meio de uma recarga | Emulador reconecta; `MeterValues`/`StopTransaction` continuam associados à mesma transação (estado está no banco) |

### 8.5 Medição (MV)

| ID | Ação | Esperado |
| :--- | :--- | :--- |
| MV-01 | `Energy.Active.Import.Register` em kWh e em Wh | Ambos gravados em Wh, mesmo `kwh_consumido` |
| MV-02 | Registro de energia regride | Amostra ignorada + alerta; `kwh_consumido` não diminui |
| MV-03 | `meterStop < meterStart` | Recarga marcada para revisão, sem estorno automático |
| MV-04 | `MeterValues` sem `measurand` (padrão = energia) | Tratado como `Energy.Active.Import.Register` (default do 1.6) |

### 8.6 Segurança (SG)

| ID | Ação | Esperado |
| :--- | :--- | :--- |
| SG-01 | `anon` tenta `update recargas_eletroposto set status='paid'` | Bloqueado pela RLS |
| SG-02 | `anon` tenta ler `recargas_eletroposto` / `ocpp_*` | Zero linhas; só `fn_recarga_publica` funciona e sem dados pessoais |
| SG-03 | `POST` no webhook sem `stripe-signature` ou com assinatura errada | 400; nada muda |
| SG-04 | `stop-charging` com recarga de outra pessoa | 403 |

### 8.7 App (UI)

| ID | Ação | Esperado |
| :--- | :--- | :--- |
| UI-01 | Abrir `/recarga?posto=..&conector=..` com conector offline/ocupado/bloqueado | Mensagem e botão de pagar desabilitado |
| UI-02 | Pagar (cartão de teste 4242) com emulador rodando RC-01 | Telas "Conecte o cabo" → "Carregando" (kWh subindo) → resumo com estorno |
| UI-03 | Clicar "Parar recarga" | Emulador recebe `RemoteStopTransaction`; tela vai ao resumo |

## 9. Homologação com o Joult real (L6)

1. Cadastrar o carregador (`ocpp_id` = identidade configurada no Joult) e gerar senha.
2. No Joult, apontar Central System URL para `wss://<host-homolog>/ocpp/<ocpp_id>`, Security Profile 1.
3. Conferir: Boot aceito; `GetConfiguration` lista chaves (`HeartbeatInterval`, `ConnectionTimeOut`, `MeterValueSampleInterval`, `MeterValuesSampledData`, `AuthorizeRemoteTxRequests`); ajustar `MeterValueSampleInterval = 10` e `MeterValuesSampledData = Energy.Active.Import.Register,Power.Active.Import,SoC`.
4. Rodar RC-01, RC-03, RC-05 e ST-03 com veículo real; comparar kWh do CSMS com o display do carregador (tolerância 1%).
5. Desligar o roteador do posto por 2 min durante uma recarga (RS-01 real).
6. Registrar firmware e divergências do 1.6 encontradas em `docs/ocpp/joult-notas.md`.

## 10. Decisões a confirmar com o dono

1. **CSMS próprio (D1)** em vez de contratar/usar o broker da Joult ou um CSMS SaaS. Se a Joult já fornecer um backend com API, a ponte (§5.4) muda de destino, mas o emulador e o catálogo (§6–8) valem igual. *Dono: construir o CSMS próprio.*
2. **Hospedagem do CSMS** (precisa de processo persistente com WSS): Fly.io, Railway ou VM. Não bloqueia os testes locais. *Dono (06/10): VPS da Contabo via Easy Panel.*
3. ~~**Tarifa ao motorista**~~ — **decidido:** coluna própria no plano de eletroposto (§4.9).
4. ~~**Estorno mínimo**~~ — **decidido:** R$ 0,50.

## 11. Fora de escopo

OCPP 2.0.1, reservas (`ReserveNow`), Smart Charging (`SetChargingProfile`), atualização de firmware, OCPI/roaming (fluxo B do guia), split diário e NFS-e (outra spec), RFID de motoristas cadastrados.
