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
-- E a trava que faltava: em **autoconsumo remoto** o titular da conta na
-- concessionária tem que ser o mesmo titular da UG. Não sendo, a concessionária
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
    v_doc_usina  text;
    v_nome_usina text;
    v_doc_ug     text;
    v_doc_uc     text;
    v_vinculando boolean;
begin
    if new.usina_id is null then
        return new;
    end if;

    select u.modalidade::text, coalesce(u.cnpj_cpf,''), u.name
      into v_mod, v_doc_usina, v_nome_usina
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

    -- Titular da UG: o documento da unidade geradora da usina; na falta dele,
    -- o CNPJ/CPF cadastrado na usina.
    select regexp_replace(coalesce(nullif(g.cpf_cnpj_fatura, ''), ''), '\D', '', 'g')
      into v_doc_ug
      from public.consumer_units g
     where g.usina_id = new.usina_id
       and g.tipo_unidade::text = 'geradora'
     limit 1;

    v_doc_ug := coalesce(nullif(v_doc_ug, ''), regexp_replace(v_doc_usina, '\D', '', 'g'));
    v_doc_uc := regexp_replace(coalesce(new.cpf_cnpj_fatura, ''), '\D', '', 'g');

    if v_doc_ug = '' then
        raise exception using
            errcode = 'check_violation',
            message = format('A usina %s é de autoconsumo remoto e não tem o CPF/CNPJ do titular cadastrado.', v_nome_usina),
            hint    = 'Preencha o CPF/CNPJ na usina ou na UC geradora dela antes de vincular unidades beneficiárias.';
    end if;

    if v_doc_uc = '' then
        raise exception using
            errcode = 'check_violation',
            message = format('A UC %s não tem o CPF/CNPJ do titular da conta preenchido.', new.numero_uc),
            hint    = 'Em autoconsumo remoto o titular da UC precisa ser o mesmo da unidade geradora, e sem o documento não há como conferir.';
    end if;

    if v_doc_uc <> v_doc_ug then
        raise exception using
            errcode = 'check_violation',
            message = format(
                'Titularidade incompatível: a UC %s está em %s e a usina %s (autoconsumo remoto) gera em %s.',
                new.numero_uc, new.cpf_cnpj_fatura, v_nome_usina, v_doc_usina),
            hint    = 'Em autoconsumo remoto a concessionária só compensa quando o titular da UC é o mesmo da unidade geradora. Faça a troca de titularidade antes de vincular, ou use uma usina de geração compartilhada.';
    end if;

    return new;
end;
$$;

drop trigger if exists tr_uc_modalidade_titularidade on public.consumer_units;
create trigger tr_uc_modalidade_titularidade
    before insert or update on public.consumer_units
    for each row execute function public.fn_uc_modalidade_e_titularidade();

comment on function public.fn_uc_modalidade_e_titularidade() is
    'Modalidade da UC vem da usina. Em ACR, so aceita vinculo de UC com o mesmo CPF/CNPJ da UG.';
