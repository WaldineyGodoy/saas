-- Portoes de auditoria da fatura, no servidor.
--
-- Ate agora as conferencias rodavam na extracao e so MARCAVAM a fatura: nada
-- impedia alguem de faturar uma que nao conferiu. Esta funcao e o portao, e
-- quem a aplica e a create-asaas-charge -- o unico lugar do sistema que cria
-- cobranca, individual ou consolidada.
--
-- Calibrada contra as 48 faturas ja cobradas na base: nenhuma dispara bloqueio
-- novo (so 'ja_cobrada', que e a definicao delas, e um 'sem_valor' de um boleto
-- de R$ 0 que nao deveria ter saido). Os limites nao sao teoricos: sao o que o
-- historico suporta.
--
-- Duas decisoes que vieram do dado, nao do desenho:
--
--   * Tarifa zerada so bloqueia QUANDO HA COMPENSACAO. As 4 UCs com tarifa 0 que
--     ja foram cobradas estao todas em 'aguardando_conexao', com compensado 0 e
--     valor_a_pagar = valor_concessionaria: e repasse puro, a tarifa nao
--     multiplica nada. Bloquear ali seria falso positivo.
--
--   * A CIP e aliquota fixa por municipio sobre o kWh. Medida na base, a
--     dispersao dentro do mesmo municipio fica em ~3% (Sao Goncalo do Amarante
--     0,14303 R$/kWh com dispersao ZERO em 9 faturas; Natal 0,11458 em 21).
--     Dai o limite de 5% do portao 9.
--
-- Esta migration consolida o estado final; no historico remoto ela chegou em
-- tres passos (criacao, correcao da colisao de nome em tarifa_concessionaria,
-- e formato de moeda pt-BR).

-- Numero em portugues sem depender do lc_numeric do servidor -- to_char com
-- G/D segue a configuracao regional e sai "6,591.56" num banco em C.
create or replace function public.fn_moeda_br(p_valor numeric)
returns text
language sql
immutable
as $$
    select translate(to_char(coalesce(p_valor, 0), 'FM999,999,990.00'), ',.', '.,');
$$;

comment on function public.fn_moeda_br(numeric) is
    'Formata numero no padrao brasileiro sem depender do lc_numeric do servidor.';

create or replace function public.fn_auditar_fatura(p_invoice_id uuid)
returns table (codigo text, severidade text, mensagem text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    f record;
    v_media numeric;
    v_variacao numeric;
    v_razao_cip numeric;
    v_razao_municipio numeric;
    v_amostras int;
    v_duplicatas int;
begin
    -- ATENCAO: nada de `i.*` aqui. `invoices` TAMBEM tem tarifa_concessionaria,
    -- e a colisao fazia o portao da tarifa ler a coluna errada -- acusava 29 das
    -- 48 faturas ja cobradas. Colunas explicitas, alias onde o nome se repete.
    select i.id, i.uc_id, i.mes_referencia, i.reading_status, i.reading_error,
           i.consumo_kwh, i.consumo_compensado, i.iluminacao_publica,
           i.valor_concessionaria, i.valor_a_pagar, i.asaas_payment_id,
           i.status::text as fatura_status,
           cu.numero_uc,
           cu.tarifa_concessionaria as uc_tarifa,
           cu.tipo_unidade::text as tipo_unidade,
           cu.status::text as uc_status,
           cu.address->>'cidade' as cidade
      into f
      from public.invoices i
      join public.consumer_units cu on cu.id = i.uc_id
     where i.id = p_invoice_id;

    if not found then
        codigo := 'fatura_inexistente';
        severidade := 'bloqueio';
        mensagem := 'Fatura nao encontrada.';
        return next;
        return;
    end if;

    -- ---------------- BLOQUEIOS ----------------

    if f.reading_status = 'error' then
        codigo := 'extracao_reprovada';
        severidade := 'bloqueio';
        mensagem := coalesce(f.reading_error, 'A leitura da conta foi reprovada na conferencia.');
        return next;
    end if;

    if coalesce(f.consumo_compensado, 0) > 0 and coalesce(f.uc_tarifa, 0) = 0 then
        codigo := 'tarifa_ausente';
        severidade := 'bloqueio';
        mensagem := format(
            'UC %s tem %s kWh compensados mas tarifa zerada no cadastro: a economia sairia zero e o assinante seria cobrado a menos.',
            f.numero_uc, round(f.consumo_compensado));
        return next;
    end if;

    select count(*) into v_duplicatas
      from public.invoices d
     where d.uc_id = f.uc_id
       and d.mes_referencia = f.mes_referencia
       and d.id <> f.id
       and d.status::text not in ('cancelado', 'cancelada');

    if v_duplicatas > 0 then
        codigo := 'duplicidade';
        severidade := 'bloqueio';
        mensagem := format('Existem %s outra(s) fatura(s) ativa(s) da UC %s no mesmo mes de referencia.',
                           v_duplicatas, f.numero_uc);
        return next;
    end if;

    if coalesce(f.valor_a_pagar, 0) <= 0 then
        codigo := 'sem_valor';
        severidade := 'bloqueio';
        mensagem := 'Valor a pagar ausente ou zerado -- a fatura ainda nao foi calculada.';
        return next;
    end if;

    if f.asaas_payment_id is not null then
        codigo := 'ja_cobrada';
        severidade := 'bloqueio';
        mensagem := format('Fatura ja possui cobranca no Asaas (%s).', f.asaas_payment_id);
        return next;
    end if;

    -- ---------------- AVISOS ----------------

    if f.reading_status is distinct from 'success' and f.reading_status is distinct from 'error' then
        codigo := 'leitura_pendente';
        severidade := 'aviso';
        mensagem := format('A conta ainda nao passou pela conferencia (reading_status = %s).',
                           coalesce(f.reading_status, 'nulo'));
        return next;
    end if;

    select avg(a.valor_concessionaria) into v_media
      from (select v.valor_concessionaria
              from public.invoices v
             where v.uc_id = f.uc_id
               and v.mes_referencia < f.mes_referencia
               and coalesce(v.valor_concessionaria, 0) > 0
               and v.status::text not in ('cancelado', 'cancelada')
             order by v.mes_referencia desc
             limit 3) a;

    if v_media > 0 and coalesce(f.valor_concessionaria, 0) > 0 then
        v_variacao := abs(f.valor_concessionaria - v_media) / v_media;
        if v_variacao > 0.5 then
            codigo := 'variacao';
            severidade := 'aviso';
            mensagem := format('Conta de R$ %s contra media de R$ %s nos 3 meses anteriores (%s%% de diferenca).',
                               fn_moeda_br(f.valor_concessionaria),
                               fn_moeda_br(v_media),
                               round(v_variacao * 100));
            return next;
        end if;
    end if;

    if f.tipo_unidade = 'beneficiaria'
       and f.uc_status in ('ativo', 'em_atraso', 'em_transf_titularidade')
       and coalesce(f.consumo_compensado, 0) = 0 then
        codigo := 'sem_compensacao';
        severidade := 'aviso';
        mensagem := format('UC %s esta ativa como beneficiaria mas nao teve energia compensada no mes.', f.numero_uc);
        return next;
    end if;

    if coalesce(f.consumo_kwh, 0) > 0 and coalesce(f.iluminacao_publica, 0) > 0 and f.cidade is not null then
        v_razao_cip := f.iluminacao_publica / f.consumo_kwh;

        select percentile_cont(0.5) within group (order by o.iluminacao_publica / o.consumo_kwh), count(*)
          into v_razao_municipio, v_amostras
          from public.invoices o
          join public.consumer_units c on c.id = o.uc_id
         where c.address->>'cidade' = f.cidade
           and o.id <> f.id
           and coalesce(o.consumo_kwh, 0) > 0
           and coalesce(o.iluminacao_publica, 0) > 0
           and o.status::text not in ('cancelado', 'cancelada');

        if v_amostras >= 3 and v_razao_municipio > 0
           and abs(v_razao_cip - v_razao_municipio) / v_razao_municipio > 0.05 then
            codigo := 'cip_fora_do_padrao';
            severidade := 'aviso';
            mensagem := format('Iluminacao publica de R$ %s da %s R$/kWh, contra %s R$/kWh de %s (%s faturas).',
                               fn_moeda_br(f.iluminacao_publica),
                               translate(to_char(v_razao_cip, 'FM0.00000'), '.', ','),
                               translate(to_char(v_razao_municipio, 'FM0.00000'), '.', ','),
                               f.cidade, v_amostras);
            return next;
        end if;
    end if;

    return;
end;
$$;

comment on function public.fn_auditar_fatura(uuid) is
    'Portoes de auditoria da fatura. severidade=bloqueio impede a emissao do boleto; aviso apenas registra. Aplicada pela create-asaas-charge.';

revoke all on function public.fn_auditar_fatura(uuid) from public, anon;
grant execute on function public.fn_auditar_fatura(uuid) to authenticated, service_role;

revoke all on function public.fn_moeda_br(numeric) from public, anon;
grant execute on function public.fn_moeda_br(numeric) to authenticated, service_role;
