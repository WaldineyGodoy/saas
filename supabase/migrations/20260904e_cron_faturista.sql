-- ============================================================================
-- Faturista tambem sai do agendador do GitHub -- e e o mais urgente dos tres
--
-- Ver 20260904b (emissor) e 20260904c (enviador). Este e o caso que mais doeu:
-- o faturista ficou 2 dias e meio sem rodar e ninguem percebeu. Sem leitura
-- nova, o emissor nao tem ciclo para fechar e o enviador nao tem o que
-- entregar -- a falha do primeiro robo esteriliza os outros dois, em silencio.
--
-- Como o enviador, ele nao vira Edge Function: o Chromium precisa de Xvfb e
-- `headless: false` para passar pelo WAF (Akamai) da Neoenergia. So o
-- agendamento muda de casa.
--
-- 08:07 UTC: antes do emissor (10:17) e do enviador (11:23), com folga para os
-- 45 minutos de timeout do workflow. Fora do topo da hora, como os outros.
-- ============================================================================

create or replace function public.fn_disparar_faturista(
    p_target_days text default ''
) returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_token text;
    v_req   bigint;
begin
    select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'cron:github_token';

    if v_token is null then
        raise exception 'Segredo cron:github_token ausente no Vault. Sem ele o pg_cron nao consegue acionar o workflow do faturista.';
    end if;

    -- Alvo vazio = o faturista decide sozinho pelo calendario de leituras, que
    -- e o comportamento diario. `target_days` serve para reprocessar um dia ou
    -- um mes especifico na mao.
    select net.http_post(
        url  := 'https://api.github.com/repos/WaldineyGodoy/saas/actions/workflows/scraper.yml/dispatches',
        body := jsonb_build_object(
            'ref', 'main',
            'inputs', jsonb_build_object(
                'target_days', coalesce(p_target_days, ''),
                'reason',      'pg_cron'
            )
        ),
        headers := jsonb_build_object(
            'Content-Type',          'application/json',
            'Accept',                'application/vnd.github+json',
            'X-GitHub-Api-Version',  '2022-11-28',
            'User-Agent',            'b2w-pg-cron',
            'Authorization',         'Bearer ' || v_token
        ),
        timeout_milliseconds := 30000
    ) into v_req;

    insert into robo_execucoes (robo, aplicou, detalhe)
    values ('faturista-disparo', true,
            jsonb_build_object('origem', 'pg_cron', 'http_request_id', v_req,
                               'target_days', coalesce(p_target_days, '')));

    return v_req;
end;
$fn$;

revoke execute on function public.fn_disparar_faturista(text) from anon, authenticated;

select cron.unschedule('faturista-diario')
where exists (select 1 from cron.job where jobname = 'faturista-diario');

select cron.schedule(
    'faturista-diario',
    '7 8 * * *',
    $cron$ select public.fn_disparar_faturista() $cron$
);
