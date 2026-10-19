-- Contrato de Originação e Indicação de Negócios.
--
-- Três coisas faltavam para o originador ter contrato como as demais
-- partes: onde guardar as condições e a minuta editada à mão, e os dois
-- CHECKs de `signatures`, que recusavam tanto o tipo de signatário quanto
-- o tipo de documento. Sem eles a Autentique cria o documento e o banco
-- recusa o registro, deixando documento órfão — já aconteceu com o termo
-- de transferência de titularidade.

alter table public.originators_v2
    add column if not exists contract_terms jsonb not null default '{}'::jsonb;

comment on column public.originators_v2.contract_terms is
    'Condições do contrato de originação (modalidades, prazos, foro) e a minuta editada à mão em .minutas.originador.';

alter table public.signatures drop constraint if exists signatures_signer_type_check;
alter table public.signatures add constraint signatures_signer_type_check
    check (signer_type = any (array['subscriber', 'lead', 'supplier', 'consumer_unit', 'originador']));

alter table public.signatures drop constraint if exists signatures_document_type_check;
alter table public.signatures add constraint signatures_document_type_check
    check ((document_type is null) or (document_type = any (array[
        'adesao', 'gestao', 'compra_venda', 'arrendamento', 'om',
        'transferencia_titularidade', 'originacao'
    ])));
