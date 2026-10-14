-- Task 2 (Split de Pagamentos) — fix round 1, F1 (Important).
--
-- `licenca_status` so recalcula quando a linha de `originators_v2` e
-- escrita (gatilho trg_originador_licenca_status). Nao existe cron tocando
-- `originators_v2`, entao a coluna pode ficar desatualizada: um PPP cuja
-- licenca vence e cuja linha ninguem mais escreve continua marcado como
-- 'ativa' indefinidamente, mesmo com o vencimento no passado.
--
-- Decisao: NAO criar cron para isso. Quem decide algo que depende da
-- licenca estar em dia agora (em particular o motor de pagamento, ao
-- suspender a recorrencia do PPP) tem que comparar `licenca_vencimento`
-- com `current_date` diretamente — `licenca_status` e cache, nao fonte de
-- verdade. Sem mudanca de comportamento nesta migracao: so os comentarios
-- das colunas deixam essa regra explicita para quem for consumir a tabela.

COMMENT ON COLUMN public.originators_v2.licenca_status IS
  'Derivado por gatilho (trg_originador_licenca_status) a partir de licenca_vencimento, mas SO recalculado quando a linha e escrita — nao ha cron tocando originators_v2, entao esta coluna pode ficar desatualizada (ex.: continuar "ativa" depois do vencimento passar, se ninguem escrever na linha nesse meio-tempo). NULL/sem vencimento na ultima escrita = isenta; vencimento < hoje na ultima escrita = vencida; senao ativa. Qualquer decisao que dependa da licenca estar em dia AGORA (em particular suspender a recorrencia do PPP) deve comparar licenca_vencimento com current_date diretamente — nao confiar so nesta coluna.';

COMMENT ON COLUMN public.originators_v2.licenca_vencimento IS
  'Vencimento da licenca anual do PPP — fonte de verdade da validade da licenca. So papel interno altera. licenca_status e um cache derivado daqui pelo gatilho trg_originador_licenca_status, atualizado so quando a linha e escrita; para saber se a licenca esta em dia AGORA, compare este campo com current_date em vez de confiar so em licenca_status.';
