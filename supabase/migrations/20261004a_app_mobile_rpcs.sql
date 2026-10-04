-- App mobile B2W Energia (iOS/Android) — leitura escopada por usuario.
--
-- POR QUE ESTE ARQUIVO EXISTE
-- As policies atuais de subscribers, consumer_units, usinas, invoices e
-- generation_production sao "to authenticated using (true)": qualquer login
-- le a base inteira. O CRM web convive com isso porque so equipe interna entra
-- nele. O app mobile abre o login para o cliente final, entao ele NAO le as
-- tabelas direto: so chama as funcoes abaixo, que filtram por auth.uid().
--
-- NAO APLICADO AUTOMATICAMENTE. Revisar e aplicar manualmente.
-- Tudo aqui e aditivo (so CREATE FUNCTION + GRANT); nao altera tabela nem policy.
--
-- PENDENCIA SEPARADA (fora do escopo desta migration): as policies "true"
-- continuam permitindo que um cliente logado, usando a anon key do projeto,
-- consulte as tabelas direto pela API REST. Fechar isso exige reescrever as
-- policies com cuidado para nao quebrar o CRM web — decisao do dono.

-- ---------------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------------

create or replace function public.fn_app_subscriber_id()
returns uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select s.id from subscribers s
     where s.user_id = auth.uid() or s.profile_id = auth.uid()
     order by (s.user_id = auth.uid()) desc
     limit 1;
$$;

create or replace function public.fn_app_supplier_id()
returns uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select s.id from suppliers s
     where s.user_id = auth.uid() or s.profile_id = auth.uid()
     order by (s.user_id = auth.uid()) desc
     limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Perfil: define quais abas o app mostra para este usuario
-- ---------------------------------------------------------------------------

create or replace function public.app_perfil()
returns jsonb
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select jsonb_build_object(
        'id', auth.uid(),
        'name', coalesce(p.name, ''),
        'email', p.email,
        'role', p.role,
        'subscriber', (select to_jsonb(x) from (
            select s.id, s.name, s.status, s.short_url
              from subscribers s where s.id = fn_app_subscriber_id()) x),
        'supplier', (select to_jsonb(x) from (
            select s.id, s.name
              from suppliers s where s.id = fn_app_supplier_id()) x),
        'originator', exists (select 1 from originators_v2 o where o.id = auth.uid())
    )
    from profiles p where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Energia por assinatura
-- ---------------------------------------------------------------------------

create or replace function public.app_minhas_ucs()
returns table (
    id uuid, numero_uc text, status text, address jsonb, concessionaria text,
    desconto_assinante numeric, dia_vencimento int,
    consumo_kwh numeric, valor_concessionaria numeric, economia_reais numeric,
    valor_a_pagar numeric, mes_referencia date
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select u.id, u.numero_uc, u.status::text, u.address, u.concessionaria,
           u.desconto_assinante, u.dia_vencimento,
           f.consumo_kwh, f.valor_concessionaria, f.economia_reais,
           f.valor_a_pagar, f.mes_referencia
      from consumer_units u
      left join lateral (
            select i.* from invoices i
             where i.uc_id = u.id
               and i.status::text not in ('cancelado', 'cancelada')
               and coalesce(i.is_placeholder, false) = false
             order by i.mes_referencia desc nulls last
             limit 1) f on true
     where u.subscriber_id = fn_app_subscriber_id()
     order by u.numero_uc;
$$;

create or replace function public.app_uc_detalhe(p_uc uuid)
returns jsonb
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select jsonb_build_object(
        'uc', to_jsonb(u) - 'portal_credentials' - 'portal_password_secret_id',
        'faturas', coalesce((
            select jsonb_agg(to_jsonb(f) order by f.mes_referencia desc)
              from (select i.id, i.mes_referencia, i.vencimento, i.status,
                           i.consumo_kwh, i.consumo_compensado, i.energia_injetada,
                           i.valor_concessionaria, i.economia_reais, i.valor_a_pagar,
                           i.desconto_aplicado, i.asaas_boleto_url,
                           i.asaas_pdf_storage_url, i.linha_digitavel, i.pix_string
                      from invoices i
                     where i.uc_id = u.id
                       and i.status::text not in ('cancelado', 'cancelada')
                       and coalesce(i.is_placeholder, false) = false
                     order by i.mes_referencia desc nulls last
                     limit 6) f), '[]'::jsonb)
    )
    from consumer_units u
    where u.id = p_uc and u.subscriber_id = fn_app_subscriber_id();
$$;

-- ---------------------------------------------------------------------------
-- Usinas de investimento
-- ---------------------------------------------------------------------------

create or replace function public.app_minhas_usinas()
returns table (
    id uuid, name text, address jsonb, status text, potencia_kwp numeric,
    valor_investido numeric, geracao_estimada_kwh numeric,
    geracao_mes_kwh numeric, receita_mes numeric, mes_referencia date
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select u.id, u.name, u.address, u.status::text, u.potencia_kwp,
           u.valor_investido, u.geracao_estimada_kwh,
           g.geracao_mensal_kwh, g.saldo_receber, g.mes_referencia
      from usinas u
      left join lateral (
            select gp.* from generation_production gp
             where gp.usina_id = u.id
             order by gp.mes_referencia desc nulls last
             limit 1) g on true
     where u.supplier_id = fn_app_supplier_id()
     order by u.name;
$$;

create or replace function public.app_usina_detalhe(p_usina uuid)
returns jsonb
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select jsonb_build_object(
        'usina', to_jsonb(u) - 'portal_credentials' - 'portal_password_secret_id'
                             - 'contract_terms' - 'cnpj_cpf',
        'producao', coalesce((
            select jsonb_agg(to_jsonb(g) order by g.mes_referencia desc)
              from (select gp.id, gp.mes_referencia, gp.geracao_mensal_kwh,
                           gp.geracao_prevista, gp.faturamento_mensal,
                           gp.total_despesas, gp.saldo_receber, gp.status,
                           gp.repasse_status
                      from generation_production gp
                     where gp.usina_id = u.id
                     order by gp.mes_referencia desc nulls last
                     limit 12) g), '[]'::jsonb)
    )
    from usinas u
    where u.id = p_usina and u.supplier_id = fn_app_supplier_id();
$$;

-- ---------------------------------------------------------------------------
-- Home Connect / Drive Connect: rede de indicados
-- ---------------------------------------------------------------------------

-- Cashback: soma de `valor` em invoices.recompensas_aplicadas, quando for array
-- de objetos. O formato foi inferido (a coluna esta vazia hoje) — conferir
-- contra o motor do Plano de Recompensas antes de exibir ao cliente.
create or replace function public.app_minha_rede()
returns table (
    subscriber_id uuid, name text, status text, numero_uc text, cidade text,
    uf text, consumo_kwh numeric, cashback numeric, fatura_status text,
    fatura_vencimento date
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select s.id, s.name, s.status::text, u.numero_uc, s.cidade, s.uf,
           f.consumo_kwh,
           coalesce((
               select sum((e->>'valor')::numeric)
                 from jsonb_array_elements(
                        case when jsonb_typeof(f.recompensas_aplicadas) = 'array'
                             then f.recompensas_aplicadas else '[]'::jsonb end) e
                where (e->>'valor') ~ '^-?[0-9]+(\.[0-9]+)?$'), 0),
           f.status::text, f.vencimento
      from subscribers s
      left join lateral (
            select c.* from consumer_units c
             where c.subscriber_id = s.id
             order by c.created_at limit 1) u on true
      left join lateral (
            select i.* from invoices i
             where i.uc_id = u.id
               and i.status::text not in ('cancelado', 'cancelada')
               and coalesce(i.is_placeholder, false) = false
             order by i.mes_referencia desc nulls last
             limit 1) f on true
     where s.indicador_assinante_id = fn_app_subscriber_id()
     order by s.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Eletropostos do investidor (Drive Connect > Meu Eletroposto)
-- ---------------------------------------------------------------------------

create or replace function public.app_meus_eletropostos()
returns table (
    id uuid, nome text, endereco jsonb, status text, potencia_kw numeric,
    qtd_carregadores int, percentual numeric, kwh_mes numeric, receita_mes numeric
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select e.id, e.nome, e.endereco, e.status::text, e.potencia_kw,
           e.qtd_carregadores, f.percentual,
           coalesce(r.kwh, 0), coalesce(r.valor, 0)
      from eletroposto_fornecedores f
      join eletropostos e on e.id = f.eletroposto_id
      left join lateral (
            select sum(rc.kwh_estimado) kwh, sum(rc.valor) valor
              from recargas_eletroposto rc
             where rc.eletroposto_id = e.id
               and rc.status in ('paid', 'pago', 'succeeded', 'concluida')
               and rc.created_at >= date_trunc('month', now())) r on true
     where f.supplier_id = fn_app_supplier_id() and f.ativo
     order by e.nome;
$$;

-- Hubs disponiveis para o motorista (mapa/lista). Sem dados do investidor.
create or replace function public.app_eletropostos_publicos()
returns table (
    id uuid, nome text, endereco jsonb, status text, potencia_kw numeric,
    qtd_carregadores int, tarifa_kwh numeric
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select e.id, e.nome, e.endereco, e.status::text, e.potencia_kw,
           e.qtd_carregadores, e.tarifa_investidor_kwh
      from eletropostos e
     where e.status = 'operando'
     order by e.nome;
$$;

create or replace function public.app_minhas_recargas()
returns table (
    id uuid, eletroposto_id uuid, eletroposto_nome text, valor numeric,
    kwh_estimado numeric, status text, created_at timestamptz
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select r.id, r.eletroposto_id, e.nome, r.valor, r.kwh_estimado, r.status, r.created_at
      from recargas_eletroposto r
      left join eletropostos e on e.id = r.eletroposto_id
     where r.user_id = auth.uid()
     order by r.created_at desc
     limit 50;
$$;

-- ---------------------------------------------------------------------------
-- Permissoes: so usuario logado; anon e PUBLIC nao executam.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
    foreach f in array array[
        'fn_app_subscriber_id()', 'fn_app_supplier_id()', 'app_perfil()',
        'app_minhas_ucs()', 'app_uc_detalhe(uuid)', 'app_minhas_usinas()',
        'app_usina_detalhe(uuid)', 'app_minha_rede()', 'app_meus_eletropostos()',
        'app_eletropostos_publicos()', 'app_minhas_recargas()'
    ] loop
        execute format('revoke all on function public.%s from public, anon', f);
        execute format('grant execute on function public.%s to authenticated', f);
    end loop;
end $$;
