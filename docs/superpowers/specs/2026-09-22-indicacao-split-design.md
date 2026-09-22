# Indicação pelo assinante e split de pagamentos — subprojeto D

Data: 22/09/2026 · Começa depois que o subprojeto A (adesão sem perdas) estiver publicado e aprovado no teste real.

## Por que

O assinante passa a ter link de indicação, como o originador. A recompensa de quem indica e a divisão de cada fatura precisam ser visíveis e configuráveis no CRM.

Estado de hoje (apurado em 22/09/2026):

- A comissão que é paga de fato vem de `originators_v2.split_commission` (`start`/`recurrent`), lançada no razão (conta 2.1.2) pelo gatilho de fatura paga `handle_invoice_paid_ledger`. Ver memória `crm-comissao-duas-fontes`.
- `profiles.commission_split` + `superior_id` pertencem a um motor morto (`generate_monthly_commissions`).
- `subscribers.split_comissoes` existe, está vazio nos 13 assinantes e nenhum código lê.
- Na fatura sem start, a recorrência já sai da gestão da B2W (`gestao = base × gestao_percentual − recorrente`).

## §1 Regras de recorrência

Base: a mesma base B que o gatilho de fatura paga usa hoje para comissão e gestão. Toda recompensa sai da gestão da B2W; fornecedor e concessionária nunca são afetados.

| Quem indicou o cliente Y | Originador recebe | Assinante que indicou recebe |
|---|---|---|
| Originador O, direto | 4% | — |
| Assinante X vinculado ao originador O | 2% | 2% (abatimento) |
| Assinante X sem originador | — | 2% (abatimento); os 2% do originador ficam na B2W |

- Um nível só: se Y indicar Z, quem recebe é Y (e o originador de Y, pela linha 2). X não recebe sobre Z.
- O start negociado por originador (hoje 100% da primeira fatura, ver memória `crm-comissao-duas-fontes`) continua como está. As regras acima são só a recorrência.
- Trava: originador + assinante ≤ `gestao_percentual` da usina da UC. Se passar, o assinante é cortado primeiro e depois o originador, até caber. O corte é gravado na fatura e aparece como alerta no CRM. A B2W nunca fica negativa.

## §2 Configuração

- Tela Configurações → Indicação, com três padrões globais: `originador_direto` = 4, `originador_via_assinante` = 2, `assinante` = 2.
- Exceção por pessoa: o modal do originador (recorrência direta e via assinante) e o modal do assinante (% como indicador) podem sobrescrever o padrão. Vazio = usa o padrão.
- Cada fatura grava o % efetivo de cada beneficiário no momento do cálculo. Mudar um padrão ou uma exceção vale só para faturas futuras.
- A fonte única da recorrência do originador passa a ser essa configuração (padrão + exceção). A chave `recurrent` de `originators_v2.split_commission` é migrada para a exceção do originador e deixa de ser lida; `start` continua em `split_commission`.

## §3 Link de indicação do assinante

- Ao virar `contrato_assinado`, o assinante ganha um link curto no YOURLS (mesmo mecanismo do `originador-short-url`), para `https://b2wenergia.com.br/?indicador=<subscriber_id>&name=<primeiro nome>`.
- A raiz (`Paginas/b2wenergia.assine`, branch `Home`) lê `indicador`, grava `leads.indicador_assinante_id` e repassa para o `/contrato`.
- `fn_criar_assinante_publico` aceita `p_indicador_assinante_id` (texto; UUID inválido é ignorado, como o originador). O assinante novo grava `subscribers.indicador_assinante_id` e herda `originator_id` do indicador quando não vier outro, que é como O recebe os 2%.
- Link e contagem de indicados aparecem no modal do assinante e no painel dele.

## §4 Abatimento do assinante

- Quando a fatura de Y é paga, o gatilho do razão lança o valor do assinante X como saldo de indicação de X, numa tabela `creditos_indicacao` (origem = fatura de Y, valor, % usado).
- No cálculo da próxima fatura de X, o saldo pendente é consumido como desconto, limitado ao valor da fatura de X. O que exceder é descartado: não acumula para o mês seguinte. O descarte é registrado no crédito (valor aplicado × valor descartado), para aparecer no extrato.
- Contabilmente, o valor sai da gestão da B2W na fatura de Y e vira uma obrigação com X; o consumo na fatura de X baixa essa obrigação. As contas do razão são definidas no plano, seguindo o plano de contas existente.

## §4.1 Tela "Equipe" do embaixador

Decisão do dono (22/09/2026): a tela `OriginatorList`, hoje no menu do papel `originator`, deixa de listar todos os embaixadores (era a própria brecha de CPF/PIX) e passa a mostrar a rede dele:

- **Indicados diretos:** leads e assinantes com `originator_id` dele, com status e data.
- **2º nível, em dropdown dentro de cada assinante direto:** quem aquele assinante indicou (`indicador_assinante_id`), com status.
- Por linha: o que ele recebe (4% direto, 2% quando vier de assinante) e o valor lançado no mês.
- Sem CPF, PIX ou comissão de terceiros — só da própria rede, e os dados pessoais dos indicados limitados a nome, cidade e status.

## §5 Split no modal

- Modal do assinante, em cada fatura: quadro com 5 fatias:
  - Concessionária (conta de energia)
  - Fornecedor (repasse ao investidor)
  - B2W (gestão líquida)
  - Originador
  - Assinante indicador
- Os valores vêm do que o razão lançou para aquela fatura, não de um recálculo na tela.
- O modal também mostra os campos de exceção de % (§2), o link de indicação (§3) e o saldo de abatimento com o extrato (§4).

## §6 Ordem e testes

- Começa depois que o A estiver publicado e aprovado no teste real.
- O D mexe no gatilho de fatura paga e no cálculo da fatura, que já movem dinheiro de verdade. Cada caso da tabela do §1 e a trava são testados em blocos SQL `SANDBOX_OK` (desfazem tudo), a partir de uma fatura real de cada tipo.
- Os testes cobrem ainda: o abatimento limitado ao valor da fatura, com o descarte registrado; o % gravado na fatura, que não muda quando o padrão muda; e o início por UUID inválido de indicador.

## Fora do escopo

- Pagamento de comissão por PIX ao assinante: a recompensa é só abatimento.
- Mais de um nível de indicação.
- Baixa do repasse ao originador no razão, que continua em aberto (memória `crm-comissao-duas-fontes`).
