-- ============================================================================
-- Registro de execucao dos robos
--
-- Em 04/09/2026 o emissor deveria ter emitido R$ 19.776,25 as 10:00 UTC e o
-- enviador entregado as 11:00. Nada aconteceu. E foi impossivel responder a
-- pergunta mais basica -- "o robo chegou a rodar?" -- sem acesso ao GitHub
-- Actions, porque nenhum deles escrevia nada no banco ao rodar.
--
-- Robo que cria cobranca e nao deixa rastro e pior que robo que falha: falha
-- ruidosa a gente conserta, silenciosa a gente descobre pelo cliente.
--
-- A propriedade que importa aqui: este registro e gravado com SERVICE_ROLE, que
-- e independente do login do robo. Se o emissor morrer autenticando -- que era
-- justamente uma das duas hipoteses que nao davam para separar -- a linha de
-- inicio ja esta gravada e o erro vai junto. A pergunta "rodou?" passa a ter
-- resposta no banco, sem depender de ler log de CI.
-- ============================================================================

create table if not exists public.robo_execucoes (
    id            uuid primary key default gen_random_uuid(),
    robo          text        not null,
    iniciado_em   timestamptz not null default now(),
    concluido_em  timestamptz,
    aplicou       boolean     not null default false,
    processados   integer     not null default 0,
    sucesso       integer     not null default 0,
    falha         integer     not null default 0,
    bloqueados    integer     not null default 0,
    erro          text,
    detalhe       jsonb
);

comment on table public.robo_execucoes is
    'Uma linha por execucao de robo. Gravada com service_role, independente do login do proprio robo, para que falha de autenticacao tambem deixe rastro.';

create index if not exists robo_execucoes_robo_inicio_idx
    on public.robo_execucoes (robo, iniciado_em desc);

alter table public.robo_execucoes enable row level security;

drop policy if exists robo_execucoes_leitura on public.robo_execucoes;
create policy robo_execucoes_leitura on public.robo_execucoes
    for select to authenticated using (true);

-- Escrita so pelo service_role (que ignora RLS). Nenhuma policy de insert:
-- usuario logado le o historico, nao inventa execucao.

-- ---------------------------------------------------------------------------
-- Leitura de conveniencia: a ultima execucao de cada robo e ha quanto tempo.
-- Serve para a pergunta "o cron esta vivo?" sem abrir o GitHub.
-- ---------------------------------------------------------------------------
create or replace function public.fn_saude_robos()
returns table (
    robo            text,
    ultima_execucao timestamptz,
    horas_atras     numeric,
    aplicou         boolean,
    processados     integer,
    sucesso         integer,
    falha           integer,
    erro            text
)
language sql
stable
security definer
set search_path = public
as $$
    select distinct on (r.robo)
        r.robo,
        r.iniciado_em,
        round(extract(epoch from (now() - r.iniciado_em)) / 3600.0, 1),
        r.aplicou, r.processados, r.sucesso, r.falha, r.erro
    from robo_execucoes r
    order by r.robo, r.iniciado_em desc;
$$;

revoke execute on function public.fn_saude_robos() from anon;
