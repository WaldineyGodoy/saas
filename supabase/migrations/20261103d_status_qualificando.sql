-- Status "Qualificando" no CRM B2W, igual à etapa do Deskcomm (03/11/2026).
-- Em migration própria: valor novo de enum não pode ser usado na mesma transação.
alter type public.lead_status add value if not exists 'qualificando' before 'simulacao';
