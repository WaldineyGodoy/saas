-- Cronograma da obra da usina (aba Planta do modal da usina), nos moldes de
-- b2winvest.com.br/usinas-disponiveis/: 4 macroetapas com itens fixos.
-- Formato (src/lib/cronogramaObra.js):
--   { "itens": { "<item_id>": { "status": "previsto|andamento|concluido",
--                               "pct": 0-100, "concluido_em": "AAAA-MM-DD",
--                               "previsto_para": "AAAA-MM-DD" } } }
-- Aditiva: a RLS de usinas ja cobre a coluna (interno grava; fornecedor le a
-- propria usina).
ALTER TABLE public.usinas
    ADD COLUMN IF NOT EXISTS cronograma_obra jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.usinas.cronograma_obra IS
    'Cronograma da obra: { itens: { <item_id>: { status, pct, concluido_em, previsto_para } } }. Catalogo de itens em src/lib/cronogramaObra.js.';
