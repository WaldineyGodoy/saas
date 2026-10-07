-- Funcoes SECURITY DEFINER fora do alcance de quem nao deve chama-las.
--
-- Achado do Security Advisor (04/10/2026): o EXECUTE padrao do Postgres vai
-- para PUBLIC, entao anon e qualquer login chamavam pela API funcoes que rodam
-- como dono e ignoram o RLS. Exemplos reais: sem login, disparar o emissor de
-- cobrancas (fn_disparar_emissor), ler a fila de faturas com dados dos
-- assinantes (fn_fila_emissao_faturas), marcar fatura como enviada; com
-- qualquer login (lead, assinante), liquidar producao (paga o fornecedor),
-- lancar reembolso, ler o extrato financeiro, trocar senha de portal.
--
-- Quem chama de verdade (mapeado no codigo e nos logs de 24h):
--   - robos (scraper/emissor/enviador) e edge functions: chave de servidor
--     (service_role), sem JWT de usuario;
--   - pg_cron: roda como postgres;
--   - CRM (logado): 15 RPCs, das quais 7 sao SECURITY DEFINER;
--   - paginas publicas: fn_criar_assinante_publico, fn_onboarding_estado,
--     fn_recarga_status;
--   - app mobile: app_* (filtradas por auth.uid());
--   - policies de RLS: fn_papel_interno, fn_eh_admin, check_user_is_admin
--     (inclusive storage.objects), fn_eletroposto_do_fornecedor, fn_rls_ve_*.
--
-- Regra: tira EXECUTE de PUBLIC/anon/authenticated em todas as SECURITY
-- DEFINER do schema public e devolve so a quem precisa. Funcao de gatilho nao
-- precisa de EXECUTE para disparar (o Postgres confere so no CREATE TRIGGER).
-- As quatro que o CRM chama e que mexem em dinheiro ou gravam ganham trava
-- interna, porque o CRM e os clientes usam o mesmo papel `authenticated`.

-- ---------------------------------------------------------------------------
-- Quem pode chamar as funcoes "internas": servidor, cron ou equipe interna
-- ---------------------------------------------------------------------------
create or replace function public.fn_chamador_interno()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select coalesce(
               nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
               'service_role'
           ) = 'service_role'
        or public.fn_papel_interno();
$$;

comment on function public.fn_chamador_interno() is
  'true para service_role, para chamadas sem contexto de API (pg_cron, SQL direto) e para a equipe interna (fn_papel_interno).';

-- ---------------------------------------------------------------------------
-- Revoga tudo e devolve por lista
-- ---------------------------------------------------------------------------
do $$
declare
    f record;
    -- anon: paginas publicas e funcoes usadas em policies
    c_anon constant text[] := array[
        'fn_criar_assinante_publico', 'fn_onboarding_estado', 'fn_recarga_status',
        'fn_desconto_assinante_municipio',
        'fn_papel_interno', 'fn_eh_admin', 'check_user_is_admin'
    ];
    -- authenticated: o que anon tem + app + policies + RPCs do CRM
    c_auth constant text[] := array[
        'fn_criar_assinante_publico', 'fn_onboarding_estado', 'fn_recarga_status',
        'fn_desconto_assinante_municipio',
        'fn_papel_interno', 'fn_eh_admin', 'check_user_is_admin', 'fn_chamador_interno',
        'fn_eletroposto_do_fornecedor',
        'fn_rls_ve_assinante', 'fn_rls_ve_uc', 'fn_rls_ve_fornecedor', 'fn_rls_ve_usina',
        'fn_app_subscriber_id', 'fn_app_supplier_id',
        'liquidate_concessionaria_payment', 'get_nearest_substations', 'fn_tarifa_referencia',
        'fn_set_portal_password', 'fn_marcar_fatura_enviada', 'fn_documento_em_uso',
        'fn_calcular_fatura'
    ];
begin
    for f in
        select p.oid::regprocedure as sig, p.proname
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.prosecdef
    loop
        execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
        execute format('grant execute on function %s to service_role', f.sig);

        if f.proname = any (c_anon) then
            execute format('grant execute on function %s to anon', f.sig);
        end if;
        if f.proname = any (c_auth) or f.proname like 'app\_%' then
            execute format('grant execute on function %s to authenticated', f.sig);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Trava interna nas quatro que o CRM chama e que gravam/mexem em dinheiro
-- ---------------------------------------------------------------------------
do $$
declare
    f record;
    v_def text;
    v_pos int;
    v_rel int;
    c_trava constant text :=
        E'\n  IF NOT public.fn_chamador_interno() THEN\n'
        || E'    RAISE EXCEPTION ''Sem permissao.'' USING ERRCODE = ''42501'';\n'
        || E'  END IF;\n';
begin
    for f in
        select p.oid, p.proname
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('fn_set_portal_password', 'fn_marcar_fatura_enviada',
                             'liquidate_concessionaria_payment', 'fn_calcular_fatura')
           and p.prosrc !~ 'fn_chamador_interno'
    loop
        v_def := pg_get_functiondef(f.oid);
        -- primeiro BEGIN depois do inicio do corpo
        v_pos := position('AS $function$' in v_def);
        if v_pos = 0 then
            raise exception 'corpo de % nao encontrado', f.proname;
        end if;
        v_rel := (regexp_instr(substr(v_def, v_pos), '\mbegin\M', 1, 1, 1, 'i'));
        if v_rel = 0 then
            raise exception 'BEGIN de % nao encontrado', f.proname;
        end if;
        v_pos := v_pos + v_rel - 1;
        execute substr(v_def, 1, v_pos - 1) || c_trava || substr(v_def, v_pos);
    end loop;
end $$;

-- fn_documento_em_uso (SQL): so a equipe interna recebe resposta verdadeira;
-- para os demais, sempre false (nao vaza se um CPF e assinante ativo).
create or replace function public.fn_documento_em_uso(p_doc text, p_ignorar uuid default null)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
    SELECT public.fn_chamador_interno() AND EXISTS (
        SELECT 1 FROM public.subscribers
         WHERE public.fn_so_digitos(cpf_cnpj) = public.fn_so_digitos(p_doc)
           AND status NOT IN ('cancelado', 'cancelado_inadimplente')
           AND (p_ignorar IS NULL OR id <> p_ignorar));
$$;
