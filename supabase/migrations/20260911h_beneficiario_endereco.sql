-- Complemento da Task 2, exigido pela Task 11 (gerador de contrato).
--
-- Cada arrendante entra QUALIFICADO na clausula do contrato, com nome,
-- documento e endereco. Com dois donos, o endereco deixa de ser da area e
-- passa a ser da pessoa.

alter table public.leased_area_beneficiaries
    add column if not exists endereco jsonb default '{}'::jsonb;

comment on column public.leased_area_beneficiaries.endereco is
    'Endereco do beneficiario. Cada arrendante entra QUALIFICADO na clausula do contrato, entao o endereco e por pessoa, nao por area.';

update public.leased_area_beneficiaries b
   set endereco = coalesce(la.arrendante_endereco, '{}'::jsonb)
  from public.leased_areas la
 where la.id = b.leased_area_id
   and b.tipo = 'terceiro'
   and (b.endereco is null or b.endereco = '{}'::jsonb)
   and la.arrendante_endereco is not null;

comment on column public.leased_areas.arrendante_endereco is
    'APOSENTADO em 11/09/2026. Migrado para leased_area_beneficiaries.endereco.';
