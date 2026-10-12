-- =====================================================================
-- App: o que a conta nova quer fazer (decisão do dono, 11/10/2026)
--
-- Login novo sem produto não é sempre um futuro assinante: pode ser um
-- motorista querendo recarregar, alguém querendo ser parceiro ou alguém
-- querendo investir. O app passa a perguntar (tela de opções) e:
--   1. Parceiro: cadastro de originador feito pela PRÓPRIA conta
--      (app_cadastrar_parceiro). O formulário do site cria outra conta
--      (signUp) e não serve para quem já tem login; ligar pelo e-mail
--      deixaria qualquer um cadastrar parceiro com o e-mail de outra pessoa.
--   2. Investidor: não existe cadastro self-service. O pedido vira lead
--      com as etiquetas do interesse (#Investidor, #Eletropostos, #Cotas...)
--      e a qualificação respondida no app; a equipe segue a jornada no
--      Kanban filtrado pela etiqueta.
--   3. Papel: protect_profile_privileges desfaz troca de papel feita na
--      sessão do próprio usuário. Como no webhook da assinatura, quem
--      promove é um processo sem sessão de usuário (pg_cron), pela mesma
--      regra de fn_vincular_cadastros_do_login: só sai de 'lead' para
--      'originator' quando a conta de fato tem o cadastro de parceiro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Parceiro pelo app
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_cadastrar_parceiro(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_nome text := btrim(regexp_replace(coalesce(p_dados ->> 'name', ''), '\s+', ' ', 'g'));
  v_tel text := public.fn_telefone_br(p_dados ->> 'phone');
  v_doc text := regexp_replace(coalesce(p_dados ->> 'cpf_cnpj', ''), '\D', '', 'g');
  v_pix_tipo text := lower(coalesce(p_dados ->> 'pix_key_type', ''));
  v_pix text := btrim(coalesce(p_dados ->> 'pix_key', ''));
  v_end jsonb := coalesce(p_dados -> 'address', '{}'::jsonb);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para continuar.' USING ERRCODE = '42501';
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirme seu e-mail para continuar.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.originators_v2 o WHERE o.id = v_uid) THEN
    RAISE EXCEPTION 'Voce ja e parceiro B2W.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.originators_v2 o WHERE lower(btrim(o.email)) = lower(btrim(v_email))) THEN
    RAISE EXCEPTION 'Ja existe um parceiro com este e-mail. Fale com a equipe B2W.' USING ERRCODE = '22023';
  END IF;

  IF array_length(string_to_array(v_nome, ' '), 1) < 2 THEN
    RAISE EXCEPTION 'Informe nome e sobrenome.' USING ERRCODE = '22023';
  END IF;
  IF v_tel IS NULL THEN
    RAISE EXCEPTION 'WhatsApp invalido. Informe DDD + numero.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.fn_documento_valido(v_doc) THEN
    RAISE EXCEPTION 'CPF ou CNPJ invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_pix_tipo NOT IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') THEN
    RAISE EXCEPTION 'Escolha o tipo da chave PIX.' USING ERRCODE = '22023';
  END IF;
  -- Chave do tipo documento e sempre o proprio documento (como no site).
  IF v_pix_tipo IN ('cpf', 'cnpj') THEN v_pix := v_doc; END IF;
  IF v_pix = '' THEN
    RAISE EXCEPTION 'Informe a chave PIX para o pagamento das comissoes.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(v_end ->> 'cep'), '') IS NULL OR nullif(btrim(v_end ->> 'cidade'), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o CEP e o endereco.' USING ERRCODE = '22023';
  END IF;

  -- Campos sensiveis (cargo, comissao, licenca, link) ficam no padrao do
  -- fn_originador_guarda_campos_sensiveis; o link curto sai pelo gatilho.
  INSERT INTO public.originators_v2 (id, name, email, phone, cpf_cnpj, pix_key, pix_key_type, profession, address)
  VALUES (v_uid, v_nome, v_email, v_tel, v_doc, v_pix, v_pix_tipo,
          nullif(btrim(coalesce(p_dados ->> 'profession', '')), ''),
          jsonb_build_object(
            'cep', btrim(coalesce(v_end ->> 'cep', '')), 'rua', btrim(coalesce(v_end ->> 'rua', '')),
            'numero', btrim(coalesce(v_end ->> 'numero', '')), 'complemento', btrim(coalesce(v_end ->> 'complemento', '')),
            'bairro', btrim(coalesce(v_end ->> 'bairro', '')), 'cidade', btrim(coalesce(v_end ->> 'cidade', '')),
            'uf', upper(btrim(coalesce(v_end ->> 'uf', ''))));

  RETURN v_uid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_cadastrar_parceiro(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_cadastrar_parceiro(jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Interesse em investir: lead com etiquetas (decisão do dono, 11/10/2026)
--
-- Vira lead no mesmo funil do CRM, com as etiquetas que o CRM já usa
-- (tagHelpers.DEFAULT_TAGS) e as respostas da qualificação do app em
-- leads.qualificacao. A jornada é o Kanban filtrado pela etiqueta:
-- Sem interação -> Negociação -> Reunião -> Contrato -> Ativo/Perdido.
-- Mesma trava de pessoa única do site (fn_registrar_lead_publico):
-- quem já é lead de energia ganha as etiquetas no mesmo lead.
-- ---------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS qualificacao jsonb;
COMMENT ON COLUMN public.leads.qualificacao IS
  'Respostas de qualificacao vindas do app, por jornada. Ex.: {"investimento": {"interesses": [...], "faixa": "...", "em": "..."}}';

CREATE OR REPLACE FUNCTION public.fn_tags_investimento(p_interesses jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT ARRAY['#Investidor'] || coalesce(array_agg(DISTINCT t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}')
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_interesses) = 'array' THEN p_interesses ELSE '[]'::jsonb END) i(cod)
    LEFT JOIN (VALUES
      ('eletropostos', '#Eletropostos'), ('cotas', '#Cotas'), ('consorcio', '#Consorcio'),
      ('financiamento', '#Financiamento'), ('arrendamento', '#Arrendamento de area'), ('vagas', '#Locação de Vagas')
    ) t(cod, tag) ON t.cod = i.cod;
$$;

CREATE OR REPLACE FUNCTION public.app_registrar_interesse_investimento(p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_nome text := btrim(coalesce(p_dados ->> 'name', ''));
  v_tel text := public.fn_telefone_br(p_dados ->> 'phone');
  v_tags text[] := public.fn_tags_investimento(p_dados -> 'interesses');
  v_existia boolean;
  v_visita uuid;
  v_lead uuid;
  v_qualif jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para continuar.' USING ERRCODE = '42501';
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirme seu e-mail para continuar.' USING ERRCODE = '42501';
  END IF;
  IF v_tel IS NULL THEN
    RAISE EXCEPTION 'Informe seu celular com DDD.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_tags) < 2 THEN
    RAISE EXCEPTION 'Escolha pelo menos uma forma de investir.' USING ERRCODE = '22023';
  END IF;
  IF v_nome = '' THEN
    SELECT nullif(p.name, '') INTO v_nome FROM public.profiles p WHERE p.id = v_uid;
  END IF;

  v_existia := EXISTS (SELECT 1 FROM public.leads l
                        WHERE l.phone = v_tel OR lower(btrim(l.email)) = lower(v_email));

  -- Sem link de indicacao aqui: investidor nao gera credito nem comissao de energia.
  v_visita := public.fn_registrar_lead_publico(
    jsonb_build_object('name', coalesce(nullif(v_nome, ''), v_email), 'phone', v_tel, 'email', v_email,
                       'cidade', nullif(btrim(coalesce(p_dados ->> 'cidade', '')), ''),
                       'uf', nullif(upper(btrim(coalesce(p_dados ->> 'uf', ''))), '')),
    'app');
  SELECT lead_id INTO v_lead FROM public.lead_visitas WHERE id = v_visita;

  v_qualif := jsonb_build_object(
    'interesses', coalesce(p_dados -> 'interesses', '[]'::jsonb),
    'faixa', nullif(btrim(coalesce(p_dados ->> 'faixa', '')), ''),
    'cidade', nullif(btrim(coalesce(p_dados ->> 'cidade', '')), ''),
    'uf', nullif(upper(btrim(coalesce(p_dados ->> 'uf', ''))), ''),
    'mensagem', left(nullif(btrim(coalesce(p_dados ->> 'mensagem', '')), ''), 1000),
    'em', now());

  UPDATE public.leads l
     SET tags = ARRAY(SELECT DISTINCT x FROM unnest(coalesce(l.tags, '{}') || v_tags) x ORDER BY x),
         qualificacao = coalesce(l.qualificacao, '{}'::jsonb) || jsonb_build_object('investimento', v_qualif),
         user_id = coalesce(l.user_id, v_uid),
         -- Lead novo de investidor nao e simulacao de energia (e nao deve
         -- ser arquivado como simulacao parada): entra aguardando contato.
         status = CASE WHEN NOT v_existia AND l.status = 'simulacao' THEN 'sem_interacao' ELSE l.status END
   WHERE l.id = v_lead;

  INSERT INTO public.crm_history (entity_type, entity_id, content, metadata)
  VALUES ('lead', v_lead,
          'Interesse em investir pelo app: ' || array_to_string(v_tags[2:], ', ')
            || coalesce(' · faixa ' || (v_qualif ->> 'faixa'), '')
            || coalesce(' · ' || (v_qualif ->> 'cidade') || coalesce('/' || (v_qualif ->> 'uf'), ''), '')
            || coalesce(' · ' || (v_qualif ->> 'mensagem'), ''),
          jsonb_build_object('acao', 'interesse_investimento_app', 'qualificacao', v_qualif));

  RETURN v_lead;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_registrar_interesse_investimento(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_registrar_interesse_investimento(jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Papel de quem virou parceiro pelo app
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_promover_papeis_pendentes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_n integer;
BEGIN
  -- So originador: assinante e fornecedor ja sobem pelos gatilhos de
  -- 20261006d (status da assinatura e vinculo do fornecedor).
  UPDATE public.profiles p
     SET role = 'originator'
   WHERE p.role = 'lead'
     AND EXISTS (SELECT 1 FROM public.originators_v2 o WHERE o.id = p.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_promover_papeis_pendentes() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'promover-papeis-pendentes';
SELECT cron.schedule('promover-papeis-pendentes', '* * * * *', $$SELECT public.fn_promover_papeis_pendentes()$$);

-- ---------------------------------------------------------------------
-- 4. app_perfil: pedido de investimento em aberto
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_perfil()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object(
        'id', auth.uid(),
        'name', coalesce(p.name, ''),
        'email', p.email,
        'role', p.role,
        'subscriber', (select to_jsonb(x) from (
            select s.id, s.name, s.status, s.short_url
              from subscribers s where s.id = fn_app_subscriber_id()) x),
        'supplier', (select to_jsonb(x) from (
            select s.id, s.name
              from suppliers s where s.id = fn_app_supplier_id()) x),
        'originator', exists (select 1 from originators_v2 o where o.id = auth.uid()),
        -- Login sem nenhum produto (D, 06/10/2026): o app pergunta o que a pessoa quer.
        'sem_produto', fn_app_subscriber_id() is null
                       and fn_app_supplier_id() is null
                       and not exists (select 1 from originators_v2 o where o.id = auth.uid())
                       and coalesce(p.role::text, 'lead') = 'lead',
        'lead', (select to_jsonb(x) from (
            select l.id, l.status,
                   coalesce(
                     (select split_part(btrim(s.name), ' ', 1) from subscribers s where s.id = l.indicador_assinante_id),
                     (select split_part(btrim(o.name), ' ', 1) from originators_v2 o where o.id = l.originator_id)
                   ) as indicador_nome
              from leads l
             where l.user_id = auth.uid()
               -- Lead so de investidor nao e adesao de energia em andamento.
               and (not ('#Investidor' = any(coalesce(l.tags, '{}')))
                    or '#Energia por Assinatura' = any(l.tags))
             order by l.updated_at desc nulls last limit 1) x),
        'interesse_investimento', (select l.qualificacao #>> '{investimento,em}' from leads l
                                    where l.user_id = auth.uid() and l.qualificacao ? 'investimento'
                                    order by l.updated_at desc nulls last limit 1)
    )
    from profiles p where p.id = auth.uid();
$function$;

-- ---------------------------------------------------------------------
-- 5. Adesao de energia pelo app ganha a etiqueta #Energia por Assinatura
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_registrar_interesse(
  p_dados jsonb,
  p_indicador text DEFAULT NULL,
  p_meio text DEFAULT 'app')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_ind jsonb;
  v_visita uuid;
  v_lead uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para continuar.' USING ERRCODE = '42501';
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirme seu e-mail para continuar.' USING ERRCODE = '42501';
  END IF;
  IF public.fn_app_subscriber_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Voce ja e assinante B2W.' USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(coalesce(p_indicador, '')), '') IS NOT NULL THEN
    v_ind := public.fn_indicador_publico(p_indicador);
    IF NOT coalesce((v_ind ->> 'valido')::boolean, false) THEN
      RAISE EXCEPTION 'Este link de indicacao nao e valido.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Mesma trava e mesma regra de ultimo link do site; o e-mail e o da conta.
  -- O originador so entra pelo link validado acima, nunca pelo p_dados.
  v_visita := public.fn_registrar_lead_publico(
    (coalesce(p_dados, '{}'::jsonb) - 'originator_id' - 'indicador_assinante_id')
      || jsonb_build_object('email', v_email)
      || CASE v_ind ->> 'tipo'
           WHEN 'assinante'  THEN jsonb_build_object('indicador_assinante_id', v_ind ->> 'id')
           WHEN 'originador' THEN jsonb_build_object('originator_id', v_ind ->> 'id')
           ELSE '{}'::jsonb
         END,
    CASE WHEN p_meio = 'qr' THEN 'qr' ELSE 'app' END);

  SELECT lead_id INTO v_lead FROM public.lead_visitas WHERE id = v_visita;
  -- A etiqueta separa a adesao de energia do pedido de investidor no app_perfil.
  UPDATE public.leads l
     SET user_id = coalesce(l.user_id, v_uid),
         tags = CASE WHEN '#Energia por Assinatura' = ANY(coalesce(l.tags, '{}')) THEN l.tags
                     ELSE array_append(coalesce(l.tags, '{}'::text[]), '#Energia por Assinatura') END
   WHERE l.id = v_lead;

  RETURN v_visita;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_registrar_interesse(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_registrar_interesse(jsonb, text, text) TO authenticated;
