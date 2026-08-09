-- =====================================================================
-- Duas decisoes do dono do produto, 08/08/2026.
-- Aplicadas em producao na mesma data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Taxa de gestao: 10% por padrao em toda usina.
--
--    O trigger do split faz COALESCE(gestao_percentual, 15), que so' age
--    em NULL. Como o campo estava em 0 (nao NULL) em 5 das 6 usinas, o
--    fallback nunca disparava e a receita da plataforma saia zerada em
--    todas elas. Corrige o dado E o default, para nao depender mais de
--    COALESCE em lugar nenhum.
--
--    UFV Bom Jesus ja' estava em 10 e nao e' tocada pela guarda do WHERE.
-- ---------------------------------------------------------------------
UPDATE public.usinas
   SET gestao_percentual = 10
 WHERE gestao_percentual IS NULL OR gestao_percentual = 0;

ALTER TABLE public.usinas
    ALTER COLUMN gestao_percentual SET DEFAULT 10;

COMMENT ON COLUMN public.usinas.gestao_percentual IS
    'Percentual da Gestora sobre a Tarifa Fornecedor. Padrao 10. NAO usar COALESCE(x,15) - o campo pode vir 0, que COALESCE nao trata.';

COMMENT ON COLUMN public.usinas.gestao_percent IS
    'OBSOLETA. Duplicata de gestao_percentual, NULL em todas as linhas. Nenhum codigo le. Nao usar.';

-- ---------------------------------------------------------------------
-- 2. Remove o trigger que sincronizava a tarifa de referencia para dentro
--    de consumer_units.
--
--    Ele contradizia a regra do negocio: o que vale e' a tarifa apurada na
--    conta de energia; a tabela Concessionaria e' regua de auditoria, nao
--    fonte. Com o trigger armado:
--      - fn_auditar_tarifa comparava a referencia consigo mesma, devolvendo
--        divergente=false trivialmente para toda UC sincronizada;
--      - o faturamento historico nao era reproduzivel, porque
--        fn_faturamento_mensal_usina e' STABLE e le cadastro mutavel sem
--        snapshot - uma importacao de Concessionaria mudava meses fechados;
--      - toda UC cujo endereco nao casasse por municipio+UF ficava com
--        tarifa zero para sempre e sumia do faturamento.
--
--    CONSEQUENCIA ACEITA PELO DONO: sem o trigger, consumer_units.te/tusd
--    congelam no valor atual ate' a extracao da conta passar a preencher
--    invoices.te_apurado / tusd_apurado. Esse plano ainda nao foi feito.
--
--    A funcao sync_tariffs_to_entities e' preservada, sem gatilho, para
--    consulta e eventual religamento manual.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_concessionaria_changes ON public."Concessionaria";

COMMENT ON FUNCTION public.sync_tariffs_to_entities() IS
    'DESARMADA em 08/08/2026. O trigger trg_sync_concessionaria_changes foi removido: ela escrevia a tarifa de referencia dentro de consumer_units, contradizendo a regra de que o que vale e a conta de energia. Mantida sem gatilho apenas para consulta.';
