-- =====================================================================
-- Consulta de CPF (CPFHub): nome e data de nascimento a partir do CPF
-- Data: 16/11/2026
--
-- A consulta e paga (1 credito por CPF encontrado) e devolve dado pessoal.
-- Esta migracao traz o que protege as duas coisas:
--
--   1. `subscribers.data_nascimento` -- onde o dado fica guardado.
--   2. `cpf_consultas` -- cache: o mesmo CPF nunca e pago duas vezes.
--      Sem nenhuma politica de RLS e sem grant para anon/authenticated: so a
--      Edge Function (service_role) e as funcoes SECURITY DEFINER abaixo leem.
--      Nome + nascimento por CPF numa tabela legivel seria um servico de
--      consulta aberto a quem tiver a chave anon, que viaja no bundle.
--   3. `cpf_consultas_uso` + `fn_cpf_reservar` -- contabilidade e limites do
--      publico (IP por hora e teto diario de credito). A reserva e atomica
--      (trava consultiva): sem ela, 100 requisicoes simultaneas leriam o mesmo
--      contador e passariam todas do limite.
--   4. Gatilho que copia o nascimento do cache para o assinante quando ele e
--      criado SEM data. E assim que a adesao publica guarda o nascimento sem
--      que o navegador do visitante jamais o receba.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Onde o dado fica
-- ---------------------------------------------------------------------
ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS data_nascimento date;

COMMENT ON COLUMN public.subscribers.data_nascimento IS
  'Data de nascimento do titular (pessoa fisica). Vem da consulta de CPF (CPFHub) ou e digitada pela equipe. Nao se aplica a CNPJ.';

-- ---------------------------------------------------------------------
-- 2. Cache das consultas (so dado de consulta que ENCONTROU o CPF)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cpf_consultas (
  cpf             text PRIMARY KEY CHECK (cpf ~ '^[0-9]{11}$'),
  nome            text NOT NULL,
  data_nascimento date,
  consultado_em   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cpf_consultas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cpf_consultas FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.cpf_consultas IS
  'Cache da consulta de CPF na CPFHub. Sem politica de RLS de proposito: so service_role e funcoes SECURITY DEFINER acessam.';

-- ---------------------------------------------------------------------
-- 3. Uso e limites do publico
--    Nao guarda o CPF nem o IP em claro: so o hash do IP e o resultado.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cpf_consultas_uso (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quando     timestamptz NOT NULL DEFAULT now(),
  origem     text NOT NULL CHECK (origem IN ('interno', 'publico')),
  ip_hash    text NOT NULL DEFAULT '',
  resultado  text NOT NULL DEFAULT 'reservado',
  creditos   integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS cpf_consultas_uso_ip_idx  ON public.cpf_consultas_uso (origem, ip_hash, quando);
CREATE INDEX IF NOT EXISTS cpf_consultas_uso_dia_idx ON public.cpf_consultas_uso (origem, quando) WHERE resultado IN ('reservado', 'encontrado');

ALTER TABLE public.cpf_consultas_uso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cpf_consultas_uso FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.cpf_consultas_uso IS
  'Uma linha por consulta de CPF: origem, hash do IP, resultado e creditos gastos. Base dos limites do publico e do extrato de consumo.';

-- ---------------------------------------------------------------------
-- Reserva ANTES de chamar a API; o resultado e gravado depois.
--   * equipe (`interno`): so registra, nunca limita;
--   * publico: limite por IP/hora vale para toda consulta (cache tambem: e
--     uma forma de ler dado), e o teto diario so conta o que gasta credito
--     (reservas em aberto + achados). "Nao encontrado" e erro nao cobram.
--   * limite 0 = desligado.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cpf_reservar(
  p_origem text, p_ip_hash text, p_usa_api boolean, p_limite_ip_hora integer, p_limite_dia integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer; v_id bigint;
BEGIN
  IF p_origem NOT IN ('interno', 'publico') THEN
    RAISE EXCEPTION 'origem invalida: %', p_origem USING ERRCODE = '22023';
  END IF;

  IF p_origem = 'publico' THEN
    -- Serializa as reservas do publico: sem isto, contar e inserir em duas
    -- etapas deixa requisicoes simultaneas furarem o limite.
    PERFORM pg_advisory_xact_lock(hashtext('fn_cpf_reservar'));

    SELECT count(*) INTO v_n FROM public.cpf_consultas_uso
     WHERE origem = 'publico' AND ip_hash = coalesce(p_ip_hash, '') AND quando > now() - interval '1 hour';
    IF v_n >= greatest(p_limite_ip_hora, 0) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'limite_publico');
    END IF;

    IF p_usa_api THEN
      SELECT count(*) INTO v_n FROM public.cpf_consultas_uso
       WHERE origem = 'publico' AND resultado IN ('reservado', 'encontrado') AND quando > now() - interval '1 day';
      IF v_n >= greatest(p_limite_dia, 0) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'limite_publico');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.cpf_consultas_uso (origem, ip_hash) VALUES (p_origem, coalesce(p_ip_hash, ''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_cpf_registrar(p_id bigint, p_resultado text, p_creditos integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  UPDATE public.cpf_consultas_uso SET resultado = p_resultado, creditos = greatest(coalesce(p_creditos, 0), 0) WHERE id = p_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fn_cpf_reservar(text, text, boolean, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_cpf_registrar(bigint, text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_cpf_reservar(text, text, boolean, integer, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.fn_cpf_registrar(bigint, text, integer) TO service_role;

-- ---------------------------------------------------------------------
-- 4. Nascimento do cache para o assinante recem-criado
--    So preenche quando a data vem vazia e o documento e CPF: o que a equipe
--    digitou nunca e sobrescrito, e CNPJ nunca recebe data de pessoa.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_subscriber_nascimento_do_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cpf text := regexp_replace(coalesce(NEW.cpf_cnpj, ''), '[^0-9]', '', 'g');
BEGIN
  IF NEW.data_nascimento IS NULL AND length(v_cpf) = 11 THEN
    SELECT c.data_nascimento INTO NEW.data_nascimento FROM public.cpf_consultas c WHERE c.cpf = v_cpf;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fn_subscriber_nascimento_do_cache() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_subscriber_nascimento_do_cache ON public.subscribers;
CREATE TRIGGER trg_subscriber_nascimento_do_cache
  BEFORE INSERT ON public.subscribers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_subscriber_nascimento_do_cache();

-- ---------------------------------------------------------------------
-- 5. Linha de configuracao (a chave e colada pelo dono em
--    Configuracoes > Consulta de CPF; fica vazia aqui de proposito).
--    Os limites vivem em `variables`, como os de `usina_acesso`, e podem ser
--    mudados na mesma tela sem publicar nada.
-- ---------------------------------------------------------------------
INSERT INTO public.integrations_config (service_name, endpoint_url, is_active, environment, variables)
VALUES ('cpfhub', 'https://api.cpfhub.io', true, 'production',
        '{"publico_ativo": true, "limite_ip_hora": 5, "limite_publico_dia": 150, "validade_cache_dias": 180}'::jsonb)
ON CONFLICT (service_name) DO NOTHING;
