-- Nome dito pelo lead vale no lugar do nome do perfil do WhatsApp (09/11/2026, pedido do dono).
--
-- No Deskcomm, o nome que o agente ouve vira PROPOSTA (contact_field_proposals,
-- campo 'name') e só vale quando alguém aprova na tela. Ninguém aprovava: todas as
-- propostas de nome feitas por agentes venceram ou estavam pendentes, e o contato
-- seguia sem nome. O card e o resumo do handoff mostravam o nome do perfil.
--
-- Esta ponte aceita sozinha a proposta de NOME feita por AGENTE quando:
--   - o contato está sem nome (name vazio) ou com o nome igual ao do perfil (display_name);
--   - o contato não foi anonimizado.
-- Nome digitado por uma pessoa nunca é sobrescrito. Os outros campos (e-mail,
-- telefone, nascimento) continuam pedindo aprovação, como o Deskcomm manda.
--
-- Faz o mesmo que a aprovação pela tela:
--   - grava o nome no contato;
--   - grava a base legal (consent.transactional), no formato que a tela usa;
--   - marca a proposta como 'accepted';
--   - registra 'contact.field_confirmed' em api_audit_log, com o valor antigo e o novo.
-- Também troca o título dos cards ABERTOS do contato que ainda mostram o nome do
-- perfil (ou estão sem título).

create or replace function ponte_deskcomm.fn_aceitar_nome_do_lead(p_proposta uuid)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  c record;
  v_nome text;
begin
  select * into p from contact_field_proposals where id = p_proposta for update;
  if not found then return 'sem_proposta'; end if;
  if p.campo <> 'name' or p.proposed_by_agent_id is null or p.status <> 'pending' then
    return 'fora_da_regra';
  end if;

  v_nome := btrim(regexp_replace(coalesce(p.valor_proposto, ''), '\s+', ' ', 'g'));
  if length(v_nome) < 2 then return 'nome_vazio'; end if;

  select * into c from contacts where id = p.contact_id for update;
  if not found then return 'sem_contato'; end if;
  if coalesce(c.is_anonymized, false) then return 'anonimizado'; end if;
  if nullif(btrim(coalesce(c.name, '')), '') is not null
     and btrim(c.name) is distinct from btrim(coalesce(c.display_name, '')) then
    return 'ja_tem_nome';
  end if;

  update contacts
     set name = v_nome,
         consent = coalesce(consent, '{}'::jsonb) || jsonb_build_object('transactional', jsonb_build_object(
           'granted', true,
           'granted_at', to_jsonb(now()),
           'source', 'informado pelo titular em atendimento; aceito pela ponte do nome (sem revisão humana)')),
         updated_at = now()
   where id = c.id;

  update crm_leads l
     set title = v_nome, updated_at = now()
   where l.contact_id = c.id and l.status = 'open'
     and (nullif(btrim(coalesce(l.title, '')), '') is null
          or btrim(l.title) = btrim(coalesce(c.display_name, ''))
          or btrim(l.title) = btrim(coalesce(c.name, '')));

  update contact_field_proposals
     set status = 'accepted', decided_at = now(), updated_at = now()
   where id = p.id;

  insert into api_audit_log (action, organization_id, resource_type, resource_id, metadata, bypassed_rls)
  values ('contact.field_confirmed', p.organization_id, 'contact', c.id,
          jsonb_build_object(
            'proposal_id', p.id, 'campo', 'name',
            'old_value', c.name, 'new_value', v_nome,
            'decidido_por', 'ponte_deskcomm.fn_aceitar_nome_do_lead',
            'legal_basis', 'L-05 transactional (dado informado pelo titular em atendimento iniciado por ele)'),
          true);

  return 'aceita';
end;
$$;

revoke all on function ponte_deskcomm.fn_aceitar_nome_do_lead(uuid) from public, anon, authenticated;

-- Gatilho: a proposta nova de nome feita por agente é aceita no mesmo ato.
-- Erro aqui nunca pode derrubar o turno do agente: a proposta fica pendente, como antes.
create or replace function ponte_deskcomm.trg_aceitar_nome_do_lead()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.campo = 'name' and new.proposed_by_agent_id is not null and new.status = 'pending' then
    begin
      perform ponte_deskcomm.fn_aceitar_nome_do_lead(new.id);
    exception when others then
      raise warning 'ponte do nome: proposta % ficou pendente: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_aceitar_nome_do_lead on public.contact_field_proposals;
create trigger trg_aceitar_nome_do_lead
  after insert on public.contact_field_proposals
  for each row execute function ponte_deskcomm.trg_aceitar_nome_do_lead();

-- As propostas de nome que já estão pendentes.
select p.id, ponte_deskcomm.fn_aceitar_nome_do_lead(p.id) as resultado
  from contact_field_proposals p
 where p.campo = 'name' and p.status = 'pending' and p.proposed_by_agent_id is not null;
