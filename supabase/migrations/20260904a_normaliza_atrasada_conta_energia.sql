-- ============================================================================
-- 'atrasado' nao existe no vocabulario da conta de energia
--
-- `invoices.status` (a fatura do assinante) usa 'atrasado', masculino.
-- `invoices.energy_bill_status` (a conta na concessionaria) usa 'atrasada',
-- feminino -- e e essa a chave que os leitores da tela conhecem.
--
-- Uma linha da base tinha 'atrasado' em `energy_bill_status`: a conta da UC
-- 7030839328, R$ 1.939,06, vencida em 26/08/2026. Nenhum leitor reconhecia o
-- valor, entao o badge caia no fallback e mostrava PENDENTE, e no kanban de
-- contas o card sumia da tela -- as colunas so existem para as chaves
-- conhecidas. Uma conta vencida ha nove dias exibida como pendente e pior do
-- que uma conta que nao aparece.
--
-- Os leitores passaram a aceitar as duas formas (InvoiceListManager
-- `resolveEnergyStatus` e InvoiceSummaryModal `getEnergyStatus`), o que impede
-- a repeticao do sintoma. Este UPDATE converge o dado numa forma so.
--
-- `derive_reading_status` ja tratava as duas grafias; nada mais na base filtra
-- por esse valor.
-- ============================================================================

update public.invoices
set energy_bill_status = 'atrasada'
where energy_bill_status = 'atrasado';
