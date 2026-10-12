# Plano de Usina e recompensa do originador da usina

Data: 06/10/2026 · revisada em 07/10/2026 (originador no fornecedor, contrato de gestão, cinco campos novos) · Branch `impl/plano-usina`, criada a partir de `impl/split-pagamentos` (depende do motor de split novo). Merge próprio, depois do split.

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
6. O **originador que trouxe a usina** recebe **bônus de entrada + recorrente**, e **o percentual do recorrente e o bônus são definidos no plano da usina** (revisão do dono, 06/10/2026 — substitui a versão anterior desta linha, que punha a regra no cadastro do originador). Como são números do plano, seguem a trava de versão.
6a. **Se a usina não tiver originador vinculado, o valor previsto no plano fica para a associação** (papel B2W). Vale para o recorrente e para o bônus. Originador inativo segue a mesma regra.
6b. **O originador mora no FORNECEDOR, e a usina herda** (revisão do dono, 07/10/2026 — substitui `usinas.originador_id`): `suppliers.originator_id`, lido pela usina via `usinas.supplier_id`. "Usina sem originador" passa a ser "usina cujo fornecedor não tem originador" (ou usina sem fornecedor).
7. O recorrente do originador da usina é **um novo beneficiário no split**, sujeito ao piso do fornecedor, e é **o primeiro a ser cortado**.
8. O bônus de entrada é **o saldo de um fechamento da usina redirecionado** do investidor para o originador (ex.: o saldo do 2º mês vai para o originador em vez do fornecedor), contando **só os fechamentos com saldo positivo**.
9. O recorrente do originador da usina vale **em toda fatura paga, qualquer que seja o tipo do plano de recompensas** (start/recorrente/híbrido). "Start é só bônus" é regra da cadeia que trouxe o assinante, não de quem trouxe a usina.

Revisão do dono, 07/10/2026:

10. **Contrato de Gestão de Créditos.** Desde `9c79356` (`main`, 06/10) ele é gerado no modal da usina, aba Contratos, opção "Gestão de Créditos" (`src/components/ContratoGestaoUsina.jsx`), mas continua sendo do fornecedor (`suppliers.contract_terms`, `signatures.document_type = 'gestao'`, Anexo II com todas as usinas dele). O plano da usina **de onde o contrato foi aberto** sugere os valores iniciais; eles continuam editáveis campo a campo e a edição grava em `suppliers.contract_terms` como hoje. O modelo de dados do contrato não muda.
11. **Cinco campos do contrato de gestão entram no plano de usina**: desconto ao consumidor, dia de corte, dia do repasse, prazo de transferência e prazo de honorários — com default do contrato atual (`DEFAULTS_FORNECEDOR`, `src/lib/contratoFornecedor.js`) e dentro da trava de versão. O foro continua fora do plano.

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
| `desconto_pct` | numeric NOT NULL default 20, 0–100 | contrato de gestão: desconto ao consumidor (Anexo I, cláusula 5.5 b) — decisão 11 |
| `dia_corte` | integer NOT NULL default 5, 1–31 | contrato de gestão: data de corte (cláusula 9.1 c) |
| `dia_repasse` | integer NOT NULL default 15, 1–31 | contrato de gestão: repasse até o dia (cláusula 9.2) |
| `prazo_transferencia_dias` | integer NOT NULL default 90, ≥ 0 | contrato de gestão: cláusula 13.2 (a) |
| `prazo_honorarios_dias` | integer NOT NULL default 180, ≥ 0 | contrato de gestão: cláusula 13.2 (b) |
| `originador_recorrente_pct` | numeric NOT NULL default 0, 0–100 | % recorrente do originador que trouxe a usina, sobre a base de cada fatura paga das UCs dela |
| `originador_bonus_fechamentos` | integer[] NOT NULL default `{}` | ordinais dos fechamentos **com saldo positivo** da usina cujo saldo é redirecionado do fornecedor para o originador (ex.: `{2}`) |
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
- **Sai** `usinas.plano_assinatura_id` (criada na branch do split, 0 de 10 preenchidas). Duas fontes para o mesmo vínculo repetiriam o defeito de `crm-comissao-duas-fontes`.
- `usinas.gestao_percentual` **fica** por ora: o fechamento mensal ainda lê dele (ver §5). Para o razão, deixa de valer quando a usina tem plano.
- `contract_terms` passa a guardar só os termos do projeto: parcelas 1–3, valor da opção do imóvel, amperagem, quantidade de inversores, prazos de execução e limite de reforço.

### No fornecedor (`suppliers`) — decisão 6b

- **Entra** `suppliers.originator_id` uuid FK `originators_v2` ON DELETE SET NULL. A usina herda pelo `supplier_id`.
- Só admin muda o originador de um fornecedor (gatilho, mesmo critério do vínculo da usina).
- A migração preenche a partir de `leads.originator_id` quando `suppliers.lead_id` existe e o fornecedor ainda não tem originador. Em 07/10/2026 isso alcança **um** fornecedor (José Gustavo Sosa Rivero → Bennaya Almeida); os outros seis não têm lead e o dono preenche à mão no cadastro do fornecedor.

### No originador (`originators_v2`)

Nada muda. A regra mora no plano da usina; o originador só é **apontado** por `suppliers.originator_id`.

### Plano padrão

A migração cria **"Plano Usina Padrão"** com os valores de `DEFAULTS_USINA` (`src/lib/contratosUsina.js`): recorrente 10%, administração R$ 10, recuperação 8%, rescisão 10%, atraso 0,5%/mês com teto 10%, garantia 12 meses; desconto 20%, corte dia 5, repasse dia 15, transferência 90 dias, honorários 180 dias (de `DEFAULTS_FORNECEDOR`); originador recorrente 0% e bônus `{}` (o dono preenche antes de vincular a primeira usina, enquanto o plano ainda é editável); `plano_assinatura_id` NULL; nenhuma usina vinculada.

## §2 Motor do split

### Resolução das regras

**Estado real em 06/10/2026** (levantado ao escrever o plano): desde o commit `64d668f` do `main` (03/10), o plano de assinatura é escolhido **na UC** (`consumer_units.plano_assinatura_id`, aba Financeiro do `ConsumerUnitModal`). 22 UCs estão no Plano Premium, e o motor novo já lançou 6 faturas reais (Bom Jesus e Bom Jesus II) em 06/10. Nenhuma usina tem `usinas.plano_assinatura_id`, e nenhum código do `main` grava essa coluna.

Resolução:

- **Plano de recompensas** = `COALESCE(consumer_units.plano_assinatura_id, planos_usina.plano_assinatura_id)` — o plano contratado pelo assinante **na UC tem precedência**; o do plano de usina é o padrão para UC sem plano próprio. `fn_plano_da_uc` troca só o join da usina (`usinas.plano_assinatura_id` → `usinas.plano_usina_id → planos_usina.plano_assinatura_id`).
- **Gestão B2W**: quando a usina tem plano de usina, `planos_usina.percentual_recorrente`, **igual em todos os níveis** — sobrescreve `regras_multinivel.b2w` e `gestao_percentual` do plano de recompensas resolvido, seja ele o da UC ou o da usina. `fn_regras_recompensa_uc` aplica a sobrescrita e devolve também `plano_usina_id` e `percentual_recorrente`. Só sobrescreve matriz válida: plano com `b2w.niveis` ausente continua caindo em `plano_sem_matriz`.
- **Bônus Start**: na fatura do Start, o `b2w` do `start_config` continua mandando (decisão de 29/09 sobre o Start); a gestão do plano de usina vale para a recorrência e para a fatura de plano `start` fora da janela.
- Matriz dos demais papéis, piso, desconto e `tipo_recompensa`: do plano de recompensas resolvido, como hoje.
- **Usina sem plano de usina**: comportamento atual — com plano na UC, gestão da matriz desse plano; sem plano nenhum, `uc_sem_plano` (fornecedor fica com o caixa, 3.1.1 = 0).
- O congelamento (`invoices.recompensas_aplicadas`) grava `plano_usina_id` e `percentual_recorrente` além do que já grava.

### Novo papel `originador_usina`

- **Quem**: `suppliers.originator_id` do fornecedor da usina da UC (`consumer_units.usina_id → usinas.supplier_id → suppliers`).
- **Percentual**: `planos_usina.originador_recorrente_pct`, injetado na matriz sintética como `originador_usina: {niveis: {L1: pct}, max_niveis: 1}`. Não é multinível; o líder dele não recebe nada por isso.
- **Base**: a mesma dos demais papéis (kWh compensado × tarifa líquida).
- **Tipo de plano**: entra em toda fatura paga, inclusive em plano `start` fora da fatura elegível (decisão 9).
- **Sem originador ou originador inativo** (decisão 6a): o participante entra com `suspenso = true` e o valor vai para a B2W (associação) pela absorção que o motor já faz nas supressões. Consequência: essa parte passa a ser da B2W e, como a B2W nunca é cortada, deixa de ser cortável — o teto pode estourar mais cedo, e o motor sinaliza em `teto_estourado`. O motor precisa aceitar `id` nulo em participante suspenso.
- **Corte**: primeiro da ordem — `fn_calcular_split_recompensa` passa de `['assinante_conect','parceiro','lider']` para `['originador_usina','assinante_conect','parceiro','lider']`. A B2W continua nunca cortada. No máximo um `originador_usina` por pagamento (mesma guarda que o motor já tem por categoria).
- **Lançamento**: conta 2.1.2, `reference_type = 'originator'`, `reference_id` = o originador. O mapa papel → conta do gatilho ganha a entrada; papel sem conta continua estourando (caso 14).
- `fn_participantes_recompensa` passa a incluir o participante sempre que o plano da usina tiver `originador_recorrente_pct` > 0 — com o originador, ou suspenso quando não houver.

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
   - **"Originador da usina" só para leitura**, mostrando o herdado do fornecedor (decisão 6b), com a indicação de onde se altera.
   - Os termos que vêm do plano aparecem só para leitura.
2a. **Cadastro do fornecedor (`SupplierModal`)**: campo **"Originador"** (originadores ativos), que grava `suppliers.originator_id`.
3. **Gerador do contrato de compra e venda** (`src/lib/contratosUsina.js`): `percentualRecorrente`, `taxaAdmin`, `taxaRecuperacao`, `retencaoRescisao`, `multaAtrasoMes`, `multaAtrasoTeto` e `garantiaInstalacaoMeses` saem do plano de usina quando a usina tem um; sem plano, os valores de hoje (`contract_terms` e `DEFAULTS_USINA`). A minuta editada (`contract_terms.minutas`) continua ganhando do texto automático.
4. **`PlanoUsinaModal`** ganha o bloco "Originador da usina": recompensa recorrente (%) e bônus de entrada (fechamentos nº), com o aviso de que, sem originador no fornecedor, os dois ficam para a associação; e os cinco campos do contrato de gestão (decisão 11). O cadastro do originador não muda.
5. **Contrato de Gestão de Créditos (`ContratoGestaoUsina`)** — decisão 10: recebe o plano da usina aberta e usa os oito termos que o plano tem (`desconto`, `percentualRecorrente`, `taxaAdmin`, `taxaRecuperacao`, `diaCorte`, `diaRepasse`, `prazoTransferencia`, `prazoHonorarios`) como **valor inicial**. Precedência por campo: o que está gravado em `suppliers.contract_terms` > o plano da usina aberta > `DEFAULTS_FORNECEDOR`. Sem plano, segue a sugestão de hoje (`usinas.gestao_percentual` como recorrente). A tela diz de qual plano vieram os valores sugeridos.
   - **Ponto de atenção registrado**: o `desconto` do plano de usina é termo do contrato; o motor continua calculando a base com o desconto do plano de recompensas (o da UC, ou o do plano de usina). O `PlanoUsinaModal` avisa quando os dois divergem.

## §4 Testes

- Arquivo novo `supabase/tests/plano_usina.test.sql`, no padrão da suíte (`DO $$ … RAISE EXCEPTION 'SANDBOX_OK'`):
  1. trava: plano sem usina edita; com usina, mudar número é recusado e mudar nome passa;
  2. vínculo recusado a plano `somente_contratos` e a plano sem plano de recompensas;
  3. gestão B2W lida do plano de usina (plano de usina 12% sobre plano de assinatura de 10% → 3.1.1 = 12% da base);
  4. `originador_usina` recebe o % do plano da usina em 2.1.2, inclusive em plano `start` fora da fatura elegível;
  5. corte: `originador_usina` é o primeiro drenado;
  6. originador inativo: parte vai para a B2W;
  6a. usina sem originador: parte vai para a B2W (3.1.1), nada em 2.1.2;
  7. usina sem plano de usina: comportamento atual inalterado;
  8. só admin muda `suppliers.originator_id`; o originador da usina é lido pelo fornecedor.
- As suítes existentes (`split_gatilho`, `split_bonus_start`, `split_base_compensada`, `split_conta_receber`, `split_piso_tarifa_bruta`, `invoice_paid_ledger_definer`) adaptadas ao vínculo via plano de usina e rodadas no banco com a saída colada verbatim.
- Razão de produção conferido antes e depois de cada migração (hoje 383 lançamentos / 139 transações / soma −10694,8082347826087400).

## §5 Fora desta branch — fechamento mensal

O fechamento mensal (`impl/fechamento-mensal`, segurada) precisa, quando entrar:

- ler a gestão de `planos_usina.percentual_recorrente` e **não descontar de novo** a gestão que o split já lançou na 3.1.1;
- cobrar `taxa_admin_reais` (× consumidores ativos) e `taxa_recuperacao_pct` do plano de usina;
- executar o bônus de entrada: no N-ésimo fechamento **com saldo positivo** da usina, com N em `planos_usina.originador_bonus_fechamentos`, o saldo vai ao originador (`suppliers.originator_id` do fornecedor da usina) em vez do fornecedor — **ou à associação, se a usina não tiver originador ou ele estiver inativo**. Mês com saldo zero ou negativo não conta.

**Risco conhecido**: se `impl/fechamento-mensal` entrar no `main` como está, ele desconta `usinas.gestao_percentual` sobre faturas pagas **e** o split já lançou a mesma gestão — cobrança em dobro. O dobro só se materializa quando se roda um fechamento de usina cujas faturas já passaram pelo motor novo; por isso a correção do fechamento tem de sair no mesmo dia que o split, para a janela ser só o intervalo entre os pushes.

**Decisão do dono (06/10/2026)**: hoje só 2 usinas estão em operação com assinantes pagantes. Se houver cobrança em duplicidade durante a implantação, o dono faz o estorno e informa, para registro no razão.

## Ordem de entrega

1. Migração de dados: `planos_usina`, travas, colunas novas, plano padrão, saída de `usinas.plano_assinatura_id`.
2. Motor: resolução via plano de usina, gestão do plano, papel `originador_usina`.
3. Telas de plano (aba Usinas, `PlanoUsinaModal`, nova versão).
4. Modal da usina (seletor do plano de usina, originador herdado) e cadastro do fornecedor (campo do originador).
5. Gerador do contrato de compra e venda e contrato de gestão sugerido pelo plano.
6. Revisão final.

---

## §6 Adendo de 10/10/2026 — decisões do dono após a revisão final

Este adendo **substitui** o que contradiz nas seções acima. Onde ele cala, vale o texto original.

### Decisões

12. **Cota de usina sem dono só vai à B2W se couber no teto** (resposta ao achado I1 da revisão final). A cota do originador da usina (e a do Líder dele, decisão 13) que fica sem dono — fornecedor sem originador, originador/Líder inativo ou ausente — deixa de engordar a B2W **antes** do corte. Ela entra como parcela da B2W **cortável e primeira da fila**; o que sobrar depois do corte vai à B2W. Assim o PPE/Líder do assinante nunca pagam por uma cota órfã. As demais supressões (PPP com licença vencida, Conect inativo, parceiro/Líder do assinante inativos) **continuam** indo inteiras à B2W, como hoje — substitui a "consequência" escrita em §2 › Novo papel.
13. **O Líder do originador da usina também recebe.** Novo papel `lider_originador_usina`: o `lider_id` do originador do fornecedor, desde que tenha cargo `lider` (mesma regra F3 do assinante). Percentual em `planos_usina.originador_lider_recorrente_pct` (default **0**; o dono configura depois). Só recorrência — o bônus de fechamento continua só do originador. Sem originador, sem Líder, Líder inativo ou Líder sem cargo `lider`: cota sem dono, decisão 12. Não é multinível. Substitui "o líder dele não recebe nada por isso" em §2.
14. **Fatura do Start**: o originador da usina e o Líder dele ficam **isentos do piso**, como o Start (teto = base). Confirmado — nada muda no motor.
15. **Originador copiado do lead, no servidor.** Fornecedor criado (ou atualizado) com `lead_id` e sem `originator_id` recebe `leads.originator_id` pelo próprio gatilho do fornecedor. A trava "só admin altera" aceita esse valor por vir do lead. O modal do fornecedor aberto a partir do lead já mostra o originador.
16. **Plano de assinatura só na UC, obrigatório.** O plano de assinatura (matriz PPE/PPP/PPF/Líder/Conect) é a única fonte das recompensas pagas a quem está ligado ao **assinante**; o plano de usina tem a sua própria regra, paga a quem está ligado ao **fornecedor** (originador e Líder). Portanto:
    - sai `planos_usina.plano_assinatura_id`; plano de usina aceita usina só por estar `ativo`;
    - plano de recompensas da UC = `consumer_units.plano_assinatura_id`, **sem fallback** (substitui o `COALESCE` de §2);
    - UC sem plano cai em `uc_sem_plano` como hoje (recebimento, concessionária e fornecedor lançados; nenhuma recompensa nem gestão);
    - obrigatoriedade: no banco, UC não geradora não entra nem fica em `ativo`, `em_atraso` ou `em_transf_titularidade` sem plano **numa escrita direta** (tela, RPC, SQL); mudança em cascata feita por outro gatilho (usina virando `gerando`, fatura vencida) passa com `RAISE WARNING`, para uma UC sem plano não travar a usina inteira — a fatura dela cai em `uc_sem_plano` até o plano ser escolhido. Na tela da UC o campo é obrigatório. O onboarding público (`fn_criar_assinante_publico`, que cria a UC em ativação sem plano) não muda. Em 10/10/2026 as 18 UCs beneficiárias em operação já têm plano.
17. **Trava de versão no plano de assinatura**, igual à do plano de usina:
    - plano com ao menos uma UC ou eletroposto vinculado não muda `desconto_assinante`, `tipo_recompensa`, `start_config`, `recorrente_config`, `gestao_percentual`, `piso_fornecedor_pct`, `modalidade`, `tarifa_motorista_kwh`, `recompensas_ativo`; nome e `ativo` continuam editáveis (hoje isso já vale para o Plano Premium, 22 UCs);
    - mudar número = **nova versão** (RPC no padrão de `fn_planos_usina_nova_versao`): nasce `ativo` com `substitui_plano_id`; a antiga vira `somente_contratos` e **mantém as UCs dela**;
    - UC ou eletroposto novo (ou troca de plano) só aponta para plano `ativo`; manter o plano atual numa edição da UC sempre passa;
    - mover UCs existentes para a versão nova é ato do admin, em lote, na tela de planos;
    - `planos_distribuidoras` (só diz em quais distribuidoras o plano é oferecido) e `leads.plano_id` ficam fora da trava.
18. **Líder de originador inativo não recebe** (dono, 12/10/2026: "o líder deve incentivar o originador a ficar ativo"). Originador do fornecedor ausente ou inativo → a cota de `lider_originador_usina` também fica sem dono (decisão 12). Migração `20261012d`.

### Dados (migração nova)

- `planos_usina`: **sai** `plano_assinatura_id`; **entra** `originador_lider_recorrente_pct numeric NOT NULL DEFAULT 0` (0–100), dentro da trava de versão.
- `planos_assinatura_energia`: **entram** `status text NOT NULL DEFAULT 'ativo'` (`ativo` | `somente_contratos`) e `substitui_plano_id uuid` (FK para a própria tabela).
- Gatilhos: trava do plano de assinatura; vínculo de UC/eletroposto a plano `ativo`; obrigatoriedade do plano na UC (decisão 16); cópia do originador do lead dentro de `fn_suppliers_originador_admin`. Ajustes em `fn_planos_usina_trava`, `fn_usinas_vinculo_plano_usina` e `fn_planos_usina_nova_versao` pela saída da coluna.

### Motor

- `fn_plano_da_uc`: só a UC.
- `fn_regras_recompensa_uc`: a gestão continua vindo do plano de usina (`percentual_recorrente`, todos os níveis, só sobre matriz válida); injeta `originador_usina` e `lider_originador_usina` na matriz quando os percentuais forem > 0.
- `fn_participantes_recompensa`: emite `lider_originador_usina` (nível 1) quando o plano de usina tem o percentual > 0, com `suspenso = true` e `id` nulo quando não houver Líder válido e ativo.
- `fn_calcular_split_recompensa`: participante suspenso dos papéis de usina (`originador_usina`, `lider_originador_usina`) não soma à B2W na 1ª passada; fica na fila de corte como parcela "a absorver pela B2W". Ordem de corte: `originador_usina` → `lider_originador_usina` → `assinante_conect` → parceiro → `lider`. Depois do corte, o que sobrou das parcelas a absorver entra em `b2w.valor` e `b2w.valor_absorvido`; o beneficiário suspenso continua saindo com `valor = 0`. No máximo um participante de cada papel de usina por pagamento.
- `handle_invoice_paid_ledger`: `lider_originador_usina` em 2.1.2, `reference_type = 'originator'`, descrição "Recompensa Líder do Originador da Usina (nível 1)"; nunca "Bônus Start". Versão gravada nova.

### Telas

- `PlanoUsinaModal` e lista: sai o seletor/coluna de plano de recompensas; entra "Líder do originador (%)". Vínculo em lote e `PowerPlantModal` deixam de exigir plano de recompensas no plano de usina.
- `ConsumerUnitModal`: plano de assinatura obrigatório; oferece só planos `ativo` (mantém o atual se for `somente_contratos`).
- Telas de plano de assinatura (`PlanModal`, `EletropostoPlanModal`, versão do `main`): plano com UC/eletroposto abre com os números travados e o botão **"Criar nova versão"**; lista mostra status e nº de UCs; ação **"Mover UCs para a versão nova"** (admin, em lote).
- `LeadsList`: ao converter lead em fornecedor, o modal já leva `originator_id` do lead.

### Testes

- `plano_usina.test.sql` ganha: cota órfã cortada antes do PPE sob teto apertado (números do Premium/Cosern: B2W 61,48, PPE 29,78, Líder 6,15, fornecedor 517,35); `lider_originador_usina` recebe; Líder inativo/ausente → cota órfã; cópia do originador do lead; trava e nova versão do plano de assinatura; vínculo de UC só a plano `ativo`; UC ativa sem plano recusada.
- As suítes existentes passam a dar plano de assinatura à UC nos fixtures (sem fallback da usina). Os casos de `uc_sem_plano` e o caso 1 do `split_gatilho` (que altera o plano depois de vinculado para provar o congelamento) se adaptam às travas novas sem mudar nenhum número esperado.
