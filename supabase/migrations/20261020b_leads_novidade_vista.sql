-- Aviso de lead novo no kanban de Leads.
--
-- Cada usuário guarda, por categoria (a tag do topo da página), até quando já
-- viu os leads. Lead criado depois dessa marca é "novo" para ele: a tag pulsa e
-- a coluna onde o lead está ganha a etiqueta NEW. Clicar na tag avança a marca.
--
-- É por usuário de propósito: o coordenador abrir a tag não pode apagar o aviso
-- do originador dono do lead.
--
-- `categoria` é o nome da tag sem '#' ('Investidor') ou '__sem_categoria__' para
-- lead sem nenhuma das tags do topo.

create table if not exists public.lead_novidade_vista (
    user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
    categoria  text        not null,
    visto_em   timestamptz not null,
    primary key (user_id, categoria)
);

alter table public.lead_novidade_vista enable row level security;

drop policy if exists lead_novidade_vista_proprio on public.lead_novidade_vista;
create policy lead_novidade_vista_proprio on public.lead_novidade_vista
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- A RPC abaixo é SECURITY INVOKER: quem chama precisa de INSERT/UPDATE, e a RLS
-- limita à própria linha. Os privilégios padrão do projeto dão tudo a todos.
revoke all on public.lead_novidade_vista from anon, authenticated;
grant select, insert, update on public.lead_novidade_vista to authenticated;

-- A marca avança até o `created_at` do lead mais recente que a tela mostrou, e
-- nunca recua. Usar now() marcaria como visto um lead que chegou entre o
-- carregamento da página e o clique, sem ninguém ter olhado para ele.
create or replace function public.fn_marcar_novidade_vista(p_categoria text, p_ate timestamptz)
returns void
language sql
security invoker
set search_path = public
as $$
    insert into public.lead_novidade_vista (user_id, categoria, visto_em)
    values (auth.uid(), p_categoria, p_ate)
    on conflict (user_id, categoria)
    do update set visto_em = greatest(public.lead_novidade_vista.visto_em, excluded.visto_em);
$$;

revoke all on function public.fn_marcar_novidade_vista(text, timestamptz) from public, anon;
grant execute on function public.fn_marcar_novidade_vista(text, timestamptz) to authenticated;

-- Lead que chega com a página aberta tem que aparecer sem recarregar. O Realtime
-- respeita a RLS de `leads`: cada um só recebe o que já pode ler.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
    ) then
        alter publication supabase_realtime add table public.leads;
    end if;
end $$;
