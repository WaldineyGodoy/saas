-- =====================================================================
-- Assinante Conect: link de indicacao proprio do assinante
-- Data: 28/09/2026
--
-- No Plano de Recompensas o assinante tambem indica, e recebe 2% do
-- nivel 1 como abatimento na propria fatura. O motor do split resolve
-- esse beneficiario por `consumer_units.indicado_por_uc_id` (migracao
-- 20260927a): a UC indicada aponta para a UC de quem indicou. O que
-- faltava era quem popula essa coluna -- ou seja, o link.
--
-- Esta migracao entrega o caminho inteiro da atribuicao:
--   1. `subscribers.short_url`            -> o link curto do assinante
--   2. `subscribers.indicador_assinante_id` -> quem o trouxe
--   3. `leads.indicador_assinante_id`     -> atribuicao ja no lead
--   4. gatilho que encurta no YOURLS quando o contrato e assinado
--   5. `fn_criar_assinante_publico` v3, que fecha a arvore por UC
--
-- Sem isso o link existiria na tela e a indicacao se perderia em
-- silencio na adesao -- exatamente o que aconteceu com o `/convite/`
-- do embaixador, que ficou meses devolvendo 404.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------

ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS short_url text,
  ADD COLUMN IF NOT EXISTS indicador_assinante_id uuid;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS indicador_assinante_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscribers_indicador_assinante_id_fkey') THEN
    ALTER TABLE public.subscribers
      ADD CONSTRAINT subscribers_indicador_assinante_id_fkey
      FOREIGN KEY (indicador_assinante_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_indicador_assinante_id_fkey') THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_indicador_assinante_id_fkey
      FOREIGN KEY (indicador_assinante_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Parcial porque a esmagadora maioria das linhas nao tem indicador, e o
-- que se consulta e sempre "quem eu indiquei".
CREATE INDEX IF NOT EXISTS idx_subscribers_indicador
  ON public.subscribers (indicador_assinante_id) WHERE indicador_assinante_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_indicador_assinante
  ON public.leads (indicador_assinante_id) WHERE indicador_assinante_id IS NOT NULL;

COMMENT ON COLUMN public.subscribers.short_url IS
  'Link curto (YOURLS) de indicacao do Assinante Conect. Gerado pelo gatilho trg_assinante_short_url quando o contrato e assinado.';
COMMENT ON COLUMN public.subscribers.indicador_assinante_id IS
  'Assinante Conect que trouxe este assinante. A arvore que o split usa e por UC (consumer_units.indicado_por_uc_id); esta coluna e o vinculo entre pessoas, para tela e extrato.';
COMMENT ON COLUMN public.leads.indicador_assinante_id IS
  'Assinante Conect que trouxe este lead (parametro ?indicador= da raiz). A adesao herda daqui quando o /contrato e aberto sem o parametro.';

-- ---------------------------------------------------------------------
-- 2. Guarda de ciclo
--
-- A do lado da UC (fn_uc_sem_ciclo, 20260927a) protege o motor do split.
-- Esta protege a tela e o extrato: rede em circulo faz a contagem de
-- indicados girar para sempre.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_assinante_indicador_sem_ciclo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cursor uuid;
  v_saltos int := 0;
BEGIN
  IF NEW.indicador_assinante_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.indicador_assinante_id = NEW.id THEN
    RAISE EXCEPTION 'Um assinante nao pode ser indicado por ele mesmo.' USING ERRCODE = '22023';
  END IF;

  -- Sobe a cadeia: se reencontrar quem esta sendo gravado, e circulo.
  -- O teto de 50 e o mesmo de fn_uc_sem_ciclo, e existe para nao rodar
  -- para sempre se algum dia entrar ciclo por caminho sem gatilho.
  v_cursor := NEW.indicador_assinante_id;
  WHILE v_cursor IS NOT NULL AND v_saltos < 50 LOOP
    SELECT s.indicador_assinante_id INTO v_cursor FROM public.subscribers s WHERE s.id = v_cursor;
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'Indicacao em circulo: este assinante ja esta acima na cadeia de indicacao.' USING ERRCODE = '22023';
    END IF;
    v_saltos := v_saltos + 1;
  END LOOP;

  IF v_saltos >= 50 THEN
    RAISE EXCEPTION 'Cadeia de indicacao passou de 50 niveis: verifique a rede antes de gravar.' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fn_assinante_indicador_sem_ciclo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assinante_indicador_sem_ciclo ON public.subscribers;
CREATE TRIGGER trg_assinante_indicador_sem_ciclo
  BEFORE INSERT OR UPDATE OF indicador_assinante_id ON public.subscribers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_assinante_indicador_sem_ciclo();

-- ---------------------------------------------------------------------
-- 3. Link curto quando o contrato e assinado
--
-- Espelha trg_originador_short_url (20260817c). Fica no banco, e nao na
-- tela, porque o contrato pode ser marcado como assinado pelo webhook da
-- Autentique, pelo modal do CRM ou por SQL -- e nenhum desses caminhos
-- deveria ter de lembrar de gerar link.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_assinante_gerar_short_url()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $fn$
BEGIN
  -- Quem ja tem link nao e reencurtado: cada chamada criaria uma keyword
  -- nova para o mesmo destino, e o assinante teria dois links no ar.
  IF NEW.short_url IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Antes de assinar ele nao e cliente: link divulgado nessa hora pendura
  -- rede em contrato que pode nunca existir.
  IF NEW.status NOT IN ('contrato_assinado', 'ativo', 'ativo_inadimplente') THEN
    RETURN NEW;
  END IF;

  -- Em UPDATE, so quando o status mudou de fato. Sem isso, qualquer
  -- gravacao no assinante (telefone, endereco) dispararia o YOURLS.
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- pg_net e assincrono: a requisicao sai depois do COMMIT. Se a
  -- transacao voltar atras, a chamada volta junto, e uma queda do YOURLS
  -- nao derruba a assinatura do contrato.
  PERFORM net.http_post(
    url     := 'https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/assinante-short-url',
    body    := jsonb_build_object('subscriber_id', NEW.id),
    params  := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000
  );

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fn_assinante_gerar_short_url() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_assinante_gerar_short_url() IS
  'Dispara a geracao do link curto de indicacao do Assinante Conect quando o assinante passa a ter contrato assinado. Assincrona via pg_net.';

DROP TRIGGER IF EXISTS trg_assinante_short_url ON public.subscribers;
CREATE TRIGGER trg_assinante_short_url
  AFTER INSERT OR UPDATE OF status ON public.subscribers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_assinante_gerar_short_url();

-- ---------------------------------------------------------------------
-- 4. fn_criar_assinante_publico v3 -- fecha a arvore na adesao
--
-- O DROP e necessario porque a assinatura ganha um parametro. Com DEFAULT
-- NULL, a chamada de 19 argumentos que o CRM em producao faz hoje
-- continua valendo, entao nao existe janela de quebra entre a migracao e
-- o deploy do front.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.fn_criar_assinante_publico(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  uuid, jsonb, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.fn_criar_assinante_publico(
  p_nome text, p_cpf_cnpj text, p_email text, p_telefone text, p_cep text, p_rua text,
  p_numero text, p_complemento text, p_bairro text, p_cidade text, p_uf text, p_ibge text,
  p_originator_id text, p_lead_id uuid, p_ucs jsonb, p_dia_vencimento integer,
  p_representante_nome text, p_representante_cpf text, p_aceite_versao text,
  p_indicador_assinante_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_doc text := public.fn_so_digitos(p_cpf_cnpj);
  v_tel text := public.fn_so_digitos(p_telefone);
  v_rep text := public.fn_so_digitos(p_representante_cpf);
  v_originator uuid; v_sub_id uuid; v_token uuid := gen_random_uuid();
  v_uc jsonb; v_uc_num text; v_tit text; v_desc numeric; v_n int := 0;
  v_descontos jsonb := '[]'::jsonb; v_desc_primeiro numeric;
  v_indicador uuid; v_uc_indicadora uuid;
BEGIN
  IF coalesce(btrim(p_aceite_versao), '') = '' THEN
    RAISE EXCEPTION 'Aceite os termos de uso e a politica de privacidade para continuar.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_nome), '') = '' THEN RAISE EXCEPTION 'Informe o nome completo.' USING ERRCODE = '22023'; END IF;
  IF v_doc IS NULL OR NOT public.fn_documento_valido(v_doc) THEN RAISE EXCEPTION 'CPF/CNPJ invalido.' USING ERRCODE = '22023'; END IF;
  IF length(v_doc) = 14 AND (coalesce(btrim(p_representante_nome), '') = '' OR v_rep IS NULL
       OR length(v_rep) <> 11 OR NOT public.fn_documento_valido(v_rep)) THEN
    RAISE EXCEPTION 'Para CNPJ, informe nome e CPF validos do representante legal.' USING ERRCODE = '22023';
  END IF;
  IF v_tel IS NULL OR length(v_tel) < 10 THEN RAISE EXCEPTION 'Telefone invalido. Informe DDD + numero.' USING ERRCODE = '22023'; END IF;
  IF coalesce(btrim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail invalido.' USING ERRCODE = '22023'; END IF;
  IF p_dia_vencimento IS NULL OR p_dia_vencimento NOT IN (5, 10, 15, 20) THEN
    RAISE EXCEPTION 'Escolha o dia de vencimento: 5, 10, 15 ou 20.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_ucs) <> 'array' OR jsonb_array_length(p_ucs) = 0 THEN
    RAISE EXCEPTION 'Cadastre pelo menos uma unidade consumidora.' USING ERRCODE = '22023';
  END IF;
  IF public.fn_documento_em_uso(v_doc) THEN
    RAISE EXCEPTION 'Ja existe um assinante com este CPF/CNPJ.' USING ERRCODE = '23505';
  END IF;

  -- originator_id vem da URL: texto invalido e ignorado, nunca derruba a adesao.
  IF p_originator_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT o.id INTO v_originator FROM public.originators_v2 o WHERE o.id = p_originator_id::uuid;
  END IF;
  IF v_originator IS NULL AND p_lead_id IS NOT NULL THEN
    SELECT l.originator_id INTO v_originator FROM public.leads l WHERE l.id = p_lead_id;
  END IF;

  -- Assinante Conect: mesma tolerancia do originador -- `?indicador=` que
  -- nao e UUID, ou que aponta para quem nao assinou contrato, e ignorado
  -- em vez de recusar a adesao. Perder a indicacao e ruim; perder o
  -- cliente e pior.
  IF p_indicador_assinante_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT s.id INTO v_indicador FROM public.subscribers s
     WHERE s.id = p_indicador_assinante_id::uuid
       AND s.status IN ('contrato_assinado', 'ativo', 'ativo_inadimplente');
  END IF;
  IF v_indicador IS NULL AND p_lead_id IS NOT NULL THEN
    SELECT l.indicador_assinante_id INTO v_indicador FROM public.leads l WHERE l.id = p_lead_id;
  END IF;

  -- Sem originador proprio, herda o do indicador: e assim que o Parceiro
  -- Power e o Lider continuam na linha quando a venda vem da rede.
  IF v_originator IS NULL AND v_indicador IS NOT NULL THEN
    SELECT s.originator_id INTO v_originator FROM public.subscribers s WHERE s.id = v_indicador;
  END IF;

  -- A arvore do split e por UC, nao por pessoa. Com indicador de varias
  -- UCs, a primeira (a mais antiga) e a que recebe -- decisao registrada
  -- na spec 2026-09-22, para nao depender da ordem em que ele cadastrou.
  IF v_indicador IS NOT NULL THEN
    SELECT cu.id INTO v_uc_indicadora FROM public.consumer_units cu
     WHERE cu.subscriber_id = v_indicador
       AND cu.status NOT IN ('cancelado', 'cancelado_inadimplente')
     ORDER BY cu.created_at NULLS LAST, cu.id
     LIMIT 1;
  END IF;

  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status, cep, rua, numero, complemento, bairro, cidade, uf,
    originator_id, lead_id, representante_nome, representante_cpf, aceite_termos_em, aceite_termos_versao,
    onboarding_token, onboarding_token_expira_em, indicador_assinante_id)
  VALUES (btrim(p_nome), v_doc, lower(btrim(p_email)), v_tel, 'ativacao', public.fn_so_digitos(p_cep), p_rua, p_numero,
    p_complemento, p_bairro, p_cidade, upper(p_uf), v_originator, p_lead_id,
    nullif(btrim(coalesce(p_representante_nome, '')), ''), v_rep, now(), btrim(p_aceite_versao),
    v_token, now() + interval '30 days', v_indicador)
  RETURNING id INTO v_sub_id;

  FOR v_uc IN SELECT * FROM jsonb_array_elements(p_ucs) LOOP
    v_uc_num := btrim(coalesce(v_uc->>'numero_uc', ''));
    v_tit := public.fn_so_digitos(v_uc->>'cpf_cnpj_fatura');
    IF v_uc_num = '' THEN RAISE EXCEPTION 'Numero da UC e obrigatorio.' USING ERRCODE = '22023'; END IF;
    IF v_tit IS NULL OR NOT public.fn_documento_valido(v_tit) THEN
      RAISE EXCEPTION 'CPF/CNPJ do titular da conta invalido na UC %.', v_uc_num USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_uc->>'tipo_ligacao', '') NOT IN ('monofasico', 'bifasico', 'trifasico') THEN
      RAISE EXCEPTION 'Informe o tipo de ligacao da UC %.', v_uc_num USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.consumer_units cu WHERE btrim(cu.numero_uc) = v_uc_num
                 AND cu.status NOT IN ('cancelado', 'cancelado_inadimplente')) THEN
      RAISE EXCEPTION 'A UC % ja esta cadastrada.', v_uc_num USING ERRCODE = '23505';
    END IF;
    v_desc := public.fn_desconto_assinante_municipio(coalesce(nullif(v_uc->>'ibge', ''), p_ibge), coalesce(nullif(v_uc->>'uf', ''), p_uf));
    IF coalesce(v_desc, 0) <= 0 THEN
      RAISE EXCEPTION 'Ainda nao temos desconto disponivel para este municipio.' USING ERRCODE = '22023';
    END IF;
    IF v_n = 0 THEN v_desc_primeiro := v_desc; END IF;
    v_descontos := v_descontos || jsonb_build_array(jsonb_build_object('numero_uc', v_uc_num, 'desconto', v_desc));

    INSERT INTO public.consumer_units (subscriber_id, numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao,
      concessionaria, status, modalidade, franquia, desconto_assinante, dia_vencimento, address, indicado_por_uc_id)
    VALUES (v_sub_id, v_uc_num, nullif(btrim(coalesce(v_uc->>'titular_conta', '')), ''), v_tit,
      (v_uc->>'tipo_ligacao')::public.uc_tipo_ligacao, nullif(btrim(coalesce(v_uc->>'concessionaria', '')), ''),
      'em_ativacao', 'geracao_compartilhada', nullif(v_uc->>'franquia', '')::numeric, v_desc, p_dia_vencimento,
      jsonb_build_object('cep', public.fn_so_digitos(v_uc->>'cep'), 'rua', v_uc->>'rua', 'numero', v_uc->>'numero',
        'complemento', v_uc->>'complemento', 'bairro', v_uc->>'bairro', 'cidade', v_uc->>'cidade', 'uf', upper(v_uc->>'uf')),
      v_uc_indicadora);
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('subscriber_id', v_sub_id, 'onboarding_token', v_token, 'ucs_criadas', v_n,
    'originador_vinculado', v_originator IS NOT NULL, 'desconto', v_desc_primeiro, 'descontos', v_descontos,
    'indicador_vinculado', v_indicador IS NOT NULL);
END;
$function$;

-- O DROP levou os grants com ele: a adesao publica roda como anon.
GRANT EXECUTE ON FUNCTION public.fn_criar_assinante_publico(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  uuid, jsonb, integer, text, text, text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.fn_criar_assinante_publico(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  uuid, jsonb, integer, text, text, text, text) IS
  'Adesao publica v3: cria assinante e UCs, resolve desconto no servidor, e fecha a arvore de indicacao (originador, Assinante Conect e indicado_por_uc_id).';
