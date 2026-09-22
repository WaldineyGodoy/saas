# Adesão sem perdas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O visitante que chega pela raiz (com ou sem embaixador) vira assinante com documentos anexados e contrato na Autentique, com o mesmo link curto no WhatsApp e no e-mail, sem perder dados nem atribuição.

**Architecture:** `/contrato` vira um assistente de 3 passos (Dados → Documentos → Contrato). O passo Dados chama a RPC `fn_criar_assinante_publico` v2, que grava tudo e devolve um `onboarding_token`; esse token é a credencial das Edge Functions anônimas `onboarding-documentos` e `onboarding-finalizar` v4. Regras puras das Edge Functions ficam em `supabase/functions/_shared/*.ts` sem imports Deno, testadas por Vitest na raiz do repo.

**Tech Stack:** Postgres/Supabase (RLS, SECURITY DEFINER, Vault, Storage, pg_net), Edge Functions Deno, React 19 + Vite, Vitest (novo), Autentique GraphQL, YOURLS, Evolution API, Resend.

## Global Constraints

- Projeto Supabase: `abbysvxnnhwvvzhftoms`. Migrações novas: `supabase/migrations/20260921b_*.sql` … aplicadas pelo MCP `apply_migration` com o mesmo nome.
- Testes SQL: padrão `supabase/tests/*.test.sql` — bloco `DO $$ … $$` que termina com `RAISE EXCEPTION 'SANDBOX_OK'` para desfazer tudo. Rodar pelo MCP `execute_sql`; **sucesso = erro `SANDBOX_OK`**; qualquer outra mensagem = falha.
- Testes JS/TS: `npx vitest run <arquivo>` na raiz do worktree.
- Nunca definir `leads.status` na mão: gatilho `trg_sync_lead_status` deriva do assinante (ver memória `crm-status-lead-assinante`).
- Texto que chega ao cliente em Edge Function: acentos em `\u` escapes (deploy anterior perdeu acentos).
- Adesão só grava pela RPC; nunca INSERT direto de `anon` em `subscribers`/`consumer_units`.
- Não commitar `src/components/SupplierModal.jsx` (trabalho de outra sessão). Não mexer em `LeadModal.jsx`, `LeadsList.jsx`, `MessageTriggerModal.jsx` (sessão "Leads").
- Leads anteriores ficam fora: sem backfill, nada é apagado.
- Autentique em produção: testes reais só com `integrations_config.environment = 'sandbox'` em `service_name = 'autentique_api'`, restaurado a `production` no fim.
- Contatos reais do teste: WhatsApp `5533999991234`, e-mail `b2wnotificacoes@gmail.com`. CEP `59158-155`.
- Dias de vencimento aceitos: `5, 10, 15, 20`. Documentos: PDF/JPG/PNG até 10 MB. Token: 30 dias.
- Commits terminam com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260921b_adesao_v2.sql` | colunas novas, `fn_desconto_assinante_municipio`, `fn_documento_em_uso`, RPC v2 |
| `supabase/migrations/20260921c_onboarding_documentos.sql` | `subscriber_documents`, bucket, `fn_onboarding_estado`, `fn_onboarding_documentos_faltantes` |
| `supabase/migrations/20260921d_originador_perfil.sql` | gatilho de papel, grants de coluna do anon, correção dos perfis |
| `supabase/migrations/20260921e_envio_interno.sql` | segredo `b2w:internal_secret`, `fn_segredo_interno_confere`, `fn_dispatch_notification` com header |
| `supabase/tests/adesao_v2.test.sql`, `onboarding_documentos.test.sql`, `originador_perfil.test.sql` | testes SQL |
| `supabase/functions/_shared/envio-portao.ts` | regra pura do portão de envio |
| `supabase/functions/_shared/onboarding-regras.ts` | regras puras: documentos, link, extensão, keyword |
| `supabase/functions/_shared/email-contrato.ts` | HTML do e-mail do contrato |
| `supabase/functions/send-email/index.ts`, `send-whatsapp/index.ts` | portão + `text` |
| `supabase/functions/onboarding-documentos/index.ts` | URL de upload assinada + registro |
| `supabase/functions/onboarding-finalizar/index.ts` | v4 |
| `supabase/functions/autentique-webhook/index.ts` | anula o token ao assinar |
| `src/lib/onboarding.js` | regras puras do front (UUID, docs obrigatórios, etapa) |
| `src/lib/contrato.js` | representante legal |
| `src/pages/public/SubscriberSignup.jsx` | assistente 3 passos |
| `src/pages/public/onboarding/PassoDocumentos.jsx` | upload |
| `src/components/PublicConsumerUnitForm.jsx` | CPF do titular, tipo de ligação, ibge |
| `src/components/subscriber/DocumentosAssinante.jsx` + `SubscriberModal.jsx` | aba Documentos, duplicidade |
| `tests/*.test.js|ts` | Vitest |
| `Paginas/Contrato/App.tsx` | termos v3.0, sem CPF |
| `Paginas/landingpage cadastro para ser embaixador/*` → repo `paginas` branch `Home` pasta `embaixador/` | publicação |

---

### Task 0: Vitest no repo

**Files:**
- Modify: `package.json` (scripts + devDependency)
- Create: `vitest.config.js`, `tests/sanity.test.js`

**Interfaces:** Produces: `npm test` → `vitest run`.

- [ ] **Step 1:** `npm ci` no worktree (não usar junction de node_modules — memória `worktree-junction-node-modules`), depois `npm i -D vitest@^3`.
- [ ] **Step 2:** criar `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.{js,ts}'], environment: 'node' } });
```

- [ ] **Step 3:** `tests/sanity.test.js`:

```js
import { test, expect } from 'vitest';
test('vitest roda', () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 4:** em `package.json` scripts: `"test": "vitest run"`. Rodar `npm test` → PASS 1 teste.
- [ ] **Step 5:** commit `chore: vitest para regras puras da adesao`.

---

### Task 1: RPC `fn_criar_assinante_publico` v2

**Files:**
- Create: `supabase/migrations/20260921b_adesao_v2.sql`
- Test: `supabase/tests/adesao_v2.test.sql`

**Interfaces:**
- Produces:
  - `fn_desconto_assinante_municipio(p_ibge text, p_uf text) returns numeric` (null se não houver)
  - `fn_documento_em_uso(p_doc text, p_ignorar uuid default null) returns boolean` (grant `authenticated`)
  - `fn_criar_assinante_publico(p_nome text, p_cpf_cnpj text, p_email text, p_telefone text, p_cep text, p_rua text, p_numero text, p_complemento text, p_bairro text, p_cidade text, p_uf text, p_ibge text, p_originator_id text, p_lead_id uuid, p_ucs jsonb, p_dia_vencimento int, p_representante_nome text, p_representante_cpf text, p_aceite_versao text) returns jsonb` → `{subscriber_id, onboarding_token, ucs_criadas, originador_vinculado, desconto}`. `p_originator_id` é **text** (UUID inválido é ignorado, não derruba).
  - Cada item de `p_ucs`: `{numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao, concessionaria, franquia, ibge, cep, rua, numero, complemento, bairro, cidade, uf}`.
  - Colunas novas em `subscribers`: `representante_nome text, representante_cpf text, aceite_termos_em timestamptz, aceite_termos_versao text, onboarding_token uuid unique, onboarding_token_expira_em timestamptz`.

- [ ] **Step 1: Write the failing test** — `supabase/tests/adesao_v2.test.sql`:

```sql
-- RPC de adesao v2. Tudo desfeito pelo SANDBOX_OK.
DO $$
DECLARE
  v_ibge text; v_uf text; v_desc numeric; r jsonb; v_sub uuid; v_org uuid; v_lead uuid;
  v_ucs jsonb; v_msg text;
BEGIN
  SELECT "Cod. Ibge", "UF", "Desconto Assinante" INTO v_ibge, v_uf, v_desc
    FROM public."Concessionaria" WHERE "Desconto Assinante" > 0 LIMIT 1;

  -- 1. desconto por municipio e fallback por UF
  IF public.fn_desconto_assinante_municipio(v_ibge, v_uf) IS DISTINCT FROM v_desc THEN
    RAISE EXCEPTION 'FALHOU: desconto por IBGE';
  END IF;
  IF public.fn_desconto_assinante_municipio('0000000', v_uf) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: sem fallback por UF';
  END IF;

  SELECT id INTO v_org FROM public.originators_v2 LIMIT 1;
  INSERT INTO public.leads (id, name, email, phone, status, originator_id)
  VALUES (gen_random_uuid(), 'Lead Teste', 'lt@teste.invalid', '84999990000', 'simulacao', v_org)
  RETURNING id INTO v_lead;

  v_ucs := jsonb_build_array(jsonb_build_object(
    'numero_uc','TESTE-UC-0001','titular_conta','Fulano Teste','cpf_cnpj_fatura','52998224725',
    'tipo_ligacao','monofasico','concessionaria','COSERN','franquia','300','ibge',v_ibge,
    'cep','59158155','rua','Rua A','numero','10','bairro','B','cidade','C','uf',v_uf));

  -- 2. sem aceite recusa
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Fulano Teste','52998224725','f@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,v_lead,v_ucs,10,null,null,null);
    RAISE EXCEPTION 'FALHOU: aceitou sem aceite';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT ILIKE '%termos%' THEN RAISE EXCEPTION 'FALHOU: erro inesperado sem aceite: %', v_msg; END IF;
  END;

  -- 3. CNPJ sem representante recusa
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Empresa Teste','11222333000181','e@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,null,v_ucs,10,null,null,'3.0');
    RAISE EXCEPTION 'FALHOU: CNPJ sem representante';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT ILIKE '%representante%' THEN RAISE EXCEPTION 'FALHOU: erro inesperado CNPJ: %', v_msg; END IF;
  END;

  -- 4. vencimento fora da lista recusa
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Fulano Teste','52998224725','f@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,null,v_ucs,7,null,null,'3.0');
    RAISE EXCEPTION 'FALHOU: aceitou vencimento 7';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT ILIKE '%vencimento%' THEN RAISE EXCEPTION 'FALHOU: erro inesperado venc: %', v_msg; END IF;
  END;

  -- 5. caminho feliz: originator_id invalido ignorado, herda do lead, grava desconto/vencimento/token
  r := public.fn_criar_assinante_publico('Fulano Teste','529.982.247-25','F@Teste.invalid','(84) 99999-0000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,'abc',v_lead,v_ucs,15,null,null,'3.0');
  v_sub := (r->>'subscriber_id')::uuid;
  IF (r->>'onboarding_token') IS NULL THEN RAISE EXCEPTION 'FALHOU: sem token'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscribers WHERE id = v_sub AND originator_id = v_org
                   AND aceite_termos_versao = '3.0' AND aceite_termos_em IS NOT NULL
                   AND onboarding_token_expira_em > now() + interval '29 days') THEN
    RAISE EXCEPTION 'FALHOU: assinante sem originador herdado/aceite/validade';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consumer_units WHERE subscriber_id = v_sub
                   AND desconto_assinante = v_desc AND dia_vencimento = 15
                   AND cpf_cnpj_fatura = '52998224725' AND tipo_ligacao = 'monofasico') THEN
    RAISE EXCEPTION 'FALHOU: UC sem desconto/vencimento/titular/ligacao';
  END IF;

  -- 6. CPF duplicado recusa; UC duplicada recusa
  IF NOT public.fn_documento_em_uso('52998224725') THEN RAISE EXCEPTION 'FALHOU: documento em uso'; END IF;
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Outro','52998224725','o@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,null,v_ucs,10,null,null,'3.0');
    RAISE EXCEPTION 'FALHOU: CPF duplicado aceito';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Outro','15350946056','o@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,null,v_ucs,10,null,null,'3.0');
    RAISE EXCEPTION 'FALHOU: UC duplicada aceita';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
```

- [ ] **Step 2:** rodar pelo `execute_sql` → esperado FAIL (`function fn_desconto_assinante_municipio does not exist`).
- [ ] **Step 3: Implementação** — `supabase/migrations/20260921b_adesao_v2.sql`:

```sql
ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS representante_nome text,
  ADD COLUMN IF NOT EXISTS representante_cpf text,
  ADD COLUMN IF NOT EXISTS aceite_termos_em timestamptz,
  ADD COLUMN IF NOT EXISTS aceite_termos_versao text,
  ADD COLUMN IF NOT EXISTS onboarding_token uuid UNIQUE,
  ADD COLUMN IF NOT EXISTS onboarding_token_expira_em timestamptz;

-- Desconto do simulador, resolvido no servidor. Mesma regra da raiz:
-- municipio pelo IBGE; sem linha, media da UF.
CREATE OR REPLACE FUNCTION public.fn_desconto_assinante_municipio(p_ibge text, p_uf text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT "Desconto Assinante" FROM public."Concessionaria"
      WHERE "Cod. Ibge" = p_ibge AND "Desconto Assinante" > 0 LIMIT 1),
    (SELECT round(avg("Desconto Assinante"), 2) FROM public."Concessionaria"
      WHERE upper("UF") = upper(p_uf) AND "Desconto Assinante" > 0)
  );
$$;

-- Regra unica de duplicidade (RPC publica e SubscriberModal).
CREATE OR REPLACE FUNCTION public.fn_documento_em_uso(p_doc text, p_ignorar uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscribers
     WHERE public.fn_so_digitos(cpf_cnpj) = public.fn_so_digitos(p_doc)
       AND status NOT IN ('cancelado', 'cancelado_inadimplente')
       AND (p_ignorar IS NULL OR id <> p_ignorar));
$$;
REVOKE EXECUTE ON FUNCTION public.fn_documento_em_uso(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_documento_em_uso(text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,uuid,uuid,jsonb);

CREATE OR REPLACE FUNCTION public.fn_criar_assinante_publico(
  p_nome text, p_cpf_cnpj text, p_email text, p_telefone text,
  p_cep text, p_rua text, p_numero text, p_complemento text, p_bairro text, p_cidade text, p_uf text,
  p_ibge text, p_originator_id text, p_lead_id uuid, p_ucs jsonb,
  p_dia_vencimento int, p_representante_nome text, p_representante_cpf text, p_aceite_versao text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_doc text := public.fn_so_digitos(p_cpf_cnpj);
  v_tel text := public.fn_so_digitos(p_telefone);
  v_rep text := public.fn_so_digitos(p_representante_cpf);
  v_originator uuid; v_sub_id uuid; v_token uuid := gen_random_uuid();
  v_uc jsonb; v_uc_num text; v_tit text; v_desc numeric; v_n int := 0;
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

  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status, cep, rua, numero, complemento, bairro, cidade, uf,
    originator_id, lead_id, representante_nome, representante_cpf, aceite_termos_em, aceite_termos_versao,
    onboarding_token, onboarding_token_expira_em)
  VALUES (btrim(p_nome), v_doc, lower(btrim(p_email)), v_tel, 'ativacao', public.fn_so_digitos(p_cep), p_rua, p_numero,
    p_complemento, p_bairro, p_cidade, upper(p_uf), v_originator, p_lead_id,
    nullif(btrim(coalesce(p_representante_nome, '')), ''), v_rep, now(), btrim(p_aceite_versao),
    v_token, now() + interval '30 days')
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

    INSERT INTO public.consumer_units (subscriber_id, numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao,
      concessionaria, status, modalidade, franquia, desconto_assinante, dia_vencimento, address)
    VALUES (v_sub_id, v_uc_num, nullif(btrim(coalesce(v_uc->>'titular_conta', '')), ''), v_tit,
      (v_uc->>'tipo_ligacao')::public.uc_tipo_ligacao, nullif(btrim(coalesce(v_uc->>'concessionaria', '')), ''),
      'em_ativacao', 'geracao_compartilhada', nullif(v_uc->>'franquia', '')::numeric, v_desc, p_dia_vencimento,
      jsonb_build_object('cep', public.fn_so_digitos(v_uc->>'cep'), 'rua', v_uc->>'rua', 'numero', v_uc->>'numero',
        'complemento', v_uc->>'complemento', 'bairro', v_uc->>'bairro', 'cidade', v_uc->>'cidade', 'uf', upper(v_uc->>'uf')));
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('subscriber_id', v_sub_id, 'onboarding_token', v_token, 'ucs_criadas', v_n,
    'originador_vinculado', v_originator IS NOT NULL, 'desconto', v_desc);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,int,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,int,text,text,text) TO anon, authenticated;
```

- [ ] **Step 4:** `apply_migration` name `20260921b_adesao_v2`; rodar o teste → esperado erro `SANDBOX_OK`. Conferir que `fn_desconto_assinante_municipio` não vaza nada sensível (só lê tabela pública). Se o CPF `52998224725` ou `15350946056` já existir em `subscribers` ativos, trocar por outro CPF válido fictício e reportar.
- [ ] **Step 5:** commit `feat(adesao): RPC v2 com desconto no servidor, vencimento, representante, aceite e token`.

---

### Task 2: Documentos e estado da retomada (banco)

**Files:**
- Create: `supabase/migrations/20260921c_onboarding_documentos.sql`
- Test: `supabase/tests/onboarding_documentos.test.sql`

**Interfaces:**
- Consumes: colunas de token (Task 1).
- Produces:
  - tabela `subscriber_documents(id uuid pk, subscriber_id uuid fk, consumer_unit_id uuid null fk, tipo text check in ('identidade','conta_energia','contrato_social'), storage_path text unique, mime text, tamanho int, criado_em timestamptz default now())`
  - bucket privado `documentos-assinante`
  - `fn_onboarding_assinante_por_token(p_token uuid) returns uuid` (null se inválido/expirado; só `service_role`)
  - `fn_onboarding_documentos_faltantes(p_subscriber uuid) returns jsonb` → array `[{tipo, consumer_unit_id, numero_uc}]` (só `service_role`)
  - `fn_onboarding_estado(p_token uuid) returns jsonb` (anon) → `{etapa: 'documentos'|'contrato'|'enviado'|'assinado', subscriber:{id,name,cpf_cnpj,email,phone,cep,rua,numero,complemento,bairro,cidade,uf,representante_nome,representante_cpf}, ucs:[{id,numero_uc,titular_conta,concessionaria,franquia,desconto_assinante,dia_vencimento}], faltantes:[…], signature_link}` ou `null` se token inválido.

- [ ] **Step 1: teste** `supabase/tests/onboarding_documentos.test.sql`:

```sql
DO $$
DECLARE r jsonb; v_sub uuid; v_tok uuid; v_uc uuid; v_ibge text; v_uf text; e jsonb;
BEGIN
  SELECT "Cod. Ibge","UF" INTO v_ibge, v_uf FROM public."Concessionaria" WHERE "Desconto Assinante" > 0 LIMIT 1;
  r := public.fn_criar_assinante_publico('Fulano Docs','52998224725','fd@teste.invalid','84999990000','59158155','Rua','1',null,'B','C',v_uf,v_ibge,null,null,
    jsonb_build_array(jsonb_build_object('numero_uc','TESTE-UC-DOC1','cpf_cnpj_fatura','52998224725','tipo_ligacao','bifasico','franquia','200','ibge',v_ibge,'uf',v_uf)),10,null,null,'3.0');
  v_sub := (r->>'subscriber_id')::uuid; v_tok := (r->>'onboarding_token')::uuid;
  SELECT id INTO v_uc FROM public.consumer_units WHERE subscriber_id = v_sub;

  IF public.fn_onboarding_assinante_por_token(v_tok) IS DISTINCT FROM v_sub THEN RAISE EXCEPTION 'FALHOU: token nao resolve'; END IF;
  IF public.fn_onboarding_assinante_por_token(gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: token falso resolve'; END IF;

  e := public.fn_onboarding_estado(v_tok);
  IF e->>'etapa' <> 'documentos' OR jsonb_array_length(e->'faltantes') <> 2 THEN
    RAISE EXCEPTION 'FALHOU: estado inicial %', e;
  END IF;

  INSERT INTO public.subscriber_documents (subscriber_id, tipo, storage_path, mime, tamanho)
  VALUES (v_sub, 'identidade', v_sub || '/identidade/a.pdf', 'application/pdf', 10);
  INSERT INTO public.subscriber_documents (subscriber_id, consumer_unit_id, tipo, storage_path, mime, tamanho)
  VALUES (v_sub, v_uc, 'conta_energia', v_sub || '/conta_energia/b.pdf', 'application/pdf', 10);

  e := public.fn_onboarding_estado(v_tok);
  IF e->>'etapa' <> 'contrato' OR jsonb_array_length(e->'faltantes') <> 0 THEN RAISE EXCEPTION 'FALHOU: estado completo %', e; END IF;

  UPDATE public.subscribers SET onboarding_token_expira_em = now() - interval '1 minute' WHERE id = v_sub;
  IF public.fn_onboarding_estado(v_tok) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: token expirado aceito'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
```

- [ ] **Step 2:** rodar → FAIL (`relation subscriber_documents does not exist`).
- [ ] **Step 3:** migração:

```sql
CREATE TABLE IF NOT EXISTS public.subscriber_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  consumer_unit_id uuid REFERENCES public.consumer_units(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('identidade', 'conta_energia', 'contrato_social')),
  storage_path text NOT NULL UNIQUE,
  mime text NOT NULL,
  tamanho int NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriber_documents_sub_idx ON public.subscriber_documents(subscriber_id);
ALTER TABLE public.subscriber_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriber_documents_interno ON public.subscriber_documents FOR ALL TO authenticated
  USING (public.check_user_is_admin()) WITH CHECK (public.check_user_is_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documentos-assinante', 'documentos-assinante', false, 10485760, ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY documentos_assinante_interno_leitura ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documentos-assinante' AND public.check_user_is_admin());

CREATE OR REPLACE FUNCTION public.fn_onboarding_assinante_por_token(p_token uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.subscribers
   WHERE onboarding_token = p_token AND onboarding_token_expira_em > now();
$$;

CREATE OR REPLACE FUNCTION public.fn_onboarding_documentos_faltantes(p_subscriber uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(f), '[]'::jsonb) FROM (
    SELECT 'identidade' AS tipo, NULL::uuid AS consumer_unit_id, NULL::text AS numero_uc
     WHERE NOT EXISTS (SELECT 1 FROM subscriber_documents d WHERE d.subscriber_id = p_subscriber AND d.tipo = 'identidade')
    UNION ALL
    SELECT 'contrato_social', NULL, NULL
      FROM subscribers s WHERE s.id = p_subscriber AND length(s.cpf_cnpj) = 14
       AND NOT EXISTS (SELECT 1 FROM subscriber_documents d WHERE d.subscriber_id = p_subscriber AND d.tipo = 'contrato_social')
    UNION ALL
    SELECT 'conta_energia', cu.id, cu.numero_uc
      FROM consumer_units cu WHERE cu.subscriber_id = p_subscriber
       AND NOT EXISTS (SELECT 1 FROM subscriber_documents d WHERE d.consumer_unit_id = cu.id AND d.tipo = 'conta_energia')
  ) f;
$$;

CREATE OR REPLACE FUNCTION public.fn_onboarding_estado(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub uuid := public.fn_onboarding_assinante_por_token(p_token); s record; v_falt jsonb; v_etapa text;
BEGIN
  IF v_sub IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM subscribers WHERE id = v_sub;
  v_falt := public.fn_onboarding_documentos_faltantes(v_sub);
  v_etapa := CASE
    WHEN s.status <> 'ativacao' THEN 'assinado'
    WHEN jsonb_array_length(v_falt) > 0 THEN 'documentos'
    WHEN EXISTS (SELECT 1 FROM signatures g WHERE g.signer_id = v_sub AND g.signer_type = 'subscriber' AND g.status = 'pending') THEN 'enviado'
    ELSE 'contrato' END;
  RETURN jsonb_build_object('etapa', v_etapa,
    'subscriber', jsonb_build_object('id', s.id, 'name', s.name, 'cpf_cnpj', s.cpf_cnpj, 'email', s.email, 'phone', s.phone,
      'cep', s.cep, 'rua', s.rua, 'numero', s.numero, 'complemento', s.complemento, 'bairro', s.bairro, 'cidade', s.cidade, 'uf', s.uf,
      'representante_nome', s.representante_nome, 'representante_cpf', s.representante_cpf),
    'ucs', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero_uc', numero_uc, 'titular_conta', titular_conta,
      'concessionaria', concessionaria, 'franquia', franquia, 'desconto_assinante', desconto_assinante, 'dia_vencimento', dia_vencimento)
      ORDER BY created_at), '[]'::jsonb) FROM consumer_units WHERE subscriber_id = v_sub),
    'faltantes', v_falt,
    'signature_link', s.signature_link);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_onboarding_assinante_por_token(uuid), public.fn_onboarding_documentos_faltantes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_assinante_por_token(uuid), public.fn_onboarding_documentos_faltantes(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_onboarding_estado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_estado(uuid) TO anon, authenticated;
```

Antes de aplicar: confirmar com `select pg_get_functiondef('public.check_user_is_admin'::regproc)` que a função existe sem argumentos e verifica o usuário atual; se a assinatura for diferente, usar a existente e ajustar as duas políticas.

- [ ] **Step 4:** aplicar (`20260921c_onboarding_documentos`), rodar o teste → `SANDBOX_OK`.
- [ ] **Step 5:** commit `feat(adesao): documentos do assinante, bucket privado e estado da retomada`.

---

### Task 3: Papel do embaixador e colunas do anon

**Files:**
- Create: `supabase/migrations/20260921d_originador_perfil.sql`
- Test: `supabase/tests/originador_perfil.test.sql`
- Modify: `src/components/OriginatorSignupForm.jsx:560` (login → `https://crm.b2wenergia.com.br/login`)

**Interfaces:** Produces gatilho `trg_originador_confirma_perfil` em `originators_v2`.

- [ ] **Step 1: teste:**

```sql
DO $$
DECLARE v_id uuid := gen_random_uuid(); v_role text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
  VALUES (v_id, 'emb.teste@teste.invalid', '{"name":"Emb Teste"}', 'authenticated', 'authenticated');
  SELECT role INTO v_role FROM public.profiles WHERE id = v_id;
  IF v_role <> 'lead' THEN RAISE EXCEPTION 'FIXTURE: handle_new_user deu %', v_role; END IF;

  INSERT INTO public.originators_v2 (id, name, email, phone, cpf_cnpj)
  VALUES (v_id, 'Emb Teste', 'emb.teste@teste.invalid', '84999990000', '52998224725');
  SELECT role INTO v_role FROM public.profiles WHERE id = v_id;
  IF v_role <> 'originator' THEN RAISE EXCEPTION 'FALHOU: papel ficou %', v_role; END IF;

  IF has_column_privilege('anon', 'public.originators_v2', 'split_commission', 'INSERT') THEN
    RAISE EXCEPTION 'FALHOU: anon ainda grava split_commission';
  END IF;
  IF NOT has_column_privilege('anon', 'public.originators_v2', 'pix_key', 'INSERT') THEN
    RAISE EXCEPTION 'FALHOU: anon perdeu pix_key';
  END IF;
  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
```

(Se `originators_v2` tiver outras colunas NOT NULL sem default, incluí-las no INSERT do teste. Se a coluna de comissão tiver outro nome, conferir em `information_schema.columns` e usar o nome real.)

- [ ] **Step 2:** rodar → FAIL `papel ficou lead`.
- [ ] **Step 3:** migração:

```sql
CREATE OR REPLACE FUNCTION public.fn_originador_confirmar_perfil()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- O signUp roda antes deste INSERT, entao handle_new_user nao achou o
  -- e-mail em originators_v2 e gravou 'lead'. Corrige so quem e lead.
  UPDATE public.profiles SET role = 'originator'
   WHERE id = NEW.id AND role = 'lead' AND lower(email) = lower(NEW.email);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_originador_confirmar_perfil() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_originador_confirma_perfil ON public.originators_v2;
CREATE TRIGGER trg_originador_confirma_perfil AFTER INSERT ON public.originators_v2
  FOR EACH ROW EXECUTE FUNCTION public.fn_originador_confirmar_perfil();

-- Perfis que ja nasceram errados.
UPDATE public.profiles p SET role = 'originator'
  FROM public.originators_v2 o
 WHERE o.id = p.id AND p.role = 'lead' AND lower(o.email) = lower(p.email);

-- Anon so grava as colunas do formulario publico.
REVOKE INSERT, UPDATE ON public.originators_v2 FROM anon;
GRANT INSERT (id, name, email, phone, cpf_cnpj, pix_key, pix_key_type, profession, address) ON public.originators_v2 TO anon;
```

- [ ] **Step 4:** aplicar, rodar teste → `SANDBOX_OK`. Rodar `select id, role from profiles p join originators_v2 o using (id) where p.role <> 'originator'` e reportar o que sobrou.
- [ ] **Step 5:** editar `OriginatorSignupForm.jsx`: trocar `https://app.b2wenergia.com.br/login` por `https://crm.b2wenergia.com.br/login`. Commit `fix(embaixador): perfil originator no cadastro publico e login no CRM`.

---

### Task 4: Portão de envio + `send-email` com `text`

**Files:**
- Create: `supabase/functions/_shared/envio-portao.ts`, `tests/envio-portao.test.ts`, `supabase/migrations/20260921e_envio_interno.sql`
- Modify: `supabase/functions/send-email/index.ts`, `supabase/functions/send-whatsapp/index.ts`, `supabase/config.toml` (ambas `verify_jwt = true`)

**Interfaces:**
- Produces: `decidirPortao(e: {bearerRole: string|null, userRole: string|null, segredoOk: boolean}) → {ok: boolean, motivo: string}`; RPC `fn_segredo_interno_confere(p_valor text) returns boolean` (só `service_role`); `send-email` aceita `{to, subject, html?, text?, variables?, attachments?}`.
- Papéis internos aceitos: `super_admin, admin, manager, coordinator, originator` (originador manda mensagem ao próprio lead no `LeadModal`). Recusados: `lead, subscriber, supplier, gerador`, anon.

- [ ] **Step 1: teste** `tests/envio-portao.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { decidirPortao, papelDoBearer, textoParaHtml } from '../supabase/functions/_shared/envio-portao';

const jwt = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`;

describe('portão de envio', () => {
  test('service_role passa', () => expect(decidirPortao({ bearerRole: 'service_role', userRole: null, segredoOk: false }).ok).toBe(true));
  test('segredo interno passa', () => expect(decidirPortao({ bearerRole: 'anon', userRole: null, segredoOk: true }).ok).toBe(true));
  test('anon sem segredo barra', () => expect(decidirPortao({ bearerRole: 'anon', userRole: null, segredoOk: false }).ok).toBe(false));
  test('admin passa', () => expect(decidirPortao({ bearerRole: 'authenticated', userRole: 'admin', segredoOk: false }).ok).toBe(true));
  test('originador passa', () => expect(decidirPortao({ bearerRole: 'authenticated', userRole: 'originator', segredoOk: false }).ok).toBe(true));
  test('assinante barra', () => expect(decidirPortao({ bearerRole: 'authenticated', userRole: 'subscriber', segredoOk: false }).ok).toBe(false));
  test('lê role do JWT', () => expect(papelDoBearer(`Bearer ${jwt({ role: 'service_role' })}`)).toBe('service_role'));
  test('bearer lixo vira null', () => expect(papelDoBearer('Bearer abc')).toBeNull());
  test('texto vira html escapado com quebras', () =>
    expect(textoParaHtml('Olá <b>\nlink')).toBe('<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">Olá &lt;b&gt;<br>link</p>'));
});
```

- [ ] **Step 2:** `npx vitest run tests/envio-portao.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3:** `supabase/functions/_shared/envio-portao.ts`:

```ts
/**
 * Regra do portão de send-whatsapp / send-email. Sem imports Deno para
 * poder ser testada pelo Vitest. `papelDoBearer` só decodifica: a
 * assinatura já foi conferida pelo gateway (verify_jwt = true).
 */
export const PAPEIS_INTERNOS = ['super_admin', 'admin', 'manager', 'coordinator', 'originator'];

export function papelDoBearer(authorization: string | null): string | null {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof json.role === 'string' ? json.role : null;
  } catch { return null; }
}

export function decidirPortao(e: { bearerRole: string | null; userRole: string | null; segredoOk: boolean }) {
  if (e.bearerRole === 'service_role') return { ok: true, motivo: 'service_role' };
  if (e.segredoOk) return { ok: true, motivo: 'segredo_interno' };
  if (e.userRole && PAPEIS_INTERNOS.includes(e.userRole)) return { ok: true, motivo: `usuario:${e.userRole}` };
  return { ok: false, motivo: 'sem_permissao' };
}

export function textoParaHtml(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${esc.replace(/\n/g, '<br>')}</p>`;
}
```

- [ ] **Step 4:** teste → PASS.
- [ ] **Step 5:** migração `20260921e_envio_interno.sql`:

```sql
-- Segredo interno para chamadas servidor→servidor (pg_net) às funções de envio.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'b2w:internal_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'b2w:internal_secret', 'Header x-b2w-internal de send-whatsapp/send-email');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_segredo_interno_confere(p_valor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT coalesce(p_valor, '') <> '' AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'b2w:internal_secret' AND decrypted_secret = p_valor);
$$;
REVOKE EXECUTE ON FUNCTION public.fn_segredo_interno_confere(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_segredo_interno_confere(text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_dispatch_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_project_url text := 'https://abbysvxnnhwvvzhftoms.supabase.co';
  v_segredo text; v_anon text; v_headers jsonb;
BEGIN
  IF NEW.status <> 'pending' OR NEW.channel NOT IN ('whatsapp', 'email') THEN RETURN NEW; END IF;
  SELECT decrypted_secret INTO v_segredo FROM vault.decrypted_secrets WHERE name = 'b2w:internal_secret';
  SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'cron:anon_key';
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-b2w-internal', v_segredo,
                                  'Authorization', 'Bearer ' || v_anon, 'apikey', v_anon);
  IF NEW.channel = 'whatsapp' THEN
    PERFORM net.http_post(url := v_project_url || '/functions/v1/send-whatsapp',
      body := jsonb_build_object('phone', NEW.recipient, 'text', NEW.body), headers := v_headers);
  ELSE
    PERFORM net.http_post(url := v_project_url || '/functions/v1/send-email',
      body := jsonb_build_object('to', NEW.recipient, 'subject', NEW.subject, 'text', NEW.body), headers := v_headers);
  END IF;
  UPDATE public.notification_logs SET status = 'sent', updated_at = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;
```

- [ ] **Step 6:** nas duas funções, logo após o `OPTIONS`, inserir o portão (mesmo bloco nas duas; `corsHeaders` ganha `x-b2w-internal` em `Access-Control-Allow-Headers`):

```ts
import { decidirPortao, papelDoBearer, textoParaHtml } from '../_shared/envio-portao.ts'
// ...
const authorization = req.headers.get('Authorization')
const bearerRole = papelDoBearer(authorization)
let userRole: string | null = null
if (bearerRole === 'authenticated') {
    const { data: { user } } = await supabaseAdmin.auth.getUser((authorization || '').replace(/^Bearer\s+/i, ''))
    if (user) {
        const { data: p } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
        userRole = p?.role ?? null
    }
}
const segredo = req.headers.get('x-b2w-internal')
const { data: segredoOk } = segredo
    ? await supabaseAdmin.rpc('fn_segredo_interno_confere', { p_valor: segredo })
    : { data: false }
const portao = decidirPortao({ bearerRole, userRole, segredoOk: !!segredoOk })
if (!portao.ok) {
    return new Response(JSON.stringify({ error: 'Sem permissão para enviar mensagens.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 })
}
```

(Em `send-whatsapp` criar `supabaseAdmin` antes do portão.) Em `send-email`: ler `text` do corpo e, se `html` e `variables` vierem vazios mas `text` vier, `finalHtml = textoParaHtml(text)`; também passar `text` ao Resend. Trocar `status: 200` do `catch` por `status: 500` apenas em `send-email` **não** — manter 200 (clientes existentes leem `error` do corpo).

- [ ] **Step 7:** `supabase/config.toml`: `send-email` e `send-whatsapp` → `verify_jwt = true`, com comentário apontando o portão. Aplicar migração; deploy das duas pelo MCP `deploy_edge_function` com `verify_jwt: true`, enviando `index.ts` e `../_shared/envio-portao.ts` (nome do arquivo `_shared/envio-portao.ts`, import `../_shared/envio-portao.ts`).
- [ ] **Step 8: verificação real:**
  - `curl -s -X POST <url>/functions/v1/send-whatsapp -H "apikey: <anon>" -H "Authorization: Bearer <anon>" -d '{"phone":"5533999991234","text":"x"}'` → 403.
  - Inserir em `notification_logs` uma linha `pending` whatsapp para `5533999991234` com texto `Teste do portão interno B2W` → mensagem chega (confirmar com o dono) e `net._http_response` mostra 200.
  - Robô enviador: conferir no próximo run de `enviador.yml` (ou `workflow_dispatch` se o dono autorizar) que `send-whatsapp` não voltou 403. Se voltar, o secret `SUPABASE_KEY` é anon: reportar e parar (não trocar secrets sem o dono).
- [ ] **Step 9:** commit `fix(seguranca): send-whatsapp e send-email exigem usuario interno, service_role ou segredo; send-email aceita text`.

---

### Task 5: Regras puras do onboarding

**Files:**
- Create: `supabase/functions/_shared/onboarding-regras.ts`, `supabase/functions/_shared/email-contrato.ts`, `tests/onboarding-regras.test.ts`

**Interfaces:** Produces:
- `TIPOS_DOCUMENTO = ['identidade','conta_energia','contrato_social']`
- `validarArquivo({mime, tamanho}) → string|null` (mensagem de erro ou null)
- `extensaoDoMime(mime) → 'pdf'|'jpg'|'png'`
- `caminhoDocumento(subscriberId, tipo, id, mime) → string` (`<sub>/<tipo>/<id>.<ext>`)
- `descreverFaltantes(faltantes: {tipo, numero_uc}[]) → string` (ex.: `"documento de identidade, conta de energia da UC 123"`)
- `escolherLink(r: {signingLinkFound?: boolean, url?: string}) → {ok: true, url} | {ok: false, motivo}`
- `keywordAdesao(subscriberId, agora: Date) → string` (`adesao-<8>-<base36 4>`)
- `urlTermos(base, {link, nome, concessionaria, desconto}) → string` (sem cpf/endereço)
- `textoWhatsappContrato(nome, url)`, `textoOriginador(nomeCliente)`
- `htmlEmailContrato({nome, link, desconto, concessionaria}) → string` (em `email-contrato.ts`)

- [ ] **Step 1: teste:**

```ts
import { describe, test, expect } from 'vitest';
import * as R from '../supabase/functions/_shared/onboarding-regras';
import { htmlEmailContrato } from '../supabase/functions/_shared/email-contrato';

describe('regras do onboarding', () => {
  test('aceita pdf de 1 MB', () => expect(R.validarArquivo({ mime: 'application/pdf', tamanho: 1_000_000 })).toBeNull());
  test('recusa doc', () => expect(R.validarArquivo({ mime: 'application/msword', tamanho: 10 })).toMatch(/PDF, JPG ou PNG/));
  test('recusa > 10 MB', () => expect(R.validarArquivo({ mime: 'image/png', tamanho: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/));
  test('caminho', () => expect(R.caminhoDocumento('s1', 'identidade', 'd1', 'image/jpeg')).toBe('s1/identidade/d1.jpg'));
  test('faltantes legíveis', () => expect(R.descreverFaltantes([{ tipo: 'identidade', numero_uc: null }, { tipo: 'conta_energia', numero_uc: '123' }]))
    .toBe('documento de identidade (CNH ou RG), conta de energia da UC 123'));
  test('link sem assinatura é recusado', () => expect(R.escolherLink({ signingLinkFound: false, url: 'https://autentique.com.br/v2/documentos/x' }).ok).toBe(false));
  test('link bom passa', () => expect(R.escolherLink({ signingLinkFound: true, url: 'https://assina.ae/abc' })).toEqual({ ok: true, url: 'https://assina.ae/abc' }));
  test('keyword única por instante', () => {
    const a = R.keywordAdesao('12345678-aaaa', new Date(1_000_000)); const b = R.keywordAdesao('12345678-aaaa', new Date(2_000_000));
    expect(a).toMatch(/^adesao-12345678-[0-9a-z]{4}$/); expect(a).not.toBe(b);
  });
  test('termos sem cpf', () => {
    const u = R.urlTermos('https://www.b2wenergia.com.br/contrato/', { link: 'https://l/x', nome: 'Ana', concessionaria: 'COSERN', desconto: 15 });
    expect(u).toContain('Linkdocontrato=https%3A%2F%2Fl%2Fx'); expect(u).toContain('desconto=15'); expect(u).not.toMatch(/cpf|endereco/);
  });
  test('whatsapp com acento e link', () => expect(R.textoWhatsappContrato('Ana', 'https://l/x')).toContain('Olá, Ana!'));
  test('email tem botão com link', () => {
    const h = htmlEmailContrato({ nome: 'Ana <x>', link: 'https://l/x', desconto: 15, concessionaria: 'COSERN' });
    expect(h).toContain('href="https://l/x"'); expect(h).toContain('Ana &lt;x&gt;'); expect(h).toContain('15%');
  });
});
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** `onboarding-regras.ts`:

```ts
// Regras puras do onboarding público. Sem imports Deno: testadas pelo Vitest.
export const TIPOS_DOCUMENTO = ['identidade', 'conta_energia', 'contrato_social'] as const;
const MIMES: Record<string, 'pdf' | 'jpg' | 'png'> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const LIMITE_BYTES = 10 * 1024 * 1024;

export function validarArquivo(a: { mime: string; tamanho: number }): string | null {
  if (!MIMES[a.mime]) return 'Envie o arquivo em PDF, JPG ou PNG.';
  if (!(a.tamanho > 0) || a.tamanho > LIMITE_BYTES) return 'O arquivo deve ter até 10 MB.';
  return null;
}
export const extensaoDoMime = (mime: string) => MIMES[mime];
export const caminhoDocumento = (sub: string, tipo: string, id: string, mime: string) => `${sub}/${tipo}/${id}.${extensaoDoMime(mime)}`;

const ROTULO: Record<string, string> = {
  identidade: 'documento de identidade (CNH ou RG)',
  contrato_social: 'contrato social da empresa',
  conta_energia: 'conta de energia',
};
export function descreverFaltantes(f: { tipo: string; numero_uc: string | null }[]): string {
  return f.map(x => x.tipo === 'conta_energia' ? `${ROTULO.conta_energia} da UC ${x.numero_uc}` : ROTULO[x.tipo]).join(', ');
}

export function escolherLink(r: { signingLinkFound?: boolean; url?: string }) {
  if (!r?.signingLinkFound || !r.url) return { ok: false as const, motivo: 'A Autentique não devolveu o link de assinatura do signatário.' };
  return { ok: true as const, url: r.url };
}

export const keywordAdesao = (sub: string, agora: Date) =>
  `adesao-${sub.replace(/-/g, '').slice(0, 8)}-${Math.floor(agora.getTime() / 1000).toString(36).slice(-4)}`;

export function urlTermos(base: string, p: { link: string; nome: string; concessionaria: string; desconto: number | null }) {
  const q = new URLSearchParams({ Linkdocontrato: p.link, nome: p.nome || '', concessionaria: p.concessionaria || '' });
  if (p.desconto) q.set('desconto', String(p.desconto));
  return `${base}?${q.toString()}`;
}

export const textoWhatsappContrato = (nome: string, url: string) =>
  `Ol\u00e1, ${nome}! \u26a1\n\nSua ades\u00e3o \u00e0 B2W Energia foi registrada. Falta s\u00f3 assinar o contrato \u2014 ` +
  `leva menos de 2 minutos e \u00e9 100% digital. \u270d\ufe0f\n\nEntenda os termos e assine aqui:\n${url}\n\n` +
  `Enviamos o mesmo link para o seu e-mail. Qualquer d\u00favida, \u00e9 s\u00f3 responder esta mensagem.`;

export const textoOriginador = (cliente: string) =>
  `\ud83d\ude80 Novo cliente pelo seu link!\n\n${cliente} concluiu a ades\u00e3o e recebeu o contrato para assinar.\nAcompanhe pelo CRM.`;
```

Ajustar o teste do WhatsApp se necessário: `'Olá, Ana!'` deve casar com a string com `\u00e1` (é o mesmo caractere).

`email-contrato.ts`:

```ts
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function htmlEmailContrato(p: { nome: string; link: string; desconto: number | null; concessionaria: string }) {
  const desconto = p.desconto ? `<p style="margin:0 0 16px">Seu desconto: <strong>${esc(String(p.desconto))}%</strong> na energia compensada${p.concessionaria ? ` (${esc(p.concessionaria)})` : ''}.</p>` : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#1e293b">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;padding:32px">
<tr><td>
<h1 style="margin:0 0 16px;color:#003366;font-size:22px">Falta só assinar, ${esc(p.nome)}</h1>
<p style="margin:0 0 16px">Sua adesão à B2W Energia foi registrada. O contrato é 100% digital e leva menos de 2 minutos.</p>
${desconto}
<p style="margin:24px 0;text-align:center"><a href="${esc(p.link)}" style="background:#FF6600;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;display:inline-block">Assinar contrato</a></p>
<p style="margin:0;font-size:13px;color:#64748b">Se o botão não abrir, copie: ${esc(p.link)}</p>
</td></tr></table>
<p style="font-size:11px;color:#94a3b8">B2W Energia · atendimento@b2wenergia.com.br</p>
</td></tr></table></body></html>`;
}
```

- [ ] **Step 4:** rodar → PASS. **Step 5:** commit `feat(adesao): regras puras do onboarding e e-mail do contrato`.

---

### Task 6: Edge Function `onboarding-documentos`

**Files:**
- Create: `supabase/functions/onboarding-documentos/index.ts`
- Modify: `supabase/config.toml` (`[functions.onboarding-documentos] verify_jwt = false` com comentário "portão = onboarding_token")

**Interfaces:**
- Consumes: `fn_onboarding_assinante_por_token`, `onboarding-regras.ts`.
- Produces: `POST {acao:'url', token, tipo, consumer_unit_id?, mime, tamanho}` → `{path, token_upload}`; `POST {acao:'registrar', token, tipo, consumer_unit_id?, path, mime, tamanho}` → `{ok:true, faltantes:[…]}`. Erros: 401 token inválido, 400 validação, 404 objeto ausente.

- [ ] **Step 1:** escrever a função:

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { TIPOS_DOCUMENTO, caminhoDocumento, validarArquivo } from '../_shared/onboarding-regras.ts'

// Upload de documentos da adesão pública. Anônima: o portão é o
// onboarding_token, que só o dono do link tem. O navegador nunca escreve
// no bucket por conta própria — recebe uma URL de upload assinada.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const BUCKET = 'documentos-assinante'
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  try {
    const b = await req.json().catch(() => ({}))
    const { data: sub } = await db.rpc('fn_onboarding_assinante_por_token', { p_token: b.token })
    if (!sub) return json({ error: 'Link de adesão inválido ou expirado.' }, 401)
    if (!TIPOS_DOCUMENTO.includes(b.tipo)) return json({ error: 'Tipo de documento inválido.' }, 400)
    const erro = validarArquivo({ mime: b.mime, tamanho: Number(b.tamanho) })
    if (erro) return json({ error: erro }, 400)
    if (b.tipo === 'conta_energia') {
      const { data: uc } = await db.from('consumer_units').select('id').eq('id', b.consumer_unit_id).eq('subscriber_id', sub).maybeSingle()
      if (!uc) return json({ error: 'UC não pertence a esta adesão.' }, 400)
    }

    if (b.acao === 'url') {
      const path = caminhoDocumento(sub as string, b.tipo, crypto.randomUUID(), b.mime)
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error) throw error
      return json({ path, token_upload: data.token })
    }

    if (b.acao === 'registrar') {
      if (typeof b.path !== 'string' || !b.path.startsWith(`${sub}/${b.tipo}/`)) return json({ error: 'Caminho inválido.' }, 400)
      const pasta = b.path.slice(0, b.path.lastIndexOf('/'))
      const nome = b.path.slice(b.path.lastIndexOf('/') + 1)
      const { data: lista } = await db.storage.from(BUCKET).list(pasta, { search: nome })
      if (!lista?.some(o => o.name === nome)) return json({ error: 'Arquivo não encontrado. Envie de novo.' }, 404)
      const { error } = await db.from('subscriber_documents').upsert({
        subscriber_id: sub, consumer_unit_id: b.tipo === 'conta_energia' ? b.consumer_unit_id : null,
        tipo: b.tipo, storage_path: b.path, mime: b.mime, tamanho: Number(b.tamanho) }, { onConflict: 'storage_path' })
      if (error) throw error
      const { data: faltantes } = await db.rpc('fn_onboarding_documentos_faltantes', { p_subscriber: sub })
      return json({ ok: true, faltantes })
    }
    return json({ error: 'Ação inválida.' }, 400)
  } catch (e) {
    console.error('onboarding-documentos:', e)
    return json({ error: (e as Error).message }, 500)
  }
})
```

- [ ] **Step 2:** deploy (`verify_jwt: false`, arquivos `index.ts` + `_shared/onboarding-regras.ts`).
- [ ] **Step 3: teste real** (sem cliente): criar assinante de teste pela RPC via `execute_sql` (guardar o token), depois:
  - `curl` `acao:url` com token falso → 401.
  - `acao:url` com `mime: application/msword` → 400.
  - `acao:url` válido → recebe `path` e `token_upload`; subir um PDF pequeno com `curl -X PUT "<url>/storage/v1/object/upload/sign/documentos-assinante/<path>?token=<token_upload>" -H "Content-Type: application/pdf" --data-binary @arquivo.pdf` → 200.
  - `acao:registrar` → `ok:true` e `faltantes` sem `identidade`.
  - Apagar o assinante de teste e o objeto do bucket.
- [ ] **Step 4:** commit `feat(adesao): upload de documentos por URL assinada com portao de token`.

---

### Task 7: `onboarding-finalizar` v4 + webhook anula o token

**Files:**
- Modify: `supabase/functions/onboarding-finalizar/index.ts` (partir da versão publicada v21, já com `\u` escapes)
- Modify: `supabase/functions/autentique-webhook/index.ts` (no bloco `signed` que faz `status='contrato_assinado'`)

**Interfaces:**
- Consumes: Task 2 RPCs, Task 4 `send-email` com `html`, Task 5 regras.
- Produces: `POST {token, pdf_base64, paginas_termo: number}` → 200 `{success, signature_link, contrato_url, reenviado: boolean, avisos}`; 401 token; 409 `{error, faltantes}`; 502 link ausente.

- [ ] **Step 1:** reescrever a função:
  1. `token` → `fn_onboarding_assinante_por_token`; nulo → 401.
  2. `fn_onboarding_documentos_faltantes` não vazio → 409 com `descreverFaltantes`.
  3. **Idempotência:** `signatures` com `signer_id = sub, signer_type = 'subscriber', status = 'pending'` mais recente e `short_url` preenchida → não cria documento; reenvia WhatsApp + e-mail com esse link; responde `reenviado: true`.
  4. Conta de acesso + profile (bloco atual, sem mudança).
  5. `create-autentique-document` com signatário **sem `email`**, `positions: [{x:50,y:82,z:paginas_termo},{x:50,y:82,z:paginas_termo+1}]` (mesma regra do `SubscriberModal.handleSendContract`). `paginas_termo` vem do corpo; se não for inteiro ≥ 1, 400.
  6. `escolherLink(autentique)`; `!ok` → `crm_history` com `content: 'Adesão pública: Autentique sem link de assinatura; contrato NÃO enviado.'`, responde 502 `{error: 'contrato_indisponivel'}`.
  7. YOURLS com `keywordAdesao(sub, new Date())`; sem encurtar → aviso, segue com o link da Autentique (é o link de assinatura, não a página de termos).
  8. `urlTermos(PAGINA_TERMOS, {link, nome, concessionaria: ucs[0].concessionaria, desconto: ucs[0].desconto_assinante})`; encurtar com keyword `contrato-<8>-<4>`.
  9. WhatsApp (`textoWhatsappContrato(nome, termosCurta)`) e e-mail (`send-email` com `{to: sub.email, subject: 'Seu contrato B2W Energia está pronto para assinar', html: htmlEmailContrato({nome, link: termosCurta, desconto, concessionaria})}`) — os dois com o **mesmo** link curto da página de termos.
  10. Originador: se `sub.originator_id`, ler `originators_v2.phone` e mandar `textoOriginador(sub.name)`.
  11. `crm_history` de sucesso como hoje, com `contrato_url_curta`.
- [ ] **Step 2:** no `autentique-webhook`, no mesmo `update` que promove para `contrato_assinado`, incluir `onboarding_token: null, onboarding_token_expira_em: null`.
- [ ] **Step 3:** deploy `onboarding-finalizar` (`verify_jwt:false`, `index.ts` + `_shared/onboarding-regras.ts` + `_shared/email-contrato.ts`) e `autentique-webhook` (`verify_jwt:false`). Conferir por `get_edge_function` que os acentos chegaram intactos.
- [ ] **Step 4: testes reais sem Autentique:** com assinante de teste criado pela RPC e sem documentos → `curl` com token → 409 citando identidade e conta de energia; token falso → 401. Apagar dados de teste.
- [ ] **Step 5:** commit `feat(adesao): onboarding-finalizar v4 com token, documentos obrigatorios, idempotencia e link por WhatsApp e e-mail`.

---

### Task 8: `contrato.js` com representante legal

**Files:** Modify `src/lib/contrato.js`; Test `tests/contrato.test.js`

**Interfaces:** `montarTextoContrato(subscriber, distribuidora, opts)` — quando `subscriber.cpf_cnpj` tem 14 dígitos e `subscriber.representante_nome`, a parte (II) vira: `"<RAZÃO>, inscrita no CNPJ <cnpj>, com sede à <endereço>, neste ato representada por <REP>, CPF <cpf>"`; sem CNPJ, o texto atual.

- [ ] **Step 1: teste:**

```js
import { test, expect } from 'vitest';
import { montarTextoContrato } from '../src/lib/contrato';

const base = { name: 'ACME LTDA', cpf_cnpj: '11222333000181', rua: 'Rua A', numero: '1', bairro: 'B', cidade: 'Natal', uf: 'RN' };
test('CNPJ qualifica o representante', () => {
  const t = montarTextoContrato({ ...base, representante_nome: 'Ana Souza', representante_cpf: '52998224725' }, 'COSERN', { desconto: 15, diaVencimento: 20 });
  expect(t).toContain('inscrita no CNPJ 11222333000181');
  expect(t).toContain('neste ato representada por Ana Souza, CPF 52998224725');
  expect(t).not.toContain('residente e domiciliado');
});
test('CPF mantém a qualificação de pessoa física', () => {
  const t = montarTextoContrato({ ...base, name: 'Ana', cpf_cnpj: '52998224725' }, 'COSERN', { desconto: 15, diaVencimento: 20 });
  expect(t).toContain('residente e domiciliado');
});
test('desconto e vencimento reais aparecem', () => {
  const t = montarTextoContrato({ ...base, name: 'Ana', cpf_cnpj: '52998224725' }, 'COSERN', { desconto: 17.5, diaVencimento: 5 });
  expect(t).toMatch(/17,5/); expect(t).toMatch(/dia 5\b/);
});
```

(Se o texto atual escreve o vencimento com outra forma que "dia 5", ler a cláusula 7.2 e ajustar o regex à forma existente — não mudar a cláusula.)

- [ ] **Step 2:** rodar → FAIL no primeiro teste.
- [ ] **Step 3:** em `montarTextoContrato`, substituir a linha `(II). ASSOCIADO:` por:

```js
    const doc = (subscriber?.cpf_cnpj || '').replace(/\D/g, '');
    const qualificacao = doc.length === 14 && subscriber?.representante_nome
        ? `${subscriber?.name || ''}, pessoa jurídica inscrita no CNPJ ${subscriber?.cpf_cnpj || ''}, com sede à ${fullAddress}, neste ato representada por ${subscriber.representante_nome}, CPF ${subscriber?.representante_cpf || ''}`
        : `${subscriber?.name || ''}, CPF/CNPJ ${subscriber?.cpf_cnpj || ''}, residente e domiciliado à ${fullAddress}`;
```

e no template: `(II). ASSOCIADO: ${qualificacao} ("ASSOCIADO").`
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(contrato): qualificacao do representante legal para CNPJ`.

---

### Task 9: Front — assistente de 3 passos em `/contrato`

**Files:**
- Create: `src/lib/onboarding.js`, `tests/onboarding-front.test.js`, `src/pages/public/onboarding/PassoDocumentos.jsx`
- Modify: `src/pages/public/SubscriberSignup.jsx`, `src/components/PublicConsumerUnitForm.jsx`

**Interfaces:**
- `src/lib/onboarding.js`: `uuidOuNulo(v) → string|null`; `VERSAO_TERMOS = '3.0'`; `DIAS_VENCIMENTO = [5,10,15,20]`; `documentosObrigatorios({cpf_cnpj, ucs:[{id,numero_uc}]}) → [{tipo, consumer_unit_id, rotulo}]`.
- RPC v2 (Task 1), `fn_onboarding_estado` (Task 2), `onboarding-documentos` (Task 6), `onboarding-finalizar` v4 (Task 7).

- [ ] **Step 1: teste:**

```js
import { test, expect } from 'vitest';
import { uuidOuNulo, documentosObrigatorios } from '../src/lib/onboarding';
test('uuid inválido vira null', () => { expect(uuidOuNulo('abc')).toBeNull(); expect(uuidOuNulo('')).toBeNull(); });
test('uuid válido passa', () => expect(uuidOuNulo('f86a003d-1b2c-4d5e-8f90-123456789abc')).toBe('f86a003d-1b2c-4d5e-8f90-123456789abc'));
test('CPF: identidade + conta por UC', () => {
  const d = documentosObrigatorios({ cpf_cnpj: '52998224725', ucs: [{ id: 'u1', numero_uc: '1' }, { id: 'u2', numero_uc: '2' }] });
  expect(d.map(x => x.tipo)).toEqual(['identidade', 'conta_energia', 'conta_energia']);
});
test('CNPJ: + contrato social', () => {
  const d = documentosObrigatorios({ cpf_cnpj: '11.222.333/0001-81', ucs: [{ id: 'u1', numero_uc: '1' }] });
  expect(d.map(x => x.tipo)).toEqual(['identidade', 'contrato_social', 'conta_energia']);
});
```

- [ ] **Step 2:** FAIL. **Step 3:** `src/lib/onboarding.js`:

```js
export const VERSAO_TERMOS = '3.0';
export const DIAS_VENCIMENTO = [5, 10, 15, 20];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOuNulo = (v) => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null);

export function documentosObrigatorios({ cpf_cnpj, ucs }) {
    const pj = (cpf_cnpj || '').replace(/\D/g, '').length === 14;
    return [
        { tipo: 'identidade', consumer_unit_id: null, rotulo: pj ? 'CNH ou RG do representante legal' : 'CNH ou RG do titular' },
        ...(pj ? [{ tipo: 'contrato_social', consumer_unit_id: null, rotulo: 'Contrato social' }] : []),
        ...ucs.map(uc => ({ tipo: 'conta_energia', consumer_unit_id: uc.id, rotulo: `Conta de energia da UC ${uc.numero_uc}` })),
    ];
}
```

PASS.

- [ ] **Step 4: `PublicConsumerUnitForm.jsx`** — acrescentar campos obrigatórios `cpf_cnpj_fatura` (máscara `maskCpfCnpj`, validação `validateDocument`, pré-preenchido com o CPF/CNPJ do assinante recebido por prop `docAssinante`) e `tipo_ligacao` (select `monofasico|bifasico|trifasico`), e guardar `ibge` vindo de `fetchAddressByCep` no objeto devolvido por `onSave`.
- [ ] **Step 5: `SubscriberSignup.jsx`** — estado `passo ∈ 'dados'|'documentos'|'contrato'|'enviado'` e `onboardingToken`:
  - Ao montar: se `searchParams.get('retomar')`, chamar `supabase.rpc('fn_onboarding_estado', {p_token})`; `null` → alerta "Link expirado, refaça a simulação"; senão hidratar `formData`/`consumerUnits` a partir de `estado.subscriber`/`estado.ucs` e ir para `estado.etapa` (`assinado` → tela de concluído).
  - Passo Dados: campos novos — dia de vencimento (botões 5/10/15/20), bloco "Representante legal" (nome + CPF) quando o documento tem 14 dígitos, checkbox de aceite com links `https://b2wenergia.com.br/termos-de-uso/` e `https://b2wenergia.com.br/politica-de-privacidade/`. `formData.ibge` vem de `handleCepBlur` (`addr.ibge`). Chamar a RPC v2 com todos os parâmetros da Task 1 (`p_originator_id: uuidOuNulo(paramOriginatorId)`, `p_aceite_versao: VERSAO_TERMOS`, `p_ucs` com `cpf_cnpj_fatura`, `tipo_ligacao`, `ibge`). No sucesso: guardar token, `window.history.replaceState(null, '', '/contrato?retomar=' + token)`, recarregar o estado pela `fn_onboarding_estado` (UCs agora com `id`, desconto e vencimento reais) e ir para `documentos`.
  - Remover `notificarOriginador` e o import de `sendWhatsapp` (passa para o servidor).
  - Passo Documentos: `<PassoDocumentos token={…} estado={…} onCompleto={() => setPasso('contrato')} />`.
  - Passo Contrato: botão "Gerar e enviar meu contrato" → `setDadosContrato({subscriber: estado.subscriber, ucs: estado.ucs})`, espera 400 ms, `gerarPdfContratoBase64()`, `paginas_termo = dividirEmPaginas(montarTextoContrato(estado.subscriber, estado.ucs[0]?.concessionaria, {desconto: estado.ucs[0]?.desconto_assinante, diaVencimento: estado.ucs[0]?.dia_vencimento})).length`, invocar `onboarding-finalizar` com `{token, pdf_base64, paginas_termo}`. Sucesso → `window.location.href = fim.contrato_url`. 409 → mostrar faltantes e voltar a `documentos`. 502 → tela "Recebemos seus dados; nossa equipe vai enviar o contrato em até 1 dia útil."
  - `ContratoAdesao` deve receber `subscriber` com `representante_nome/representante_cpf` (vêm do estado).
- [ ] **Step 6: `PassoDocumentos.jsx`** — lista `documentosObrigatorios(...)` marcando como enviados os que não estão em `estado.faltantes`; para cada item um `<input type="file" accept="application/pdf,image/jpeg,image/png">`; ao escolher:

```js
const { data: u, error: e1 } = await supabase.functions.invoke('onboarding-documentos',
    { body: { acao: 'url', token, tipo: item.tipo, consumer_unit_id: item.consumer_unit_id, mime: file.type, tamanho: file.size } });
if (e1 || u?.error) throw new Error(u?.error || e1.message);
const { error: e2 } = await supabase.storage.from('documentos-assinante').uploadToSignedUrl(u.path, u.token_upload, file, { contentType: file.type });
if (e2) throw e2;
const { data: r } = await supabase.functions.invoke('onboarding-documentos',
    { body: { acao: 'registrar', token, tipo: item.tipo, consumer_unit_id: item.consumer_unit_id, path: u.path, mime: file.type, tamanho: file.size } });
if (r?.error) throw new Error(r.error);
setFaltantes(r.faltantes);
if (r.faltantes.length === 0) onCompleto();
```

Validar no navegador com as mesmas regras (tipo e 10 MB) antes de pedir a URL; mensagens em português; botão "Continuar" só habilitado sem faltantes.
- [ ] **Step 7:** `npm run build` sem erro; `npx vitest run` tudo PASS. Rodar o dev server (`npx vite --port 5190` em background) e abrir `/contrato?name=Teste&email=x@y.z&phone=84999990000&cep=59158155` no navegador interno: conferir que o passo Dados renderiza os campos novos e que o CNPJ mostra o bloco de representante. **Não** submeter (o envio real é na revisão, Task 13).
- [ ] **Step 8:** commit `feat(adesao): assistente Dados → Documentos → Contrato com retomada por token`.

---

### Task 10: CRM — aba Documentos e duplicidade única

**Files:**
- Create: `src/components/subscriber/DocumentosAssinante.jsx`
- Modify: `src/components/SubscriberModal.jsx` (aba nova + checagem de duplicidade em `handleSubmit`, ~linha 1807)

**Interfaces:** `<DocumentosAssinante subscriberId={id} />` lista `subscriber_documents` (tipo, UC, data, tamanho) e abre cada um com `supabase.storage.from('documentos-assinante').createSignedUrl(path, 300)` em nova aba.

- [ ] **Step 1:** componente:

```jsx
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const ROTULO = { identidade: 'Identidade (CNH/RG)', conta_energia: 'Conta de energia', contrato_social: 'Contrato social' };

export default function DocumentosAssinante({ subscriberId }) {
    const [docs, setDocs] = useState([]);
    const [erro, setErro] = useState('');
    useEffect(() => {
        if (!subscriberId) return;
        supabase.from('subscriber_documents')
            .select('id, tipo, storage_path, mime, tamanho, criado_em, consumer_units(numero_uc)')
            .eq('subscriber_id', subscriberId).order('criado_em')
            .then(({ data, error }) => error ? setErro(error.message) : setDocs(data || []));
    }, [subscriberId]);
    const abrir = async (path) => {
        const { data, error } = await supabase.storage.from('documentos-assinante').createSignedUrl(path, 300);
        if (error) return setErro(error.message);
        window.open(data.signedUrl, '_blank', 'noopener');
    };
    if (erro) return <p style={{ color: '#b91c1c' }}>{erro}</p>;
    if (!docs.length) return <p style={{ color: '#64748b' }}>Nenhum documento enviado.</p>;
    return (
        <table style={{ width: '100%', fontSize: '0.9rem' }}>
            <thead><tr><th align="left">Documento</th><th align="left">UC</th><th align="left">Enviado em</th><th /></tr></thead>
            <tbody>{docs.map(d => (
                <tr key={d.id}>
                    <td>{ROTULO[d.tipo] || d.tipo}</td>
                    <td>{d.consumer_units?.numero_uc || '—'}</td>
                    <td>{new Date(d.criado_em).toLocaleString('pt-BR')}</td>
                    <td><button type="button" className="btn btn-sm btn-outline-primary" onClick={() => abrir(d.storage_path)}>Abrir</button></td>
                </tr>))}
            </tbody>
        </table>
    );
}
```

- [ ] **Step 2:** no `SubscriberModal`, adicionar a aba "Documentos" seguindo o padrão das abas existentes (ler como as abas são declaradas e renderizadas; só aparece com `subscriber?.id`).
- [ ] **Step 3:** substituir a checagem de duplicado por:

```js
const { data: emUso, error: dupErr } = await supabase.rpc('fn_documento_em_uso', { p_doc: formData.cpf_cnpj, p_ignorar: subscriber?.id ?? null });
if (dupErr) throw dupErr;
if (emUso) { showAlert('Já existe um assinante com este CPF/CNPJ.', 'warning'); setLoading(false); return; }
```

(preservar o que o bloco antigo fazia depois de detectar duplicado — ler as linhas seguintes antes de trocar).
- [ ] **Step 4:** `npm run build` OK; abrir um assinante no dev server logado (se não houver sessão, validar por leitura do componente e build) e conferir a aba.
- [ ] **Step 5:** commit `feat(crm): aba de documentos do assinante e regra unica de CPF duplicado` (sem `SupplierModal.jsx`).

---

### Task 11: Página de termos (`Paginas/Contrato`)

**Files:** Modify `C:\Users\Godoy\Documents\HTML\Paginas\Contrato\App.tsx` (+ componentes de cláusulas, se houver)

- [ ] **Step 1:** ler `desconto` da URL e mostrar no resumo; remover leitura/exibição de `cpf` e `endereco` (o bloco "confira seus dados" passa a mostrar só nome, distribuidora e desconto). Remover os fallbacks que assumem 20% e COSERN: sem `desconto` o texto diz "o desconto informado na sua simulação"; sem `concessionaria`, "sua distribuidora".
- [ ] **Step 2:** alinhar o resumo às 22 cláusulas da versão 3.0 lendo `src/lib/contrato.js` do CRM: acrescentar os tópicos que faltam (faturamento e pagamento, mora — multa de 2% e juros —, benefício de pontualidade, titularidade, assinatura eletrônica, foro no domicílio do associado). Linguagem de resumo, sem copiar cláusula inteira.
- [ ] **Step 3:** `npm run build` com `base: './'`; abrir `dist/index.html` via `npx vite preview` e conferir com `?Linkdocontrato=https://example.com&nome=Ana&concessionaria=COSERN&desconto=15`.
- [ ] **Step 4:** gerar `contrato-hostinger.zip` com o conteúdo de `dist/` no scratchpad para o dono subir em `public_html/contrato`; commitar o fonte e o build no branch `contrato` do repo `paginas` (clone em `C:\Users\Godoy\Documents\HTML\Paginas\temp_paginas_contrato`), `git push`.

---

### Task 12: Página do embaixador no branch `Home` + limpeza

**Files:**
- Modify: `Paginas/landingpage cadastro para ser embaixador/index.html` (remover `<link rel="stylesheet" href="/index.css">`)
- Repo `paginas` (clone `C:\Users\Godoy\Documents\HTML\TempRepo`), branch `Home`: pasta `embaixador/`
- Delete (CRM): `src/pages/LeadSignup.jsx`, `src/pages/ReferralLanding.jsx`, `src/pages/LeadSimulation.jsx`

- [ ] **Step 1:** `vite.config.ts` já tem `base: '/embaixador/'` — manter. `npm run build`; conferir que `dist/index.html` referencia `/embaixador/assets/...` e que o iframe aponta para `https://crm.b2wenergia.com.br/cadastro-parceiro`.
- [ ] **Step 2:** no `TempRepo`: `git fetch origin && git checkout Home && git pull`; copiar `dist/*` para `embaixador/`; `git add embaixador && git commit -m "feat: pagina de cadastro de embaixador em /embaixador/"`; `git push origin Home`.
- [ ] **Step 3:** `curl -sI https://b2wenergia.com.br/embaixador/` — se não for 200 em 5 min, avisar o dono que o Hostinger precisa de "Deploy" manual do branch `Home` (memória: publicação parece travada desde 14/09).
- [ ] **Step 4:** no CRM: `git grep -n "LeadSignup\|ReferralLanding\|LeadSimulation" -- src` → só os próprios arquivos; `git rm` dos três; `npm run build` OK; commit `chore: remove paginas mortas de adesao`.
- [ ] **Step 5:** escrever `C:\...\scratchpad\htaccess-redirects.txt` com:

```
RewriteEngine On
RewriteRule ^convite/?$ / [R=301,L,QSA]
RewriteRule ^assine/?$  / [R=301,L,QSA]
```

para o dono colar no topo do `.htaccess` do `public_html`. Depois de aplicado: `curl -sI "https://b2wenergia.com.br/convite/?name=Teste&id=<uuid>"` → 301 para `/?name=Teste&id=<uuid>`.

---

### Task 13: Revisão ponta a ponta real (Autentique Sandbox)

Executada na fase de revisão (requesting-code-review), depois do deploy do front (push em `main` → gh-pages).

- [ ] **Step 1:** `update integrations_config set environment='sandbox' where service_name='autentique_api'`.
- [ ] **Step 2: Caminho 1 — raiz com embaixador:** abrir `https://b2wenergia.com.br/?name=<primeiro nome>&id=<id de um originador real>` (ou `/convite/?…` se o 301 já estiver no ar); simular com CEP 59158-155, e-mail `b2wnotificacoes@gmail.com`, WhatsApp `5533999991234`; no `/contrato` preencher CPF fictício válido, UC `TESTE-<data>`, titular com o mesmo CPF, tipo de ligação, vencimento 15, aceite; enviar um PDF pequeno como identidade e outro como conta de energia; gerar o contrato.
- [ ] **Step 3: Caminho 2 — raiz sem embaixador**, CNPJ fictício válido com representante, mesma sequência (contrato social incluso).
- [ ] **Step 4: conferências por caminho:**
  - banco: `leads` (originator_id no caminho 1), `subscribers` (status `ativacao`, token, aceite, originador herdado), `consumer_units` (desconto = `fn_desconto_assinante_municipio`, vencimento 15, titular, ligação), `subscriber_documents` (2 ou 3 linhas), `profiles` (role subscriber), `signatures` (pending, `captured_via` ≠ fallback), `crm_history` (sucesso), lead derivado `negociacao`/`contrato_enviado` pelo gatilho;
  - dono confirma: WhatsApp em 5533999991234 e e-mail em b2wnotificacoes@gmail.com com o **mesmo** link curto; originador recebeu aviso (caminho 1);
  - retomada: abrir o link `/contrato?retomar=<token>` em aba nova → cai no passo certo;
  - idempotência: chamar `onboarding-finalizar` de novo com o mesmo token → `reenviado: true`, nenhum documento novo em `signatures`;
  - assinar no sandbox da Autentique → webhook → `contrato_assinado`, token anulado, lead `ativacao`.
- [ ] **Step 5:** inconsistência → systematic-debugging antes de qualquer correção.
- [ ] **Step 6: limpeza:** apagar assinantes/UCs/leads/documentos/objetos de storage/perfis e usuários de auth de teste, links YOURLS de teste; `update integrations_config set environment='production' where service_name='autentique_api'`; conferir.

---

### Task 14: Embaixador fora do portão de envio (decisão do dono, 22/09/2026)

Motivo: qualquer pessoa vira `originator` pelo cadastro público de embaixador e, com o papel no portão, disparava WhatsApp/e-mail com texto e destino livres pelo número da B2W.

**Files:**
- Modify: `supabase/functions/_shared/envio-portao.ts` (`PAPEIS_INTERNOS` sem `originator`), `tests/envio-portao.test.ts`
- Create: `supabase/migrations/20260922c_notification_logs_sem_originador.sql` (policy de INSERT de `notification_logs` sem `originator`)
- Create: `supabase/functions/_shared/mensagem-lead.ts` (modelos puros), `tests/mensagem-lead.test.ts`
- Create: `supabase/functions/lead-mensagem/index.ts` (verify_jwt true)
- Modify: `src/components/LeadModal.jsx` (envio manual: embaixador escolhe modelo; interno segue com texto livre)

**Interfaces:**
- `MODELOS_LEAD`: chaves `convite`, `lembrete_simulacao`, `retomar_adesao`; `montarMensagemLead(chave, {nomeLead, nomeOriginador, link}) → string | null` (chave desconhecida → null). Texto com `\u` escapes.
- `POST lead-mensagem {lead_id, modelo}` com JWT do usuário:
  - papel interno (`super_admin, admin, manager, coordinator`) → 403 (use `send-whatsapp`, texto livre);
  - `originator` → o lead precisa ter `leads.originator_id = auth.uid()`; telefone lido de `leads.phone` no servidor (nunca do corpo); link = `originators_v2.short_url` (ou URL longa de `buildConviteUrl` equivalente); envia via `send-whatsapp` com service role; grava `crm_history` (entity lead, `whatsapp_modelo`); 200 `{ok:true}`;
  - lead de outro originador → 403; modelo inválido → 400; demais → 401.
  - Limite: no máximo 3 envios por lead por dia (conta `crm_history` do dia com `whatsapp_modelo`) → 429.
- `LeadModal`: se o papel do usuário logado é `originator`, o bloco de WhatsApp manual mostra um select de modelos com a prévia do texto e envia por `lead-mensagem`; sem anexo e sem texto livre. Demais papéis: comportamento atual.

- [ ] **Step 1:** testes Vitest de `mensagem-lead.ts` (3 modelos, chave inválida → null, sem caracteres não-ASCII no fonte) e de `envio-portao` (originator agora barrado) → RED.
- [ ] **Step 2:** implementar os módulos puros → GREEN.
- [ ] **Step 3:** migração: `DROP POLICY notification_logs_insert_interno` e recriar sem `originator`; teste SQL `supabase/tests/notification_logs_insert.test.sql` passa a afirmar que originator é recusado (RED antes, `SANDBOX_OK` depois).
- [ ] **Step 4:** Edge Function `lead-mensagem`; deploy verify_jwt true; redeploy de `send-whatsapp` e `send-email` com o portão novo.
- [ ] **Step 5:** `LeadModal` conforme a interface; `npm run build`.
- [ ] **Step 6: verificação real:** curl com anon em `send-whatsapp` → 403; `lead-mensagem` sem sessão → 401. Sem envio real de mensagem.
- [ ] **Step 7:** commit `fix(seguranca): embaixador fora do portao de envio; mensagens ao lead por modelo e so para os proprios leads`.

---

### Task 15: RLS de `originators_v2` (decisão do dono, 22/09/2026)

Motivo: a política `originators_v2_authenticated` é `ALL` com `USING true`/`WITH CHECK true`. Qualquer usuário logado (lead, assinante, quem se cadastrou pelo formulário público) lê CPF e PIX de todos os embaixadores e **altera o PIX de qualquer um**, o que desvia comissão.

**Files:**
- Create: `supabase/migrations/20260922d_originators_v2_rls.sql`, `supabase/tests/originators_v2_rls.test.sql`

**Regras:**
- Papéis internos = `super_admin, admin, manager, coordinator` (via `profiles.role` de `auth.uid()`; criar helper `fn_papel_interno()` SECURITY DEFINER STABLE, `search_path` fixo, se não houver um equivalente).
- SELECT authenticated: a própria linha (`id = auth.uid()`) ou papel interno.
- INSERT authenticated: a própria linha (`id = auth.uid()`, o cadastro público com sessão) ou papel interno.
- UPDATE authenticated: a própria linha ou papel interno. Guarda por gatilho BEFORE UPDATE: quem não é papel interno não pode alterar `split_commission`, `short_url`, `id` nem `cpf_cnpj` (erro claro). Gatilhos SECURITY DEFINER existentes (`trg_originador_short_url` via Edge Function com service role) continuam funcionando.
- DELETE: só papel interno.
- `anon` fica como está (INSERT das colunas do formulário; SELECT só `id, phone`).

- [ ] **Step 1: levantamento.** Listar todos os usos de `originators_v2` em `src/`, `supabase/functions/` e funções do banco, com o papel que os executa (ex.: `OriginatorDashboard` como originator, `OriginatorModal`/`OriginatorList` como admin, `LeadModal`/`SubscriberModal` como admin, `SubscriberSignup`/raiz como anon, funções SECURITY DEFINER). Se algum uso legítimo de um papel não interno ler ou gravar linha alheia, PARAR e reportar NEEDS_CONTEXT.
- [ ] **Step 2: teste SQL** (padrão `SANDBOX_OK`, com `set_config('role','authenticated',true)` + `request.jwt.claims`): um lead/assinante não lê nem altera o PIX de um embaixador; um embaixador lê e altera o próprio PIX, mas não o próprio `split_commission`; um admin altera qualquer linha. RED antes.
- [ ] **Step 3: migração**, aplicar, GREEN.
- [ ] **Step 4:** `npm run build`; conferir por leitura que as telas do levantamento continuam cobertas.
- [ ] **Step 5:** commit `fix(seguranca): originators_v2 so le e grava a propria linha; campos de comissao so por papel interno`.
