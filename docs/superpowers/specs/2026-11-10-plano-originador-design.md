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

---

# Revisão de 12/11/2026 (dono, ao testar as telas) — PREVALECE sobre o acima

Decisões: Start **por nível**; Start vale para as **N primeiras faturas com energia compensada**
com UMA matriz (igual para as N); **Híbrido sequencial** (Start nas N primeiras, recorrência só
depois, nunca as duas na mesma fatura, "enquanto o parceiro estiver ativo"); **PPE e PPP continuam
separados**; **Assinante Conect continua no plano de assinatura**; todos os cargos até **L3**;
o seletor de plano no modal do originador vai para a aba **Indicação**. As edições que o dono já
salvou em produção (Plano Padrão = Start na 1ª fatura, Líder 50%, PPP 40%; "Plano Hibrido";
Recorrente alterado) **ficam** — a migração só converte o formato, sem mudar números.

## Formato novo de `planos_originador.start_config`
```json
{ "faturas_elegiveis": [1, 2],               // sempre [1..N]
  "regras_multinivel": { "lider": {"niveis": {"L1":"50","L2":"10","L3":"5","L4":"0"}, "max_niveis": 3},
                         "ppe": {...}, "ppp": {...}, "ppf": {...} } }
```
- A chave antiga `regras` (por fatura, só L1) **some**. Conversão: o % da menor fatura elegível vira o
  L1 do cargo (`max_niveis` 1); `faturas_elegiveis` vira `[1..quantidade]`.
- `recorrente_config` não muda de formato. Teto de nível: 3 para os 4 cargos (L4 sempre "0").
- Fonte da tela: `src/lib/planoOriginador.js` (`faturasDoStart`, `quantidadeFaturasStart`,
  `normalizarPlanoOriginador`, `niveisDoCargo`, `NIVEIS_TELA`, `MAX_NIVEIS_ORIGINADOR`, `TIPOS_RECOMPENSA` com `ajuda`).

## Motor — semântica nova por participante-parceiro (plano efetivo dele)
`janela` = ordinal ∈ `faturas_elegiveis` do plano dele (e Start não bloqueado pela guarda de transição).
| tipo do plano | dentro da janela | fora da janela |
|---|---|---|
| `start` | matriz de **Start** (todos os níveis) | nada |
| `recorrente` | recorrência | recorrência |
| `ambos` (Híbrido) | matriz de **Start** | recorrência **só se ordinal > max(janela)** ou Start da UC encerrado pela guarda |

`regra` do beneficiário = `start` / `recorrencia` / `nenhuma` conforme a matriz usada e `nivel ≤ max_niveis`.
Fatura com qualquer parceiro em `start` fica isenta do piso. O preenchimento dos cargos sem
participante (matriz congelada completa) segue a mesma tabela, pelo plano da UC.
B2W e Conect: inalterados (plano de assinatura).

---

# Revisão de 12/11/2026 (2ª, dono) — Start por energia, franquia mensal — PREVALECE

O Start deixa de contar **faturas** e passa a contar **energia**. A migração `20261112a`
(Start em N faturas) **não será aplicada**; será refeita sobre esta regra.

## Decisões do dono (não reabrir)
1. **Histórico de consumo no cadastro do assinante.** O leitor da conta de energia (upload no
   cadastro) grava o bloco "histórico" mês a mês por UC.
2. **Consumo médio = MEDIANA** do histórico. Meses com 0 kWh são preenchidos com a mediana
   (mediana calculada sobre os meses com consumo > 0).
3. **Start = X × mediana em kWh compensados**, não "X faturas". O plano diz o multiplicador X
   (ex.: "Start 2x"). O parceiro recebe sobre a energia compensada de cada fatura até
   completar X × mediana; o que passar do teto não paga Start.
   - Ex. mediana 1.000, 2x (teto 2.000): F1 600 → paga 600; F2 1.200 → paga 1.000 (acum.
     1.600); F3 800 → paga 400 (acum. 2.000, encerrado).
4. **Teto do Start FIXO no cadastro** (mediana do upload; não muda com o perfil).
5. **Base do % (Start e recorrência dos parceiros) = kWh × tarifa da concessionária impressa
   na conta × %, SEM descontos** (não mais a tarifa líquida do investidor; sem desconto do
   assinante nem Fio B). Ex.: 600 kWh × R$ 1,02 × 50%. Quem paga continua o fornecedor;
   fatura com Start fica isenta do piso.
6. **Híbrido:** a fatura em que o Start se completa paga **só Start**; a recorrência começa
   na fatura **seguinte** (nunca os dois na mesma fatura).
7. **Franquia mensal (perfil de 12 meses)**, não mais um número único, comparada mês a mês
   com a **geração estimada da usina naquele mês** para detectar overbook.
8. **Autoatualização:** cada conta nova lida **sobrescreve o mês correspondente do perfil
   com o CONSUMO MEDIDO da conta** (não a energia compensada — o compensado é limitado pela
   usina e esconderia o overbook).

## Defaults do coordenador (dono pode revisar)
- X é um por plano; o % continua por cargo × nível (L1..L3). Todos os níveis usam o mesmo teto.
- Geração mensal estimada da usina = `geracao_estimada_kwh` distribuída pelo formato mensal de
  `irradiancia` (jan..dez kWh/kWp da cidade da usina); sem cidade casada → plano (12 × média).
- Assinantes existentes sem histórico: perfil inicial = histórico das contas já lidas no banco;
  sem nada, 12 × `franquia` atual. Teto de Start dos existentes = X × mediana desse perfil,
  congelado na aplicação da migração.

## Complemento do dono (12/11/2026)
- **B2W (gestão) e Assinante Conect também usam a tarifa cheia da concessionária** como base.
- **Gestão B2W fica no Plano da Usina** (`planos_usina.percentual_recorrente`, já lido por
  `fn_regras_recompensa_uc`); sem plano de usina, cai no plano de assinatura como hoje.
- Modal da UC: nova seção **"Histórico de consumo"** na aba "Faturas e Contas de Energia";
  o bloco **"Desligamento na concessionária"** sai dessa aba e vai para a aba **Técnico**.
- Start da B2W (`start_config.regras` do plano de assinatura, por ordinal de fatura) continua por
  ordinal; só a base muda para tarifa cheia.

## Contrato comum (nomes fixos — todos os agentes)
### Banco
- `consumer_units.historico_consumo jsonb` — perfil por MÊS DO CALENDÁRIO:
  `{"01":{"kwh":980,"ref":"2026-01","origem":"cadastro"}, ..., "12":{...}}`.
  `origem` ∈ `cadastro` (lido no upload), `conta` (sobrescrito por conta nova), `mediana`
  (mês zerado/ausente preenchido), `franquia` (backfill sem dado).
- `consumer_units.consumo_mediano_kwh numeric` — mediana atual do perfil (recalculada).
- `consumer_units.start_base_kwh numeric` + `start_base_em timestamptz` — mediana CONGELADA no
  cadastro; teto do Start = multiplicador × start_base_kwh. Nunca reescrita depois de preenchida
  (só admin, por RPC explícita).
- RPC `fn_gravar_historico_consumo(p_uc uuid, p_historico jsonb, p_origem text default 'cadastro')`
  `RETURNS jsonb` (SECURITY DEFINER, authenticated): recebe o array do leitor
  `[{"mes":"2026-05","kwh":166,"dias":29}, ...]`, grava os meses (o mais recente por mês do
  calendário), mediana sobre kwh>0, preenche zerados/ausentes com a mediana (`origem`='mediana'),
  atualiza `consumo_mediano_kwh`, congela `start_base_kwh` se nulo. Não mexe em `franquia`.
  Devolve `{historico, mediana, start_base_kwh}`.
- `fn_mediana_kwh(jsonb) RETURNS numeric` IMMUTABLE.
- Autoatualização: quando a conta lida grava o consumo medido do mês em `invoices`, o mês
  correspondente do perfil é sobrescrito (`origem`='conta') e a mediana recalculada
  (o teto do Start NÃO muda).
- `fn_geracao_estimada_mensal(p_usina uuid) RETURNS jsonb` `{"01":kwh,...,"12":kwh}` =
  `geracao_estimada_kwh × 12 × fator_mês`, fator = kWh/kWp do mês ÷ soma dos 12 em `irradiancia`
  (pela `usinas.ibge_code` = `"cod.ibge"`); sem casamento → 12 × `geracao_estimada_kwh`.
- `planos_originador.start_config` NOVO: `{"multiplicador": 2, "regras_multinivel": {cargo:
  {"niveis":{"L1","L2","L3","L4"="0"}, "max_niveis":0..3}}}`. Somem `faturas_elegiveis` e `regras`.
  Conversão dos planos atuais: multiplicador = quantidade de faturas elegíveis de hoje (1 fatura → 1x),
  matriz por nível como na `20261112a`.
### Motor (por participante-parceiro, plano efetivo dele)
- `kwh_start_pago` = soma de `recompensas_aplicadas->'plano_originador'->papel->>'kwh_start'` das
  faturas pagas anteriores da UC para o MESMO beneficiário (id); teto = multiplicador × start_base_kwh.
- `kwh_start` desta fatura = min(consumo_compensado, teto − kwh_start_pago) se > 0.
- Valor Start = kwh_start × tarifa × % do nível. Recorrência = consumo_compensado × tarifa × %.
- `start`: só Start. `recorrente`: sempre recorrência. `ambos`: Start enquanto houver saldo; a
  recorrência só a partir da fatura SEGUINTE à que zerou o saldo.
- Sem `start_base_kwh` na UC → Start não paga (motivo `uc_sem_consumo_base`), recorrência segue.
- Base de TODOS os percentuais (parceiros, B2W, Conect) = consumo_compensado × tarifa (sem desconto
  nem Fio B); `fn_base_recompensa_fatura` passa a devolver também `base_bruta` e `tarifa`.
  O fornecedor fica com base_líquida − soma dos repasses; piso como hoje (fatura com Start isenta).
- Congelar por beneficiário: `kwh_start`, `kwh_start_pago_antes`, `teto_start_kwh`, `regra`.

## Decisões do dono (12/11/2026, 3ª rodada)
- **Teto por fatura:** cada fatura paga Start sobre no máximo **1 × consumo médio**; o total
  para em X × consumo médio (600 / 1.000 / 400 no exemplo 2x). Contrato e tela dizem isso.
- **Tarifa cheia mantida; os % dos planos serão REDUZIDOS** pelo dono (fator de referência
  base líquida ÷ bruta ≈ 0,594 nas faturas Cosern com 20% de desconto). A conversão da migração
  fica num bloco isolado para receber os valores novos.
- **Cláusula 8.4:** incluir que a fatura com Bônus Start é isenta da trava de margem do fornecedor.
