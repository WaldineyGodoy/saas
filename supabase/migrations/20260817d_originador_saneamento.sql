-- =====================================================================
-- Saneamento do cadastro de originadores
-- Data: 17/08/2026
--
-- Blocos 1 a 4: NÃO APLICADOS — revisar antes de rodar. São
-- independentes entre si, dá para rodar um de cada vez.
--
-- Bloco 5: JÁ EXECUTADO em 17/08/2026 (estorno da comissão órfã), e fica
-- registrado aqui só para rastreabilidade — não precisa rodar de novo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Endereço: unificar o vocabulário em português
--
-- O cadastro público gravava `street`/`number`/`neighborhood`/`city`/
-- `complement`; o modal do CRM lê `rua`/`numero`/`bairro`/`cidade`/
-- `complemento`. O modal exibia vazio e, ao salvar, gravava as chaves em
-- português vazias por cima — apagando o endereço de quem se cadastrou
-- pelo site. O front já foi corrigido (grava e lê em português, e aceita
-- os dois na leitura); aqui os registros existentes são convertidos.
-- ---------------------------------------------------------------------
UPDATE public.originators_v2
SET address = jsonb_strip_nulls(
    jsonb_build_object(
        'cep',         COALESCE(address->>'cep', ''),
        'rua',         COALESCE(NULLIF(address->>'rua', ''),         address->>'street',       ''),
        'numero',      COALESCE(NULLIF(address->>'numero', ''),      address->>'number',       ''),
        'complemento', COALESCE(NULLIF(address->>'complemento', ''), address->>'complement',   ''),
        'bairro',      COALESCE(NULLIF(address->>'bairro', ''),      address->>'neighborhood', ''),
        'cidade',      COALESCE(NULLIF(address->>'cidade', ''),      address->>'city',         ''),
        'uf',          COALESCE(address->>'uf', '')
    )
)
WHERE address ?| array['street', 'number', 'neighborhood', 'city', 'complement'];


-- ---------------------------------------------------------------------
-- 2. Nome: tirar espaço das pontas e colapsar espaço repetido
--
-- "Bennaya Almeida " virava `%20` no fim do parâmetro do link e
-- "José Claudio Gonçalo  Silva" virava `%20%20` na saudação da landing.
--
-- ATENÇÃO: isto NÃO conserta o `short_url` já emitido — o alvo ficou
-- gravado no YOURLS no momento em que o link foi criado. Para o José,
-- ver o bloco 2b.
-- ---------------------------------------------------------------------
UPDATE public.originators_v2
SET name = regexp_replace(btrim(name), '\s+', ' ', 'g')
WHERE name <> regexp_replace(btrim(name), '\s+', ' ', 'g');


-- 2b. Reemitir o link encurtado de quem teve o nome corrigido.
--     Zerar `short_url` faz a Edge Function tratá-lo como pendente; o
--     link antigo continua funcionando (só mostra a saudação com o
--     espaço a mais), então ninguém fica sem link no intervalo.
--
--     Rode o bloco abaixo e, em seguida, o backfill:
--       curl -X POST \
--         https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/originador-short-url \
--         -H "Content-Type: application/json" -d '{"all_missing":true}'
--
-- UPDATE public.originators_v2
-- SET short_url = NULL
-- WHERE id = '1985f9a9-2b41-479a-b530-917b241eeeb4';  -- José Claudio


-- ---------------------------------------------------------------------
-- 3. Fechar a leitura anônima da tabela inteira
--
-- A policy `originators_v2_anon_referral` é SELECT com USING (true) para
-- `anon`. Como RLS não filtra coluna, isso deixa `pix_key` (que é o CPF
-- de quase todo mundo), `cpf_cnpj`, telefone, e-mail e endereço de todos
-- os parceiros legíveis por qualquer um com a chave publicável — que é
-- pública por definição, vai no bundle do site.
--
-- A policy existe por um motivo legítimo: `SubscriberSignup` lê o
-- telefone do originador, sem sessão, para avisá-lo por WhatsApp que
-- entrou um lead pelo link dele. Só que precisa de `phone`, não da
-- ficha inteira. Como RLS é por linha, o corte de coluna é por GRANT.
-- ---------------------------------------------------------------------
REVOKE SELECT ON public.originators_v2 FROM anon;

GRANT SELECT (id, name, phone, short_url) ON public.originators_v2 TO anon;

COMMENT ON POLICY originators_v2_anon_referral ON public.originators_v2 IS
  'Leitura sem sessão para o fluxo de indicação. As colunas visíveis a anon são limitadas por GRANT (id, name, phone, short_url) — RLS não filtra coluna.';


-- ---------------------------------------------------------------------
-- 4. Fechar o razão para quem não é admin
--
-- `ledger_entries` tem hoje uma policy de SELECT com USING (true) para
-- `authenticated`. Ou seja: qualquer originador ou assinante logado lê o
-- razão inteiro da empresa — receita, repasse a investidor, comissão dos
-- outros parceiros.
--
-- Isso passou a importar mais agora: o extrato do painel do originador
-- lê `ledger_entries` (conta 2.1.2). A tela filtra pelo próprio id, mas
-- nada impede o parceiro de consultar direto com o token dele.
--
-- A policy abaixo mantém o admin com leitura total e deixa o originador
-- ver só os lançamentos de comissão dele. Como `originators_v2.id` é o
-- próprio id de auth, o filtro é direto — a tela do painel não muda.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.ledger_entries;

CREATE POLICY ledger_entries_read ON public.ledger_entries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
    OR (reference_type = 'originator' AND reference_id = auth.uid())
  );

COMMENT ON POLICY ledger_entries_read ON public.ledger_entries IS
  'Admin lê o razão inteiro; originador lê apenas os lançamentos de comissão dele (2.1.2).';

-- ---------------------------------------------------------------------
-- 5. JÁ EXECUTADO em 17/08/2026 — registrado aqui para rastreabilidade
--
-- Havia R$ 207,34 em 2.1.2 (3 lançamentos) apontando para o originador
-- 40b573cd-cd4f-4db4-a35c-c351b5ee71fc, que não existe mais em
-- `originators_v2` — foi excluído pelo modal, que não tinha trava (a
-- trava está no front agora). Era dívida registrada sem credor.
--
-- Decisão do dono: estornar.
--
-- Estornado por CONTRA-LANÇAMENTO, não por DELETE: apagar o original
-- destruiria a trilha de auditoria e esconderia que a comissão chegou a
-- ser lançada. Cada estorno cita no `description` o id do lançamento que
-- reverte, então o par é rastreável.
--
-- Os 3 originais estavam em transações de UMA PERNA SÓ — sem
-- contrapartida. Por isso o estorno também é de uma perna: mais do que
-- desfazer o que foi criado seria inventar um fato (não há como saber de
-- que conta o valor teria saído). Resultado: saldo do originador
-- excluído zerado, e a soma global do razão foi de -10.902,15 para
-- -10.694,81 (melhora de exatamente 207,34).
--
-- Transação do estorno: 9ef3ae87-f701-4fd9-8f0b-9b2a5efcc7b6
--
-- O comando abaixo é idempotente (o NOT EXISTS impede estorno em
-- duplicidade) e foi executado assim:
--
--   WITH nova AS (SELECT gen_random_uuid() AS tx)
--   INSERT INTO public.ledger_entries
--       (transaction_id, account_id, amount, description, reference_type, reference_id)
--   SELECT n.tx, e.account_id, -e.amount,
--          'Estorno comissao originador excluido (ref. lancamento ' || e.id || ')',
--          e.reference_type, e.reference_id
--   FROM public.ledger_entries e
--   JOIN public.ledger_accounts a ON a.id = e.account_id
--   CROSS JOIN nova n
--   WHERE a.code = '2.1.2'
--     AND e.reference_type = 'originator'
--     AND e.reference_id = '40b573cd-cd4f-4db4-a35c-c351b5ee71fc'
--     AND e.amount < 0
--     AND NOT EXISTS (
--           SELECT 1 FROM public.ledger_entries r
--           WHERE r.description = 'Estorno comissao originador excluido (ref. lancamento ' || e.id || ')'
--     );
--
-- NOTA para quem for mexer no razão: o desbalanceamento não é só disso.
-- Há 32 lançamentos em transações de uma perna só, e a soma global
-- segue em -10.694,81. Frente separada.
-- ---------------------------------------------------------------------
