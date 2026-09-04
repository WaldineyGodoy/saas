-- ============================================================================
-- Enviador tambem sai do agendador do GitHub -- mas nao do runner
--
-- Ver 20260904b (cron do emissor) para o contexto da migracao de agendador.
--
-- O emissor virou Edge Function porque so faz HTTP. O enviador nao pode: ele
-- renderiza o demonstrativo com Chromium, e Edge Function nao roda navegador.
-- Redesenhar o PDF na mao (jsPDF, como em contratoBase.js) e possivel, mas
-- mudaria a aparencia de um documento que ja vai para o cliente -- risco de
-- regressao visual num artefato de cobranca, para consertar uma peca que nao
-- esta quebrada.
--
-- O que quebrou foi o AGENDADOR: o `schedule` do repositorio parou de disparar
-- por dias, sem aviso e sem rastro. O executor seguiu saudavel (push e disparo
-- manual funcionam). Entao so o agendamento muda de casa: o pg_cron chama o
-- workflow pela API do GitHub, e o Playwright continua onde ele roda.
--
-- Fica registrado o custo desta escolha: a entrega continua dependendo do
-- runner do GitHub e de um token que expira. O emissor nao depende de nada
-- disso; o enviador ainda depende.
-- ============================================================================

create or replace function public.fn_disparar_enviador(
    p_aplicar boolean default false,
    p_limite  integer default 30
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
        raise exception 'Segredo cron:github_token ausente no Vault. Sem ele o pg_cron nao consegue acionar o workflow do enviador.';
    end if;

    -- `workflow_dispatch` exige os inputs como STRING, inclusive os booleanos.
    -- Mandar true/false JSON aqui devolve 422 com mensagem obscura.
    select net.http_post(
        url  := 'https://api.github.com/repos/WaldineyGodoy/saas/actions/workflows/enviador.yml/dispatches',
        body := jsonb_build_object(
            'ref', 'main',
            'inputs', jsonb_build_object(
                'simular', case when p_aplicar then 'false' else 'true' end,
                'limite',  p_limite::text
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

    -- O disparo em si vira rastro. O resultado do ENVIO e gravado pelo proprio
    -- enviador em robo_execucoes; aqui fica so a prova de que foi acionado --
    -- que e exatamente o que faltou no dia em que nada saiu.
    insert into robo_execucoes (robo, aplicou, detalhe)
    values ('enviador-disparo', p_aplicar,
            jsonb_build_object('origem', 'pg_cron', 'http_request_id', v_req));

    return v_req;
end;
$fn$;

revoke execute on function public.fn_disparar_enviador(boolean, integer) from anon, authenticated;

select cron.unschedule('enviador-diario')
where exists (select 1 from cron.job where jobname = 'enviador-diario');

select cron.schedule(
    'enviador-diario',
    '23 11 * * *',
    $cron$ select public.fn_disparar_enviador(p_aplicar => true) $cron$
);
