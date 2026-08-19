-- Contrato de gestão do fornecedor: assinatura via Autentique.
--
-- A tabela `signatures` só aceitava 'subscriber' e 'lead'. Sem esta
-- migration, gerar o contrato de um fornecedor falha no INSERT da
-- create-autentique-document — e falha DEPOIS de o documento já ter subido
-- para a Autentique, deixando um documento órfão lá e nenhum registro aqui.

alter table public.signatures
    drop constraint if exists signatures_signer_type_check;

alter table public.signatures
    add constraint signatures_signer_type_check
    check (signer_type = any (array['subscriber'::text, 'lead'::text, 'supplier'::text]));

-- Atalho para o link de assinatura vigente, igual ao que subscribers já tem.
-- Evita varrer `signatures` só para mostrar o link na tela do fornecedor.
alter table public.suppliers
    add column if not exists signature_link text;

comment on column public.suppliers.signature_link is
    'Último link de assinatura (Autentique, encurtado pelo YOURLS) do Contrato de Gestão. O histórico completo fica em public.signatures.';

-- Status do fornecedor. 'contrato_assinado' entra entre 'ativacao' e 'ativo':
-- assinar o contrato e a usina estar gerando são marcos distintos, separados
-- por meses de projeto e conexão.
--
-- A coluna era texto livre, e o kanban do SupplierList cai no rótulo
-- 'Inativo' para qualquer valor que não reconheça — um typo transformava um
-- fornecedor ativo em cancelado na tela, sem erro nenhum.
alter table public.suppliers
    drop constraint if exists suppliers_status_check;

alter table public.suppliers
    add constraint suppliers_status_check
    check (status = any (array['ativacao'::text, 'contrato_assinado'::text, 'ativo'::text, 'inativo'::text]));
