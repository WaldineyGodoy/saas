-- Termômetro do Jev no Deskcomm com a probabilidade, como no CRM (07/11/2026).
--
-- O CRM mostra "Morno · 35%" (faixa + probabilidade de fechar em 30 dias, de
-- leads.qualificacao.jev). O Deskcomm mostrava só `temp:morno`. O dono quer o mesmo
-- número lá, para ver na lista de conversas quem precisa de mais atenção.
--
-- Formato: `temp:<faixa> <pct>%`, com o pct arredondado de 5 em 5. O Deskcomm guarda
-- cada etiqueta pelo nome exato (organizations.settings.tags), então de 1 em 1 o
-- vocabulário ganharia uma entrada a cada reavaliação. Sem probabilidade, só a faixa.
-- A jev-temperatura grava assim a partir de agora (etiquetaTemp, mesma regra).
--
-- 1. Cor pela FAIXA (prefixo), não pelo nome exato: `temp:morno 35%` sai amarelo.
-- 2. fn_etiqueta_temp(faixa, prob): a regra em SQL, para o preenchimento abaixo.
-- 3. Cards que já têm temp: passam ao formato novo, com o número da última avaliação.
--    trg_ponte_card_temp_para_contato leva ao contato, como sempre.
-- 4. Vocabulário: tira as entradas temp:* que ninguém usa mais e colore as novas.

create or replace function ponte_deskcomm.fn_cor_da_etiqueta(p_tag text)
returns text
language sql
immutable
as $$
  select case
    when p_tag = 'agente:humano'      then '#6f6f6f'
    when p_tag like 'agente:%'        then '#00655a'
    when p_tag like 'anuncio:%'       then '#ffb224'
    when p_tag like 'fu:%'            then '#ab4aba'
    when p_tag like 'alerta:%'        then '#e5484d'
    when p_tag like 'temp:gelado%'    then '#0091ff'
    when p_tag like 'temp:frio%'      then '#3e63dd'
    when p_tag like 'temp:morno%'     then '#ffe629'
    when p_tag like 'temp:quente%'    then '#ffb224'
    when p_tag like 'temp:fechando%'  then '#cf3716'
  end
$$;

create or replace function ponte_deskcomm.fn_etiqueta_temp(p_faixa text, p_prob numeric)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(p_faixa), '') is null then null
    when p_prob is null then 'temp:' || p_faixa
    else 'temp:' || p_faixa || ' ' || greatest(0, least(100, round(p_prob * 20) * 5))::int || '%'
  end
$$;

-- 3. cards com temp: → formato novo
with novo as (
  select cl.id,
         ponte_deskcomm.fn_etiqueta_temp(l.qualificacao -> 'jev' ->> 'temperatura',
                                         (l.qualificacao -> 'jev' ->> 'probabilidade_fechamento_30d')::numeric) as etiqueta
    from ponte_deskcomm.vinculos v
    join crm_leads cl on cl.id = v.deskcomm_lead_id
    join leads l on l.id = v.b2w_lead_id
   where exists (select 1 from unnest(coalesce(cl.tags, '{}')) t where t like 'temp:%')
     and l.qualificacao -> 'jev' ->> 'temperatura' is not null
)
update crm_leads cl
   set tags = array_append(array(select t from unnest(coalesce(cl.tags, '{}')) t where t not like 'temp:%'), n.etiqueta)
  from novo n
 where cl.id = n.id
   and n.etiqueta is not null
   and not (n.etiqueta = any(coalesce(cl.tags, '{}')));

-- 4. vocabulário: fora as temp:* sem uso; as novas ganham cor
update organizations o
   set settings = jsonb_set(o.settings, '{tags}', coalesce((
         select jsonb_agg(e)
           from jsonb_array_elements(o.settings -> 'tags') e
          where lower(btrim(coalesce(e ->> 'tag', e #>> '{}'))) not like 'temp:%'
             or lower(btrim(coalesce(e ->> 'tag', e #>> '{}'))) in (
                  select lower(t) from (
                    select unnest(tags) t from contacts  where organization_id = o.id
                    union all select unnest(tags) from crm_leads where organization_id = o.id
                  ) s where t like 'temp:%')), '[]'::jsonb))
 where jsonb_typeof(o.settings -> 'tags') = 'array';

select ponte_deskcomm.colorir_etiquetas();
