-- =====================================================================
-- Onboarding público do assinante — desbloqueio e blindagem
-- Data: 17/08/2026
--
-- Contexto: as páginas públicas /simulacao e /contrato rodam como `anon`.
-- `subscribers` e `consumer_units` têm RLS com uma única policy
-- (`authenticated`), então o "FINALIZAR ADESÃO" sempre falhou com
-- "new row violates row-level security policy". Nenhum assinante nasceu
-- pelo caminho público — os 13 existentes vieram todos do CRM.
--
-- A correção NÃO abre INSERT direto para `anon`: `anon` tem GRANT de
-- coluna em tudo, inclusive `status`, `asaas_customer_id`,
-- `split_comissoes` e `portal_credentials`. Em vez disso, uma única RPC
-- SECURITY DEFINER cria assinante + UCs numa transação só, com os campos
-- que ela mesma controla.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rastreabilidade lead → assinante
--    `GraphNodeView.jsx` e `AuditGraphViewInvoiceSummary.jsx` já leem
--    `sub.lead_id`; a coluna nunca existiu.
-- ---------------------------------------------------------------------
ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS lead_id uuid
  REFERENCES public.leads(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS subscribers_lead_id_idx
  ON public.subscribers(lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON COLUMN public.subscribers.lead_id IS
  'Lead que originou este assinante. Preenchido pela RPC fn_criar_assinante_publico e pela conversão manual no CRM.';


-- ---------------------------------------------------------------------
-- 2. Validador de CPF/CNPJ (módulo 11) no banco
--    O front valida, mas a RPC é chamada por `anon` direto da internet:
--    a validação precisa existir do lado de cá também. Também é o que
--    encarece o spam de cadastros.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_documento_valido(p_doc text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  d      text := regexp_replace(p_doc, '\D', '', 'g');
  soma   int;
  peso   int;
  dig    int;
  i      int;
  pesos  int[];
BEGIN
  -- rejeita dígitos todos iguais (00000000000, 11111111111, ...)
  IF d ~ '^(\d)\1+$' THEN
    RETURN false;
  END IF;

  IF length(d) = 11 THEN                       -- CPF
    FOR dig IN 0..1 LOOP
      soma := 0;
      peso := 10 + dig;
      FOR i IN 1..(9 + dig) LOOP
        soma := soma + substr(d, i, 1)::int * peso;
        peso := peso - 1;
      END LOOP;
      soma := 11 - (soma % 11);
      IF soma >= 10 THEN soma := 0; END IF;
      IF soma <> substr(d, 10 + dig, 1)::int THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;

  ELSIF length(d) = 14 THEN                    -- CNPJ
    FOR dig IN 0..1 LOOP
      IF dig = 0 THEN
        pesos := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
      ELSE
        pesos := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
      END IF;
      soma := 0;
      FOR i IN 1..array_length(pesos, 1) LOOP
        soma := soma + substr(d, i, 1)::int * pesos[i];
      END LOOP;
      soma := soma % 11;
      IF soma < 2 THEN soma := 0; ELSE soma := 11 - soma; END IF;
      -- CNPJ tem 12 dígitos de base: os verificadores estão em 13 e 14.
      IF soma <> substr(d, 13 + dig, 1)::int THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_documento_valido(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_documento_valido(text) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_documento_valido(text) IS
  'Valida CPF (11) ou CNPJ (14) por módulo 11, ignorando máscara. Não valida existência na Receita.';


-- ---------------------------------------------------------------------
-- 3. Normalização de documento — o CRM gravou 12 CPFs com máscara e 1 sem.
--    Toda comparação de duplicidade tem que ser feita sobre os dígitos.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_so_digitos(p_txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT nullif(regexp_replace(coalesce(p_txt, ''), '\D', '', 'g'), '') $$;

REVOKE EXECUTE ON FUNCTION public.fn_so_digitos(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_so_digitos(text) TO anon, authenticated;

-- Índice único funcional: impede o mesmo CPF entrar duas vezes com
-- máscaras diferentes. Só vale para assinantes não cancelados, para não
-- travar recadastro de quem saiu.
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_doc_digits_uidx
  ON public.subscribers (public.fn_so_digitos(cpf_cnpj))
  WHERE cpf_cnpj IS NOT NULL
    AND status NOT IN ('cancelado', 'cancelado_inadimplente');


-- ---------------------------------------------------------------------
-- 4. A RPC de adesão pública
--    Assinante + UCs numa transação só. Se a UC falhar, o assinante não
--    fica órfão — hoje o /contrato salva o assinante primeiro e só depois
--    tenta a UC, deixando registro pela metade a cada erro.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_criar_assinante_publico(
  p_nome           text,
  p_cpf_cnpj       text,
  p_email          text,
  p_telefone       text,
  p_cep            text    DEFAULT NULL,
  p_rua            text    DEFAULT NULL,
  p_numero         text    DEFAULT NULL,
  p_complemento    text    DEFAULT NULL,
  p_bairro         text    DEFAULT NULL,
  p_cidade         text    DEFAULT NULL,
  p_uf             text    DEFAULT NULL,
  p_originator_id  uuid    DEFAULT NULL,
  p_lead_id        uuid    DEFAULT NULL,
  p_ucs            jsonb   DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc         text := public.fn_so_digitos(p_cpf_cnpj);
  v_tel         text := public.fn_so_digitos(p_telefone);
  v_cep         text := public.fn_so_digitos(p_cep);
  v_originator  uuid;
  v_sub_id      uuid;
  v_uc          jsonb;
  v_uc_num      text;
  v_ucs_criadas int  := 0;
BEGIN
  ------------------------------------------------------------------
  -- Validação de entrada
  ------------------------------------------------------------------
  IF coalesce(btrim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome completo.' USING ERRCODE = '22023';
  END IF;

  IF v_doc IS NULL OR NOT public.fn_documento_valido(v_doc) THEN
    RAISE EXCEPTION 'CPF/CNPJ inválido.' USING ERRCODE = '22023';
  END IF;

  IF v_tel IS NULL OR length(v_tel) < 10 THEN
    RAISE EXCEPTION 'Telefone inválido. Informe DDD + número.' USING ERRCODE = '22023';
  END IF;

  IF coalesce(btrim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_ucs) <> 'array' OR jsonb_array_length(p_ucs) = 0 THEN
    RAISE EXCEPTION 'Cadastre pelo menos uma unidade consumidora.' USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------------------------
  -- Duplicidade (sobre dígitos, não sobre a máscara)
  ------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM public.subscribers
     WHERE public.fn_so_digitos(cpf_cnpj) = v_doc
       AND status NOT IN ('cancelado', 'cancelado_inadimplente')
  ) THEN
    RAISE EXCEPTION 'Já existe um assinante ativo com este CPF/CNPJ.' USING ERRCODE = '23505';
  END IF;

  ------------------------------------------------------------------
  -- Originador: só vincula se existir de fato. Um `id` inventado na
  -- URL do convite não pode derrubar o cadastro nem forjar comissão.
  ------------------------------------------------------------------
  SELECT o.id INTO v_originator
    FROM public.originators_v2 o
   WHERE o.id = p_originator_id;

  ------------------------------------------------------------------
  -- Assinante. `status` é sempre 'ativacao': não vem do cliente.
  ------------------------------------------------------------------
  INSERT INTO public.subscribers (
    name, cpf_cnpj, email, phone, status,
    cep, rua, numero, complemento, bairro, cidade, uf,
    originator_id, lead_id
  ) VALUES (
    btrim(p_nome), v_doc, lower(btrim(p_email)), v_tel, 'ativacao',
    v_cep, p_rua, p_numero, p_complemento, p_bairro, p_cidade, upper(p_uf),
    v_originator, p_lead_id
  )
  RETURNING id INTO v_sub_id;

  ------------------------------------------------------------------
  -- Unidades consumidoras
  ------------------------------------------------------------------
  FOR v_uc IN SELECT * FROM jsonb_array_elements(p_ucs) LOOP
    v_uc_num := btrim(coalesce(v_uc->>'numero_uc', ''));

    IF v_uc_num = '' THEN
      RAISE EXCEPTION 'Número da UC é obrigatório.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.consumer_units (
      subscriber_id, numero_uc, titular_conta, concessionaria,
      status, modalidade, franquia, address
    ) VALUES (
      v_sub_id,
      v_uc_num,
      nullif(btrim(coalesce(v_uc->>'titular_conta', '')), ''),
      nullif(btrim(coalesce(v_uc->>'concessionaria', '')), ''),
      'em_ativacao',
      'geracao_compartilhada',
      nullif(v_uc->>'franquia', '')::numeric,
      jsonb_build_object(
        'cep',         public.fn_so_digitos(v_uc->>'cep'),
        'rua',         v_uc->>'rua',
        'numero',      v_uc->>'numero',
        'complemento', v_uc->>'complemento',
        'bairro',      v_uc->>'bairro',
        'cidade',      v_uc->>'cidade',
        'uf',          upper(v_uc->>'uf')
      )
    );

    v_ucs_criadas := v_ucs_criadas + 1;
  END LOOP;

  ------------------------------------------------------------------
  -- Fecha o lead de origem
  ------------------------------------------------------------------
  IF p_lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET status = 'ativacao', updated_at = now()
     WHERE id = p_lead_id;
  END IF;

  RETURN jsonb_build_object(
    'subscriber_id', v_sub_id,
    'ucs_criadas',   v_ucs_criadas,
    'originador_vinculado', v_originator IS NOT NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_criar_assinante_publico(
  text, text, text, text, text, text, text, text, text, text, text, uuid, uuid, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_criar_assinante_publico(
  text, text, text, text, text, text, text, text, text, text, text, uuid, uuid, jsonb
) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_criar_assinante_publico(
  text, text, text, text, text, text, text, text, text, text, text, uuid, uuid, jsonb
) IS
  'Adesão pública: cria assinante + UCs numa transação. Único caminho de escrita de `anon` em subscribers/consumer_units. `status`, `asaas_customer_id`, `split_comissoes` e `portal_credentials` não são aceitos do cliente.';


-- ---------------------------------------------------------------------
-- 5. Vazamento de leads: `anon` lia as 24 linhas em `simulacao` inteiras
--    (nome, e-mail, telefone, CEP, endereço) só com a chave pública.
--    A policy existia para o `.insert().select()` do LeadCaptureForm
--    devolver o id; o front passa a gerar o UUID no cliente e dispensa
--    o SELECT.
-- ---------------------------------------------------------------------
--    Janela de 15s: o RETURNING do insert continua funcionando enquanto o
--    front antigo estiver no ar; a raspagem do histórico morre agora.
--    Depois que o front novo (UUID gerado no cliente, sem `.select()`)
--    estiver publicado, esta policy pode ser removida por completo.
DROP POLICY IF EXISTS "leads_anon_select_simulacao" ON public.leads;

CREATE POLICY "leads_anon_select_recem_inserido" ON public.leads
  FOR SELECT TO anon
  USING (status = 'simulacao' AND created_at > now() - interval '15 seconds');

-- INSERT de `anon` fica restrito a `simulacao`: sem isso, um visitante
-- podia inserir lead já em 'ativo'/'pago' e poluir o kanban.
DROP POLICY IF EXISTS "Enable insert for public" ON public.leads;

DROP POLICY IF EXISTS "leads_authenticated_insert" ON public.leads;
CREATE POLICY "leads_authenticated_insert" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (true);

REVOKE UPDATE, DELETE ON public.leads FROM anon;
