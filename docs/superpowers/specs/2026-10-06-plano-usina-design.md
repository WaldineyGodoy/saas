# Plano de Usina e recompensa do originador da usina

Data: 06/10/2026 · Branch `impl/plano-usina`, criada a partir de `impl/split-pagamentos` (depende do motor de split novo). Merge próprio, depois do split.

## Por que

Em Configurações → Planos e Serviços, as abas de Assinatura e de Eletropostos têm "Criar Plano"; a aba Usinas era um aviso de "em breve". Os termos comerciais com o investidor estão espalhados no cadastro de cada usina e nada é reaproveitado:

| Onde está hoje | O que guarda | Situação real (06/10/2026) |
|---|---|---|
| `usinas.gestao_percentual` | % de gestão B2W | 10 em sete usinas, **0 em três** (Santa Maria, São Vicente e São Vicente II — todas em pré-operação, e com `percentualRecorrente` 10 no `contract_terms`, ou seja, o 0 é lacuna de cadastro) |
| `usinas.contract_terms` | termos do contrato de compra e venda | `percentualRecorrente` 10, `taxaAdmin` 10, `taxaRecuperacao` 8 nas cinco usinas que têm termos |
| `usinas.plano_assinatura_id` | plano de recompensas (split) | criado na branch do split, **nunca preenchido** (0 de 10) |

E ninguém registra **quem trouxe a usina** para o sistema: nem `usinas` nem `suppliers` têm originador.

## Decisões do dono (06/10/2026)

1. O Plano de Usina reúne **gestão B2W, termos do contrato e plano de recompensas**. Serviços fixos (internet, água, manutenção, arrendamento etc.) **ficam fora**: continuam sendo escolhidos no modal da usina, como hoje.
2. **Vínculo vivo, plano imutável nos números.** A usina lê o plano o tempo todo. Quando percentuais ou valores mudam, **nasce um plano novo**; o antigo fica mantido **somente para cumprimento de contrato** (continua valendo para quem está nele, não aparece para usinas novas).
3. A gestão B2W do plano e os 10% da B2W no split **são a mesma cobrança**. O plano de usina passa a ser a fonte do % da B2W no split, e o fechamento mensal não desconta de novo.
4. Taxa de Administração e Taxa de Recuperação **são cobradas pelo fechamento mensal**; o plano só guarda os valores (e alimenta o contrato).
5. Ponto de partida: um **"Plano Usina Padrão"** com os valores do contrato atual, **sem plano de recompensas e sem nenhuma usina vinculada**. O dono vincula pela tela.
6. O **originador que trouxe a usina** recebe **bônus de entrada + recorrente**, e **a regra mora no cadastro do originador**, não no plano da usina.
7. O recorrente do originador da usina é **um novo beneficiário no split**, sujeito ao piso do fornecedor, e é **o primeiro a ser cortado**.
8. O bônus de entrada é **o saldo de um fechamento da usina redirecionado** do investidor para o originador (ex.: o saldo do 2º mês vai para o originador em vez do fornecedor), contando **só os fechamentos com saldo positivo**.
9. O recorrente do originador da usina vale **em toda fatura paga, qualquer que seja o tipo do plano de recompensas** (start/recorrente/híbrido). "Start é só bônus" é regra da cadeia que trouxe o assinante, não de quem trouxe a usina.

## §1 Dados

### Tabela `planos_usina`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `nome` | text NOT NULL | editável sempre |
| `descricao` | text | editável sempre |
| `percentual_recorrente` | numeric NOT NULL, 0–100 | gestão B2W = cláusula (b) "Remuneração Recorrente" do contrato; é o % que o split lança na 3.1.1 |
| `taxa_admin_reais` | numeric NOT NULL ≥ 0 | R$ por consumidor ativo por mês — cláusula (c) |
| `taxa_recuperacao_pct` | numeric NOT NULL, 0–100 | % sobre o principal recuperado de fatura paga após 30 dias — cláusula (d) |
| `retencao_rescisao_pct` | numeric NOT NULL, 0–100 | cláusulas 22.1/22.2 |
| `multa_atraso_mes_pct` | numeric NOT NULL ≥ 0 | |
| `multa_atraso_teto_pct` | numeric NOT NULL ≥ 0 | |
| `garantia_instalacao_meses` | integer NOT NULL ≥ 0 | |
| `plano_assinatura_id` | uuid FK `planos_assinatura_energia` ON DELETE RESTRICT, NULL | matriz, piso do fornecedor, desconto e tipo de recompensa |
| `status` | text NOT NULL CHECK (`ativo`, `somente_contratos`) | default `ativo` |
| `substitui_plano_id` | uuid FK `planos_usina`, NULL | versão anterior que este plano substituiu |
| `created_at`, `updated_at` | timestamptz | |

RLS no padrão de `planos_assinatura_energia`: leitura para logado, escrita só admin.

### Trava de versão (gatilho BEFORE UPDATE em `planos_usina`)

- Plano **sem usina vinculada**: tudo editável.
- Plano **com usina vinculada**: `UPDATE` que mude qualquer coluna de número ou `plano_assinatura_id` é **recusado pelo banco** com mensagem que manda criar nova versão. `nome`, `descricao` e `status` continuam editáveis.
- `DELETE` de plano com usina vinculada é recusado pela FK `usinas.plano_usina_id ... ON DELETE RESTRICT`.

### Regra de vínculo (gatilho BEFORE INSERT/UPDATE OF `plano_usina_id` em `usinas`)

Só aceita vincular a plano com `status = 'ativo'` **e** `plano_assinatura_id` preenchido. Sem plano de recompensas não há desconto para a base, e a usina cairia em "sem plano" — sem gestão B2W no razão. (Manter a usina num plano que virou `somente_contratos` é permitido: a regra olha só a troca de valor.)

### Na usina

- **Entra** `usinas.plano_usina_id` uuid FK `planos_usina` ON DELETE RESTRICT.
- **Entra** `usinas.originador_id` uuid FK `originators_v2` ON DELETE SET NULL.
- **Sai** `usinas.plano_assinatura_id` (criada na branch do split, 0 de 10 preenchidas). Duas fontes para o mesmo vínculo repetiriam o defeito de `crm-comissao-duas-fontes`.
- `usinas.gestao_percentual` **fica** por ora: o fechamento mensal ainda lê dele (ver §5). Para o razão, deixa de valer quando a usina tem plano.
- `contract_terms` passa a guardar só os termos do projeto: parcelas 1–3, valor da opção do imóvel, amperagem, quantidade de inversores, prazos de execução e limite de reforço.

### No originador (`originators_v2`)

- `recompensa_usina_pct` numeric NULL, 0–100 — % recorrente sobre a base de cada fatura paga das UCs das usinas que ele trouxe. NULL ou 0 = não recebe.
- `bonus_usina_fechamentos` integer[] NULL — ordinais dos fechamentos **com saldo positivo** da usina cujo saldo é redirecionado para ele (ex.: `{2}`).

### Plano padrão

A migração cria **"Plano Usina Padrão"** com os valores de `DEFAULTS_USINA` (`src/lib/contratosUsina.js`): recorrente 10%, administração R$ 10, recuperação 8%, rescisão 10%, atraso 0,5%/mês com teto 10%, garantia 12 meses; `plano_assinatura_id` NULL; nenhuma usina vinculada.

## §2 Motor do split

### Resolução das regras

Caminho novo: **UC → usina → `planos_usina` → `planos_assinatura_energia`**. `fn_plano_da_uc` e `fn_regras_recompensa_uc` são reescritas para esse caminho e passam a devolver também `percentual_recorrente` e o `plano_usina_id`.

- **Gestão B2W**: `planos_usina.percentual_recorrente`, **igual em todos os níveis** (sobrescreve `regras_multinivel.b2w` e `planos_assinatura_energia.gestao_percentual` na matriz sintética que o gatilho já monta desde a Task 11).
- Matriz dos demais papéis, piso, desconto e `tipo_recompensa`: do plano de assinatura, como hoje.
- **Usina sem plano de usina**: comportamento atual de `uc_sem_plano` — fornecedor fica com o caixa, 3.1.1 = 0.
- O congelamento (`invoices.recompensas_aplicadas`) grava `plano_usina_id` e `percentual_recorrente` além do que já grava.

### Novo papel `originador_usina`

- **Quem**: `usinas.originador_id` da usina da UC.
- **Percentual**: `originators_v2.recompensa_usina_pct`, injetado na matriz sintética como `originador_usina: {niveis: {L1: pct}, max_niveis: 1}`. Não é multinível; o líder dele não recebe nada por isso.
- **Base**: a mesma dos demais papéis (kWh compensado × tarifa líquida).
- **Tipo de plano**: entra em toda fatura paga, inclusive em plano `start` fora da fatura elegível (decisão 9).
- **Supressão**: `originators_v2.ativo = false` → `suspenso`, e o valor vai para a B2W, como nas demais supressões.
- **Corte**: primeiro da ordem — `fn_calcular_split_recompensa` passa de `['assinante_conect','parceiro','lider']` para `['originador_usina','assinante_conect','parceiro','lider']`. A B2W continua nunca cortada. No máximo um `originador_usina` por pagamento (mesma guarda que o motor já tem por categoria).
- **Lançamento**: conta 2.1.2, `reference_type = 'originator'`, `reference_id` = o originador. O mapa papel → conta do gatilho ganha a entrada; papel sem conta continua estourando (caso 14).
- `fn_participantes_recompensa` passa a incluir o participante quando a usina tem originador com percentual > 0.

Nenhum outro papel muda. Faturas já lançadas não são recalculadas.

## §3 Telas

1. **Configurações → Planos e Serviços → Usinas**
   - Botão **"Criar Plano de Usina"** e tabela dos planos: nome, gestão %, taxa de administração, recuperação, plano de recompensas, status (Ativo / Somente contratos) e nº de usinas.
   - **Editar** (`PlanoUsinaModal`, novo): todos os campos enquanto o plano não tem usina; depois disso só nome e descrição, e aparece **"Criar nova versão"** — abre o modal pré-preenchido; ao salvar, a versão nova nasce `ativo` com `substitui_plano_id`, e a antiga vira `somente_contratos`. As usinas da antiga não mudam.
   - **Excluir**: só sem usina vinculada.
   - Abaixo, o **vínculo em lote** (`UsinasPlanosTab`, feito na branch do split), apontando para `plano_usina_id`. Só oferece planos `ativo` com plano de recompensas.
   - O bloqueio de exclusão de plano de assinatura com usinas (feito no split) passa a contar planos de usina que apontam para ele.
2. **Modal da usina (`PowerPlantModal`), aba Financeiro**
   - O seletor "Plano de Recompensas" vira **"Plano de Usina"**, com o mesmo aviso do efeito no razão.
   - Campo **"Originador da usina"** (originadores ativos).
   - Os termos que vêm do plano aparecem só para leitura.
3. **Gerador do contrato de compra e venda** (`src/lib/contratosUsina.js`): `percentualRecorrente`, `taxaAdmin`, `taxaRecuperacao`, `retencaoRescisao`, `multaAtrasoMes`, `multaAtrasoTeto` e `garantiaInstalacaoMeses` saem do plano de usina quando a usina tem um; sem plano, os valores de hoje (`contract_terms` e `DEFAULTS_USINA`). A minuta editada (`contract_terms.minutas`) continua ganhando do texto automático.
4. **Cadastro do originador (`OriginatorModal`)**: "Recompensa recorrente por usina (%)" e "Bônus de entrada: fechamento nº".

## §4 Testes

- Arquivo novo `supabase/tests/plano_usina.test.sql`, no padrão da suíte (`DO $$ … RAISE EXCEPTION 'SANDBOX_OK'`):
  1. trava: plano sem usina edita; com usina, mudar número é recusado e mudar nome passa;
  2. vínculo recusado a plano `somente_contratos` e a plano sem plano de recompensas;
  3. gestão B2W lida do plano de usina (plano de usina 12% sobre plano de assinatura de 10% → 3.1.1 = 12% da base);
  4. `originador_usina` recebe o seu % em 2.1.2, inclusive em plano `start` fora da fatura elegível;
  5. corte: `originador_usina` é o primeiro drenado;
  6. originador inativo: parte vai para a B2W;
  7. usina sem plano de usina: comportamento atual inalterado.
- As suítes existentes (`split_gatilho`, `split_bonus_start`, `split_base_compensada`, `split_conta_receber`, `split_piso_tarifa_bruta`, `invoice_paid_ledger_definer`) adaptadas ao vínculo via plano de usina e rodadas no banco com a saída colada verbatim.
- Razão de produção conferido antes e depois de cada migração (hoje 383 lançamentos / 139 transações / soma −10694,8082347826087400).

## §5 Fora desta branch — fechamento mensal

O fechamento mensal (`impl/fechamento-mensal`, segurada) precisa, quando entrar:

- ler a gestão de `planos_usina.percentual_recorrente` e **não descontar de novo** a gestão que o split já lançou na 3.1.1;
- cobrar `taxa_admin_reais` (× consumidores ativos) e `taxa_recuperacao_pct` do plano de usina;
- executar o bônus de entrada: no N-ésimo fechamento **com saldo positivo** da usina, com N em `originators_v2.bonus_usina_fechamentos`, o saldo vai ao originador em vez do fornecedor. Mês com saldo zero ou negativo não conta.

**Risco conhecido**: se `impl/fechamento-mensal` entrar no `main` como está, ele desconta `usinas.gestao_percentual` sobre faturas pagas **e** o split já lançou a mesma gestão — cobrança em dobro. A ordem de merge tem de tratar disso.

## Ordem de entrega

1. Migração de dados: `planos_usina`, travas, colunas novas, plano padrão, saída de `usinas.plano_assinatura_id`.
2. Motor: resolução via plano de usina, gestão do plano, papel `originador_usina`.
3. Telas de plano (aba Usinas, `PlanoUsinaModal`, nova versão).
4. Usina (seletor e originador) e originador (os dois campos).
5. Gerador do contrato.
6. Revisão final.
