# Plano do Originador — desenho (10/11/2026)

Branch `feat/plano-originador`, worktree `.claude/worktrees/plano-originador`, base `origin/main` (dc8bd6b).

## Por que existe

A remuneração dos parceiros (Líder, PPE, PPP, PPF) vivia **dentro do plano de
assinatura** (`planos_assinatura_energia.start_config` e
`recorrente_config.regras_multinivel`), por cargo. Não havia como dar a um
originador uma regra negociada sem mexer no produto inteiro, e o cadastro do
originador tinha um terceiro lugar de percentual (`originators_v2.split_commission`)
que o motor novo não lê. Caso que disparou: Jefferson Carlos / Green Park,
50% nas 2 primeiras faturas com compensação, sem nenhum lugar no sistema para
registrar isso.

## Decisões do dono (10/11/2026) — não reabrir

1. **Nova seção "Plano do Originador"** em Configurações → Planos e Serviços,
   nascendo com **2 planos**: **Plano Padrão** (cópia das regras de parceiro do
   Plano Premium de hoje) e **Plano Recorrente** (cópia das do Plano Ultra Connect).
2. **Saem do plano de assinatura** os campos de remuneração dos parceiros:
   percentuais de Líder/PPE/PPP/PPF (Start e recorrência), a janela de faturas do
   Start dos parceiros e o tipo de recompensa dos parceiros. **Ficam** no plano de
   assinatura: desconto, gestão B2W (inclusive a % da B2W na fatura de Start),
   piso do fornecedor, Assinante Conect e o `tipo_recompensa` que rege B2W+Conect.
   O plano de assinatura passa a **apontar** para um Plano do Originador
   (`plano_originador_id`), por default o Padrão. Premium → Padrão; Ultra Connect → Recorrente.
3. **Modal do originador** ganha o campo "Plano do Originador". Sem escolha = Padrão.
4. **Precedência — "exceção do originador vence"**, resolvida POR BENEFICIÁRIO:
   - o originador tem no modal um plano **diferente do Padrão** → vale esse;
   - senão → vale o Plano do Originador ligado ao plano de assinatura da UC;
   - senão → Padrão.
5. **Conflitos resolvidos:**
   - quantidade de faturas e percentual do Start: **o Plano do Originador determina**;
   - **conta como fatura só a fatura paga COM energia compensada** (`consumo_compensado > 0`);
   - **quem paga continua sendo o fornecedor** (Start sai da parte dele, isento do piso).
     A exceção Jefferson/Green Park (B2W absorve R$ 6.507,86) é lançamento manual
     à parte e **não entra no código**.

## Banco (fonte da verdade) — nomes fixos

### Tabela `public.planos_originador`
| coluna | tipo | regra |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `nome` | text not null | |
| `descricao` | text | |
| `status` | text not null default 'ativo' | check in ('ativo','inativo') |
| `padrao` | boolean not null default false | índice único parcial `WHERE padrao` (exatamente um) |
| `tipo_recompensa` | text not null default 'start' | check in ('start','recorrente','ambos') |
| `start_config` | jsonb not null | `{"faturas_elegiveis":[2], "regras":{"2":{"lider":20,"ppe":20,"ppp":0,"ppf":0}}}` |
| `recorrente_config` | jsonb not null | `{"regras_multinivel":{"lider":{"niveis":{"L1":"1","L2":"1","L3":"1","L4":"0"},"max_niveis":3}, "ppe":{...}, "ppp":{...}, "ppf":{...}}}` |
| `created_at`, `updated_at` | timestamptz | |

- Só os 4 cargos `lider, ppe, ppp, ppf`. **Nunca** b2w, assinante_conect nem chaves legadas
  (`associacao, embaixador, coordenador, assinante`).
- `faturas_elegiveis` = ordinais (1 = 1ª fatura paga **com compensação** da UC).
- Guardas: o Padrão não pode ser excluído nem inativado nem perder `padrao`; plano
  referenciado não pode ser excluído (FK `ON DELETE RESTRICT`).
- RLS igual a `planos_usina`: leitura `authenticated` (true); insert/update/delete só `fn_eh_admin()`.

### Colunas novas
- `planos_assinatura_energia.plano_originador_id uuid NOT NULL REFERENCES planos_originador ON DELETE RESTRICT`
  — gatilho BEFORE INSERT preenche com o Padrão quando vier nulo.
- `originators_v2.plano_originador_id uuid NOT NULL REFERENCES planos_originador ON DELETE RESTRICT`
  — idem; backfill de todos com o Padrão. (`split_commission` fica no banco, **sem uso**; não apagar.)

### Função `public.fn_plano_originador_efetivo(p_originator uuid, p_uc uuid) RETURNS jsonb`
STABLE SECURITY DEFINER. Devolve a linha do plano em jsonb + `"origem"`:
`'originador'` (exceção) | `'plano_assinatura'` | `'padrao'`.

### Motor (`handle_invoice_paid_ledger`)
- **Ordinal** = 1 + nº de OUTRAS faturas pagas da UC com `consumo_compensado > 0`.
  Vale para tudo que usa `v_ordinal` (Start da B2W, Start dos parceiros e faturas retidas
  do fornecedor, que por decisão de 05/11 usam "o mesmo ordinal do Bônus Start").
- **Transição sem pagar Start duas vezes:** se alguma fatura paga anterior da UC tem
  `recompensas_aplicadas->'bonus_start'->>'aplicado' = 'true'` gravada pela regra antiga
  (sem `ordinal_regra` ou com `'todas_pagas'`), o Start daquela UC está **encerrado**
  (B2W e parceiros) — motivo registrado. Pela regra nova, um mesmo ordinal nunca paga Start
  duas vezes na mesma UC.
- **Matriz efetiva por papel:**
  - `b2w` e `assinante_conect`: do plano de assinatura, como hoje (inclusive o `b2w` do
    `start_config` do plano de assinatura na fatura de Start dele).
  - `lider/ppe/ppp/ppf`: do plano efetivo **daquele participante**
    (`fn_plano_originador_efetivo(participante.id, uc)`): Start se `tipo_recompensa` desse
    plano ∈ (start, ambos), o ordinal ∈ `faturas_elegiveis` e o participante é nível 1;
    senão recorrência se tipo ∈ (recorrente, ambos), pela `regras_multinivel` desse plano;
    senão 0. Mesma semântica de hoje para `ambos` (nível 1 Start, nível 2+ recorrência).
- **Piso:** fatura em que QUALQUER Start se aplica (B2W ou parceiro) fica isenta do piso
  (teto = base), como hoje.
- **Congelamento** (`recompensas_aplicadas`): nova `versao`, `bonus_start.ordinal_regra =
  'compensadas'`, e por beneficiário `plano_originador_id`, `plano_origem`, `regra`
  ('start'|'recorrencia'|'nenhuma').
- **Com os dois planos semeados, o motor tem de pagar exatamente o que paga hoje**, exceto
  pela contagem do ordinal (resolução 3). Isso é teste obrigatório.

### Limpeza do plano de assinatura
Depois de copiar para os 2 planos: remover de `start_config.regras.*`,
`recorrente_config.regras_multinivel` e `recorrente_config.regras` as chaves
`lider, ppe, ppp, ppf, associacao, embaixador, coordenador, assinante`. Ficam `b2w` e
`assinante_conect`.

## Fora do escopo
Planos de eletroposto (`EletropostoPlanModal.jsx` continua com cargos próprios — **não
quebrar**, ele usa `src/lib/planoRecompensas.js`), Plano de Usina (`originador_recorrente_pct`
do fornecedor), contagem retroativa (o motor só age em fatura que vira `pago` daqui em diante).

## Regras de execução
- **Nenhuma migração é aplicada em produção.** Validar com `BEGIN; <migração>; <teste>; ROLLBACK;`
  ou com o padrão `RAISE EXCEPTION 'SANDBOX_OK'` dos testes em `supabase/tests/`.
- Nada de `git commit`/`push` pelos agentes — o coordenador revisa e commita.
- Push em `main` republica o CRM (GitHub Pages). Nunca.

## Donos de arquivo (trabalho em paralelo, sem sobreposição)
| Agente | Arquivos |
|---|---|
| A — banco/motor | `supabase/migrations/20261110a_plano_originador.sql`, `supabase/migrations/20261110b_motor_plano_originador.sql`, `supabase/tests/plano_originador_*.test.sql`, fixtures dos `supabase/tests/split_*.test.sql` |
| B — seção Plano do Originador | `src/pages/settings/PlansServicesSettings.jsx`, `src/pages/settings/components/PlanoOriginadorModal.jsx` (novo) |
| C — plano de assinatura | `src/pages/settings/components/PlanModal.jsx`, `src/lib/planoRecompensas.js` (sem quebrar eletroposto) |
| D — originador | `src/components/OriginatorModal.jsx`, `src/pages/dashboards/OriginatorList.jsx`, `src/lib/contratoOriginador.js`, `src/components/ContratoOriginacao.jsx`, `src/pages/dashboards/OriginatorDashboard.jsx`, `src/components/LeadModal.jsx` (só se ler split_commission) |
| coordenador | `src/lib/planoOriginador.js` (contrato da tela, já escrito), esta spec |
