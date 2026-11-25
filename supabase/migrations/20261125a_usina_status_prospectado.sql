-- Status "Prospectado" da usina, anterior ao Pré-Operação (dono, 25/11/2026).
--
-- Usina prospectada ainda não tem obra. Para as UCs vinculadas ela vale como
-- Pré-Operação (UC fica 'vinculado'); para o fornecedor não conta como usina
-- em operação (fn_supplier_status_calculado só olha em_conexao/gerando/
-- manutencao, então não muda). A busca de vaga do b2w-mcp continua só em
-- pre_operacao/em_conexao: usina prospectada não é oferecida como vaga.
-- O default de usina nova continua pre_operacao.

ALTER TYPE public.usina_status ADD VALUE IF NOT EXISTS 'prospectado' BEFORE 'pre_operacao';

-- Os três gatilhos de UC tratam prospectado igual a pre_operacao.
DO $$
DECLARE
    v_fn record;
    v_def text;
    v_n int;
    c_de constant text := $q$IN ('pre_operacao', 'em_conexao')$q$;
    c_para constant text := $q$IN ('prospectado', 'pre_operacao', 'em_conexao')$q$;
BEGIN
    FOR v_fn IN
        SELECT * FROM (VALUES
            ('handle_usina_status_change', 1),
            ('handle_uc_usina_link', 2),
            ('handle_invoice_status_change', 1)
        ) AS t(fn, esperado)
    LOOP
        v_def := pg_get_functiondef(('public.' || v_fn.fn)::regproc);
        v_n := (length(v_def) - length(replace(v_def, c_de, ''))) / length(c_de);
        IF v_n <> v_fn.esperado THEN
            RAISE EXCEPTION '%: ancora achada % vezes (esperado %)', v_fn.fn, v_n, v_fn.esperado;
        END IF;
        EXECUTE replace(v_def, c_de, c_para);
    END LOOP;
END $$;
