-- Follow-up esgotado encerra o atendimento (03/11/2026, regra do dono).
--
-- Quando a última retomada de um fluxo de follow-up fica sem resposta, a
-- inscrição termina como status='completed', outcome='exhausted' (o Deskcomm
-- espera ~24 h depois da última mensagem antes de fechar). Até aqui nada
-- acontecia: a conversa seguia aberta e o card parado no funil.
--
-- Agora, nesse momento:
--   - todos os cards abertos do contato vão para a etapa de perdido do próprio
--     funil, motivo canônico 'no_response';
--   - o trigger trg_ponte_card_perdido_encerra (20261029d/e) faz o resto:
--     lead B2W -> negocio_perdido (card da Recepção) e conversa fechada;
--   - no CRM B2W: quem nunca respondeu ao agente volta para Sem Interação;
--     quem chegou a conversar fica em Negócio Perdido.
-- Salvaguardas: não mexe se o lead escreveu depois da nossa última mensagem,
-- se há outra inscrição de follow-up ativa para o contato, ou se a conversa está
-- com um atendente humano.

-- Nunca interagiu = nenhuma mensagem do lead depois da primeira mensagem do agente.
create or replace function ponte_deskcomm.fn_nunca_interagiu(p_contact uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select not exists (
        select 1 from conversations c
          join messages m on m.conversation_id = c.id and m.direction = 'inbound'
         where c.contact_id = p_contact
           and m.created_at > (select min(o.created_at) from messages o
                                where o.conversation_id = c.id and o.direction = 'outbound'))
$$;

create or replace function ponte_deskcomm.fn_encerrar_fu_esgotado(p_enrollment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
    e record;
    v_conv record;
begin
    select * into e from followup_enrollments where id = p_enrollment_id;
    if e is null or e.status <> 'completed' or e.outcome <> 'exhausted' then
        return 'nao_esgotado';
    end if;

    if exists (select 1 from followup_enrollments o
                where o.contact_id = e.contact_id and o.id <> e.id and o.status = 'active') then
        return 'outro_fluxo_ativo';
    end if;

    if exists (select 1 from conversations c
                where c.contact_id = e.contact_id and c.status not in ('closed', 'resolved', 'archived')
                  and (c.assignee_kind = 'user' or c.contato_trava_humano)) then
        return 'com_humano';
    end if;

    if exists (select 1 from conversations c
                join lateral (select max(created_at) em from messages m
                               where m.conversation_id = c.id and m.direction = 'outbound') o on true
                join lateral (select max(created_at) em from messages m
                               where m.conversation_id = c.id and m.direction = 'inbound') i on true
                where c.contact_id = e.contact_id and c.status not in ('closed', 'resolved', 'archived')
                  and i.em > coalesce(o.em, '-infinity')) then
        return 'lead_respondeu';
    end if;

    -- Um UPDATE só: os triggers AFTER de cada card rodam no fim do comando, e o do
    -- card da Recepção marca o lead B2W como perdido e fecha a conversa.
    update crm_leads l
       set stage_id = (select s.id from crm_stages s
                        where s.pipeline_id = l.pipeline_id and s.is_lost and not s.is_archived
                        order by s.position limit 1),
           status = 'lost', lost_reason = 'no_response',
           lost_from_stage_id = l.stage_id, closed_at = now(),
           stage_changed_at = now(), updated_at = now()
     where l.contact_id = e.contact_id and l.status = 'open'
       and exists (select 1 from crm_stages s
                    where s.pipeline_id = l.pipeline_id and s.is_lost and not s.is_archived);

    -- Sem card aberto (ou funil sem etapa de perdido): fecha a conversa mesmo assim.
    for v_conv in
        select id, organization_id from conversations
         where contact_id = e.contact_id and status not in ('closed', 'resolved', 'archived')
    loop
        perform fn_service_status(v_conv.organization_id, v_conv.id, 'closed');
    end loop;

    -- CRM B2W: o trigger do card já pôs o lead em Negócio Perdido. Quem NUNCA
    -- respondeu a nenhuma mensagem do agente fica em Sem Interação (regra do dono,
    -- 03/11/2026). Respondeu ao menos uma vez = interagiu = Negócio Perdido.
    if ponte_deskcomm.fn_nunca_interagiu(e.contact_id) then
        perform set_config('ponte.origem', 'deskcomm', true);
        update leads b set status = 'sem_interacao', updated_at = now()
          from ponte_deskcomm.vinculos vi
          join crm_leads l on l.id = vi.deskcomm_lead_id
         where l.contact_id = e.contact_id and b.id = vi.b2w_lead_id
           and b.status = 'negocio_perdido';
        perform set_config('ponte.origem', '', true);
        return 'encerrado:sem_interacao';
    end if;

    return 'encerrado:negocio_perdido';
end;
$$;

create or replace function ponte_deskcomm.fn_fu_esgotado_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
begin
    perform ponte_deskcomm.fn_encerrar_fu_esgotado(new.id);
    return null;
exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('fn_fu_esgotado_trigger', new.id, sqlstate, sqlerrm);
    return null;
end;
$$;

revoke all on function ponte_deskcomm.fn_encerrar_fu_esgotado(uuid) from public, anon, authenticated;

drop trigger if exists trg_ponte_fu_esgotado_encerra on public.followup_enrollments;
create trigger trg_ponte_fu_esgotado_encerra
    after update of status on public.followup_enrollments
    for each row
    when (new.status = 'completed' and new.outcome = 'exhausted'
          and old.status is distinct from 'completed')
    execute function ponte_deskcomm.fn_fu_esgotado_trigger();
