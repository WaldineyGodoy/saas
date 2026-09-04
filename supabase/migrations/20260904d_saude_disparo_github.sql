-- ============================================================================
-- Token vencido nao pode virar silencio
--
-- O disparo do enviador vai para a API do GitHub e o pg_net responde depois. Se
-- o token for revogado ou vencer, a chamada devolve 401 e a entrega para -- sem
-- erro nenhum no banco, porque a funcao `fn_disparar_enviador` disparou
-- normalmente e nao tem como saber o desfecho.
--
-- Esse e exatamente o formato da falha de 04/09/2026: tudo parecia certo, nada
-- saiu, e nao havia onde olhar. Um dia de faturas se perdeu assim.
--
-- `fn_saude_robos` passa a correlacionar o `http_request_id` gravado no disparo
-- com a resposta em `net._http_response`. A pergunta "o agendamento esta vivo?"
-- passa a incluir "e o GitHub aceitou?".
-- ============================================================================

drop function if exists public.fn_saude_robos();

create function public.fn_saude_robos()
returns table (
    robo            text,
    ultima_execucao timestamptz,
    horas_atras     numeric,
    aplicou         boolean,
    processados     integer,
    sucesso         integer,
    falha           integer,
    erro            text,
    http_disparo    text
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
        r.aplicou, r.processados, r.sucesso, r.falha, r.erro,
        case
            when r.detalhe->>'http_request_id' is null then null
            else coalesce((
                select case
                    when resp.status_code between 200 and 299
                        then 'ok (' || resp.status_code || ')'
                    else 'FALHOU ' || resp.status_code || ' — ' || left(coalesce(resp.content,''), 120)
                end
                from net._http_response resp
                where resp.id = (r.detalhe->>'http_request_id')::bigint
            ), 'sem resposta registrada')
        end
    from robo_execucoes r
    order by r.robo, r.iniciado_em desc;
$$;

revoke execute on function public.fn_saude_robos() from anon;
