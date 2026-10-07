-- Pedido de nova UC a partir da leitura da conta de energia.
--
-- Fluxo decidido pelo dono (04/10/2026): ler a conta NAO cria UC. Vira um
-- pedido (lead) com os dados lidos, que a equipe aproveita para cadastrar sem
-- redigitar. A UC so nasce quando a adesao e assinada; se o lead nao assinar
-- ou for reprovado na analise de credito, nada avanca.
--
--   app mobile (assinante logado) -> app_solicitar_nova_uc -> lead com conta_lida
--   CRM (modal do lead)           -> grava conta_lida direto (RLS da equipe)
--   adesao publica (/contrato?lead_id=) -> fn_lead_adesao preenche o cadastro
--
-- Assinante existente nao passa pela adesao publica (fn_criar_assinante_publico
-- recusa CPF/CNPJ em uso). Para ele falta o termo aditivo, fora deste arquivo:
-- o pedido fica marcado em solicitante_assinante_id para a equipe tratar.
--
-- Aditivo: duas colunas anulaveis em leads e tres funcoes novas.

alter table public.leads
    add column if not exists conta_lida jsonb,
    add column if not exists solicitante_assinante_id uuid
        references public.subscribers(id) on delete set null;

comment on column public.leads.conta_lida is
  'Leitura da conta de energia (PDF ou foto): numeroUc, titular, endereco, ligacao, mediaKwh, historico... Mesmo formato de completarLeitura (src/lib/energyBillParser.js).';
comment on column public.leads.solicitante_assinante_id is
  'Assinante que pediu a nova UC pelo app. Preenchido = cliente existente: a adesao publica nao se aplica (precisa de termo aditivo).';

create index if not exists leads_solicitante_assinante_idx
    on public.leads (solicitante_assinante_id)
    where solicitante_assinante_id is not null;

-- Numero de UC comparavel: so digitos, sem zeros a esquerda (igual a normalizarUc do front).
create or replace function public.fn_uc_normalizada(p_txt text)
returns text
language sql immutable
set search_path to 'public', 'pg_temp'
as $$
    select nullif(ltrim(coalesce(public.fn_so_digitos(p_txt), ''), '0'), '');
$$;

-- ---------------------------------------------------------------------------
-- App: assinante pede nova UC com a conta lida
-- ---------------------------------------------------------------------------
create or replace function public.app_solicitar_nova_uc(p_conta jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_sub public.subscribers%rowtype;
    v_uc text;
    v_lead uuid;
    v_end jsonb;
    v_media text;
begin
    select * into v_sub from public.subscribers where id = public.fn_app_subscriber_id();
    if not found then
        raise exception 'Este login ainda nao esta vinculado a um contrato de assinatura.' using errcode = '42501';
    end if;

    if jsonb_typeof(p_conta) is distinct from 'object' or pg_column_size(p_conta) > 16384 then
        raise exception 'Leitura da conta invalida.' using errcode = '22023';
    end if;

    v_uc := public.fn_uc_normalizada(p_conta ->> 'numeroUc');
    if v_uc is null then
        raise exception 'Nao foi possivel identificar o numero da UC na conta. Tente outra foto.' using errcode = '22023';
    end if;

    -- So compara com as UCs do proprio assinante: dizer se a UC existe em
    -- outro cadastro revelaria dados de terceiros.
    if exists (
        select 1 from public.consumer_units c
         where c.subscriber_id = v_sub.id
           and v_uc in (public.fn_uc_normalizada(c.numero_uc), public.fn_uc_normalizada(c.numero_uc_anterior))
    ) then
        raise exception 'Esta UC ja esta cadastrada na sua conta.' using errcode = '23505';
    end if;

    -- Reenvio do mesmo pedido devolve o pedido em aberto, sem duplicar.
    select l.id into v_lead
      from public.leads l
     where l.solicitante_assinante_id = v_sub.id
       and public.fn_uc_normalizada(l.conta_lida ->> 'numeroUc') = v_uc
       and l.status not in ('ativo', 'pago', 'negocio_perdido')
     limit 1;
    if v_lead is not null then
        return jsonb_build_object('lead_id', v_lead, 'ja_existia', true);
    end if;

    v_end := case when jsonb_typeof(p_conta -> 'endereco') = 'object' then p_conta -> 'endereco' else '{}'::jsonb end;
    v_media := p_conta ->> 'mediaKwh';

    insert into public.leads (
        name, email, phone, cpf_cnpj, status,
        cep, rua, complemento, bairro, cidade, uf,
        concessionaria, consumo_kwh,
        originator_id, tags, conta_lida, solicitante_assinante_id
    ) values (
        v_sub.name, v_sub.email, v_sub.phone, v_sub.cpf_cnpj, 'simulacao',
        v_end ->> 'cep', v_end ->> 'logradouro', v_end ->> 'complemento', v_end ->> 'bairro', v_end ->> 'cidade', v_end ->> 'uf',
        coalesce(nullif(p_conta ->> 'concessionaria', ''), 'Neoenergia Cosern'),
        case when v_media ~ '^\d+(\.\d+)?$' then v_media::numeric end,
        v_sub.originator_id, array['nova_uc_app'],
        p_conta || jsonb_build_object('lidoEm', now()),
        v_sub.id
    )
    returning id into v_lead;

    return jsonb_build_object('lead_id', v_lead, 'ja_existia', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Adesao publica: dados do lead para preencher o cadastro e a primeira UC
-- ---------------------------------------------------------------------------
-- O lead_id ja viaja no link de adesao (hoje junto com nome, e-mail e telefone
-- em texto na URL). Aqui ele e a chave: UUID aleatorio, so de leads ainda em
-- negociacao e que nao sao de assinante existente.
create or replace function public.fn_lead_adesao(p_lead uuid)
returns jsonb
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select jsonb_build_object(
        'name', l.name, 'email', l.email, 'phone', l.phone,
        'cep', l.cep, 'rua', l.rua, 'numero', l.numero, 'complemento', l.complemento,
        'bairro', l.bairro, 'cidade', l.cidade, 'uf', l.uf,
        'concessionaria', l.concessionaria, 'consumo_kwh', l.consumo_kwh,
        'uc', case when l.conta_lida is null then null else jsonb_build_object(
            'numeroUc', l.conta_lida ->> 'numeroUc',
            'titular', l.conta_lida ->> 'titular',
            'ligacao', l.conta_lida ->> 'ligacao',
            'mediaKwh', l.conta_lida -> 'mediaKwh',
            'endereco', l.conta_lida -> 'endereco'
        ) end
    )
      from public.leads l
     where l.id = p_lead
       and l.solicitante_assinante_id is null
       and l.status not in ('ativacao', 'ativo', 'pago', 'negocio_perdido');
$$;

-- ---------------------------------------------------------------------------
-- Permissoes (mesma regra de 20261004f: nada de EXECUTE para PUBLIC)
-- ---------------------------------------------------------------------------
revoke all on function public.fn_uc_normalizada(text) from public, anon;
grant execute on function public.fn_uc_normalizada(text) to authenticated;

revoke all on function public.app_solicitar_nova_uc(jsonb) from public, anon;
grant execute on function public.app_solicitar_nova_uc(jsonb) to authenticated;

revoke all on function public.fn_lead_adesao(uuid) from public;
grant execute on function public.fn_lead_adesao(uuid) to anon, authenticated;
