-- Aviso de lead novo: a marca de visto passa a ser por lead.
--
-- A 20261020b guardava, por categoria, até quando o usuário tinha visto. Com
-- isso só o clique na tag apagava o aviso: o filtro de status não sabe a que
-- categoria marcar, e marcar a categoria inteira apagaria leads que estão em
-- outra coluna e ninguém viu. Agora cada lead visto vira uma linha, e o NEW some
-- assim que ele aparece por um clique na tag, no filtro de status ou ao abrir.
--
-- Continua por usuário: o coordenador ver o lead não apaga o aviso do
-- originador dono dele.

create table if not exists public.lead_visto (
    user_id   uuid        not null default auth.uid() references auth.users(id) on delete cascade,
    lead_id   uuid        not null references public.leads(id) on delete cascade,
    visto_em  timestamptz not null default now(),
    primary key (user_id, lead_id)
);

alter table public.lead_visto enable row level security;

drop policy if exists lead_visto_proprio on public.lead_visto;
create policy lead_visto_proprio on public.lead_visto
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- A RPC abaixo é SECURITY INVOKER: quem chama precisa de INSERT, e a RLS limita
-- à própria linha. Os privilégios padrão do projeto dão tudo a todos.
revoke all on public.lead_visto from anon, authenticated;
grant select, insert on public.lead_visto to authenticated;

create or replace function public.fn_marcar_leads_vistos(p_leads uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
    insert into public.lead_visto (user_id, lead_id)
    select auth.uid(), l from unnest(p_leads) as l
    on conflict (user_id, lead_id) do nothing;
$$;

revoke all on function public.fn_marcar_leads_vistos(uuid[]) from public, anon;
grant execute on function public.fn_marcar_leads_vistos(uuid[]) to authenticated;

-- Leva o que já foi visto pela marca por categoria, para nenhum aviso apagado
-- voltar. Mesma regra da tela: a categoria é a tag sem '#' e sem caixa, e
-- '__sem_categoria__' é o lead sem nenhuma das tags do topo.
insert into public.lead_visto (user_id, lead_id, visto_em)
select distinct on (v.user_id, l.id) v.user_id, l.id, v.visto_em
from public.lead_novidade_vista v
join public.leads l on l.created_at <= v.visto_em
where l.created_at > '2026-10-20T03:00:00Z'
  and (
    exists (
        select 1 from unnest(coalesce(l.tags, '{}')) t
        where lower(trim(leading '#' from trim(t))) = lower(v.categoria)
    )
    or (
        v.categoria = '__sem_categoria__'
        and not exists (
            select 1 from unnest(coalesce(l.tags, '{}')) t
            where lower(trim(leading '#' from trim(t))) in (
                'embaixador', 'energia por assinatura', 'investidor', 'eletropostos',
                'cotas', 'consorcio', 'financiamento', 'arrendamento de area',
                'locação de vagas', 'comercializadora'
            )
        )
    )
  )
on conflict (user_id, lead_id) do nothing;

-- `lead_novidade_vista` e `fn_marcar_novidade_vista` ficam até todo mundo
-- recarregar a página: o bundle anterior ainda chama a RPC.
