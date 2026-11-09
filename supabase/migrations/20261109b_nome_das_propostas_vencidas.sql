-- Aplicação única (09/11/2026, pedido do dono): as propostas de nome feitas por
-- agente que venceram sem ninguém aprovar, antes da ponte 20261109a.
-- Só a proposta mais recente de cada contato, e só se o contato continua sem nome
-- e não tem outra proposta de nome pendente ou aceita. A proposta volta a
-- 'pending' e passa pela mesma ponte (grava o nome, a base legal, a auditoria e o
-- título dos cards abertos). Resultado em 09/11: 7 aceitas.

with alvo as (
  select p.id from contact_field_proposals p join contacts c on c.id = p.contact_id
   where p.campo = 'name' and p.status = 'expired' and p.proposed_by_agent_id is not null
     and nullif(btrim(coalesce(c.name, '')), '') is null
     and not exists (select 1 from contact_field_proposals q where q.contact_id = p.contact_id and q.campo = 'name' and q.status in ('pending', 'accepted'))
     and p.proposed_at = (select max(r.proposed_at) from contact_field_proposals r
                           where r.contact_id = p.contact_id and r.campo = 'name' and r.proposed_by_agent_id is not null)
)
update contact_field_proposals set status = 'pending', decided_at = null, updated_at = now()
 where id in (select id from alvo);

select ponte_deskcomm.fn_aceitar_nome_do_lead(p.id)
  from contact_field_proposals p
 where p.campo = 'name' and p.status = 'pending' and p.proposed_by_agent_id is not null;
