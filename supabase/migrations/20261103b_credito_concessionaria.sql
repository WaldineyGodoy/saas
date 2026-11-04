-- Credito devolvido pela concessionaria na propria conta.
--
-- A Cosern devolveu cobrancas indevidas anteriores da UC 80926303262 como
-- "Devolucao de Credito" nas contas de 06/2026 (R$ 147,19, zerou a conta) e
-- 07/2026 (R$ 60,81). O credito abate o que a B2W paga a concessionaria, mas
-- nao muda o que o assinante deve -- o boleto sai pela energia compensada,
-- CIP e encargos, como sempre.
--
-- Sem ler esse credito, dois falsos alarmes:
--   * a auditoria via a conta "menor do que o repassado" e bloqueava com
--     residuo_conta (07/2026: residuo R$ 60,96, o credito era R$ 60,81);
--   * a ponte (20261103a) tratava conta zerada como "valor da conta ausente"
--     e nao calculava (06/2026).
--
-- O que muda:
--   * invoices.credito_concessionaria (positivo), lido pela parse-invoice;
--   * fn_auditar_fatura soma o credito de volta a conta antes de medir o
--     residuo e a tolerancia;
--   * fn_fatura_fatos_pendentes: conta zerada so e pendencia no modo repasse
--     (sem compensacao), onde o boleto E o valor da conta. Com compensacao o
--     valor da conta nao entra no boleto; nulo continua pendencia nos dois.

alter table public.invoices
    add column if not exists credito_concessionaria numeric;

comment on column public.invoices.credito_concessionaria is
    'Credito devolvido pela concessionaria na conta (ex.: Devolucao de Credito), em valor positivo. Abate a conta, nao o boleto do assinante (20261103b).';


create or replace function public.fn_fatura_fatos_pendentes(p_invoice_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case
        when i.id is null                            then 'fatura inexistente'
        when i.valor_concessionaria is null          then 'valor da conta ausente'
        when i.consumo_kwh is null                   then 'consumo (kWh) nao lido'
        when i.consumo_compensado is null            then 'compensado (kWh) nao lido'
        when i.consumo_compensado = 0
         and i.valor_concessionaria <= 0             then 'valor da conta ausente'
        when i.iluminacao_publica is null            then 'iluminacao publica nao lida'
        when i.outros_lancamentos is null            then 'outros lancamentos nao lidos'
    end
      from (select 1) um
      left join public.invoices i on i.id = p_invoice_id;
$$;


-- A auditoria e longa (14 mil caracteres) e so o bloco do residuo muda. Em vez
-- de reescreve-la inteira, troca os trechos e confere que cada troca pegou:
-- se a funcao tiver mudado por baixo, a migracao falha em vez de aplicar meia
-- alteracao.
do $mig$
declare
    d text := pg_get_functiondef('public.fn_auditar_fatura(uuid)'::regprocedure);
    trocas text[][] := array[
        array['i.valor_concessionaria, i.valor_a_pagar,',
              'i.valor_concessionaria, i.credito_concessionaria, i.valor_a_pagar,'],
        array['and f.fio_b_apurado is not null and coalesce(f.valor_concessionaria, 0) > 0 then',
              'and f.fio_b_apurado is not null and coalesce(f.valor_concessionaria, 0) + coalesce(f.credito_concessionaria, 0) > 0 then'],
        array['v_residuo    := round(f.valor_concessionaria - v_repassado',
              'v_residuo    := round(f.valor_concessionaria + coalesce(f.credito_concessionaria, 0) - v_repassado'],
        array['v_tolerancia := greatest(5, round(f.valor_concessionaria * 0.02, 2));',
              'v_tolerancia := greatest(5, round((f.valor_concessionaria + coalesce(f.credito_concessionaria, 0)) * 0.02, 2));']
    ];
    i int;
begin
    for i in 1 .. array_length(trocas, 1) loop
        if position(trocas[i][1] in d) = 0 then
            raise exception 'fn_auditar_fatura mudou: trecho % nao encontrado', i;
        end if;
        d := replace(d, trocas[i][1], trocas[i][2]);
    end loop;
    execute d;
end
$mig$;
