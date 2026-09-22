-- Task 14, fix round 1 (C1c/I2): contador dos envios de lead-mensagem.
--
-- Os limites (3 por lead por dia, 20 por embaixador por dia) contavam
-- crm_history, que qualquer usuario logado pode apagar (policy ALL true) --
-- o embaixador zerava o proprio limite. Esta tabela so e lida/escrita pela
-- Edge Function com service_role: RLS ligada, nenhuma policy, e nenhum
-- privilegio para anon/authenticated.
--
-- Sem FK para leads de proposito: com ON DELETE CASCADE o embaixador (que
-- pode apagar os proprios leads) zeraria o contador apagando o lead.
CREATE TABLE IF NOT EXISTS public.lead_mensagens_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  originator_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  modelo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_mensagens_envios_originador_idx
  ON public.lead_mensagens_envios (originator_id, criado_em);
CREATE INDEX IF NOT EXISTS lead_mensagens_envios_lead_idx
  ON public.lead_mensagens_envios (lead_id, criado_em);

ALTER TABLE public.lead_mensagens_envios ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lead_mensagens_envios FROM anon, authenticated;
GRANT ALL ON public.lead_mensagens_envios TO service_role;

COMMENT ON TABLE public.lead_mensagens_envios IS
  'Reserva/contagem dos envios de lead-mensagem (limites 3/lead/dia e 20/embaixador/dia). So service_role.';
