-- Card perdido PELA ETAPA também encerra a conversa (04/11/2026).
--
-- O gatilho de 20261029d era AFTER UPDATE OF status. Quando o agente (MCP
-- crm_move_lead_stage) move o card para "Negócio Perdido", o UPDATE só seta
-- stage_id; quem muda status para 'lost' é o BEFORE trg_crm_lead_close_on_stage.
-- Coluna alterada por gatilho BEFORE não conta para "UPDATE OF status", então o
-- AFTER nunca rodava e a conversa ficava aberta. Agora escuta stage_id também;
-- o WHEN (old.status distinto de 'lost') segue barrando disparo repetido.

drop trigger if exists trg_ponte_card_perdido_encerra on public.crm_leads;
create trigger trg_ponte_card_perdido_encerra
  after update of status, stage_id on public.crm_leads
  for each row
  when (new.status = 'lost' and old.status is distinct from 'lost'
        and coalesce(new.lost_reason, '') <> 'moved_to_another_pipeline'
        and new.contact_id is not null)
  execute function ponte_deskcomm.fn_card_perdido_encerra();
