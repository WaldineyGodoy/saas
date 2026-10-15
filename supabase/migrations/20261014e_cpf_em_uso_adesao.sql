-- =====================================================================
-- Adesão com CPF/CNPJ de assinante existente mostrava o erro cru do banco
-- ("duplicate key value violates unique constraint subscribers_doc_digits_uidx"),
-- reportado pelo dono em 14/10/2026 na adesão assistida do parceiro.
--
-- fn_criar_assinante_publico conferia com fn_documento_em_uso, que só
-- responde para chamador interno (fn_chamador_interno): para o anon (site) e
-- para o parceiro (app) devolvia sempre false, e a gravação esbarrava no
-- índice único. A conferência passa a ser feita aqui dentro, direto na
-- tabela, com a mesma regra do índice. Não revela mais do que o índice já
-- revelava: só troca o erro técnico pela mensagem.
-- =====================================================================
DO $migr$
DECLARE
  v_def text := pg_get_functiondef(
    'public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,integer,text,text,text,text)'::regprocedure);
  v_de text := '  IF public.fn_documento_em_uso(v_doc) THEN';
  v_para text := '  -- Direto na tabela: fn_documento_em_uso so responde a chamador interno (20261014e).
  IF EXISTS (SELECT 1 FROM public.subscribers s
              WHERE public.fn_so_digitos(s.cpf_cnpj) = v_doc
                AND s.status NOT IN (''cancelado'', ''cancelado_inadimplente'')) THEN';
BEGIN
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'fn_criar_assinante_publico: trecho do CPF em uso nao encontrado exatamente uma vez';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$migr$;
