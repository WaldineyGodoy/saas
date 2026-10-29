-- Encerrar o atendimento quando o negócio é perdido (29/10/2026).
--
-- Caso real de 29/10/2026: a lead recusou a cota ("valor acima do meu orçamento"), o
-- agente agradeceu, mas o card ficou aberto em "Qualificando": a conversa continuou na
-- lista do Deskcomm, os leads do CRM B2W seguiram em "Simulação" e uma retomada
-- automática ainda saiu 4 horas depois. Regra do dono, para todos os atendentes:
-- conversa encerrada = conversa fechada no Deskcomm + status de perdido no CRM.
--
-- O agente marca a recusa movendo o card para "Não fechou" (regra no roteiro dos
-- agentes, scripts/deskcomm/regra_encerrar_recusa.sql). A partir daí, este gatilho:
--   1. leva para "Não fechou" os OUTROS cards abertos do mesmo contato (o roteador
--      pode ter deixado card aberto em outro funil), com o mesmo motivo — e a ponte
--      (fn_card_para_lead) põe cada lead do CRM B2W em negocio_perdido;
--   2. fecha as conversas abertas do contato por fn_service_status, a mesma função do
--      botão "Fechar" do Deskcomm. Se o cliente escrever de novo, o Deskcomm abre um
--      atendimento novo.
-- Transferência do roteador (lost_reason = 'moved_to_another_pipeline') não conta.
-- Vale também para card movido à mão para "Não fechou" no Kanban.

create or replace function ponte_deskcomm.fn_card_perdido_encerra()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
  v_card  record;
  v_conv  record;
  -- os outros cards podem estar em funil com outra lista de motivos extras; o motivo
  -- canônico (fn_validate_lost_reason_required) vale em todos, o extra vira 'other'
  v_motivo text := case when new.lost_reason = any (array['requested_by_customer','price','no_response',
                     'product_unavailable','cancelled_by_store','cancelled_by_customer','payment_failed',
                     'other','opted_out_of_messages']) then new.lost_reason else 'other' end;
begin
  if coalesce(current_setting('ponte.encerrando', true), '') = 'on' then return null; end if;
  perform set_config('ponte.encerrando', 'on', true);

  -- 1. outros cards abertos do contato
  for v_card in
    select l.id, l.stage_id, s_lost.id as lost_stage
      from crm_leads l
      join lateral (select s.id from crm_stages s
                     where s.pipeline_id = l.pipeline_id and s.is_lost and not s.is_archived
                     order by s.position limit 1) s_lost on true
     where l.contact_id = new.contact_id and l.id <> new.id and l.status = 'open'
  loop
    update crm_leads
       set stage_id = v_card.lost_stage, status = 'lost', lost_reason = v_motivo,
           lost_from_stage_id = v_card.stage_id, closed_at = now(),
           stage_changed_at = now(), updated_at = now()
     where id = v_card.id;
  end loop;

  -- 2. conversas abertas do contato
  for v_conv in
    select id, organization_id from conversations
     where contact_id = new.contact_id and status not in ('closed', 'resolved', 'archived')
  loop
    perform fn_service_status(v_conv.organization_id, v_conv.id, 'closed');
  end loop;

  perform set_config('ponte.encerrando', '', true);
  return null;
exception when others then
  perform set_config('ponte.encerrando', '', true);
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_card_perdido_encerra', new.id, sqlstate, sqlerrm);
  return null;
end $$;

drop trigger if exists trg_ponte_card_perdido_encerra on public.crm_leads;
create trigger trg_ponte_card_perdido_encerra
  after update of status on public.crm_leads
  for each row
  when (new.status = 'lost' and old.status is distinct from 'lost'
        and coalesce(new.lost_reason, '') <> 'moved_to_another_pipeline'
        and new.contact_id is not null)
  execute function ponte_deskcomm.fn_card_perdido_encerra();
