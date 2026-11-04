-- Padroniza etapas do Deskcomm e status do CRM B2W (03/11/2026, aprovado pelo dono).
-- Um nome por etapa, igual nos dois lados:
--
--   Padrão            | Deskcomm (8 funis)                         | CRM B2W (leads.status)
--   Sem Interação     | Sem Interação (era Novo contato)           | sem_interacao
--   Qualificando      | Qualificando (Recepção: Já respondi +      | qualificando (novo, 20261103d)
--                     |   Entendendo a necessidade)                |
--   Simulação         | Simulação (era Simulação / Proposta env.)  | simulacao
--   Negociação        | Negociação                                 | negociacao
--   Reunião Agendada  | Reunião Agendada                           | reuniao_agendada
--   Contrato Enviado  | Contrato Enviado + Pendência de adesão     | contrato_enviado
--   Fechou            | Fechou                                     | ativacao -> ativo -> pago (só CRM)
--   Negócio Perdido   | Negócio Perdido (era Não fechou)           | negocio_perdido
--   (trabalho)        | Aguardando resposta (era Sem resposta)     | não muda o status
--
-- Os slugs das etapas NÃO mudam: as etiquetas fu:* e os fluxos de retomada usam o
-- slug (grupo_fu_da_etapa) e o id da etapa, não o nome.

-- 1. Nomes e descrições das etapas
update crm_stages set name = 'Sem Interação',
       description = coalesce(description, 'Cliente chegou e ainda não respondeu ao agente.')
 where name = 'Novo contato';
update crm_stages set name = 'Simulação' where name = 'Simulação / Proposta enviada';
update crm_stages set name = 'Reunião Agendada' where name in ('Reunião agendada', 'Reunião Agendada/Apresentação');
update crm_stages set name = 'Contrato Enviado' where name = 'Contrato enviado';
update crm_stages set name = 'Negócio Perdido' where name = 'Não fechou';
update crm_stages set name = 'Aguardando resposta',
       description = 'Agente respondeu e aguarda o cliente. Não é perda: o card segue no funil.'
 where name = 'Sem resposta';

-- 2. Recepção: Já respondi + Entendendo a necessidade -> Qualificando
update crm_leads l set stage_id = jr.id, stage_changed_at = now(), updated_at = now()
  from crm_stages en
  join crm_stages jr on jr.pipeline_id = en.pipeline_id and jr.name = 'Já respondi'
 where en.name = 'Entendendo a necessidade' and l.stage_id = en.id;
update crm_stages set is_archived = true where name = 'Entendendo a necessidade';
update crm_stages set name = 'Qualificando',
       description = coalesce(description, 'Cliente respondeu e o agente está entendendo a necessidade.'),
       agent_stage_hint = 'qualifying'
 where name = 'Já respondi';

-- 3. Tradução etapa -> status do CRM (primeiro padrão que casar, por prioridade)
delete from ponte_deskcomm.etapa_status;
insert into ponte_deskcomm.etapa_status (padrao, status_b2w, prioridade) values
    ('%contrato%',          'contrato_enviado', 10),
    ('%pend%ncia de ades%', 'contrato_enviado', 11),
    ('%reuni%',             'reuniao_agendada', 20),
    ('%negocia%',           'negociacao',       30),
    ('%simula%',            'simulacao',        40),
    ('%qualifica%',         'qualificando',     50),
    ('%sem intera%',        'sem_interacao',    60);
-- "Aguardando resposta" não casa nenhum padrão: o status do CRM fica como estava.

delete from ponte_deskcomm.status_etapa;
insert into ponte_deskcomm.status_etapa (status_b2w, etapa_padrao) values
    ('sem_interacao',    '%sem intera%'),
    ('qualificando',     '%qualifica%'),
    ('simulacao',        '%simula%'),
    ('negociacao',       '%negocia%'),
    ('reuniao_agendada', '%reuni%'),
    ('contrato_enviado', '%contrato%'),
    ('ativacao',         'fechou'),
    ('ativo',            'fechou'),
    ('pago',             'fechou'),
    ('negocio_perdido',  '%perdido%');

-- 4. Ordem do funil no CRM
create or replace function public.fn_lead_status_ordem(p_status lead_status)
returns integer language sql immutable as $$
    select coalesce(array_position(array[
        'negocio_perdido', 'sem_interacao', 'indicado', 'qualificando', 'simulacao', 'convite_enviado',
        'negociacao', 'reuniao_agendada', 'contrato_enviado', 'ativacao', 'ativo', 'pago'
    ], p_status::text), 0);
$$;

-- 5. Ponte card -> lead: a Recepção também segue a tabela (antes ficava sempre em
--    Sem Interação), e lead novo nasce em Sem Interação quando a etapa não traduz.
create or replace function ponte_deskcomm.fn_card_para_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $function$
declare
  v_cat      ponte_deskcomm.categorias%rowtype;
  v_contato  record;
  v_fone     text;
  v_status   public.lead_status;
  v_lead_id  uuid;
begin
  if coalesce(current_setting('ponte.origem', true), '') = 'b2w' then
    return new;
  end if;

  begin
    select * into v_cat from ponte_deskcomm.categorias
     where pipeline_id = new.pipeline_id and ativa;
    if not found then
      return new;
    end if;

    if new.status = 'lost' and new.lost_reason = 'moved_to_another_pipeline' then
      return new;
    end if;

    select c.name, c.display_name, c.email, c.phone_number, c.is_personal, c.is_anonymized, c.tags
      into v_contato
      from contacts c where c.id = new.contact_id;
    if not found or v_contato.is_personal or v_contato.is_anonymized
       or 'nao_lead' = any(coalesce(v_contato.tags, '{}')) then
      return new;
    end if;

    v_fone   := ponte_deskcomm.fn_telefone(v_contato.phone_number);
    v_status := ponte_deskcomm.fn_status_da_etapa(new.stage_id);

    select b2w_lead_id into v_lead_id from ponte_deskcomm.vinculos
     where deskcomm_lead_id = new.id;

    if v_lead_id is null and v_fone is not null then
      select l.id into v_lead_id from leads l
       where ponte_deskcomm.fn_telefone(l.phone) = v_fone
         and l.arquivado_em is null
       order by l.updated_at desc nulls last
       limit 1;
    end if;

    perform set_config('ponte.origem', 'deskcomm', true);

    if v_lead_id is null then
      insert into leads (name, phone, email, status, tags)
      values (
        coalesce(nullif(trim(v_contato.name), ''), nullif(trim(v_contato.display_name), ''), new.title),
        v_fone,
        v_contato.email,
        coalesce(v_status, 'sem_interacao'),
        case when v_cat.tag_b2w is null then '{}'::text[] else array[v_cat.tag_b2w] end
      )
      returning id into v_lead_id;
    else
      update leads l set
        tags   = case when v_cat.tag_b2w is null or v_cat.tag_b2w = any(coalesce(l.tags, '{}')) then l.tags
                      else array_append(coalesce(l.tags, '{}'), v_cat.tag_b2w) end,
        status = case when l.status in ('ativacao', 'ativo', 'pago') then l.status
                      else coalesce(v_status, l.status) end,
        email  = coalesce(l.email, v_contato.email),
        updated_at = now()
      where l.id = v_lead_id
        and (tg_op = 'INSERT'
             or new.stage_id is distinct from old.stage_id
             or new.pipeline_id is distinct from old.pipeline_id
             or (v_cat.tag_b2w is not null and not (v_cat.tag_b2w = any(coalesce(l.tags, '{}')))));
    end if;

    insert into ponte_deskcomm.vinculos (deskcomm_lead_id, b2w_lead_id, contact_id, organization_id, categoria)
    values (new.id, v_lead_id, new.contact_id, new.organization_id, v_cat.slug)
    on conflict (deskcomm_lead_id) do update
      set b2w_lead_id = excluded.b2w_lead_id,
          categoria   = excluded.categoria,
          atualizado_em = now();

    perform set_config('ponte.origem', '', true);
  exception when others then
    perform set_config('ponte.origem', '', true);
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('fn_card_para_lead', new.id, sqlstate, sqlerrm);
  end;

  return new;
end
$function$;

-- 6. Regra da sessão da Bel (retomada esgotada) seguia o nome antigo
create or replace function ponte_deskcomm.perder_por_retomada(p_contact uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $function$
declare
  v_card record;
  v_n    integer := 0;
begin
  for v_card in
    select d.id, ls.id as lost_stage
      from crm_leads d
      join crm_stages s  on s.id = d.stage_id and lower(s.name) = 'aguardando resposta'
      join crm_pipelines p on p.id = d.pipeline_id and p.name = 'Recepção'
      join lateral (select x.id from crm_stages x
                     where x.pipeline_id = d.pipeline_id and x.is_lost and not x.is_archived
                     order by x.position limit 1) ls on true
     where d.contact_id = p_contact and d.status = 'open'
  loop
    update crm_leads
       set stage_id = v_card.lost_stage, status = 'lost', lost_reason = 'no_response', closed_at = now()
     where id = v_card.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
