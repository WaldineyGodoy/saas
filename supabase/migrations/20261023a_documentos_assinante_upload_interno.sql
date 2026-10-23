-- Upload de documentos do assinante pelo CRM.
--
-- O bucket `documentos-assinante` so tinha politica de LEITURA para o time
-- interno (documentos_assinante_interno_leitura). A escrita existia apenas
-- por URL assinada, emitida pela Edge Function `onboarding-documentos` a
-- quem tem o token do assistente publico. Resultado: o modal do assinante no
-- CRM mostrava "Nenhum documento enviado" e nao tinha como anexar.
--
-- Mesmo criterio da leitura e de subscriber_documents (check_user_is_admin:
-- admin, super_admin, manager), restrito ao bucket de documentos. Sem
-- UPDATE nem DELETE de proposito: documento de identidade enviado nao se
-- sobrescreve nem se apaga pelo cliente do navegador.
CREATE POLICY documentos_assinante_interno_escrita
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documentos-assinante'
    AND public.check_user_is_admin(auth.uid())
  );
