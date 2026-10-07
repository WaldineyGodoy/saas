-- Reenvio SO por WhatsApp de fatura ja entregue por e-mail.
--
-- Em 03/10/2026 a instancia da Evolution caiu (codigo 401) e os boletos da
-- Guanabara sairam so por e-mail. O enviador nao tinha como mandar o WhatsApp
-- depois: `fatura_enviada_em` tira a fatura da fila e reenviar pela fila
-- repetiria o e-mail. Estas funcoes servem ao modo `enviador.js --so-whatsapp`.

-- Itens no mesmo formato de fn_fila_envio_faturas, mas SO os ids pedidos e SO
-- os que ja foram entregues sem WhatsApp. Lista explicita de proposito: uma
-- queda do WhatsApp nao pode virar reenvio em massa de tudo que falhou.
create or replace function public.fn_itens_reenvio_whatsapp(p_ids uuid[])
returns table(tipo text, id uuid, subscriber_id uuid, subscriber_name text, subscriber_email text,
              subscriber_phone text, referencia text, vencimento date, valor numeric, boleto_url text,
              invoice_ids uuid[], tentativas integer, impedimento text)
language sql stable security definer set search_path to 'public'
as $$
    (
    select 'consolidada'::text, ci.id, s.id, s.name, s.email, s.phone,
           to_char(min(i.mes_referencia), 'MM/YYYY'), ci.due_date, ci.total_value, ci.asaas_boleto_url,
           array_agg(i.id order by cu.numero_uc), ci.envio_tentativas,
           nullif(concat_ws('; ',
               case when s.phone is null then 'assinante sem telefone' end,
               case when ci.asaas_boleto_url is null then 'boleto sem URL' end,
               case when abs(ci.total_value - sum(
                        coalesce(i.consumo_reais,0) + coalesce(i.iluminacao_publica,0)
                      + coalesce(i.outros_lancamentos,0) + coalesce(i.parcelamento,0))) > 0.05
                    then 'demonstrativo nao fecha com o boleto' end
           ), '')
    from consolidated_invoices ci
    join subscribers s     on s.id = ci.subscriber_id
    join invoices i        on i.consolidated_invoice_id = ci.id
    join consumer_units cu on cu.id = i.uc_id
    where ci.id = any(p_ids)
      and ci.asaas_payment_id is not null
      and ci.fatura_enviada_em is not null
      and ci.enviado_whatsapp_em is null
      and coalesce(ci.status, '') not in ('paid', 'cancelled', 'canceled')
    group by ci.id, s.id, s.name, s.email, s.phone, ci.due_date, ci.total_value,
             ci.asaas_boleto_url, ci.envio_tentativas
    )
    union all
    (
    select 'individual'::text, i.id, s.id, s.name, s.email, s.phone,
           to_char(i.mes_referencia, 'MM/YYYY'), i.vencimento, i.valor_a_pagar, i.asaas_boleto_url,
           array[i.id], i.envio_tentativas,
           nullif(concat_ws('; ',
               case when s.phone is null then 'assinante sem telefone' end,
               case when i.asaas_boleto_url is null then 'boleto sem URL' end,
               case when abs(coalesce(i.valor_a_pagar,0) - (
                        coalesce(i.consumo_reais,0) + coalesce(i.iluminacao_publica,0)
                      + coalesce(i.outros_lancamentos,0) + coalesce(i.parcelamento,0))) > 0.05
                    then 'demonstrativo nao fecha com o boleto' end
           ), '')
    from invoices i
    join consumer_units cu on cu.id = i.uc_id
    join subscribers s     on s.id  = cu.subscriber_id
    where i.id = any(p_ids)
      and i.asaas_payment_id is not null
      and i.consolidated_invoice_id is null
      and i.fatura_enviada_em is not null
      and i.enviado_whatsapp_em is null
      and i.status::text in ('a_vencer', 'atrasado')
      and coalesce(i.asaas_status, '') not in ('RECEIVED', 'CONFIRMED', 'REFUNDED')
    )
    order by 8 nulls last;
$$;

-- Marca so o canal WhatsApp. fn_marcar_fatura_enviada regrava envio_canais
-- inteiro e apagaria o registro do e-mail que ja saiu.
create or replace function public.fn_marcar_whatsapp_reenvio(p_tipo text, p_id uuid, p_invoice_ids uuid[],
                                                             p_ok boolean, p_erro text default null)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare
    v_agora timestamptz := now();
    v_wa    jsonb := jsonb_build_object('ok', coalesce(p_ok, false), 'erro', p_erro, 'reenvio_em', v_agora);
    v_ids   uuid[];
begin
    if p_tipo = 'consolidada' then
        update consolidated_invoices
           set enviado_whatsapp_em = case when p_ok then v_agora else enviado_whatsapp_em end,
               envio_canais = coalesce(envio_canais, '{}'::jsonb) || jsonb_build_object('whatsapp', v_wa)
         where id = p_id;
        v_ids := coalesce(p_invoice_ids, (select array_agg(id) from invoices where consolidated_invoice_id = p_id));
    else
        v_ids := coalesce(p_invoice_ids, array[p_id]);
    end if;

    update invoices
       set enviado_whatsapp_em = case when p_ok then v_agora else enviado_whatsapp_em end,
           envio_canais = coalesce(envio_canais, '{}'::jsonb) || jsonb_build_object('whatsapp', v_wa)
     where id = any(v_ids);
end;
$$;

-- Aciona o workflow do enviador no modo reenvio. Usado por agendamento
-- pontual no pg_cron; o mesmo token do disparo diario.
create or replace function public.fn_disparar_reenvio_whatsapp(p_faturas text, p_aplicar boolean default false)
returns bigint language plpgsql security definer set search_path to 'public'
as $$
declare
    v_token text;
    v_req   bigint;
begin
    select decrypted_secret into v_token from vault.decrypted_secrets where name = 'cron:github_token';
    if v_token is null then
        raise exception 'Segredo cron:github_token ausente no Vault.';
    end if;
    if coalesce(btrim(p_faturas), '') = '' then
        raise exception 'Informe os ids das faturas.';
    end if;

    select net.http_post(
        url  := 'https://api.github.com/repos/WaldineyGodoy/saas/actions/workflows/enviador.yml/dispatches',
        body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object(
                    'simular',     case when p_aplicar then 'false' else 'true' end,
                    'limite',      '10',
                    'so_whatsapp', 'true',
                    'faturas',     p_faturas)),
        headers := jsonb_build_object(
            'Content-Type', 'application/json', 'Accept', 'application/vnd.github+json',
            'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'b2w-pg-cron',
            'Authorization', 'Bearer ' || v_token),
        timeout_milliseconds := 30000
    ) into v_req;

    insert into robo_execucoes (robo, aplicou, detalhe)
    values ('enviador-disparo', p_aplicar,
            jsonb_build_object('origem', 'pg_cron', 'modo', 'reenvio_whatsapp', 'faturas', p_faturas,
                               'http_request_id', v_req));
    return v_req;
end;
$$;

revoke all on function public.fn_itens_reenvio_whatsapp(uuid[]) from public, anon, authenticated;
revoke all on function public.fn_marcar_whatsapp_reenvio(text, uuid, uuid[], boolean, text) from public, anon, authenticated;
revoke all on function public.fn_disparar_reenvio_whatsapp(text, boolean) from public, anon, authenticated;
grant execute on function public.fn_itens_reenvio_whatsapp(uuid[]) to service_role;
grant execute on function public.fn_marcar_whatsapp_reenvio(text, uuid, uuid[], boolean, text) to service_role;
grant execute on function public.fn_disparar_reenvio_whatsapp(text, boolean) to service_role;
