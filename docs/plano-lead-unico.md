# Lead único por pessoa

Branch `app-v1.3` · 06/10/2026 · Migração `supabase/migrations/20261006b_lead_publico_unico.sql`.

## Problema

O site gravava um lead novo a cada simulação enviada, com um insert direto feito pela chave anon. Em 06/10/2026 havia 42 leads, e 12 deles repetiam um celular que já estava cadastrado.

## Decisões do dono (06/10/2026)

1. A trava é pelo celular. Quando o celular não bate, vale o e-mail.
2. O indicador e o originador seguem a mesma regra: vale o último link.
3. Uma simulação sem andamento por 90 dias é arquivada.
4. Os duplicados existentes só são juntados depois da revisão do dono.

## Como funciona

**Uma visita por envio.** O site chama `fn_registrar_lead_publico`.
- A função procura um lead em aberto da mesma pessoa: primeiro pelo celular (sem o 55 e sem máscara), depois pelo e-mail.
- Se acha, o lead recebe só os campos que estavam vazios, além de `retornos + 1`. O envio também tira o lead do arquivo.
- Se não acha, cria um lead novo.
- Em qualquer caso, grava uma linha em `lead_visitas` com o que foi digitado e com o link usado (indicador, originador e meio).

**O id devolvido é o da visita, nunca o do lead.** Por isso:
- Quem manda o formulário com o celular de outra pessoa não recebe os dados dela. `fn_lead_adesao` com um id de visita devolve só o que foi digitado naquela visita.
- Esse envio também não apaga nem troca o cadastro existente, porque o lead só recebe campos vazios.

**Último link.**
- No lead: uma visita que traz um link troca o indicador e o originador juntos. Uma visita sem link não mexe em nada.
- Na adesão: `fn_criar_assinante_publico` aceita como `p_lead_id` tanto o id de uma visita quanto o de um lead, para manter funcionando o link gerado pelo CRM.
  - Vale o link da sessão que concluiu: o da URL ou o da visita.
  - Se a sessão não trouxe link, vale o que está no lead.
  - Quando o link é de assinante, o originador vem do indicador.
  - Esse é o "último link concluído". Quem manda o celular de outra pessoa pelo próprio link não leva a indicação, porque só a sessão que assina o contrato decide.

**Trava.** O lead fica com a indicação travada em dois casos:
- já existe contrato assinado (lead em `ativacao` ou assinante ligado ao lead com contrato);
- o celular já é de um assinante.

Nesses casos a visita é registrada com `aplicada = false`, e o CRM mostra o motivo.

**Proteção contra leads fantasma:**
- campo invisível no formulário: quem o preenche é robô, e a resposta finge sucesso sem gravar nada;
- no máximo 5 envios por celular por hora;
- celular de um dígito só, como 99999999999, é recusado.

**Arquivo.**
- O `pg_cron` roda `arquivar-leads-parados` todo dia às 06:41 UTC.
- O lead volta do arquivo sozinho se a pessoa simular de novo ou se a equipe mudar o status dele.
- No Kanban, a caixa "Mostrar arquivados" exibe os arquivados.

**No CRM:** o modal do lead ganhou a aba "Visitas e Indicações".

## Testes

`supabase/tests/lead_publico_unico.test.sql` rodou junto com a migração, num lote desfeito no fim (`SANDBOX_OK`), sobre produção. Cobre:
- trava pelo celular, com máscara e com +55;
- trava pelo e-mail;
- último link trocando indicador e originador juntos;
- envio de estranho que não sobrescreve nem vaza dados;
- visita orgânica;
- campo armadilha;
- limite por hora;
- adesão atribuída pela sessão que concluiu, com `subscribers.lead_id` apontando para o lead;
- trava após o contrato;
- arquivo e desarquivo.

O caso 5b (celular de um dígito só) entrou depois dessa execução. Só a expressão regular foi conferida no banco; o caso ainda precisa rodar no lote completo.

## Depois de publicar o front

- Retirar as políticas `leads_anon_insert_simulacao` e `leads_anon_select_recem_inserido`. Elas continuam ativas porque o site publicado ainda grava pelo insert direto, e retirá-las antes do deploy derrubaria o formulário.
- Juntar os duplicados de hoje depois da revisão do dono.
