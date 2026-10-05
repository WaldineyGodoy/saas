-- Termo aditivo: assinante existente inclui uma UC nova pelo app.
--
-- Decisoes do dono (05/10/2026, docs/plano-termo-aditivo.md):
--   - tudo no app: le a conta -> escolhe o plano -> confere -> assina;
--   - o plano define o desconto, e so aparecem planos ligados a distribuidora da UC;
--   - so o assinante assina; sem analise de credito;
--   - assinado o termo, a UC nasce sozinha em 'em_ativacao' com o plano escolhido.
--
-- Fluxo de dados:
--   app_planos_para_uc(distribuidora)      -> planos que o app oferece
--   Edge Function aditivo-nova-uc          -> lead (app_solicitar_nova_uc) + plano_id + PDF + Autentique
--   signatures(signer_type='lead', document_type='aditivo_uc', signer_id=lead.id)
--   autentique-webhook (signed)            -> fn_criar_uc_do_aditivo(lead)
--   app_meus_pedidos_uc()                  -> situacao do pedido e link pendente no app

-- ---------------------------------------------------------------------------
-- Plano x distribuidora
-- ---------------------------------------------------------------------------
create table if not exists public.planos_distribuidoras (
    plano_id uuid not null references public.planos_assinatura_energia(id) on delete cascade,
    -- Mesmo texto de consumer_units.concessionaria (ex.: 'Neoenergia Cosern').
    concessionaria text not null check (btrim(concessionaria) <> ''),
    created_at timestamptz not null default now(),
    primary key (plano_id, concessionaria)
);

comment on table public.planos_distribuidoras is
  'Em quais distribuidoras cada plano de assinatura pode ser contratado. O app so oferece o plano para UC dessas distribuidoras.';

alter table public.planos_distribuidoras enable row level security;

drop policy if exists planos_distribuidoras_leitura on public.planos_distribuidoras;
create policy planos_distribuidoras_leitura on public.planos_distribuidoras
    for select to authenticated using (public.fn_papel_interno());

drop policy if exists planos_distribuidoras_escrita on public.planos_distribuidoras;
create policy planos_distribuidoras_escrita on public.planos_distribuidoras
    for all to authenticated using (public.fn_papel_interno()) with check (public.fn_papel_interno());

-- Plano escolhido no pedido de nova UC
alter table public.leads
    add column if not exists plano_id uuid references public.planos_assinatura_energia(id) on delete set null;

-- ---------------------------------------------------------------------------
-- App: planos disponiveis para a distribuidora da UC lida
-- ---------------------------------------------------------------------------
create or replace function public.app_planos_para_uc(p_concessionaria text)
returns table (id uuid, nome text, desconto_assinante numeric)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select p.id, p.nome, p.desconto_assinante
      from public.planos_assinatura_energia p
      join public.planos_distribuidoras d on d.plano_id = p.id
     where p.ativo
       and public.fn_app_subscriber_id() is not null
       and lower(btrim(d.concessionaria)) = lower(btrim(p_concessionaria))
     order by p.desconto_assinante desc nulls last, p.nome;
$$;

-- ---------------------------------------------------------------------------
-- App: pedidos de nova UC do assinante e a situacao de cada um
-- ---------------------------------------------------------------------------
create or replace function public.app_meus_pedidos_uc()
returns table (
    lead_id uuid, numero_uc text, plano text, criado_em timestamptz,
    situacao text, link_assinatura text
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select l.id,
           l.conta_lida ->> 'numeroUc',
           p.nome,
           l.created_at,
           case
               when uc.id is not null then 'uc_criada'
               when s.status = 'signed' then 'assinado'
               when s.status = 'pending' then 'aguardando_assinatura'
               when l.status = 'negocio_perdido' then 'encerrado'
               else 'em_preparo'
           end,
           case when s.status = 'pending' and uc.id is null then s.autentique_url end
      from public.leads l
      left join public.planos_assinatura_energia p on p.id = l.plano_id
      left join lateral (
          select sg.status, sg.autentique_url
            from public.signatures sg
           where sg.signer_type = 'lead' and sg.signer_id = l.id and sg.document_type = 'aditivo_uc'
             and sg.status in ('pending', 'signed')
           order by sg.created_at desc
           limit 1
      ) s on true
      left join lateral (
          select c.id
            from public.consumer_units c
           where c.subscriber_id = l.solicitante_assinante_id
             and public.fn_uc_normalizada(c.numero_uc) = public.fn_uc_normalizada(l.conta_lida ->> 'numeroUc')
           limit 1
      ) uc on true
     where l.solicitante_assinante_id = public.fn_app_subscriber_id()
       and l.status <> 'negocio_perdido'
     order by l.created_at desc
     limit 20;
$$;

-- ---------------------------------------------------------------------------
-- UC da conta ja cadastrada em qualquer cadastro ativo? (so diz sim/nao)
-- ---------------------------------------------------------------------------
create or replace function public.fn_uc_ja_cadastrada(p_numero text)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select exists (
        select 1 from public.consumer_units c
         where public.fn_uc_normalizada(p_numero) in (public.fn_uc_normalizada(c.numero_uc), public.fn_uc_normalizada(c.numero_uc_anterior))
           and c.status not in ('cancelado', 'cancelado_inadimplente')
    );
$$;

-- Nome comparavel: maiusculo, sem acento e sem espacos repetidos.
create or replace function public.fn_nome_comparavel(p text)
returns text
language sql immutable
set search_path to 'public', 'pg_temp'
as $$
    select regexp_replace(upper(translate(btrim(coalesce(p, '')),
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g');
$$;

-- ---------------------------------------------------------------------------
-- Termo assinado -> UC em ativacao (so o autentique-webhook chama)
-- ---------------------------------------------------------------------------
create or replace function public.fn_criar_uc_do_aditivo(p_lead uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_lead public.leads%rowtype;
    v_sub public.subscribers%rowtype;
    v_plano public.planos_assinatura_energia%rowtype;
    v_conta jsonb;
    v_end jsonb;
    v_num text;
    v_uc uuid;
    v_partes text[];
    v_dia int;
    v_media text;
begin
    select * into v_lead from public.leads where id = p_lead for update;
    if not found or v_lead.solicitante_assinante_id is null or v_lead.conta_lida is null then
        return jsonb_build_object('ok', false, 'motivo', 'pedido_invalido');
    end if;
    select * into v_sub from public.subscribers where id = v_lead.solicitante_assinante_id;
    select * into v_plano from public.planos_assinatura_energia where id = v_lead.plano_id;

    v_conta := v_lead.conta_lida;
    v_num := btrim(coalesce(v_conta ->> 'numeroUc', ''));
    if v_num = '' then
        return jsonb_build_object('ok', false, 'motivo', 'sem_numero_uc');
    end if;

    -- Idempotente: o evento da Autentique pode chegar repetido.
    select c.id into v_uc from public.consumer_units c
     where c.subscriber_id = v_sub.id
       and public.fn_uc_normalizada(c.numero_uc) = public.fn_uc_normalizada(v_num)
     limit 1;
    if v_uc is not null then
        return jsonb_build_object('ok', true, 'uc_id', v_uc, 'ja_existia', true);
    end if;

    -- Em outro cadastro ativo: nao cria; a equipe resolve.
    if public.fn_uc_ja_cadastrada(v_num) then
        insert into public.crm_history (entity_type, entity_id, content, metadata)
        values ('lead', v_lead.id,
                format('Termo aditivo assinado, mas a UC %s ja esta em outro cadastro ativo. UC nao criada.', v_num),
                jsonb_build_object('origem', 'fn_criar_uc_do_aditivo'));
        return jsonb_build_object('ok', false, 'motivo', 'uc_em_outro_cadastro');
    end if;

    v_end := case when jsonb_typeof(v_conta -> 'endereco') = 'object' then v_conta -> 'endereco' else '{}'::jsonb end;
    v_partes := regexp_match(btrim(coalesce(v_end ->> 'logradouro', '')), '^(.*\D)[\s,]+(\d+[A-Z]?)$');
    v_dia := coalesce(
        v_sub.consolidated_due_day,
        (select c.dia_vencimento from public.consumer_units c
          where c.subscriber_id = v_sub.id and c.dia_vencimento is not null
          order by c.created_at limit 1));
    v_media := v_conta ->> 'mediaKwh';

    insert into public.consumer_units (
        subscriber_id, numero_uc, titular_conta, titular_fatura_id, tipo_ligacao, concessionaria,
        status, modalidade, franquia, plano_assinatura_id, desconto_assinante, dia_vencimento, address
    ) values (
        v_sub.id, v_num,
        nullif(btrim(coalesce(v_conta ->> 'titular', '')), ''),
        -- Conta no nome do proprio assinante: ele e o titular (o gatilho copia o CPF/CNPJ).
        -- Outro nome: fica sem titular_fatura_id; a equipe trata pela troca de titularidade.
        case when public.fn_nome_comparavel(v_conta ->> 'titular') = public.fn_nome_comparavel(v_sub.name) then v_sub.id end,
        case when v_conta ->> 'ligacao' in ('monofasico', 'bifasico', 'trifasico')
             then (v_conta ->> 'ligacao')::public.uc_tipo_ligacao end,
        coalesce(nullif(v_conta ->> 'concessionaria', ''), 'Neoenergia Cosern'),
        'em_ativacao',
        case when v_plano.modalidade in ('auto_consumo_remoto', 'geracao_compartilhada')
             then v_plano.modalidade::public.uc_modalidade else 'geracao_compartilhada' end,
        case when v_media ~ '^\d+(\.\d+)?$' then v_media::numeric end,
        v_plano.id, v_plano.desconto_assinante, v_dia,
        jsonb_build_object(
            'cep', public.fn_so_digitos(v_end ->> 'cep'),
            'rua', coalesce(v_partes[1], v_end ->> 'logradouro'),
            'numero', v_partes[2],
            'complemento', v_end ->> 'complemento',
            'bairro', v_end ->> 'bairro',
            'cidade', v_end ->> 'cidade',
            'uf', upper(v_end ->> 'uf'))
    )
    returning id into v_uc;

    update public.leads set status = 'ativacao', updated_at = now() where id = v_lead.id;

    insert into public.crm_history (entity_type, entity_id, content, metadata)
    values ('subscriber', v_sub.id,
            format('Termo aditivo assinado: UC %s incluida em ativacao (plano %s).', v_num, coalesce(v_plano.nome, '-')),
            jsonb_build_object('origem', 'fn_criar_uc_do_aditivo', 'lead_id', v_lead.id, 'uc_id', v_uc));

    return jsonb_build_object('ok', true, 'uc_id', v_uc, 'ja_existia', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissoes
-- ---------------------------------------------------------------------------
revoke all on function public.app_planos_para_uc(text) from public, anon;
grant execute on function public.app_planos_para_uc(text) to authenticated;

revoke all on function public.app_meus_pedidos_uc() from public, anon;
grant execute on function public.app_meus_pedidos_uc() to authenticated;

-- Servidor apenas (Edge Functions com a chave de servidor).
revoke all on function public.fn_uc_ja_cadastrada(text) from public, anon, authenticated;
grant execute on function public.fn_uc_ja_cadastrada(text) to service_role;

revoke all on function public.fn_criar_uc_do_aditivo(uuid) from public, anon, authenticated;
grant execute on function public.fn_criar_uc_do_aditivo(uuid) to service_role;

revoke all on function public.fn_nome_comparavel(text) from public, anon;
grant execute on function public.fn_nome_comparavel(text) to authenticated, service_role;
