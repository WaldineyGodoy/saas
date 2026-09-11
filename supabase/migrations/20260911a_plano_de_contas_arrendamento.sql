-- Task 1 do plano 2026-09-11-arrendamento-repasse.
--
-- Arrendamento nunca foi receita da B2W. Ela cobra do fornecedor para
-- repassar ao dono da terra, e o razao registrava os dois lados como se o
-- dinheiro ficasse na casa: 100% do valor cobrado ia para 3.1.4, conta de
-- receita, e o pagamento ao arrendante nao tinha contrapartida para debitar.
-- Sem passivo, nao ha como pagar sem desarrumar o razao.
--
-- Esta migration so cria contas e corrige um nome. Nenhum lancamento e'
-- gerado aqui.
--
-- SALDO PENDENTE: 3.1.4 carrega R$ 1.200,00 (competencias rotuladas
-- Junho e Julho/2026, UFV Bom Jesus, transacoes a023778f e d1f4c4f6) que
-- pertencem ao Jose Santiago e serao reclassificados para 2.1.5 na Task 12.
-- Ate' la' a conta continua afirmando um lucro que nao existe. Comentario
-- fica aqui porque o Postgres nao tem COMMENT por linha.

-- O passivo que faltava. Enquanto ele nao existia, um PIX a arrendante caia
-- em 2.1.0, que e' conta-titulo: receber lancamento ali e' defeito.
insert into public.ledger_accounts (code, name, type, parent_id)
select '2.1.5', 'Arrendamento a Pagar', 'liability', id
  from public.ledger_accounts where code = '2.1.0'
on conflict (code) do nothing;

-- Grupo de despesa operacional. 4.1.0 e' financeira (taxas de banco) e nao
-- comporta arrendamento.
insert into public.ledger_accounts (code, name, type, parent_id)
select '4.2.0', 'Despesas Operacionais', 'expense', id
  from public.ledger_accounts where code = '4.0.0'
on conflict (code) do nothing;

-- Usina em obra nao tem fornecedor a debitar: o arrendamento do periodo e'
-- custo da propria B2W (decisao do dono em 11/09/2026, spec secao 2). O
-- caminho de saida continua sendo o mesmo do regime normal -- muda a origem
-- do debito, nunca o trilho do pagamento.
insert into public.ledger_accounts (code, name, type, parent_id)
select '4.2.1', 'Arrendamento de Áreas (pré-operação)', 'expense', id
  from public.ledger_accounts where code = '4.2.0'
on conflict (code) do nothing;

-- 3.1.4 passa a receber so' a margem de intermediacao, nao o aluguel inteiro.
-- O nome antigo descrevia o erro.
update public.ledger_accounts
   set name = 'Receita de Intermediação de Arrendamento'
 where code = '3.1.4'
   and name is distinct from 'Receita de Intermediação de Arrendamento';
