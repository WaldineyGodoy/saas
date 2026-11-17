-- NDA / Termo de Confidencialidade gerado no modal do lead (aba Comunicados).
--
-- `leads.contract_terms.nda` guarda os campos do gerador e, só quando
-- editada à mão, a minuta. A assinatura vai para `signatures` com
-- signer_type='lead' (já permitido) e document_type='nda'. O webhook da
-- Autentique só carimba o status: NDA assinado não muda o status do lead.

alter table public.leads
    add column if not exists contract_terms jsonb not null default '{}'::jsonb;

alter table public.signatures drop constraint if exists signatures_document_type_check;
alter table public.signatures add constraint signatures_document_type_check
    check (document_type is null or document_type = any (array[
        'adesao', 'gestao', 'compra_venda', 'arrendamento', 'om',
        'transferencia_titularidade', 'originacao', 'nda'
    ]));
