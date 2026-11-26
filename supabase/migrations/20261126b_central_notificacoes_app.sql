-- =====================================================================
-- Central de notificações do app (push + caixa de entrada)
-- Data: 26/11/2026
--
-- O motor de gatilhos que já existe (notification_triggers) fala WhatsApp e
-- e-mail por mudança de status. O app precisa de outra coisa: avisar um
-- LOGIN, no aparelho dele, de eventos da rede e do dinheiro. Por isso:
--
--   app_notificacao_tipos  catálogo configurável pelo super admin no CRM
--                          (Configurações > Notificações > App): liga/desliga,
--                          título e texto com variáveis {{...}};
--   app_notificacoes       caixa de entrada de cada login (o app lê e marca
--                          como lida); cada linha também é um push a enviar;
--   app_push_tokens        aparelhos (Expo push token) de cada login;
--   app_comunicados        mensagens avulsas do super admin para um público;
--   app_push_lotes         envio ao Expo e conferência da resposta.
--
-- Eventos ligados agora:
--   rede_novo_assinante  assinante da rede assinou o contrato: avisa quem o
--                        indicou (até N níveis), o Parceiro Power e o Líder;
--   recompensa_recebida  o razão lançou recompensa/crédito de indicação (2.1.2
--                        ou 2.1.6) porque alguém da rede pagou a fatura;
--   bonus_recebido       idem, quando o lançamento é Bônus Start.
--
-- O push sai pelo serviço do Expo (exp.host) via pg_net, num cron de 1 min:
-- fn_push_conferir lê a resposta do lote anterior e desliga aparelho que não
-- existe mais (DeviceNotRegistered); fn_push_disparar manda os pendentes.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_eh_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin');
$$;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_notificacao_tipos (
    codigo        text PRIMARY KEY,
    nome          text NOT NULL,
    descricao     text NOT NULL,
    ativo         boolean NOT NULL DEFAULT true,
    titulo        text NOT NULL,
    corpo         text NOT NULL,
    rota          text,
    variaveis     text[] NOT NULL DEFAULT '{}',
    config        jsonb NOT NULL DEFAULT '{}'::jsonb,
    ordem         integer NOT NULL DEFAULT 100,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    atualizado_por uuid
);

CREATE TABLE IF NOT EXISTS public.app_push_tokens (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token         text NOT NULL UNIQUE,
    plataforma    text,
    ativo         boolean NOT NULL DEFAULT true,
    ultimo_erro   text,
    criado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_push_tokens_user ON public.app_push_tokens (user_id) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.app_comunicados (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    publico     text NOT NULL,
    titulo      text NOT NULL,
    corpo       text NOT NULL,
    rota        text,
    total       integer NOT NULL DEFAULT 0,
    enviado_por uuid,
    criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_notificacoes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tipo          text NOT NULL,
    titulo        text NOT NULL,
    corpo         text NOT NULL,
    rota          text,
    dados         jsonb NOT NULL DEFAULT '{}'::jsonb,
    comunicado_id uuid REFERENCES public.app_comunicados(id) ON DELETE SET NULL,
    lida_em       timestamptz,
    criada_em     timestamptz NOT NULL DEFAULT now(),
    push_status   text NOT NULL DEFAULT 'pendente'
                  CHECK (push_status IN ('pendente', 'enviando', 'enviado', 'sem_aparelho', 'erro')),
    push_erro     text
);
CREATE INDEX IF NOT EXISTS idx_app_notificacoes_user ON public.app_notificacoes (user_id, criada_em DESC);
CREATE INDEX IF NOT EXISTS idx_app_notificacoes_pendentes ON public.app_notificacoes (criada_em) WHERE push_status = 'pendente';

CREATE TABLE IF NOT EXISTS public.app_push_lotes (
    request_id    bigint PRIMARY KEY,
    itens         jsonb NOT NULL,          -- [{notificacao_id, token}] na ordem enviada
    criado_em     timestamptz NOT NULL DEFAULT now(),
    conferido_em  timestamptz
);

-- ---------------------------------------------------------------------
-- RLS: o app lê só o que é do login; o CRM interno lê tudo; só o super
-- admin muda o catálogo. Escrita da caixa e dos aparelhos só por RPC.
-- ---------------------------------------------------------------------
ALTER TABLE public.app_notificacao_tipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_push_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_comunicados       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notificacoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_push_lotes        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_notif_tipos_ler ON public.app_notificacao_tipos;
CREATE POLICY app_notif_tipos_ler ON public.app_notificacao_tipos FOR SELECT TO authenticated USING (public.fn_papel_interno());
DROP POLICY IF EXISTS app_notif_tipos_editar ON public.app_notificacao_tipos;
CREATE POLICY app_notif_tipos_editar ON public.app_notificacao_tipos FOR UPDATE TO authenticated
    USING (public.fn_eh_super_admin()) WITH CHECK (public.fn_eh_super_admin());

DROP POLICY IF EXISTS app_push_tokens_interno ON public.app_push_tokens;
CREATE POLICY app_push_tokens_interno ON public.app_push_tokens FOR SELECT TO authenticated USING (public.fn_papel_interno());

DROP POLICY IF EXISTS app_comunicados_interno ON public.app_comunicados;
CREATE POLICY app_comunicados_interno ON public.app_comunicados FOR SELECT TO authenticated USING (public.fn_papel_interno());

DROP POLICY IF EXISTS app_notificacoes_ler ON public.app_notificacoes;
CREATE POLICY app_notificacoes_ler ON public.app_notificacoes FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.fn_papel_interno());

REVOKE ALL ON public.app_push_lotes FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Catálogo inicial
-- ---------------------------------------------------------------------
INSERT INTO public.app_notificacao_tipos (codigo, nome, descricao, ativo, titulo, corpo, rota, variaveis, config, ordem) VALUES
('rede_novo_assinante', 'Novo assinante na rede',
 'Quando alguém da sua rede assina o contrato. Avisa quem indicou (até o nível configurado), o Parceiro Power e o Líder dele.',
 true, 'Novo assinante na sua rede',
 '{{nome}}, de {{cidade}}, assinou com a B2W e entrou no nível {{nivel}} da sua rede.',
 '/connect/home', ARRAY['nome', 'cidade', 'nivel'], '{"niveis": 3}'::jsonb, 10),
('recompensa_recebida', 'Recompensa recebida',
 'Quando um assinante da sua rede paga a fatura e a sua parte entra na sua conta B2W.',
 true, 'Você recebeu uma recompensa',
 '{{valor}} de recompensa: um assinante do nível {{nivel}} da sua rede pagou a fatura.',
 '/connect/home', ARRAY['valor', 'nivel', 'descricao'], '{}'::jsonb, 20),
('bonus_recebido', 'Bônus recebido',
 'Quando o pagamento de um assinante novo da sua rede gera o Bônus Start.',
 true, 'Bônus Start recebido',
 '{{valor}} de bônus pela primeira fatura paga de um assinante do nível {{nivel}} da sua rede.',
 '/connect/home', ARRAY['valor', 'nivel', 'descricao'], '{}'::jsonb, 30),
('comunicado', 'Comunicado da B2W',
 'Mensagem avulsa enviada pelo super admin em Configurações > Notificações > App.',
 true, '{{titulo}}', '{{corpo}}', NULL, ARRAY['titulo', 'corpo'], '{}'::jsonb, 90)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------
-- Criar notificação
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_render_template(p_texto text, p_vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    k text; v text; r text := coalesce(p_texto, '');
BEGIN
    FOR k, v IN SELECT key, value FROM jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) LOOP
        r := replace(r, '{{' || k || '}}', coalesce(v, ''));
    END LOOP;
    -- Variável sem valor não pode aparecer crua para o cliente.
    RETURN btrim(regexp_replace(r, '\{\{[a-z_]+\}\}', '', 'g'));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_brl(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
    select 'R$ ' || translate(to_char(round(coalesce(p, 0), 2), 'FM999,999,990.00'), ',.', '.,');
$$;

CREATE OR REPLACE FUNCTION public.fn_app_notificar(p_user uuid, p_tipo text, p_vars jsonb, p_dados jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    t public.app_notificacao_tipos%rowtype;
    v_id uuid;
BEGIN
    IF p_user IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO t FROM public.app_notificacao_tipos WHERE codigo = p_tipo AND ativo;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN RETURN NULL; END IF;

    INSERT INTO public.app_notificacoes (user_id, tipo, titulo, corpo, rota, dados)
    VALUES (p_user, p_tipo,
            left(public.fn_render_template(t.titulo, p_vars), 120),
            left(public.fn_render_template(t.corpo, p_vars), 400),
            t.rota, coalesce(p_dados, '{}'::jsonb))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_app_notificar(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Evento: novo assinante na rede (contrato assinado)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_notif_rede_novo_assinante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    c_ok constant text[] := ARRAY['contrato_assinado', 'ativo'];
    v_niveis int;
    v_atual uuid;
    v_nivel int := 0;
    v_user uuid;
    v_vars jsonb;
    v_orig record;
    v_avisados uuid[] := '{}';
BEGIN
    IF NOT (NEW.status::text = ANY (c_ok)) THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status::text = ANY (c_ok) THEN RETURN NEW; END IF;
    -- Uma vez por assinante: ativo -> inadimplente -> ativo não avisa de novo.
    IF EXISTS (SELECT 1 FROM public.app_notificacoes
                WHERE tipo = 'rede_novo_assinante' AND dados ->> 'subscriber_id' = NEW.id::text) THEN
        RETURN NEW;
    END IF;

    SELECT coalesce((config ->> 'niveis')::int, 3) INTO v_niveis
      FROM public.app_notificacao_tipos WHERE codigo = 'rede_novo_assinante' AND ativo;
    IF v_niveis IS NULL THEN RETURN NEW; END IF;

    -- Só o primeiro nome: quem está em outro nível não precisa do nome inteiro.
    v_vars := jsonb_build_object(
        'nome', initcap(split_part(btrim(coalesce(NEW.name, 'Um novo assinante')), ' ', 1)),
        'cidade', coalesce(nullif(btrim(NEW.cidade), ''), 'sua região'));

    -- Assinante Conect: sobe a cadeia de indicação.
    v_atual := NEW.indicador_assinante_id;
    WHILE v_atual IS NOT NULL AND v_atual <> NEW.id AND v_nivel < v_niveis LOOP
        v_nivel := v_nivel + 1;
        SELECT s.user_id INTO v_user FROM public.subscribers s WHERE s.id = v_atual;
        IF v_user IS NOT NULL AND NOT v_user = ANY (v_avisados) THEN
            PERFORM public.fn_app_notificar(v_user, 'rede_novo_assinante',
                v_vars || jsonb_build_object('nivel', v_nivel),
                jsonb_build_object('subscriber_id', NEW.id, 'nivel', v_nivel));
            v_avisados := v_avisados || v_user;
        END IF;
        SELECT s.indicador_assinante_id INTO v_atual FROM public.subscribers s WHERE s.id = v_atual;
    END LOOP;

    -- Parceiro Power (o login é o próprio id do originador) e o Líder dele.
    IF NEW.originator_id IS NOT NULL THEN
        SELECT o.id, o.lider_id INTO v_orig FROM public.originators_v2 o WHERE o.id = NEW.originator_id;
        IF FOUND THEN
            IF NOT v_orig.id = ANY (v_avisados) THEN
                PERFORM public.fn_app_notificar(v_orig.id, 'rede_novo_assinante',
                    v_vars || jsonb_build_object('nivel', 1),
                    jsonb_build_object('subscriber_id', NEW.id, 'nivel', 1));
                v_avisados := v_avisados || v_orig.id;
            END IF;
            IF v_orig.lider_id IS NOT NULL AND v_orig.lider_id <> v_orig.id AND NOT v_orig.lider_id = ANY (v_avisados) THEN
                PERFORM public.fn_app_notificar(v_orig.lider_id, 'rede_novo_assinante',
                    v_vars || jsonb_build_object('nivel', 2),
                    jsonb_build_object('subscriber_id', NEW.id, 'nivel', 2));
            END IF;
        END IF;
    END IF;
    RETURN NEW;
EXCEPTION WHEN others THEN
    -- Aviso nunca derruba a assinatura do contrato.
    RAISE WARNING 'fn_trg_notif_rede_novo_assinante: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_rede_novo_assinante ON public.subscribers;
CREATE TRIGGER trg_notif_rede_novo_assinante
    AFTER INSERT OR UPDATE OF status ON public.subscribers
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_notif_rede_novo_assinante();

-- ---------------------------------------------------------------------
-- Evento: recompensa / bônus lançado no razão
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_notif_recompensa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_conta text;
    v_user uuid;
    v_nivel text;
    v_tipo text;
BEGIN
    -- Crédito ao beneficiário = valor negativo no passivo; estorno é positivo.
    IF NEW.amount IS NULL OR NEW.amount > -0.005 OR coalesce(NEW.is_sandbox, false) THEN RETURN NEW; END IF;
    SELECT code INTO v_conta FROM public.ledger_accounts WHERE id = NEW.account_id;
    IF v_conta NOT IN ('2.1.2', '2.1.6') THEN RETURN NEW; END IF;

    IF NEW.reference_type = 'originator' THEN
        v_user := NEW.reference_id;
    ELSIF NEW.reference_type = 'subscriber' THEN
        SELECT user_id INTO v_user FROM public.subscribers WHERE id = NEW.reference_id;
    END IF;
    IF v_user IS NULL THEN RETURN NEW; END IF;

    v_nivel := coalesce(substring(NEW.description from 'nível ([0-9]+)'), '1');
    v_tipo := CASE WHEN NEW.description ILIKE 'Bônus Start%' THEN 'bonus_recebido' ELSE 'recompensa_recebida' END;

    PERFORM public.fn_app_notificar(v_user, v_tipo,
        jsonb_build_object('valor', public.fn_brl(-NEW.amount), 'nivel', v_nivel, 'descricao', NEW.description),
        jsonb_build_object('ledger_entry_id', NEW.id, 'valor', -NEW.amount));
    RETURN NEW;
EXCEPTION WHEN others THEN
    RAISE WARNING 'fn_trg_notif_recompensa: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_recompensa ON public.ledger_entries;
CREATE TRIGGER trg_notif_recompensa
    AFTER INSERT ON public.ledger_entries
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_notif_recompensa();

-- ---------------------------------------------------------------------
-- RPCs do app
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_registrar_push_token(p_token text, p_plataforma text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF auth.uid() IS NULL OR p_token IS NULL OR p_token !~ '^(Exponent|Expo)PushToken\[.+\]$' THEN
        RAISE EXCEPTION 'token inválido';
    END IF;
    -- O aparelho pode trocar de login: o token passa para quem entrou agora.
    INSERT INTO public.app_push_tokens (user_id, token, plataforma)
    VALUES (auth.uid(), p_token, p_plataforma)
    ON CONFLICT (token) DO UPDATE
       SET user_id = auth.uid(), plataforma = EXCLUDED.plataforma, ativo = true,
           ultimo_erro = NULL, atualizado_em = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.app_remover_push_token(p_token text)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    update public.app_push_tokens set ativo = false, atualizado_em = now()
     where token = p_token and user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.app_minhas_notificacoes(p_limite int DEFAULT 50)
RETURNS TABLE (id uuid, tipo text, titulo text, corpo text, rota text, criada_em timestamptz, lida_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    select n.id, n.tipo, n.titulo, n.corpo, n.rota, n.criada_em, n.lida_em
      from public.app_notificacoes n
     where n.user_id = auth.uid()
     order by n.criada_em desc
     limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;

CREATE OR REPLACE FUNCTION public.app_notificacoes_nao_lidas()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    select count(*)::int from public.app_notificacoes where user_id = auth.uid() and lida_em is null;
$$;

CREATE OR REPLACE FUNCTION public.app_marcar_notificacoes_lidas(p_ids uuid[] DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    update public.app_notificacoes set lida_em = now()
     where user_id = auth.uid() and lida_em is null
       and (p_ids is null or id = any (p_ids));
$$;

REVOKE EXECUTE ON FUNCTION public.app_registrar_push_token(text, text), public.app_remover_push_token(text),
    public.app_minhas_notificacoes(int), public.app_notificacoes_nao_lidas(), public.app_marcar_notificacoes_lidas(uuid[])
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_registrar_push_token(text, text), public.app_remover_push_token(text),
    public.app_minhas_notificacoes(int), public.app_notificacoes_nao_lidas(), public.app_marcar_notificacoes_lidas(uuid[])
    TO authenticated;

-- ---------------------------------------------------------------------
-- RPCs do CRM (super admin)
-- ---------------------------------------------------------------------
-- Logins de cada público. 'todos' = qualquer login com aparelho registrado.
CREATE OR REPLACE FUNCTION public.fn_app_publico(p_publico text)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    select distinct x.uid from (
        select s.user_id as uid from public.subscribers s
         where p_publico in ('todos', 'assinantes') and s.user_id is not null
           and s.status::text in ('contrato_assinado', 'ativo', 'ativo_inadimplente')
        union all
        select o.id from public.originators_v2 o
         where p_publico in ('todos', 'parceiros') and o.ativo is distinct from false
        union all
        select sp.user_id from public.suppliers sp
         where p_publico in ('todos', 'investidores') and sp.user_id is not null
        union all
        select t.user_id from public.app_push_tokens t
         where p_publico = 'todos' and t.ativo
    ) x
    where x.uid is not null and exists (select 1 from auth.users u where u.id = x.uid);
$$;
REVOKE EXECUTE ON FUNCTION public.fn_app_publico(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_app_publico_total(p_publico text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF NOT public.fn_eh_super_admin() THEN RAISE EXCEPTION 'apenas super admin'; END IF;
    RETURN (select jsonb_build_object(
        'logins', count(*),
        'com_aparelho', count(*) filter (where exists (select 1 from public.app_push_tokens t where t.user_id = p.uid and t.ativo)))
      from public.fn_app_publico(p_publico) p(uid));
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_enviar_comunicado(p_publico text, p_titulo text, p_corpo text, p_rota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_id uuid; v_total int;
BEGIN
    IF NOT public.fn_eh_super_admin() THEN RAISE EXCEPTION 'apenas super admin'; END IF;
    IF p_publico NOT IN ('todos', 'assinantes', 'parceiros', 'investidores') THEN RAISE EXCEPTION 'público inválido'; END IF;
    IF btrim(coalesce(p_titulo, '')) = '' OR btrim(coalesce(p_corpo, '')) = '' THEN RAISE EXCEPTION 'título e texto são obrigatórios'; END IF;

    INSERT INTO public.app_comunicados (publico, titulo, corpo, rota, enviado_por)
    VALUES (p_publico, left(btrim(p_titulo), 120), left(btrim(p_corpo), 400), nullif(btrim(coalesce(p_rota, '')), ''), auth.uid())
    RETURNING id INTO v_id;

    INSERT INTO public.app_notificacoes (user_id, tipo, titulo, corpo, rota, comunicado_id)
    SELECT p.uid, 'comunicado', left(btrim(p_titulo), 120), left(btrim(p_corpo), 400),
           nullif(btrim(coalesce(p_rota, '')), ''), v_id
      FROM public.fn_app_publico(p_publico) p(uid);
    GET DIAGNOSTICS v_total = ROW_COUNT;

    UPDATE public.app_comunicados SET total = v_total WHERE id = v_id;
    RETURN jsonb_build_object('id', v_id, 'total', v_total);
END;
$$;

-- Manda o tipo com valores de exemplo para o próprio super admin.
CREATE OR REPLACE FUNCTION public.crm_testar_notificacao(p_tipo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    t public.app_notificacao_tipos%rowtype;
BEGIN
    IF NOT public.fn_eh_super_admin() THEN RAISE EXCEPTION 'apenas super admin'; END IF;
    SELECT * INTO t FROM public.app_notificacao_tipos WHERE codigo = p_tipo;
    IF NOT FOUND THEN RAISE EXCEPTION 'tipo inexistente'; END IF;
    INSERT INTO public.app_notificacoes (user_id, tipo, titulo, corpo, rota, dados)
    VALUES (auth.uid(), p_tipo,
            '[Teste] ' || left(public.fn_render_template(t.titulo, '{"titulo":"Comunicado de teste"}'::jsonb), 110),
            left(public.fn_render_template(t.corpo, jsonb_build_object(
                'nome', 'Maria', 'cidade', 'Natal', 'nivel', 1, 'valor', 'R$ 12,34',
                'descricao', 'exemplo', 'corpo', 'Texto de exemplo do comunicado.')), 400),
            t.rota, '{"teste": true}'::jsonb);
    RETURN (select id from public.app_notificacoes where user_id = auth.uid() order by criada_em desc limit 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crm_app_publico_total(text), public.crm_enviar_comunicado(text, text, text, text),
    public.crm_testar_notificacao(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_app_publico_total(text), public.crm_enviar_comunicado(text, text, text, text),
    public.crm_testar_notificacao(text) TO authenticated;

-- ---------------------------------------------------------------------
-- Envio pelo Expo (pg_net) e conferência
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_push_disparar()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_lote jsonb;
    v_itens jsonb;
    v_req bigint;
    v_total int := 0;
BEGIN
    -- Sem aparelho: fica só na caixa de entrada do app.
    UPDATE public.app_notificacoes n SET push_status = 'sem_aparelho'
     WHERE n.push_status = 'pendente'
       AND NOT EXISTS (SELECT 1 FROM public.app_push_tokens t WHERE t.user_id = n.user_id AND t.ativo);

    -- O Expo aceita até 100 mensagens por chamada.
    LOOP
        WITH fila AS (
            SELECT n.id, n.titulo, n.corpo, n.rota, t.token
              FROM public.app_notificacoes n
              JOIN public.app_push_tokens t ON t.user_id = n.user_id AND t.ativo
             WHERE n.push_status = 'pendente'
             ORDER BY n.criada_em, n.id
             LIMIT 100
        )
        SELECT jsonb_agg(jsonb_build_object(
                   'to', token, 'title', titulo, 'body', corpo, 'sound', 'default',
                   'channelId', 'default', 'data', jsonb_build_object('id', id, 'rota', rota))),
               jsonb_agg(jsonb_build_object('notificacao_id', id, 'token', token))
          INTO v_lote, v_itens
          FROM fila;
        EXIT WHEN v_lote IS NULL;

        v_req := net.http_post(
            url := 'https://exp.host/--/api/v2/push/send',
            body := v_lote,
            headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json'),
            timeout_milliseconds := 30000);
        INSERT INTO public.app_push_lotes (request_id, itens) VALUES (v_req, v_itens);
        UPDATE public.app_notificacoes SET push_status = 'enviando'
         WHERE id IN (SELECT (i ->> 'notificacao_id')::uuid FROM jsonb_array_elements(v_itens) i);
        v_total := v_total + jsonb_array_length(v_itens);
        EXIT WHEN v_total >= 1000;
    END LOOP;
    RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_push_conferir()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    l record;
    r record;
    v_body jsonb;
    i int;
    v_item jsonb;
    v_ticket jsonb;
    v_n int := 0;
BEGIN
    FOR l IN SELECT * FROM public.app_push_lotes WHERE conferido_em IS NULL ORDER BY criado_em LIMIT 50 LOOP
        SELECT status_code, content, timed_out, error_msg INTO r FROM net._http_response WHERE id = l.request_id;
        IF NOT FOUND THEN
            -- Sem resposta depois de 10 min: dá como erro para não travar a fila.
            IF l.criado_em < now() - interval '10 minutes' THEN
                UPDATE public.app_notificacoes SET push_status = 'erro', push_erro = 'sem resposta do Expo'
                 WHERE id IN (SELECT (x ->> 'notificacao_id')::uuid FROM jsonb_array_elements(l.itens) x)
                   AND push_status = 'enviando';
                UPDATE public.app_push_lotes SET conferido_em = now() WHERE request_id = l.request_id;
            END IF;
            CONTINUE;
        END IF;

        BEGIN v_body := r.content::jsonb; EXCEPTION WHEN others THEN v_body := NULL; END;

        IF r.status_code IS DISTINCT FROM 200 OR v_body IS NULL OR jsonb_typeof(v_body -> 'data') <> 'array' THEN
            UPDATE public.app_notificacoes SET push_status = 'erro',
                   push_erro = left(coalesce(r.error_msg, 'HTTP ' || r.status_code::text, 'resposta inválida'), 300)
             WHERE id IN (SELECT (x ->> 'notificacao_id')::uuid FROM jsonb_array_elements(l.itens) x)
               AND push_status = 'enviando';
        ELSE
            FOR i IN 0 .. jsonb_array_length(l.itens) - 1 LOOP
                v_item := l.itens -> i;
                v_ticket := v_body -> 'data' -> i;
                IF v_ticket ->> 'status' = 'ok' THEN
                    UPDATE public.app_notificacoes SET push_status = 'enviado', push_erro = NULL
                     WHERE id = (v_item ->> 'notificacao_id')::uuid;
                ELSE
                    IF v_ticket #>> '{details,error}' = 'DeviceNotRegistered' THEN
                        UPDATE public.app_push_tokens SET ativo = false, ultimo_erro = 'DeviceNotRegistered', atualizado_em = now()
                         WHERE token = v_item ->> 'token';
                    END IF;
                    -- Login com dois aparelhos: basta um ter recebido.
                    UPDATE public.app_notificacoes SET push_status = 'erro',
                           push_erro = left(coalesce(v_ticket ->> 'message', 'erro no Expo'), 300)
                     WHERE id = (v_item ->> 'notificacao_id')::uuid AND push_status <> 'enviado';
                END IF;
            END LOOP;
        END IF;
        UPDATE public.app_push_lotes SET conferido_em = now() WHERE request_id = l.request_id;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_push_disparar(), public.fn_push_conferir() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'push-app';
SELECT cron.schedule('push-app', '* * * * *', $$ select public.fn_push_conferir(); select public.fn_push_disparar(); $$);
