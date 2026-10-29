-- Encerrar ao perder, v2: card da Recepção (29/10/2026). Ajuste de 20261029d.
--
-- O funil Recepção é a categoria de ENTRADA: fn_card_para_lead só cria o lead do CRM
-- B2W em sem_interacao e não muda status por etapa. Quando a Bel registra a recusa
-- (card da Recepção em "Não fechou"), o lead do CRM vai para negocio_perdido aqui.
-- Cliente fechado (ativacao, ativo, pago) não regride. A escrita leva
-- ponte.origem = 'deskcomm', como em fn_card_para_lead, para o CRM não devolver a
-- mudança ao Deskcomm (fn_lead_para_fila).

create or replace function ponte_deskcomm.fn_card_perdido_encerra()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
  v_card  record;
  v_conv  record;
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

  -- 1b. card da Recepção: lead do CRM B2W em negocio_perdido
  perform set_config('ponte.origem', 'deskcomm', true);
  update leads l set status = 'negocio_perdido', updated_at = now()
    from ponte_deskcomm.vinculos vi
    join ponte_deskcomm.categorias ca on ca.pipeline_id = new.pipeline_id and ca.entrada
   where vi.deskcomm_lead_id = new.id and l.id = vi.b2w_lead_id
     and l.status not in ('ativacao', 'ativo', 'pago', 'negocio_perdido');
  perform set_config('ponte.origem', '', true);

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
  perform set_config('ponte.origem', '', true);
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_card_perdido_encerra', new.id, sqlstate, sqlerrm);
  return null;
end $$;
