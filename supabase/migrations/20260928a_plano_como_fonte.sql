-- Task 3 (Split de Pagamentos): o plano como fonte unica de gestao, piso,
-- desconto, modalidade e matriz de comissao por cargo/nivel.
-- Spec: .superpowers/sdd/2026-09-27-split-de-pagamentos/task-3-brief.md
--
-- planos_assinatura_energia.desconto_assinante ja existe (coluna de tabela,
-- ja usada por src/pages/settings/components/PlanModal.jsx) -- nao mexemos
-- nela aqui, so as tres que faltam: gestao_percentual, piso_fornecedor_pct
-- e modalidade. usinas.gestao_percentual/modalidade e
-- consumer_units.desconto_assinante tambem ja existem e ficam intactos: a
-- partir desta migracao a coluna do PLANO e que e a fonte, mas o motor so
-- passa a ler dali na Task 6 (constraint global: substituicao direta, nao
-- convivencia de dois mecanismos).

-- ---------------------------------------------------------------------
-- 1. planos_assinatura_energia: colunas que faltam
-- ---------------------------------------------------------------------
ALTER TABLE public.planos_assinatura_energia
  ADD COLUMN IF NOT EXISTS gestao_percentual numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS piso_fornecedor_pct numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS modalidade text;

ALTER TABLE public.planos_assinatura_energia DROP CONSTRAINT IF EXISTS planos_assinatura_energia_modalidade_check;
ALTER TABLE public.planos_assinatura_energia
  ADD CONSTRAINT planos_assinatura_energia_modalidade_check
  CHECK (modalidade IS NULL OR modalidade IN ('auto_consumo_remoto', 'geracao_compartilhada'));

COMMENT ON COLUMN public.planos_assinatura_energia.gestao_percentual IS
  'Percentual de gestao do plano (default 10, decisao do dono/Task 1: gestao a 10% nao mudou dinheiro no trimestre avaliado). Fonte de gestao a partir desta task; usinas.gestao_percentual continua no banco mas deixa de ser lido pelo motor na Task 6.';
COMMENT ON COLUMN public.planos_assinatura_energia.piso_fornecedor_pct IS
  'Piso do fornecedor: percentual minimo da tarifa bruta que o fornecedor recebe (default 50, global-constraints.md). Fonte do piso a partir desta task -- ate aqui so existia dentro de recorrente_config->lastro_tarifario, que e referencia de simulador (ver comentario em recorrente_config).';
COMMENT ON COLUMN public.planos_assinatura_energia.modalidade IS
  'Modalidade do plano: auto_consumo_remoto ou geracao_compartilhada (mesmo vocabulario do enum usina_modalidade / consumer_units.modalidade). Fonte de modalidade a partir desta task; usinas.modalidade continua no banco mas deixa de ser lido pelo motor na Task 6. NULL = plano ainda nao amarrado a uma modalidade especifica.';
COMMENT ON COLUMN public.planos_assinatura_energia.recorrente_config IS
  'Configuracao da recompensa recorrente. A chave regras_multinivel e a fonte da matriz de comissao por cargo/nivel (percentuais relativos a quem recebe: b2w 10 fixo em L1-L4; lider 1/1/1/0 ate L3; ppe 5/2 ate L2; ppp 4/2 ate L2; ppf 2/2 ate L2; assinante_conect 2 so em L1 -- decisao do dono, 27/09/2026). A chave lastro_tarifario e SO referencia do simulador (Task 1, 27/09/2026): a base real do motor de pagamento e valor_a_pagar - valor_concessionaria (fatura real), nunca a formula fixa de lastro_tarifario -- ela nao e, e nunca foi, fonte do motor. A chave regras (flat, legado) espelha o nivel 1 de regras_multinivel so por compatibilidade de leitura antiga.';

-- Backfill dos 2 planos existentes: piso_fornecedor_pct a partir do que ja
-- estava em lastro_tarifario (ambos com 50, mesmo valor do default acima,
-- mas explicito para nao depender de coincidencia); gestao_percentual fica
-- no default (10) porque nao havia equivalente no JSON.
UPDATE public.planos_assinatura_energia
   SET piso_fornecedor_pct = COALESCE((recorrente_config#>>'{lastro_tarifario,piso_fornecedor_pct}')::numeric, 50)
 WHERE recorrente_config ? 'lastro_tarifario';

-- ---------------------------------------------------------------------
-- 2. usinas e consumer_units apontam para o plano
-- ---------------------------------------------------------------------
ALTER TABLE public.usinas
  ADD COLUMN IF NOT EXISTS plano_assinatura_id uuid REFERENCES public.planos_assinatura_energia(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usinas_plano_assinatura_id ON public.usinas (plano_assinatura_id);

COMMENT ON COLUMN public.usinas.plano_assinatura_id IS
  'Plano de assinatura que rege esta usina (gestao/piso/desconto/modalidade/matriz), usado como fallback por fn_plano_da_uc quando a UC nao tem plano proprio. NULL = usina sem plano atribuido ainda.';

ALTER TABLE public.consumer_units
  ADD COLUMN IF NOT EXISTS plano_assinatura_id uuid REFERENCES public.planos_assinatura_energia(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_consumer_units_plano_assinatura_id ON public.consumer_units (plano_assinatura_id);

COMMENT ON COLUMN public.consumer_units.plano_assinatura_id IS
  'Plano de assinatura desta UC especificamente; tem prioridade sobre o plano da usina em fn_plano_da_uc. NULL = usa o plano da usina (ou nenhum).';

-- ---------------------------------------------------------------------
-- 3. fn_plano_da_uc: resolve o plano de uma UC
--    Ordem: plano da UC -> plano da usina da UC -> NULL.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plano_da_uc(p_uc uuid)
RETURNS public.planos_assinatura_energia
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT p.*
    FROM public.consumer_units cu
    LEFT JOIN public.usinas u ON u.id = cu.usina_id
    LEFT JOIN public.planos_assinatura_energia p
      ON p.id = COALESCE(cu.plano_assinatura_id, u.plano_assinatura_id)
   WHERE cu.id = p_uc;
$fn$;

COMMENT ON FUNCTION public.fn_plano_da_uc(uuid) IS
  'Resolve o plano de assinatura de uma UC: plano_assinatura_id da propria UC primeiro, senao o plano_assinatura_id da usina da UC, senao NULL. UC inexistente tambem devolve NULL (nao estoura erro).';

-- ---------------------------------------------------------------------
-- 4. fn_regras_recompensa_uc: percentuais normalizados prontos para o
--    motor de pagamento (Task 6) consumir.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_regras_recompensa_uc(p_uc uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_plano public.planos_assinatura_energia;
BEGIN
  v_plano := public.fn_plano_da_uc(p_uc);

  IF v_plano.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'plano_id', v_plano.id,
    'gestao_pct', v_plano.gestao_percentual,
    'piso_pct', v_plano.piso_fornecedor_pct,
    'desconto_pct', v_plano.desconto_assinante,
    'modalidade', v_plano.modalidade,
    'regras_multinivel', v_plano.recorrente_config->'regras_multinivel',
    'start_config', v_plano.start_config
  );
END;
$fn$;

COMMENT ON FUNCTION public.fn_regras_recompensa_uc(uuid) IS
  'Devolve {plano_id, gestao_pct, piso_pct, desconto_pct, modalidade, regras_multinivel, start_config} do plano resolvido por fn_plano_da_uc para a UC, ou NULL quando nao ha plano (nem na UC, nem na usina).';

-- ---------------------------------------------------------------------
-- 5. Normalizacao da matriz nos 2 planos existentes (Plano Premium,
--    Plano Ultra) -- decisao do dono, 27/09/2026, percentuais relativos a
--    quem recebe. ppp/lider/b2w ja batiam com o acordado; ppe, ppf e
--    assinante_conect precisavam de ajuste. Substituicao integral do
--    objeto (nao patch por chave) para garantir que os dois planos ficam
--    byte-a-byte iguais na matriz, como pedido.
-- ---------------------------------------------------------------------
UPDATE public.planos_assinatura_energia
   SET recorrente_config = jsonb_set(
         recorrente_config,
         '{regras_multinivel}',
         '{
            "b2w":  {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
            "lider": {"niveis": {"L1": "1",  "L2": "1",  "L3": "1",  "L4": "0"}, "max_niveis": 3},
            "ppe":  {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"}, "max_niveis": 2},
            "ppp":  {"niveis": {"L1": "4",  "L2": "2",  "L3": "0",  "L4": "0"}, "max_niveis": 2},
            "ppf":  {"niveis": {"L1": "2",  "L2": "2",  "L3": "0",  "L4": "0"}, "max_niveis": 2},
            "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}
         }'::jsonb
       )
 WHERE nome IN ('Plano Premium', 'Plano Ultra');

-- `regras` (flat, legado) passa a espelhar o nivel 1 da matriz acima, com
-- as mesmas 6 chaves modernas -- sem associacao/embaixador/coordenador/
-- assinante, para nao haver dois vocabularios (global-constraints.md).
UPDATE public.planos_assinatura_energia
   SET recorrente_config = jsonb_set(
         recorrente_config,
         '{regras}',
         '{"b2w": 10, "lider": 1, "ppe": 5, "ppp": 4, "ppf": 2, "assinante_conect": 2}'::jsonb
       )
 WHERE nome IN ('Plano Premium', 'Plano Ultra');

-- start_config.regras.{1,2,3}: so remove as 4 chaves legadas, mantendo os
-- valores atuais das 6 chaves modernas (bonus Start e regra de negocio
-- separada da matriz recorrente, o dono nao pediu para mexer nela aqui).
UPDATE public.planos_assinatura_energia
   SET start_config = jsonb_set(
         jsonb_set(
           jsonb_set(
             start_config,
             '{regras,1}',
             (start_config#>'{regras,1}') - 'associacao' - 'embaixador' - 'coordenador' - 'assinante'
           ),
           '{regras,2}',
           (start_config#>'{regras,2}') - 'associacao' - 'embaixador' - 'coordenador' - 'assinante'
         ),
         '{regras,3}',
         (start_config#>'{regras,3}') - 'associacao' - 'embaixador' - 'coordenador' - 'assinante'
       )
 WHERE nome IN ('Plano Premium', 'Plano Ultra')
   AND start_config ? 'regras';
