-- O enviador tambem precisa saber do parcelamento nao repassado (20261103d).
--
--   * fn_demonstrativo_fatura monta as linhas e o total do PDF do assinante
--     somando o parcelamento;
--   * fn_fila_envio_faturas e fn_itens_reenvio_whatsapp retem o envio quando
--     valor_a_pagar difere de consumo + CIP + outros + parcelamento em mais de
--     R$ 0,05 -- com a parcela fora do boleto, a fatura certa ficaria retida.
--
-- Nas tres, o parcelamento passa a contar so quando repassado.

do $mig$
declare
    fn text;
    d text;
    antes text;
begin
    foreach fn in array array[
        'public.fn_demonstrativo_fatura(uuid)',
        'public.fn_fila_envio_faturas(integer)',
        'public.fn_itens_reenvio_whatsapp(uuid[])'
    ] loop
        d := pg_get_functiondef(fn::regprocedure);
        antes := d;
        d := replace(d, 'coalesce(i.parcelamento, 0)',
                        'case when i.parcelamento_repassado then coalesce(i.parcelamento, 0) else 0 end');
        d := replace(d, 'coalesce(i.parcelamento,0)',
                        'case when i.parcelamento_repassado then coalesce(i.parcelamento,0) else 0 end');
        if d = antes then
            raise exception '% mudou: parcelamento nao encontrado', fn;
        end if;
        execute d;
    end loop;
end
$mig$;
