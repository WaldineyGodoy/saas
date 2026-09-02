-- ============================================================================
-- Modalidade vem da usina, e ACR exige titularidade igual à da UG
--
-- `consumer_units.modalidade` era um campo fantasma: o `<select>` foi declarado
-- em ConsumerUnitModal.jsx (a constante `modalidadeOptions`, linha 141) e nunca
-- renderizado. Resultado — toda UC criada pela tela nascia
-- `geracao_compartilhada` por padrão, ninguém via, ninguém corrigia, e cada
-- salvamento reescrevia o padrão. Em 02/09/2026, **9 das 21 UCs vinculadas
-- discordavam da modalidade da própria usina**.
--
-- Regra do negócio, dada pelo dono: **quem determina ACR ou GC é a usina, nunca
-- a UC.** Então a modalidade passa a ser derivada, não digitada.
--
-- E a trava que faltava: em **autoconsumo remoto** o titular da conta de
-- energia (`titular_fatura_id`) tem que ser o mesmo titular da UG. Não sendo, a concessionária
-- simplesmente não compensa — a UC consome a tarifa cheia e o assinante paga
-- repasse sem saber por quê. Vincular UC de titular diferente a uma usina ACR
-- passa a ser recusado no banco.
--
-- Em GC a regra não existe: a geração é rateada entre titulares distintos, que
-- é justamente o propósito da modalidade.
-- ============================================================================

-- --------------------------------------------------------------- backfill
-- Antes do gatilho, para que a correção em massa não esbarre na trava.
update public.consumer_units cu
set modalidade = u.modalidade
from public.usinas u
where u.id = cu.usina_id
  and cu.modalidade is distinct from u.modalidade;

-- ------------------------------------------------------------- o gatilho
create or replace function public.fn_uc_modalidade_e_titularidade()
returns trigger
language plpgsql
as $$
declare
    v_mod        text;
    v_nome_usina text;
    v_ug_uc      text;
    v_doc_ug     text;
    v_nome_ug    text;
    v_doc_uc     text;
    v_nome_tit   text;
    v_vinculando boolean;
begin
    if new.usina_id is null then
        return new;
    end if;

    select u.modalidade::text, u.name
      into v_mod, v_nome_usina
      from public.usinas u
     where u.id = new.usina_id;

    -- A usina manda na modalidade, sempre — inclusive quando ela muda de
    -- modalidade e as UCs precisam acompanhar.
    new.modalidade := v_mod::public.uc_modalidade;

    -- A trava só vale no momento do vínculo. Aplicá-la em todo UPDATE
    -- impediria de salvar qualquer outro campo das UCs que já estão
    -- divergentes hoje — trancaria a porta com as pessoas do lado de fora.
    v_vinculando := (tg_op = 'INSERT')
                 or (old.usina_id is distinct from new.usina_id);

    if not v_vinculando then
        return new;
    end if;

    -- Em GC titulares distintos são o esperado.
    if v_mod <> 'auto_consumo_remoto' then
        return new;
    end if;

    -- A própria UG não se compara consigo mesma.
    if coalesce(new.tipo_unidade::text, '') = 'geradora' then
        return new;
    end if;

    -- Titular da conta de energia da unidade geradora.
    --
    -- É `titular_fatura_id` → subscribers.cpf_cnpj. NÃO é `cpf_cnpj_fatura`,
    -- que é campo livre e ora traz o documento do assinante, ora o do titular,
    -- ora um CPF solto — comparar por ele acusava três UCs da UFV Bom Jesus,
    -- entre elas a 7030839166, que compensou 4.948 kWh em agosto. Prova de que
    -- a comparação estava errada, não o cadastro.
    --
    -- `usinas.cnpj_cpf` também não serve: na Bom Jesus II ele traz a SPE
    -- proprietária, e o titular da conta da UG é outra pessoa. Sem titular na
    -- UG, a trava recusa por falta de prova em vez de comparar com o campo
    -- errado.
    select regexp_replace(coalesce(t.cpf_cnpj,''), '\D', '', 'g'), t.name, g.numero_uc
      into v_doc_ug, v_nome_ug, v_ug_uc
      from public.consumer_units g
      left join public.subscribers t on t.id = g.titular_fatura_id
     where g.usina_id = new.usina_id
       and g.tipo_unidade::text = 'geradora'
     limit 1;

    if v_ug_uc is null then
        raise exception using
            errcode = 'check_violation',
            message = format('A usina %s é de autoconsumo remoto e não tem unidade geradora cadastrada.', v_nome_usina),
            hint    = 'Cadastre a UC geradora da usina antes de vincular unidades beneficiárias.';
    end if;

    if coalesce(v_doc_ug,'') = '' then
        raise exception using
            errcode = 'check_violation',
            message = format('A unidade geradora %s da usina %s está sem titular da conta de energia.', v_ug_uc, v_nome_usina),
            hint    = 'Informe o titular da conta de energia da UC geradora. Sem ele não há como conferir a titularidade exigida pelo autoconsumo remoto.';
    end if;

    select regexp_replace(coalesce(t.cpf_cnpj,''), '\D', '', 'g'), t.name
      into v_doc_uc, v_nome_tit
      from public.subscribers t
     where t.id = new.titular_fatura_id;

    if coalesce(v_doc_uc,'') = '' then
        raise exception using
            errcode = 'check_violation',
            message = format('A UC %s está sem titular da conta de energia.', new.numero_uc),
            hint    = format('Em autoconsumo remoto o titular da conta na concessionária tem que ser o mesmo da unidade geradora (%s).', v_nome_ug);
    end if;

    if v_doc_uc <> v_doc_ug then
        raise exception using
            errcode = 'check_violation',
            message = format('Titularidade incompatível: a conta de energia da UC %s está em %s e a unidade geradora da usina %s está em %s.',
                             new.numero_uc, v_nome_tit, v_nome_usina, v_nome_ug),
            hint    = 'Em autoconsumo remoto a concessionária só compensa quando o titular da conta de energia é o mesmo da unidade geradora. Faça a troca de titularidade antes de vincular, ou use uma usina de geração compartilhada.';
    end if;

    return new;
end;
$$;

drop trigger if exists tr_uc_modalidade_titularidade on public.consumer_units;
create trigger tr_uc_modalidade_titularidade
    before insert or update on public.consumer_units
    for each row execute function public.fn_uc_modalidade_e_titularidade();

comment on function public.fn_uc_modalidade_e_titularidade() is
    'Modalidade da UC vem da usina. Em ACR, so aceita vinculo quando o titular da conta de energia (titular_fatura_id) e o mesmo da UG.';
