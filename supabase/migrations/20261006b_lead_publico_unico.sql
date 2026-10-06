-- =====================================================================
-- Lead publico unico: trava por celular/e-mail, ultima indicacao e arquivo
-- Data: 06/10/2026 · branch app-v1.3
--
-- Antes: cada simulacao enviada no site criava um lead novo (insert direto
-- com a chave anon). Em 06/10/2026 eram 42 leads, 12 deles repetindo um
-- celular ja cadastrado.
--
-- Decisoes do dono (06/10/2026):
--   1. trava pelo celular; sem celular igual, pelo e-mail;
--   2. indicador E originador: vale o ultimo link (mesma regra);
--   3. simulacao sem andamento por 90 dias e arquivada (sai do Kanban);
--   4. os duplicados de hoje so sao juntados depois da revisao dele.
--
-- O cuidado que molda o desenho: com a trava, mandar o formulario com o
-- celular de outra pessoa "acha" o lead dela. Se a resposta devolvesse o id
-- do lead, fn_lead_adesao entregaria os dados dela a quem so sabe o numero;
-- e sobrescrever o lead com o que chegou deixaria qualquer um apagar o
-- cadastro alheio ou trocar o indicador dele.
--
-- Por isso cada envio vira uma VISITA (lead_visitas): ela guarda o que a
-- pessoa digitou e o link pelo qual veio, e o id devolvido e o da visita.
--   * /contrato?lead_id=<visita> preenche so com o que a propria pessoa
--     digitou naquela visita;
--   * o lead existente so recebe campos que estavam vazios;
--   * a adesao atribui pela visita que concluiu -- "o ultimo link
--     concluido", na letra do dono. Quem manda o celular alheio com o
--     proprio link nao leva a indicacao: so a sessao que assina o contrato
--     decide.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colunas do lead
-- ---------------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ultima_visita_em timestamptz,
  ADD COLUMN IF NOT EXISTS retornos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arquivado_em timestamptz;

COMMENT ON COLUMN public.leads.retornos IS
  'Quantas vezes a mesma pessoa (mesmo celular ou e-mail) voltou a simular depois de criado o lead.';
COMMENT ON COLUMN public.leads.arquivado_em IS
  'Simulacao sem andamento por 90 dias. Sai do Kanban padrao; volta sozinha se a pessoa simular de novo ou se a equipe mudar o status.';

-- ---------------------------------------------------------------------
-- 2. Celular comparavel: so digitos, sem o 55 do pais
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_telefone_br(p_txt text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
           WHEN d IS NULL THEN NULL
           WHEN length(d) IN (12, 13) AND left(d, 2) = '55' THEN substr(d, 3)
           ELSE d
         END
    FROM (SELECT public.fn_so_digitos(p_txt) AS d) x;
$$;

CREATE INDEX IF NOT EXISTS idx_leads_telefone_br
  ON public.leads (public.fn_telefone_br(phone)) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_email_lower
  ON public.leads (lower(btrim(email))) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Visitas: cada envio do formulario, com o link de origem
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_visitas (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  dados                  jsonb NOT NULL,
  indicador_assinante_id uuid REFERENCES public.subscribers(id) ON DELETE SET NULL,
  originator_id          uuid REFERENCES public.originators_v2(id) ON DELETE SET NULL,
  meio                   text NOT NULL DEFAULT 'link' CHECK (meio IN ('link', 'qr', 'app', 'organico')),
  aplicada               boolean NOT NULL DEFAULT true,
  motivo                 text,
  criado_em              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_visitas_lead ON public.lead_visitas (lead_id, criado_em DESC);

ALTER TABLE public.lead_visitas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_visitas_leitura_interna ON public.lead_visitas;
CREATE POLICY lead_visitas_leitura_interna ON public.lead_visitas
  FOR SELECT TO authenticated USING (public.fn_papel_interno());

COMMENT ON TABLE public.lead_visitas IS
  'Cada simulacao enviada no site/app. Guarda o que a pessoa digitou e o link (indicador/originador) daquela vez: e o historico de indicacoes do lead e o que a adesao usa para atribuir ("ultimo link concluido").';
COMMENT ON COLUMN public.lead_visitas.aplicada IS
  'false = a indicacao desta visita nao mudou o lead (contrato ja assinado ou celular de assinante existente).';

-- Limite de envios por celular (robo ou insistencia). Sem politica: so a
-- funcao abaixo le e grava.
CREATE TABLE IF NOT EXISTS public.lead_envios_publicos (
  id        bigserial PRIMARY KEY,
  telefone  text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_envios_publicos ON public.lead_envios_publicos (telefone, criado_em DESC);
ALTER TABLE public.lead_envios_publicos ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 4. Registrar a simulacao publica
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_registrar_lead_publico(
  p_dados jsonb,
  p_meio text DEFAULT 'link',
  p_armadilha text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_limite_hora constant int := 5;
  v_tel   text := public.fn_telefone_br(p_dados ->> 'phone');
  v_email text := nullif(lower(btrim(coalesce(p_dados ->> 'email', ''))), '');
  v_ind   uuid;
  v_orig  uuid;
  v_lead  public.leads%ROWTYPE;
  v_travada boolean := false;
  v_motivo  text;
  v_meio  text := CASE WHEN p_meio IN ('link', 'qr', 'app') THEN p_meio ELSE 'link' END;
  v_visita uuid := gen_random_uuid();
  v_tem_link boolean;
BEGIN
  -- Campo invisivel preenchido: robo. Resposta igual a de sucesso, nada gravado.
  IF coalesce(btrim(p_armadilha), '') <> '' THEN
    RETURN v_visita;
  END IF;

  -- Numero de um digito so ("99999999999") e preenchimento de fachada.
  IF v_tel IS NULL OR length(v_tel) NOT IN (10, 11) OR v_tel ~ '^(\d)\1+$' THEN
    RAISE EXCEPTION 'Telefone invalido. Informe DDD + numero.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_dados ->> 'name'), '') = '' THEN
    RAISE EXCEPTION 'Informe seu nome.' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM public.lead_envios_publicos e
       WHERE e.telefone = v_tel AND e.criado_em > now() - interval '1 hour') >= c_limite_hora THEN
    RAISE EXCEPTION 'Muitas simulacoes seguidas para este telefone. Tente de novo mais tarde.' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.lead_envios_publicos (telefone) VALUES (v_tel);

  -- Link de origem. Texto invalido e ignorado, nunca derruba a simulacao.
  IF (p_dados ->> 'indicador_assinante_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT s.id INTO v_ind FROM public.subscribers s
     WHERE s.id = (p_dados ->> 'indicador_assinante_id')::uuid
       AND s.status IN ('contrato_assinado', 'ativo', 'ativo_inadimplente');
  END IF;
  IF (p_dados ->> 'originator_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT o.id INTO v_orig FROM public.originators_v2 o WHERE o.id = (p_dados ->> 'originator_id')::uuid;
  END IF;
  v_tem_link := v_ind IS NOT NULL OR v_orig IS NOT NULL;
  IF NOT v_tem_link THEN v_meio := 'organico'; END IF;

  -- Lead em aberto da mesma pessoa: celular primeiro, e-mail depois.
  SELECT l.* INTO v_lead FROM public.leads l
   WHERE public.fn_telefone_br(l.phone) = v_tel
     AND l.status NOT IN ('ativo', 'pago', 'negocio_perdido')
     AND l.solicitante_assinante_id IS NULL
   ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC
   LIMIT 1;
  IF NOT FOUND AND v_email IS NOT NULL THEN
    SELECT l.* INTO v_lead FROM public.leads l
     WHERE lower(btrim(l.email)) = v_email
       AND l.status NOT IN ('ativo', 'pago', 'negocio_perdido')
       AND l.solicitante_assinante_id IS NULL
     ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC
     LIMIT 1;
  END IF;

  -- Celular de quem ja e assinante: a indicacao dele esta fechada.
  IF EXISTS (SELECT 1 FROM public.subscribers s
              WHERE public.fn_telefone_br(s.phone) = v_tel
                AND s.status IN ('contrato_assinado', 'ativo', 'ativo_inadimplente', 'transferido')) THEN
    v_travada := true; v_motivo := 'ja_assinante';
  END IF;

  IF v_lead.id IS NOT NULL THEN
    -- Contrato assinado trava a indicacao do lead.
    IF NOT v_travada AND (v_lead.status IN ('ativacao')
        OR EXISTS (SELECT 1 FROM public.subscribers s
                    WHERE s.lead_id = v_lead.id
                      AND s.status IN ('contrato_assinado', 'ativo', 'ativo_inadimplente', 'transferido'))) THEN
      v_travada := true; v_motivo := 'contrato_assinado';
    END IF;

    -- So preenche o que estava vazio: o envio de um estranho com este
    -- celular nao apaga nem troca o cadastro de ninguem.
    UPDATE public.leads l SET
      name        = coalesce(nullif(btrim(l.name), ''), btrim(p_dados ->> 'name')),
      email       = coalesce(nullif(btrim(l.email), ''), v_email),
      cep         = coalesce(nullif(l.cep, ''), p_dados ->> 'cep'),
      rua         = coalesce(nullif(l.rua, ''), p_dados ->> 'rua'),
      numero      = coalesce(nullif(l.numero, ''), p_dados ->> 'numero'),
      bairro      = coalesce(nullif(l.bairro, ''), p_dados ->> 'bairro'),
      cidade      = coalesce(nullif(l.cidade, ''), p_dados ->> 'cidade'),
      uf          = coalesce(nullif(l.uf, ''), p_dados ->> 'uf'),
      concessionaria = coalesce(nullif(l.concessionaria, ''), p_dados ->> 'concessionaria'),
      consumo_kwh = coalesce(l.consumo_kwh, nullif(p_dados ->> 'consumo_kwh', '')::numeric),
      calculated_discount = coalesce(l.calculated_discount, nullif(p_dados ->> 'calculated_discount', '')::numeric),
      tarifa_concessionaria = coalesce(nullif(l.tarifa_concessionaria, 0), nullif(p_dados ->> 'tarifa_concessionaria', '')::numeric),
      desconto_assinante = coalesce(nullif(l.desconto_assinante, 0), nullif(p_dados ->> 'desconto_assinante', '')::numeric),
      -- Ultimo link vale (indicador e originador juntos); visita sem link nao mexe.
      indicador_assinante_id = CASE WHEN v_tem_link AND NOT v_travada THEN v_ind ELSE l.indicador_assinante_id END,
      originator_id          = CASE WHEN v_tem_link AND NOT v_travada THEN v_orig ELSE l.originator_id END,
      ultima_visita_em = now(),
      retornos = l.retornos + 1,
      arquivado_em = NULL
    WHERE l.id = v_lead.id;
  ELSE
    INSERT INTO public.leads (name, email, phone, cep, rua, numero, bairro, cidade, uf, concessionaria,
      consumo_kwh, calculated_discount, tarifa_concessionaria, desconto_assinante, status,
      originator_id, indicador_assinante_id, ultima_visita_em)
    VALUES (btrim(p_dados ->> 'name'), v_email, v_tel, p_dados ->> 'cep', p_dados ->> 'rua', p_dados ->> 'numero',
      p_dados ->> 'bairro', p_dados ->> 'cidade', p_dados ->> 'uf', p_dados ->> 'concessionaria',
      nullif(p_dados ->> 'consumo_kwh', '')::numeric, nullif(p_dados ->> 'calculated_discount', '')::numeric,
      nullif(p_dados ->> 'tarifa_concessionaria', '')::numeric, nullif(p_dados ->> 'desconto_assinante', '')::numeric,
      'simulacao',
      CASE WHEN v_travada THEN NULL ELSE v_orig END,
      CASE WHEN v_travada THEN NULL ELSE v_ind END,
      now())
    RETURNING * INTO v_lead;
  END IF;

  INSERT INTO public.lead_visitas (id, lead_id, dados, indicador_assinante_id, originator_id, meio, aplicada, motivo)
  VALUES (v_visita, v_lead.id,
          jsonb_strip_nulls(jsonb_build_object(
            'name', btrim(p_dados ->> 'name'), 'email', v_email, 'phone', v_tel,
            'cep', p_dados ->> 'cep', 'rua', p_dados ->> 'rua', 'numero', p_dados ->> 'numero',
            'bairro', p_dados ->> 'bairro', 'cidade', p_dados ->> 'cidade', 'uf', p_dados ->> 'uf',
            'concessionaria', p_dados ->> 'concessionaria', 'consumo_kwh', p_dados ->> 'consumo_kwh',
            'calculated_discount', p_dados ->> 'calculated_discount')),
          v_ind, v_orig, v_meio, NOT v_travada, v_motivo);

  -- O id devolvido e o da VISITA, nunca o do lead (ver cabecalho).
  RETURN v_visita;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_registrar_lead_publico(jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_registrar_lead_publico(jsonb, text, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Adesao: preencher pela visita
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lead_adesao(p_lead uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    -- Id de visita: so o que a propria pessoa digitou naquela vez.
    SELECT v.dados
      FROM public.lead_visitas v
      JOIN public.leads l ON l.id = v.lead_id
     WHERE v.id = p_lead
       AND l.status NOT IN ('ativacao', 'ativo', 'pago', 'negocio_perdido')
    UNION ALL
    -- Id de lead: link gerado pela equipe no CRM (comportamento anterior).
    SELECT jsonb_build_object(
        'name', l.name, 'email', l.email, 'phone', l.phone,
        'cep', l.cep, 'rua', l.rua, 'numero', l.numero, 'complemento', l.complemento,
        'bairro', l.bairro, 'cidade', l.cidade, 'uf', l.uf,
        'concessionaria', l.concessionaria, 'consumo_kwh', l.consumo_kwh,
        'uc', CASE WHEN l.conta_lida IS NULL THEN NULL ELSE jsonb_build_object(
            'numeroUc', l.conta_lida ->> 'numeroUc',
            'titular', l.conta_lida ->> 'titular',
            'ligacao', l.conta_lida ->> 'ligacao',
            'mediaKwh', l.conta_lida -> 'mediaKwh',
            'endereco', l.conta_lida -> 'endereco'
        ) END
    )
      FROM public.leads l
     WHERE l.id = p_lead
       AND l.solicitante_assinante_id IS NULL
       AND l.status NOT IN ('ativacao', 'ativo', 'pago', 'negocio_perdido')
    LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- 6. Adesao: atribuir pela sessao que concluiu
-- ---------------------------------------------------------------------
-- Mesmo corpo de 20260928a, mudando so a resolucao do lead e da atribuicao:
--   * p_lead_id pode ser id de VISITA (site novo) ou de lead (link do CRM);
--   * se a sessao que conclui trouxe link (URL ou a visita), vale SO ele --
--     indicador e originador juntos, o originador herdado do indicador
--     quando o link e de assinante;
--   * sem link na sessao, vale o que o lead tem.
CREATE OR REPLACE FUNCTION public.fn_criar_assinante_publico(p_nome text, p_cpf_cnpj text, p_email text, p_telefone text, p_cep text, p_rua text, p_numero text, p_complemento text, p_bairro text, p_cidade text, p_uf text, p_ibge text, p_originator_id text, p_lead_id uuid, p_ucs jsonb, p_dia_vencimento integer, p_representante_nome text, p_representante_cpf text, p_aceite_versao text, p_indicador_assinante_id text DEFAULT NULL::text)
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
  v_lead uuid; v_visita record; v_sess_orig uuid; v_sess_ind uuid;
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

  -- p_lead_id: visita (site novo) ou lead (link do CRM).
  IF p_lead_id IS NOT NULL THEN
    SELECT v.lead_id, v.indicador_assinante_id, v.originator_id INTO v_visita
      FROM public.lead_visitas v WHERE v.id = p_lead_id;
    IF FOUND THEN
      v_lead := v_visita.lead_id;
      v_sess_ind := v_visita.indicador_assinante_id;
      v_sess_orig := v_visita.originator_id;
    ELSIF EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead_id) THEN
      v_lead := p_lead_id;
    END IF;
  END IF;

  -- O link da URL e o da sessao que esta concluindo: tem precedencia.
  -- Texto invalido ou de quem nao existe/nao pode indicar e ignorado.
  IF p_originator_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND EXISTS (SELECT 1 FROM public.originators_v2 o WHERE o.id = p_originator_id::uuid) THEN
    v_sess_orig := p_originator_id::uuid;
  END IF;
  IF p_indicador_assinante_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND EXISTS (SELECT 1 FROM public.subscribers s WHERE s.id = p_indicador_assinante_id::uuid
                   AND s.status IN ('contrato_assinado', 'ativo', 'ativo_inadimplente')) THEN
    v_sess_ind := p_indicador_assinante_id::uuid;
  END IF;

  IF v_sess_orig IS NOT NULL OR v_sess_ind IS NOT NULL THEN
    v_originator := v_sess_orig;
    v_indicador := v_sess_ind;
  ELSIF v_lead IS NOT NULL THEN
    SELECT l.originator_id, l.indicador_assinante_id INTO v_originator, v_indicador
      FROM public.leads l WHERE l.id = v_lead;
  END IF;

  -- So indica quem pode indicar (mesma lista do gatilho e do front).
  IF v_indicador IS NOT NULL THEN
    SELECT s.id INTO v_indicador FROM public.subscribers s
     WHERE s.id = v_indicador
       AND s.status IN ('contrato_assinado', 'ativo', 'ativo_inadimplente');
  END IF;

  IF v_originator IS NULL AND v_indicador IS NOT NULL THEN
    SELECT s.originator_id INTO v_originator FROM public.subscribers s WHERE s.id = v_indicador;
  END IF;

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
    p_complemento, p_bairro, p_cidade, upper(p_uf), v_originator, v_lead,
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

  -- O lead fica com a atribuicao que valeu.
  IF v_lead IS NOT NULL THEN
    UPDATE public.leads SET indicador_assinante_id = v_indicador, originator_id = v_originator, arquivado_em = NULL
     WHERE id = v_lead;
  END IF;

  RETURN jsonb_build_object('subscriber_id', v_sub_id, 'onboarding_token', v_token, 'ucs_criadas', v_n,
    'originador_vinculado', v_originator IS NOT NULL, 'desconto', v_desc_primeiro, 'descontos', v_descontos,
    'indicador_vinculado', v_indicador IS NOT NULL);
END;
$function$;

-- ---------------------------------------------------------------------
-- 7. Arquivo: simulacao parada ha 90 dias sai do Kanban
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_arquivar_leads_parados()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.leads l
     SET arquivado_em = now()
   WHERE l.arquivado_em IS NULL
     AND l.status = 'simulacao'
     AND greatest(l.created_at, coalesce(l.updated_at, l.created_at), coalesce(l.ultima_visita_em, l.created_at))
         < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_arquivar_leads_parados() FROM PUBLIC, anon, authenticated;

-- Equipe mexeu no status: o lead voltou a andar.
CREATE OR REPLACE FUNCTION public.fn_desarquivar_lead_movido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.arquivado_em IS NOT NULL
     AND NEW.arquivado_em IS NOT DISTINCT FROM OLD.arquivado_em THEN
    NEW.arquivado_em := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_desarquivar_lead_movido ON public.leads;
CREATE TRIGGER trg_desarquivar_lead_movido
  BEFORE UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_desarquivar_lead_movido();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'arquivar-leads-parados') THEN
    PERFORM cron.unschedule('arquivar-leads-parados');
  END IF;
  PERFORM cron.schedule('arquivar-leads-parados', '41 6 * * *', 'SELECT public.fn_arquivar_leads_parados()');
END $$;

-- O insert anonimo direto (leads_anon_insert_simulacao) continua por
-- enquanto: o site publicado ainda grava assim ate o front novo subir.
-- Retirar em migracao propria depois do deploy (docs/plano-lead-unico.md).
