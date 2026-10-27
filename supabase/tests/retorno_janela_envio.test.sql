-- Teste da trava da janela de envio (migration 20261027b_retorno_janela_envio.sql).
-- Rodar depois da migration, numa transação: termina em RAISE 'SANDBOX_OK' e desfaz tudo.

do $$
declare
    f   text := 'America/Sao_Paulo';
    v_org uuid := (select organization_id from public.cron_jobs limit 1);
    v_ct  uuid := (select contact_id from public.cron_jobs limit 1);
    v_id  uuid;
    j     record;
begin
    -- Próxima janela (seg 26/10/2026 a seg 02/11/2026; 31/10 sábado).
    assert ponte_deskcomm.fn_proxima_janela_envio(('2026-10-26 10:00' :: timestamp) at time zone f)
         = ('2026-10-26 10:00' :: timestamp) at time zone f, 'dentro da janela fica';
    assert ponte_deskcomm.fn_proxima_janela_envio(('2026-10-26 17:00' :: timestamp) at time zone f)
         = ('2026-10-26 17:00' :: timestamp) at time zone f, '17:00 ainda é janela';
    assert ponte_deskcomm.fn_proxima_janela_envio(('2026-10-26 20:30' :: timestamp) at time zone f)
         = ('2026-10-27 08:15' :: timestamp) at time zone f, 'noite vai para 08:15 do dia seguinte';
    assert ponte_deskcomm.fn_proxima_janela_envio(('2026-10-27 07:00' :: timestamp) at time zone f)
         = ('2026-10-27 08:15' :: timestamp) at time zone f, 'madrugada vai para 08:15 do mesmo dia';
    assert ponte_deskcomm.fn_proxima_janela_envio(('2026-10-30 18:00' :: timestamp) at time zone f)
         = ('2026-11-02 08:15' :: timestamp) at time zone f, 'sexta à noite vai para segunda';
    assert ponte_deskcomm.fn_proxima_janela_envio(('2026-10-31 10:00' :: timestamp) at time zone f)
         = ('2026-11-02 08:15' :: timestamp) at time zone f, 'sábado vai para segunda';

    -- Retorno do agente à noite: adiado, com nota no motivo.
    insert into public.cron_jobs (organization_id, contact_id, kind, job_kind, payload, next_run_at)
    values (v_org, v_ct, 'at', 'followup_turn',
            jsonb_build_object('reason', 'ver se olhou o link', 'promised_at', '2099-01-05T23:30:00Z'),
            ('2099-01-05 20:30' :: timestamp) at time zone f)
    returning id into v_id;
    select * into j from public.cron_jobs where id = v_id;
    assert j.next_run_at = ('2099-01-06 08:15' :: timestamp) at time zone f, 'retorno à noite adiado';
    assert j.payload->>'promised_at' = '2099-01-05T23:30:00Z', 'promised_at intacto';
    assert j.payload->>'reason' like 'ver se olhou o link (Retorno adiado%', 'nota no motivo';
    assert j.payload ? 'adiado_pela_janela_de', 'guarda o horário original';

    -- Retorno curto (link do contrato, 2 min) sai mesmo fora da janela.
    insert into public.cron_jobs (organization_id, contact_id, kind, job_kind, payload, next_run_at)
    values (v_org, v_ct, 'at', 'followup_turn',
            jsonb_build_object('reason', 'entregar o link do contrato', 'promised_at', now() + interval '2 minutes'),
            now() + interval '2 minutes')
    returning id into v_id;
    assert (select next_run_at from public.cron_jobs where id = v_id) <= now() + interval '2 minutes', 'retorno curto não muda';

    -- Retomada automática (node_id) não é tocada: o motor já aplica a janela.
    insert into public.cron_jobs (organization_id, contact_id, kind, job_kind, payload, next_run_at)
    values (v_org, v_ct, 'at', 'followup_turn',
            jsonb_build_object('node_id', 'tentativa_1', 'promised_at', 'x'),
            ('2099-01-05 20:30' :: timestamp) at time zone f)
    returning id into v_id;
    assert (select next_run_at from public.cron_jobs where id = v_id) = ('2099-01-05 20:30' :: timestamp) at time zone f,
        'retomada automática intacta';

    -- Gravações posteriores do motor no retorno adiado não somam outra nota.
    update public.cron_jobs set payload = payload || '{"x": 1}'
     where payload->>'reason' like 'ver se olhou o link%';
    assert (select count(*) from public.cron_jobs
             where payload->>'reason' like '%Retorno adiado%Retorno adiado%') = 0, 'nota não duplica';

    raise exception 'SANDBOX_OK';
end $$;
