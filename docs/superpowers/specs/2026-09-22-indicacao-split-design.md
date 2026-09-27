# Plano de Recompensas — implementação (subprojeto D)

Data: 22/09/2026 · **Reescrita em 27/09/2026** para implementar o `Plano de Recompensas/REGRAS_E_TABELAS_PLANO_DE_RECOMPENSAS.md` (commit `20e3a4b`), que substitui as regras da versão anterior desta spec.

Começa depois que o subprojeto A (adesão sem perdas) passar no teste real de ponta a ponta.

## Por que

O assinante passa a indicar, como o originador, e a divisão de cada fatura ganha níveis (L1 a L4+) com cargos. O documento oficial define a matriz; esta spec define **como implementá-la no banco e no CRM que existem hoje**.

Estado real em 27/09/2026:

- Quem paga comissão de verdade é `handle_invoice_paid_ledger` (SECURITY DEFINER desde 22/09), lendo `originators_v2.split_commission` e calculando `gestao = base × gestao_percentual − recorrente`. **Esse motor será reescrito.**
- `profiles.commission_split` + `superior_id` pertencem a um motor morto (`generate_monthly_commissions`).
- `subscribers.split_comissoes` está vazio nos 13 assinantes e ninguém lê.
- Existe a tabela `planos_assinatura_energia`. **Não existem** `planos_eletropostos`, `extrato_recompensas`, `tarifas_concessionarias` nem `unidades_consumidoras` — os nomes reais são `consumer_units`, `originators_v2`, `invoices` e `Concessionaria`.
- Não existem as colunas da árvore: `originators_v2.cargo`/`lider_id`, `consumer_units.indicado_por_uc_id`/`nivel_rede`/`plano_assinatura_id`.

## §1 A matriz

Base de cálculo líquida = **tarifa bruta da concessionária − Fio B − desconto do assinante**. Tudo abaixo incide sobre ela.

**Os níveis são relativos a quem recebe** (decisão do dono, 27/09/2026), não à profundidade absoluta da UC: cada beneficiário olha a distância entre ele e a UC que gerou a fatura. Por fatura, cada papel paga no máximo um beneficiário.

| Papel | Nível 1 (venda/indicação direta) | Nível 2 | Nível 3 | Nível 4+ |
|---|---:|---:|---:|---:|
| B2W (plataforma) | 10% | 10% | 10% | 10% (fixo, sem corte) |
| Líder | 1% | 1% | 1% | 0% |
| PPE — Parceiro Power Embaixador | 5% | 2% | 0% | 0% |
| PPP — Parceiro Power Pro | 4% | 2% | 0% | 0% |
| PPF — Parceiro Power Free | 2% | 2% | 0% | 0% |
| Assinante Conect | 2% | 0% | 0% | 0% |

- **Assinante Conect** recebe só pela indicação direta (`max_niveis: 1`), um por fatura: quem indicou aquela UC.
- **Dedução total por fatura:** 16% no pior caso (PPE direto), contra o teto de 22,3% que o piso do fornecedor permite na tarifa Cosern de referência.
- **Trava anti-déficit:** o líquido do fornecedor nunca fica abaixo do piso contratual (50% da tarifa bruta, configurável por plano). Se ficar, corta na ordem Assinante Conect → Parceiro Power → Líder, grava o corte na fatura e alerta no CRM. A B2W nunca fica negativa.
- **Vigência:** vitalícia enquanto a UC estiver ativa e adimplente **e** o recebedor estiver ativo. Sem trava de 48 meses.

### §1.1 Cargos de parceiro (hierarquia)

1. **PPF — Parceiro Power Free:** entrada gratuita, menor recorrência.
2. **PPP — Parceiro Power Pro:** intermediário; **exige licença anual paga**. O modal do originador ganha os campos da licença (valor, vencimento, situação) e mostra quando está vencida.
3. **PPE — Parceiro Power Embaixador:** topo dos parceiros, abaixo apenas do Líder. **Critério:** ser PPP e ter **1000 assinantes ativos na rede**, contando todos os níveis.
   - **Promoção automática, com registro:** ao cruzar o critério, o cargo passa a PPE sozinho e fica gravado no histórico quem era, quando mudou e qual a contagem no momento. Rebaixamento nunca é automático.

### §1.2 Bônus Start

Configurável por plano em `start_config`: até **3 faturas** elegíveis (`faturas_elegiveis`), com percentual por cargo em cada uma. Não é regra fixa: é possibilidade, e um plano pode não ter nenhuma.

O `originators_v2.split_commission.start` do motor antigo deixa de ser lido.

## §2 Onde a configuração vive

- Por plano, em `planos_assinatura_energia.recorrente_config` (`regras_multinivel`), como no documento: `b2w`, `lider`, `ppe`, `ppp`, `ppf`, `assinante_conect`, cada um com `max_niveis` e `niveis {L1..L4}`.
- A UC aponta para o plano (`consumer_units.plano_assinatura_id`). Sem plano, a UC usa o plano padrão; sem plano padrão, não há recompensa e a fatura registra o motivo.
- Cada fatura grava o percentual efetivo de cada beneficiário no momento do cálculo. Mudar o plano depois não reescreve o passado.
- `originators_v2.split_commission.recurrent` deixa de ser lido. `start` fica até a decisão do Bônus Start (§1).

## §3 A árvore

- `originators_v2` ganha `cargo` (`lider | ppe | ppp | ppf`) e `lider_id` (auto-relação).
- `consumer_units` ganha `indicado_por_uc_id` (a UC que indicou) e `nivel_rede` (1 a 4+, derivado por gatilho a partir do pai, com teto de profundidade para não percorrer ciclo).
- Guarda: `indicado_por_uc_id` não pode formar ciclo nem apontar para UC do mesmo assinante.
- O link de indicação do assinante (§4) é o que popula `indicado_por_uc_id`.

## §4 Link de indicação do assinante

- Ao virar `contrato_assinado`, o assinante ganha um link curto no YOURLS (mesmo mecanismo do `originador-short-url`), para `https://b2wenergia.com.br/?indicador=<subscriber_id>&name=<primeiro nome>`.
- A raiz (`Paginas/b2wenergia.assine`, branch `Home`) lê `indicador`, grava `leads.indicador_assinante_id` e repassa ao `/contrato`.
- `fn_criar_assinante_publico` aceita `p_indicador_assinante_id` (texto; UUID inválido é ignorado, como o originador). A UC criada recebe `indicado_por_uc_id` = primeira UC do indicador, e o assinante herda o `originator_id` do indicador quando não vier outro — é assim que o Parceiro Power e o Líder continuam na linha.
- Link e contagem de indicados aparecem no modal do assinante e no painel dele.

## §5 Como o Assinante Conect recebe

Decisão do dono (22/09, mantida): **abatimento na própria fatura**.

- Quando a fatura da UC indicada é paga, o motor lança o valor do Conect como saldo dele em `creditos_indicacao` (origem, valor, % usado).
- No cálculo da próxima fatura do indicador, o saldo é consumido como desconto, **limitado ao valor da fatura**. O excedente é descartado, não acumula, e o descarte fica registrado para aparecer no extrato.
- Contabilmente: na fatura de origem o valor vira obrigação com o assinante; o consumo na fatura dele baixa essa obrigação.

## §6 Tela "Equipe" do embaixador

`OriginatorList`, hoje no menu do papel `originator`, deixa de listar todos os embaixadores (era a brecha de CPF/PIX, fechada em 22/09) e passa a mostrar a rede dele:

- Indicados diretos: leads e assinantes com `originator_id` dele, com status e data.
- 2º nível em dropdown dentro de cada assinante direto: quem aquele assinante indicou, com status.
- Por linha: o percentual que ele recebe naquele nível e o valor lançado no mês.
- Sem CPF, PIX ou comissão de terceiros; dos indicados, só nome, cidade e status.

## §7 Split no modal do assinante

Em cada fatura, o quadro com as fatias, sempre lidas do que o razão lançou (nunca recalculadas na tela):

- Concessionária (conta de energia)
- Fornecedor (repasse ao investidor, com o superávit em relação ao piso)
- B2W (10% fixo)
- Líder
- Parceiro Power
- Assinante Conect

O modal também mostra o link de indicação (§4), o saldo de abatimento com extrato (§5) e o nível da UC.

## §8 Ordem, riscos e testes

- Começa depois do teste real do subprojeto A.
- **Substituição direta** (decisão do dono, 27/09/2026): como ninguém nunca foi pago pelo motor antigo, o gatilho passa a calcular só pela matriz nova. Os R$ 135,91 já lançados na conta 2.1.2 (8 lançamentos, abr–ago/2026) **ficam como estão**: o motor novo vale das próximas faturas em diante, e a decisão de pagar ou estornar é do dono.
- Cada linha da matriz do §1, a trava anti-déficit e o abatimento limitado são testados em blocos SQL `SANDBOX_OK` sobre faturas reais de cada tipo, comparando o razão antes e depois.
- Testes adicionais: nível derivado na árvore (incluindo tentativa de ciclo), percentual congelado na fatura, UUID inválido de indicador, UC sem plano, e originador inativo (não recebe).

## Fora do escopo

- Eletropostos (`planos_eletropostos`): o documento descreve, mas a tabela não existe e o produto não está no CRM.
- Pagamento por PIX ao assinante: a recompensa é só abatimento.
- Baixa do repasse ao originador no razão, ainda em aberto (memória `crm-comissao-duas-fontes`).
- `extrato_recompensas` como tabela separada: o razão (`ledger_entries`) continua sendo a fonte, e o extrato é uma leitura dele.
