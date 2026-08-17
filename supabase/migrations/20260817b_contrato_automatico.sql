-- =====================================================================
-- Contrato automático — status e pré-requisitos
-- Data: 17/08/2026
--
-- Complementa 20260817a_onboarding_publico.sql: a adesão pública agora
-- gera e envia o contrato sozinha, sem admin. Falta o estado que
-- representa "assinou" e o acesso de leitura à marca.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Estado "contrato assinado"
--    Entra logo depois de `ativacao`, que é o estado em que a RPC de
--    adesão cria o assinante. O webhook da Autentique promove daqui.
--
--    ATENÇÃO: ALTER TYPE ... ADD VALUE não roda junto com um uso do
--    valor novo na mesma transação. Rode este bloco isolado.
-- ---------------------------------------------------------------------
ALTER TYPE public.subscriber_status ADD VALUE IF NOT EXISTS 'contrato_assinado' AFTER 'ativacao';

-- Ordem resultante:
--   ativacao, contrato_assinado, ativo, ativo_inadimplente,
--   transferido, cancelado, cancelado_inadimplente


-- ---------------------------------------------------------------------
-- 2. Marca visível para o visitante anônimo
--    A página pública gera o PDF do contrato no navegador do próprio
--    assinante e precisa do mesmo logo, cor e razão social que o CRM
--    usa — senão o contrato do cliente sai diferente do contrato do
--    admin. São dados públicos de marca; não há segredo aqui.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "branding_anon_read" ON public.branding_settings;
CREATE POLICY "branding_anon_read" ON public.branding_settings
  FOR SELECT TO anon USING (true);

GRANT SELECT ON public.branding_settings TO anon;
