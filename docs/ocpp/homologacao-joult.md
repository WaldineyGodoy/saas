# Homologação com o Joult real (L6)

Spec: `docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md` §9. Ambiente, comandos e leitura de logs: `docs/ocpp/RUNBOOK.md`.
Preencha uma cópia por rodada (firmware diferente = nova rodada). Divergências do 1.6 encontradas vão em `docs/ocpp/joult-notas.md` (criar na primeira rodada).

## Identificação

| Campo | Valor |
|---|---|
| Data | ____/____/________ |
| Responsável | |
| Modelo / serial do carregador | |
| **Firmware do Joult** | |
| `ocpp_id` (identidade configurada no Joult) | |
| Host de homologação (CSMS) | `wss://______________/ocpp/<ocpp_id>` |
| Versão do CSMS (commit) | |
| Security Profile | 1 (Basic Auth) |

## Preparação

- [ ] Carregador cadastrado em `eletroposto_carregadores` e senha gerada (RUNBOOK §5). A senha vai só para o painel do Joult.
- [ ] Posto com plano de eletroposto com `tarifa_motorista_kwh` preenchida; conectores com `numero`.
- [ ] No Joult: Central System URL = `wss://<host-homolog>/ocpp/<ocpp_id>`, usuário = `ocpp_id`, senha gerada, Security Profile 1.
- [ ] `GET https://<host-homolog>/health` responde `ok`.

## Conexão

| Verificação | OK | Observação |
|---|---|---|
| Handshake aceito (sem 401/404 no log do CSMS) | [ ] | |
| `BootNotification` aceito (`Accepted`, `interval` aplicado) | [ ] | |
| `ultimo_boot_em`, `vendor`, `modelo`, `firmware` preenchidos no carregador | [ ] | |
| `StatusNotification` de cada conector chega e `Available` aparece em `eletroposto_conectores` | [ ] | |
| `Heartbeat` periódico (`ultimo_contato_em` avança) | [ ] | |

## Chaves `GetConfiguration` a conferir

Enviar `GetConfiguration` (sem `key` lista todas) pela fila `ocpp_comandos` (RUNBOOK §6) e anotar o valor lido. Ajustar com `ChangeConfiguration` as chaves da coluna "Definir". Registrar a resposta (`Accepted`, `Rejected`, `RebootRequired`, `NotSupported`).

| Chave | Lido | Definir | Resposta do ChangeConfiguration |
|---|---|---|---|
| `HeartbeatInterval` | | conforme o Boot (padrão do CSMS) | |
| `ConnectionTimeOut` | | anotar (o CSMS usa `CONNECTION_TIMEOUT_S`, padrão 120 s, para cancelar) | |
| `MeterValueSampleInterval` | | **10** | |
| `MeterValuesSampledData` | | **`Energy.Active.Import.Register,Power.Active.Import,SoC`** | |
| `AuthorizeRemoteTxRequests` | | anotar (se `true`, o carregador envia `Authorize` do idTag antes de iniciar; o CSMS aceita idTag válido, não usado e não expirado) | |
| `StopTransactionOnEVSideDisconnect` | | anotar (recomendado `true`) | |
| `LocalAuthorizeOffline` / `LocalPreAuthorize` | | anotar | |
| `SupportedFeatureProfiles` | | anotar | |
| `GetConfigurationMaxKeys` | | anotar | |
| Chaves desconhecidas devolvidas em `unknownKey` | | | |

Se o firmware recusar `MeterValuesSampledData` com `SoC`, repetir só com `Energy.Active.Import.Register,Power.Active.Import` e anotar.

## Cenários com veículo real

Para cada um: iniciar pelo app (checkout de teste) ou pelo procedimento indicado, e consultar `ocpp_mensagens` (RUNBOOK §7) em caso de falha.

| Cenário | Procedimento | Esperado | Resultado (OK / FALHA / N/A) | Observações |
|---|---|---|---|---|
| **RC-01** fluxo feliz | Pagar R$ 50 (ou valor de teste), plugar, deixar medir, parar pelo app | `paid → starting → charging → completed`; `kwh_consumido` = medição; `valor_final` = kWh × tarifa; estorno = pago − final; idTag `Expired` | | |
| **RC-03** não pluga | Pagar e **não** plugar o cabo | Após `CONNECTION_TIMEOUT_S`: `canceled`, estorno total, idTag `Expired` | | |
| **RC-05** parada local | Em recarga ativa, desplugar/parar no carregador | `StopTransaction(reason=EVDisconnected/Local)`; `completed`; estorno da diferença | | |
| **ST-03** falha de hardware | Provocar falha que o firmware reporte como `Faulted` (se não houver como provocar com segurança, marcar N/A e justificar) | Conector `Faulted` bloqueia novo checkout e `RemoteStart` é `rejeitado` sem envio; após `Reset` pelo operador, conector liberado | | |
| **RS-01** real | Em recarga ativa, desligar o roteador do posto por **2 min** e religar | Reconecta; medições retroativas aceitas **sem duplicar** (`ocpp_medicoes`); transação e recarga seguem `charging`; telemetria retoma. Anotar se o carregador reenviou o que acumulou e se tentou `StopTransaction` | | |

## Energia: CSMS × display do carregador (tolerância 1%)

Por recarga concluída: anotar o kWh mostrado no display do carregador e o `kwh_consumido` da recarga (`(meter_stop_wh - meter_start_wh) / 1000` em `ocpp_transacoes`). Divergência = `|CSMS − display| / display`.

| Recarga | kWh display | kWh CSMS | Divergência % | ≤ 1%? |
|---|---|---|---|---|
| RC-01 | | | | [ ] |
| RC-05 | | | | [ ] |
| RS-01 | | | | [ ] |

## Resultado e observações

- Aprovado para operação: [ ] sim  [ ] com ressalvas  [ ] não
- Divergências do OCPP 1.6 vs. o comportamento do Joult (também em `docs/ocpp/joult-notas.md`):
- Chaves/valores que o firmware não aceitou:
- Frames estranhos (id do `ocpp_mensagens`, ação):
- Pendências para o CSMS/emulador (o emulador deve passar a reproduzir o comportamento observado):
