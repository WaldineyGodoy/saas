-- ============================================================================
-- Emissao agendada sai do GitHub Actions e passa para o pg_cron
--
-- Em 04/09/2026 o `schedule` do repositorio parou de disparar. Nenhum workflow,
-- nenhum agendamento, por dias -- enquanto os gatilhos de push seguiam
-- funcionando. Ninguem percebeu ate faltarem R$ 19.776,25 em boletos que
-- deveriam ter saido, e nem de dentro do repositorio deu para diagnosticar:
-- sem acesso a aba Actions, "o cron nao disparou" e "disparou e morreu" eram
-- indistinguiveis.
--
-- Pendurar a unica etapa do pipeline que cria dinheiro num agendador que some
-- sem avisar, fora do nosso alcance, e fragil demais. Aqui o agendamento mora
-- no mesmo banco que ja e fonte de verdade do resto: se parar, a mesma conexao
-- que emite e a que investiga (`cron.job_run_details`, `robo_execucoes`).
--
-- O GitHub continua existindo como disparo MANUAL, de proposito -- ter duas
-- portas para a mesma acao e barato, e a idempotencia (`asaas_payment_id`) faz
-- a segunda nao cobrar de novo.
--
-- ---------------------------------------------------------------------------
-- Sobre os segredos
--
-- O token do emissor nasceu dentro do banco (`gen_random_bytes`), mora no Vault
-- e e lido dos DOIS lados -- daqui para montar o cabecalho, e da Edge Function
-- para conferir. Nenhuma pessoa e nenhum agente precisou ver o valor.
--
-- A chave anon tambem vai para o Vault. Ela e publica (viaja no bundle do
-- front), entao nao e segredo de verdade; esta ali so para o comando do cron
-- nao ter literal nenhum e a rotacao ser um update.
-- ============================================================================

do $$
begin
    if not exists (select 1 from vault.secrets where name = 'cron:anon_key') then
        perform vault.create_secret(
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYnlzdnhubmh3dnZ6aGZ0b21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTcwNzcsImV4cCI6MjA4NDIzMzA3N30.omP9h4ZqFbDX4FMO_lkd5Q3Iv99xgbs5bVz6beIpqfo',
            'cron:anon_key',
            'Chave anon (publica) usada como credencial de gateway pelo cron.'
        );
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- Disparo do emissor.
--
-- Existe como funcao, e nao como comando solto dentro do cron, por dois
-- motivos: o comando agendado fica legivel (uma linha), e uma pessoa pode
-- disparar a emissao pelo SQL sem depender do GitHub -- que foi exatamente o
-- que faltou no dia em que o agendamento sumiu.
--
-- `p_aplicar => false` ensaia: percorre a fila, reconfere, audita e nao cria
-- cobranca nenhuma.
-- ---------------------------------------------------------------------------
create or replace function public.fn_disparar_emissor(
    p_aplicar boolean default false,
    p_limite  integer default 10,
    p_teto    numeric default 50000
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_token text;
    v_anon  text;
    v_req   bigint;
begin
    select decrypted_secret into v_token from vault.decrypted_secrets where name = 'cron:emissor_token';
    select decrypted_secret into v_anon  from vault.decrypted_secrets where name = 'cron:anon_key';

    if v_token is null then
        raise exception 'Segredo cron:emissor_token ausente no Vault.';
    end if;

    select net.http_post(
        url     := 'https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/emissor',
        body    := jsonb_build_object('aplicar', p_aplicar, 'limite', p_limite, 'teto', p_teto),
        headers := jsonb_build_object(
            'Content-Type',     'application/json',
            'Authorization',    'Bearer ' || v_anon,
            'x-emissor-token',  v_token
        ),
        timeout_milliseconds := 120000
    ) into v_req;

    return v_req;
end;
$$;

-- Só o service_role dispara. Usuario logado emite pela tela, que tem o
-- requireAdmin; aqui nao ha rosto para auditar.
revoke execute on function public.fn_disparar_emissor(boolean, integer, numeric) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Agendamento: 10:17 UTC (07:17 BRT), entre o faturista e o enviador.
-- Fora do topo da hora de proposito -- e a faixa em que agendador congestiona.
-- ---------------------------------------------------------------------------
select cron.unschedule('emissor-diario')
where exists (select 1 from cron.job where jobname = 'emissor-diario');

select cron.schedule(
    'emissor-diario',
    '17 10 * * *',
    $cron$ select public.fn_disparar_emissor(p_aplicar => true) $cron$
);
