-- UC que nunca gera cobranca ao assinante.
--
-- A "B2W - Conta Saldo" (7029875787) e uma UC beneficiaria cujo assinante e a
-- propria ASSOCIACAO DE USINAS B2W ENERGIA: emitir boleto seria a B2W cobrando
-- de si mesma. Ela passava limpa pelo auditor -- nenhuma das 7 regras sabia
-- disso -- e so ficava de fora porque o operador lembrava de exclui-la a mao.
-- Ao ligar a emissao automatica, "o operador lembra" deixa de ser um portao.
--
-- Flag explicita em vez de casar por numero ou por nome: o numero muda em troca
-- de titularidade e o nome e texto livre. Mesmo padrao de fatura_consumo_terceiro.
--
-- NOTA: esta migration ALTERA a funcao criada em 20260823a_fn_auditar_fatura.sql,
-- reescrevendo-a a partir da definicao vigente no banco. Depende daquela ter sido
-- aplicada antes. As duas ancoras sao verificadas: se qualquer uma nao casar, a
-- migration falha em vez de aplicar pela metade.

ALTER TABLE public.consumer_units
    ADD COLUMN IF NOT EXISTS nao_faturavel boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consumer_units.nao_faturavel IS
    'UC que nunca gera cobranca ao assinante (ex.: conta saldo da propria associacao). Bloqueia a emissao em fn_auditar_fatura.';

UPDATE public.consumer_units
   SET nao_faturavel = true
 WHERE numero_uc = '7029875787';

DO $mig$
DECLARE d text; d0 text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_auditar_fatura';
  IF d IS NULL THEN RAISE EXCEPTION 'fn_auditar_fatura nao existe: aplique 20260823a antes'; END IF;
  d0 := d;

  d := replace(d,
    'cu.address->>''cidade'' as cidade, cu.data_desligamento',
    'cu.address->>''cidade'' as cidade, cu.data_desligamento, cu.nao_faturavel');
  IF d = d0 THEN RAISE EXCEPTION 'ancora do SELECT nao encontrada'; END IF;
  d0 := d;

  d := replace(d,
    '-- ---------------- BLOQUEIOS ----------------',
    '-- ---------------- BLOQUEIOS ----------------' || chr(10) || chr(10) ||
    '    -- UC marcada como nao faturavel (ex.: conta saldo da propria' || chr(10) ||
    '    -- associacao). Emitir boleto seria a B2W cobrando de si mesma.' || chr(10) ||
    '    if coalesce(f.nao_faturavel, false) then' || chr(10) ||
    '        codigo := ''uc_nao_faturavel''; severidade := ''bloqueio'';' || chr(10) ||
    '        mensagem := format(''UC %s esta marcada como nao faturavel no cadastro: ela nao gera cobranca ao assinante.'', f.numero_uc);' || chr(10) ||
    '        return next; return;' || chr(10) ||
    '    end if;');
  IF d = d0 THEN RAISE EXCEPTION 'ancora dos BLOQUEIOS nao encontrada'; END IF;

  EXECUTE d;
END
$mig$;
