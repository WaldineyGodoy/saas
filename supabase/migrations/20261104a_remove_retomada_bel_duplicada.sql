-- A regra geral de follow-up esgotado (20261103b, trg_ponte_fu_esgotado_encerra) já cobre a Bel.
-- Remove a regra só da Bel, que ficou duplicada.
drop trigger if exists trg_ponte_retomada_esgotada on public.followup_enrollments;
drop function if exists ponte_deskcomm.fn_retomada_esgotada();
drop function if exists ponte_deskcomm.perder_por_retomada(uuid);
