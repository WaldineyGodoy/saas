-- Temperatura que não aparecia e temperatura sem cor (07/11/2026, correção do dono).
--
-- 1. Cards com a etiqueta de interesse e SEM temperatura (ex.: lead que falou com a
--    Bel e foi passado ao funil do produto). A fila do Jev pedia 3 mensagens do
--    cliente DESDE A CRIAÇÃO DO CARD do produto; o card nasce na passagem, então
--    quem já tinha conversado na recepção ficava abaixo de 3 e nunca era avaliado
--    (23 cards abertos). Agora conta a conversa inteira do contato. O mínimo de 3
--    continua: com 1 ou 2 mensagens não há o que avaliar.
--
-- 2. Temperatura sem cor. A cor mora no vocabulário (organizations.settings.tags,
--    {tag, cor} por nome exato), e colorir_etiquetas só a acrescenta a cada 10 min:
--    cada "quente 45%" nova nascia cinza até a rodada seguinte. O vocabulário passa
--    a ter de antemão as 105 combinações (5 faixas × 0..100% de 5 em 5) e as 5
--    faixas sem número, todas na cor da faixa.

create or replace function public.ponte_deskcomm_para_avaliar(p_limite integer default 25)
returns table(deskcomm_lead_id uuid, b2w_lead_id uuid, contact_id uuid, organization_id uuid,
              categoria text, categoria_nome text, etapa text, ultima_entrada timestamptz)
language sql
stable security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
  select v.deskcomm_lead_id, v.b2w_lead_id, v.contact_id, v.organization_id,
         v.categoria, cat.nome, st.name, conv.ultima
    from ponte_deskcomm.vinculos v
    join crm_leads cl on cl.id = v.deskcomm_lead_id and cl.status = 'open'
    join leads l on l.id = v.b2w_lead_id
    join ponte_deskcomm.categorias cat on cat.slug = v.categoria and cat.tag_b2w is not null
    left join crm_stages st on st.id = cl.stage_id
    join lateral (
      select max(c.last_inbound_at) as ultima from conversations c
       where c.contact_id = v.contact_id and c.organization_id = v.organization_id
    ) conv on conv.ultima is not null
   where conv.ultima > coalesce((l.qualificacao->'jev'->>'avaliado_em')::timestamptz, '-infinity')
     and (select count(*) from messages m
           where m.contact_id = v.contact_id and m.organization_id = v.organization_id
             and m.direction = 'inbound') >= 3
   order by conv.ultima desc
   limit greatest(1, least(p_limite, 100))
$$;

-- vocabulário com todas as temperaturas possíveis, já coloridas
with todas as (
  select f.faixa || coalesce(' ' || p.pct || '%', '') as tag
    from unnest(array['gelado','frio','morno','quente','fechando']) f(faixa)
   cross join (select null::int as pct union all select generate_series(0, 100, 5)) p
)
update organizations o
   set settings = jsonb_set(coalesce(o.settings, '{}'::jsonb), '{tags}',
         coalesce((select jsonb_agg(e) from jsonb_array_elements(
                     case when jsonb_typeof(o.settings -> 'tags') = 'array' then o.settings -> 'tags' else '[]'::jsonb end) e
                    where not ponte_deskcomm.eh_etiqueta_temp(lower(btrim(coalesce(e ->> 'tag', e #>> '{}'))))), '[]'::jsonb)
         || (select jsonb_agg(jsonb_build_object('tag', t.tag, 'cor', ponte_deskcomm.fn_cor_da_etiqueta(t.tag)) order by t.tag) from todas t),
         true);
