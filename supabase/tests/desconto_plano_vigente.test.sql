-- Sandbox: adesão pelo site (sem plano) usa o plano vigente da distribuidora.
-- Rodar depois da migração 20261014d, na mesma transação; tudo é desfeito.
DO $t$
DECLARE r jsonb; v_uc record; v_plano uuid;
BEGIN
  SELECT p.id INTO v_plano FROM planos_assinatura_energia p JOIN planos_distribuidoras d ON d.plano_id = p.id
   WHERE p.ativo AND p.status = 'ativo' AND lower(d.concessionaria) = 'neoenergia cosern';
  SET LOCAL ROLE anon;
  r := to_jsonb(public.fn_criar_assinante_publico('Teste Sandbox', '52998224725', 'sandbox-teste@example.invalid', '84999990000', '59000000', 'Rua Teste', '1', null, 'Centro', 'Natal', 'RN', '2408102',
     '6a48a802-35cf-4d1d-972d-36af9af9632c', null,
     '[{"numero_uc":"999000111","titular_conta":"Teste Sandbox","cpf_cnpj_fatura":"52998224725","tipo_ligacao":"trifasico","concessionaria":"Neoenergia Cosern","franquia":"0","ibge":"2408102","cep":"59000000","rua":"Rua Teste","numero":"1","bairro":"Centro","cidade":"Natal","uf":"RN"}]'::jsonb,
     10, null, null, 'v-sandbox', null));
  RESET ROLE;
  SELECT c.desconto_assinante, c.plano_assinatura_id INTO v_uc FROM consumer_units c WHERE c.subscriber_id = (r->>'subscriber_id')::uuid;
  IF v_uc.plano_assinatura_id IS DISTINCT FROM v_plano THEN RAISE EXCEPTION 'FALHOU: plano %', v_uc.plano_assinatura_id; END IF;
  RAISE EXCEPTION 'SANDBOX_OK desconto=% retorno=%', v_uc.desconto_assinante, r->>'desconto';
END
$t$;
