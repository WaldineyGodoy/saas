# Histórico Integral Extraído do Link Compartilhado (Gemini)

> Fonte: https://share.gemini.google/aOsIfQmgoJxW

---

Gemini
About Gemini
Get Gemini App
Subscriptions
For Business
Sign in
Ramificação • Fluxo de Descontos e Indicações
https://share.gemini.google/UmhzBqAmsyVQ
Created with 3.8 Flash September 23, 2026 at 12:04 AM
Published September 24, 2026 at 10:23 AM
•••••••••
Uploaded image not shown
You said Essa imagem trata-se de uma estrutura de desconto em conta de energia para embaixadores, assinantes …

Essa imagem trata-se de uma estrutura de desconto em conta de energia para embaixadores, assinantes originadores e assinantes




Embaixadores indicam assinantes

Assinantes recebe desconto recorrente na conta de energia de 15% e o embaixador 4% de recorrência sobre o pagamento da fatura do assinante




Quando o assinante indica outro assinante ele se torna um assinante originador e fluxo passa a ser




Assinante recebe desconto recorrente na conta de energia de 15% Assinante originador recebe 2% e o embaixador continua recebendo 4% sobre o assinante originador e passa também a receber 2% de recorrência sobre o pagamento da fatura do assinante indicado pelo assinante originador




Reestruture esse fluxo e me gere um diagrama visual e bem elaborado

You said Me ajude a estruturar melhor Eu tenho uma margem em que posso dar 15% de desconto na assinatura da …

Me ajude a estruturar melhor

Eu tenho uma margem em que posso dar 15% de desconto na assinatura da conta de energia e 4% para distribuir entre embaixador e assinante originador e assinantes

Na estruturação 1 ficou da forma apresentada acima.




E se o novo assinante indicar e passar a ser originador , como ficaria sem estourar minha margem




Minha sugestão é que o embaixador deixe de receber após o Level 2




Como ficaria a situação do assinante originador level 1 ?




Me apresente sugestões com perguntas e após encontrar o modelo ideal

gere um novo diagrama ilustrativo

Essa é uma excelente decisão de modelagem de negócio! O seu limite financeiro por fatura é claro:

Desconto na ponta (para quem consome): 15% fixo.

Comissão de distribuição (pool de indicação): 4% no máximo, incidente sobre a fatura paga.

Para garantir sustentabilidade e evitar estouro de margem com o crescimento da rede (Level 3 em diante: Embaixador → Assinante 1 → Assinante 2 → Assinante 3), o segredo é trabalhar com uma regra fixa de até 2 níveis de repasse (Indicação Direta e Indicação Indireta).

Análise do Cenário: O que acontece quando o Assinante 2 indica o Assinante 3?

Se a fatura paga for do Assinante 3, temos R$ 4% disponíveis para remunerar a cadeia acima dele.

Aqui estão 3 sugestões práticas para você avaliar:

💡 Sugestão 1: Modelo "Janela Deslizante / 2 Níveis Locais" (Mais Recomendado)

Neste modelo, quem indica diretamente fica com a maior fatia e o anterior com o residual. O Embaixador só ganha até a 2ª linha dele (L1 e L2).

Fatura do Assinante 1:

Embaixador (indicação direta): 4%

Fatura do Assinante 2:

Assinante 1 / Originador L1 (indicação direta): 2%

Embaixador (indicação indireta / L2 dele): 2%

Fatura do Assinante 3:

Assinante 2 / Originador L2 (indicação direta): 2%

Assinante 1 / Originador L1 (indicação indireta): 2%

Embaixador: 0% (sai do fluxo nessa ponta, pois atingiu o teto de 2 níveis)

Total distribuído: Sempre 4%.

Vantagem: O Assinante 1 continua ganhando recorrência sobre quem o Assinante 2 indicou (L2 dele), mantendo-o motivado a ajudar a rede a crescer, sem que o Embaixador onere a operação indefinidamente.

💡 Sugestão 2: Modelo "Direto Forte + Residual Simples (2,5% + 1,5%)"

Se você quiser dar ainda mais força para quem traz o cliente na hora (indicação direta):

Fatura do Assinante 3:

Assinante 2 (quem indicou diretamente): 2,5%

Assinante 1 (indireto): 1,5%

Embaixador: 0%

Total distribuído: Sempre 4%.

Vantagem: Dá mais estímulo imediato para qualquer assinante indicar amigos (2,5% é mais atrativo que 2%).

💡 Sugestão 3: Modelo "Formato de Desconto Adicional na Conta"

Em vez de pagar comissão em dinheiro para o assinante comum, o bônus dele vira crédito na própria conta de energia:

Cada cliente indicado reduz em mais 2% a conta do Assinante Originador (podendo zerar a conta dele se ele indicar vários).

A regra de 4% de pool financeiro permanece rigorosamente igual.

Perguntas para alinharmos e definirmos o modelo ideal:

Sobre o Assinante 1 (Originador Level 1):

Você prefere que ele ganhe 2% fixo sobre as faturas do Assinante 3 (Modelo Janela Deslizante, Sugestão 1), mantendo a lógica de que todo mundo ganha de quem indicou (direto) e de quem o indicado indicou (indireto)?

Sobre o Embaixador:

Para você, faz sentido o Embaixador parar de receber no Level 3 (recebe apenas de L1 e L2)? (Isso protege a sua margem de 4% de forma definitiva).

Forma de Repasse:

O Assinante Originador recebe esses 2% em dinheiro/PIX ou como desconto/crédito adicional abatido da sua própria conta de energia?

Assim que você me disser qual dessas opções prefere (ou se quiser ajustar os percentuais de 2% / 2%), eu gero o diagrama visual atualizado e completo com toda a estrutura!

You said 1 - Sugestão 1 janela deslizante faz sentido 2 - Sim faz sentido o embaixador parar de receber em L…

1 - Sugestão 1 janela deslizante faz sentido

2 - Sim faz sentido o embaixador parar de receber em L3

O assinante originador para de receber em L2

3 - o assinante originador recebe como desconto na própria conta limitado ao valor da sua fatura do mês







Após o vc me apresentar o Diagrama

Iremos colocar a figura do coordenador que irá ficar com o residual de L3

O modelo com a Janela Deslizante (Pool de 4%) e a regra de crédito na fatura para os originadores ficou muito consistente e sustentável!

Aqui está o diagrama ilustrando essa mecânica:

Resumo Operacional da Estrutura
Origem do Pagamento	Desconto na Ponta	Quem Recebe Comissão / Bônus	Forma de Repasse	Total do Pool
Fatura Assinante 1 (L1)	15%	4% Embaixador (Indicação Direta)	Repasse em Dinheiro/Comissão	4%
Fatura Assinante 2 (L2)	15%	

• 2% Assinante 1 (Originador L1 - Direto)




• 2% Embaixador (Indireto L2)

	

• Crédito na fatura (limite valor conta)




• Dinheiro/Comissão

	4%
Fatura Assinante 3 (L3)	15%	

• 2% Assinante 2 (Originador L2 - Direto)




• 2% Assinante 1 (Originador L1 - Indireto L2)




• 0% Embaixador (Corte de margem atingido)

	

• Crédito na fatura (limite valor conta)




• Crédito na fatura (limite valor conta)




—

	4%
Próximo Passo: Inclusão do Coordenador

Com essa base pronta, podemos agora desenhar a entrada do Coordenador:

O Coordenador atuará acima do Embaixador (gerenciando a equipe de embaixadores)?

A remuneração dele virá de um percentual específico que "sobra" ou de uma nova fatia separada quando o Embaixador sai do fluxo em L3?

Como você prefere desenhar essa regra do Coordenador?

You said Na fatura do assinante 3 o assinante 1 não recebe 2% - Assinante 1 para de receber em L2

Na fatura do assinante 3 o assinante 1 não recebe 2% - Assinante 1 para de receber em L2

Perfeito! Esse ajuste simplifica bastante a matemática e abre a folga exata que você mencionou para o Coordenador.

Entendendo a regra de corte (Stop no L2):

Todo mundo só ganha até a sua segunda linha (L2):

Embaixador: Ganha no Assinante 1 (L1 dele) e no Assinante 2 (L2 dele). Para em L3.

Assinante 1 (Originador L1): Ganha apenas no Assinante 2 (que é o L1 dele). Como ele não ganha de L2 em diante (ou seja, não ganha do Assinante 3), ele sai do fluxo na fatura do Assinante 3!

Assinante 2 (Originador L2): Ganha no Assinante 3 (que é o L1 dele) via crédito na conta.

O Cenário da Fatura do Assinante 3 (L3):

Na fatura do Assinante 3, o pool de 4% se comporta assim:

Assinante 3 (Consumidor): 15% de desconto direto na fatura.

Assinante 2 (Originador direto): 2% (como crédito/abatimento na própria conta).

Assinante 1 (Originador L1): 0% (Corte: parou no L2 dele).

Embaixador: 0% (Corte: parou no L2 dele).

Residual Livre no Pool: Sobram 2% livres!

Alinhamento sobre o Coordenador:

Esses 2% residuais que sobraram da fatura do Assinante 3 vão integralmente para o Coordenador?

Além disso, para fecharmos a regra completa do Coordenador:

Nas faturas anteriores (L1 e L2): O Coordenador recebe alguma coisa (por exemplo, um percentual separado/override de gestão) ou ele atua puramente como "captador do residual" a partir de L3?

Do L3 em diante (L4, L5...): Se o Assinante 3 indicar o Assinante 4, o Coordenador continua com esse residual de 2% (ou mais)?

Assim que você confirmar como quer distribuir esse residual com o Coordenador, gero o diagrama visual atualizado e totalmente em português!

You said Gera uma nova imagem com a regra revisada

Gera uma nova imagem com a regra revisada

Aqui está o diagrama revisado com as regras atualizadas:

Resumo das Regras Revisadas:
Origem do Pagamento	Desconto na Ponta	Distribuição do Pool (Máx. 4%)	Modalidade	Status dos Cortes
Fatura Assinante 1	15%	• 4% Embaixador	Dinheiro / Comissão	Indicação direta do Embaixador
Fatura Assinante 2	15%	

• 2% Assinante 1 (Originador L1)




• 2% Embaixador (Indireto L2)

	

• Crédito na conta (teto fatura)




• Dinheiro / Comissão

	Embaixador recebe em L2
Fatura Assinante 3	15%	

• 2% Assinante 2 (Originador L2)




• 2% Coordenador (Residual)




• 0% Assinante 1




• 0% Embaixador

	

• Crédito na conta (teto fatura)




• Comissão residual




—




—

	

Corte aplicado:




• Assinante 1 para de receber




• Embaixador para de receber

O pool financeiro totaliza exatamente 4% em todas as faturas, assegurando que a margem nunca seja ultrapassada.

You said O coordenador receberá 1% na fatura Assinante 1, 2 e 3 Resumo Coordenador 1% ate L3 - para de rece…

O coordenador receberá 1% na fatura Assinante 1, 2 e 3




Resumo Coordenador 1% ate L3 - para de receber em L4

Resumo embaixador 4% em L1 , 2% em L2

Para de receber em L3

Assinante originador 2% em L1 para de receber em L2




Todos assinantes recebem 15% de desconto na conta de energia e as recompensas como dedução na fatura de energia limitado ao valor da fatura




O desconto de assinantes são aplicados sobre o valor da conta de energia na concessionária

Não aplicado sobre CIP ( iluminação pública)




As recompensas são aplicadas sobres os valores líquidos




Após dedução do desconto do assinante e Fio B




Ex:

Tarifa Cosern R$ 1,02

Desconto assinante 15% R$ 0,15

Fio B R$ 0,21




Base de cálculo de recompensa

R$ 0,66




Recorrência coordenador 1% R$ 0,006

Rocorrencia embaixador 4% R$ 0,026

Recorrência Assinante org. 2% R$ 0,013

Aqui está o diagrama completo e atualizado com as regras de corte, a base de cálculo líquida e a inclusão do Coordenador:   
agorarn.com.br
+ 5

1. Formação da Base de Cálculo Líquida (Exemplo Prático: Cosern)
Componente	Valor / Regra	Observação
Tarifa da Concessionária (ex: Cosern)	R$ 1,02 / kWh	Base bruta (excluída a CIP/Iluminação Pública)
(-) Desconto do Assinante (15%)	- R$ 0,15 / kWh	Abatimento aplicado diretamente na conta do assinante
(-) Fio B	- R$ 0,21 / kWh	Remuneração da distribuidora (custo regulatório)
(=) Base Líquida para Recompensas	R$ 0,66 / kWh	Valor real sobre o qual incidem os percentuais
2. Matriz de Distribuição por Nível de Fatura (L1, L2, L3 e L4)

Todos os valores em R$/kWh utilizam a base líquida de R$ 0,66/kWh.

Fatura Paga	Desconto na Ponta	Coordenador	Embaixador	Assinante Originador	Status de Cortes
Fatura Assinante 1 (L1)	15% (s/ CIP)	1% (R$ 0,006)	4% (R$ 0,026)	—	Entrada direta do Embaixador
Fatura Assinante 2 (L2)	15% (s/ CIP)	1% (R$ 0,006)	2% (R$ 0,013)	

2% (R$ 0,013)




(Assinante 1 - Crédito na fatura)

	Embaixador em L2; Assinante 1 em L1
Fatura Assinante 3 (L3)	15% (s/ CIP)	1% (R$ 0,006)	0% (Corte L3)	

2% (R$ 0,013)




(Assinante 2 - Crédito na fatura)

	

• Embaixador cortado




• Assinante 1 cortado (atingiu L2)


Fatura Assinante 4 (L4)	15% (s/ CIP)	0% (Corte L4)	0% (Corte)	

2% (R$ 0,013)




(Assinante 3 - Crédito na fatura)

	

• Coordenador cortado




• Cadeia anterior cortada

3. Regras de Travamento e Sustentabilidade Financeira

Assinantes (Benefício na Ponta):

Recebem sempre 15% de desconto incidente sobre a fatura de energia da concessionária (excluindo iluminação pública - CIP).

Ganhos de originador são creditados exclusivamente como dedução na própria fatura, travados ao teto mensal de consumo (não geram saldo devedor/reembolso em dinheiro).

Corte Rígido por Papel:

Assinante Originador: Ganha 2% apenas no seu L1 direto (para imediatamente em L2).

Embaixador: Ganha 4% em L1 e 2% em L2 (para em L3).

Coordenador: Ganha 1% fixo em L1, L2 e L3 (para em L4).

Carga Máxima de Bonificação:

L1: 4% + 1% = 5% sobre o líquido

L2: 2% + 2% + 1% = 5% sobre o líquido

L3: 2% + 1% = 3% sobre o líquido

L4 em diante: 2% = 2% sobre o líquido

You said Essa estrutura é sustentável?

Essa estrutura é sustentável?

A resposta direta é: sim, ela é altamente sustentável, desde que a sua usina tenha um custo de geração (ou custo de arrendamento/energia) compatível com a receita líquida restante.

Abaixo estão os pontos que comprovam a viabilidade e os riscos que você deve monitorar:

1. Por que a estrutura é financeiramente sólida?

Comissões incidem sobre a Base Líquida (o maior acerto do modelo):

Calcular os percentuais sobre R$ 0,66/kWh (já expurgados o Fio B e o desconto comercial do cliente) em vez da tarifa cheia blinda sua operação contra a inflação regulatória e evita que você pague comissão sobre encargos que não entram no seu caixa.

Carga de Bonificação com Teto Rígido (Sem Risco de Pirâmide):

L1: 4% + 1% = 5% sobre o líquido (R$ 0,033/kWh)

L2: 2% + 2% + 1% = 5% sobre o líquido (R$ 0,033/kWh)

L3: 2% + 1% = 3% sobre o líquido (R$ 0,019/kWh)

L4 em diante: Apenas 2% (R$ 0,013/kWh)

Isso significa que o custo de aquisição e retenção da sua rede diminui à medida que ela cresce em profundidade, o que melhora a sua margem ao longo do tempo.

Crédito em Fatura para Assinantes (Retenção e Caixa Fechado):

Ao travar o bônus do assinante originador como desconto na própria fatura (sem repasse em dinheiro via PIX/TED), você não drena caixa operacional e ainda reduz a taxa de evasão (churn), pois o assinante terá forte incentivo para continuar no clube e ver sua conta zerada ou reduzida.

2. Análise da Margem do Gerador / Operador

Considerando o seu exemplo da Cosern:

Tarifa Bruta da Distribuidora: R$ 1,020 / kWh

(-) Fio B (Custo regulatório de distribuição): R$ 0,210 / kWh

(-) Desconto Comercial do Assinante (15%): R$ 0,153 / kWh

Base Líquida Faturável: R$ 0,657 / kWh (arredondado para R$ 0,66)

(-) Custo Máximo do Pool de Comissões (5% em L1 e L2): R$ 0,033 / kWh

Receita Líquida Efetiva para a Usina/Operação: ~R$ 0,624 / kWh (ou ~R$ 624 / MWh)

Veredito de Margem: Uma receita de mais de R$ 600/MWh para GD Solar Compartilhada em baixa tensão é bastante saudável no mercado brasileiro, cobrindo com folga os custos operacionais (O&M, software de faturamento/gestão, inadimplência e custo de capital da usina).

3. Três Pontos Críticos de Atenção para Garantir a Sustentabilidade

Aumento Progressivo do Fio B (Lei 14.300):

Para usinas enquadradas na Lei 14.300 (protocoladas após janeiro/2023), o percentual de incidência do Fio B sobe anualmente até atingir 100% da componente tarifária em 2028/2029.

Solução: Como sua regra já deduz expressamente o Fio B antes de apurar a base líquida de comissões, a sua blindagem já está feita automaticamente.

Inadimplência do Assinante:

Embaixadores e Coordenadores só devem ter seus percentuais liberados após a efetiva liquidação financeira da fatura pelo assinante final. Se o cliente não pagar, a comissão não pode ser provisionada nem creditada.

ICMS e PIS/COFINS:

Certifique-se de que a apuração contábil e tributária (se a operação for via consórcio, cooperativa ou aluguel de equipamento) reflita adequadamente a base de emissão das notas fiscais de serviço para os embaixadores e coordenador.

A estrutura desenhada é segura, escalável e matematicamente travada contra déficits operacionais.

You said Uma pergunta sincera e direta Para o assinante 1 com consumo médio de 300 kWh é mais atrativo fina…

Uma pergunta sincera e direta

Para o assinante 1 com consumo médio de 300 kWh é mais atrativo financeiramente, receber 20% de desconto na tarifa da concessionária ou receber 15% de desconto na tarifa da concessionária + 2% (sobre base de cálculo) de 2 assinantes 2 indicados por ele

Ambos por período de 1 ano

Resposta direta e sincera: Para o Assinante 1, é muito mais atrativo financeiramente receber 20% de desconto fixo.

Abaixo estão os números exatos para comprovar isso:

Premissas Adotadas (Base Cosern):

Consumo do Assinante 1: 300 kWh/mês

Tarifa cheia: R$ 1,02 / kWh (sem CIP)

Fatura base na concessionária: 300 × R$ 1,02 = R$ 306,00 / mês

Base líquida para bonificação: R$ 0,66 / kWh

Bônus por indicação direta: 2% sobre R$ 0,66 = R$ 0,0132 / kWh

Período: 12 meses (1 ano)

Cenário A: Desconto Fixo de 20% na Tarifa

Desconto mensal na conta: 20% de R$ 306,00 = R$ 61,20 / mês

Economia anual total: 12 × R$ 61,20 = R$ 734,40

Esforço do cliente: Zero (nenhuma indicação necessária).

Cenário B: Desconto de 15% + 2% de Bônus sobre 2 Indicados

Desconto direto na conta (15%): 15% de R$ 306,00 = R$ 45,90 / mês

Agora, vamos calcular o bônus dos 2 indicados (considerando que cada um também consuma 300 kWh/mês):

Bônus gerado por 1 indicado: 300 kWh × R$ 0,0132 = R$ 3,96 / mês

Bônus dos 2 indicados juntos: 2 × R$ 3,96 = R$ 7,92 / mês

Total de benefício mensal no Cenário B:

R$ 45,90 (desconto direto) + R$ 7,92 (bônus das 2 indicações) = R$ 53,82 / mês

Economia anual total: 12 × R$ 53,82 = R$ 645,84

Comparativo Direto (Em 1 Ano):
Cenário	Benefício Mensal	Benefício Anual	Esforço Exigido
Cenário A (20% Fixo)	R$ 61,20	R$ 734,40	Nenhum
Cenário B (15% + 2 Indicados de 300 kWh)	R$ 53,82	R$ 645,84	Indicar e manter 2 clientes
Diferença (Vantagem para o Cenário A)	+ R$ 7,38 / mês	+ R$ 88,56 / ano	—
Onde está o "ponto de equilíbrio" (Breakeven)?

Para que o Cenário B comece a empatar com os 20% de desconto:

A diferença que o Assinante 1 precisa cobrir é de R$ 15,30 / mês (R$ 61,20 - R$ 45,90).

Como cada indicado de 300 kWh gera apenas R$ 3,96/mês, ele precisaria indicar 4 clientes de 300 kWh (ou 2 clientes comerciais que consumissem juntos cerca de 1.160 kWh/mês) apenas para empatar com a oferta de 20%.

Conclusão Comercial Prática:

Financeiramente: O cliente ganha mais e tem risco zero nos 20% fixos.

Do ponto de vista comercial/psicológico: Dificilmente um cliente residencial se dará ao trabalho de convencer dois conhecidos a assinar um contrato para economizar apenas R$ 7,92 a mais por mês.

Recomendação: Se a sua intenção é que o próprio assinante vire um divulgador ativo (Member-Get-Member), a recompensa unitária dele precisa parecer mais vantajosa (por exemplo: dar uma bonificação fixa em reais na fatura por indicação concluída, ou um percentual de 5% a 10% sobre a fatura do indicado nos primeiros 3 a 6 meses), ou simplesmente trabalhar com um desconto fixo mais agressivo se o objetivo for apenas fechar a venda rápida.

You said Perfeito o Breakeven 4 assinantes indicados Quantos assinantes com o mesmo perfil de consumo ele pr…

Perfeito o Breakeven 4 assinantes indicados

Quantos assinantes com o mesmo perfil de consumo ele precisa indicar para zerar sua fatura ?

Para o Assinante 1 zerar a fatura, vamos calcular o saldo restante que ele precisa abater por meio das indicações:

1. Saldo a Pagar da Fatura do Assinante 1

Consumo mensal: 300 kWh

Tarifa cheia: R$ 1,02 / kWh

Fatura bruta (sem CIP): 300 × R$ 1,02 = R$ 306,00

(-) Desconto automático de 15%: 15% de R$ 306,00 = R$ 45,90

Saldo restante da fatura a liquidar: R$ 306,00 - R$ 45,90 = R$ 260,10 / mês

2. Crédito Gerado por Cada Indicado (Perfil: 300 kWh)

Base líquida de cálculo: R$ 0,66 / kWh

Comissão/crédito do originador (2%): 2% de R$ 0,66 = R$ 0,0132 / kWh

Crédito gerado por 1 assinante indicado (300 kWh):

300 kWh×R$0,0132=R$3,96 / m
e
ˆ
s
3. Número de Indicados Necessários

Para cobrir os R$ 260,10 restantes:

R$3,96
R$260,10
	​

=65,68

Arredondando para cima, ele precisa indicar e manter ativos 66 assinantes com consumo de 300 kWh/mês para zerar integralmente sua fatura.

You said Então podemos presumir que para cada kWh consumido ele tem que indicar 66 kWh para zerar sua fatura …

Então podemos presumir que para cada kWh consumido ele tem que indicar 66 kWh para zerar sua fatura ?

Vamos calcular a relação exata entre o consumo próprio e o consumo indicado necessário:

Custo por kWh consumido pelo assinante:

Tarifa cheia: R$ 1,02 / kWh

(-) Desconto de 15%: R$ 0,153 / kWh

Saldo a pagar por cada kWh consumido:

1,02−0,153=R$0,867 / kWh

Crédito gerado por cada kWh indicado:

Base de cálculo líquida: R$ 0,66 / kWh

Recompensa de 2%:

0,66×0,02=R$0,0132 / kWh

Razão direta (kWh indicado necessário por kWh consumido):

R$0,0132
R$0,867
	​

≈65,68

Arredondando, a proporção é de 65,7 kWh indicados para cada 1 kWh consumido (ou 66 kWh para garantir a quitação completa).

Portanto, a conclusão está correta: para zerar a fatura, o volume total de energia consumido pela carteira de indicados precisa ser aproximadamente 66 vezes maior do que o consumo próprio dele.

You said Será ofertado 2 planos E Plano ultra com 15% de descontos para o assinante com recorrência de 2% p…

Será ofertado 2 planos




E Plano ultra com 15% de descontos para o assinante com recorrência de 2% para o assinante originador




A recorrência do coordenador e do embaixador já definidos acima




Plano Premium com 20% de desconto para o assinante sem recorrência




No premium o coordenador recebem 50% e o embaixador recebe também 50% da base de cálculo da fatura em pagamento único




Qual é o ponto de equilíbrio em meses para o plano ultra se assemelhar ao plano premium em rentabilidade para o coordenador e para o embaixador?

Para encontrar o ponto de equilíbrio (breakeven) em meses, vamos calcular a receita de cada um sob a mesma base de cálculo da fatura em ambos os planos.

1. Definição das Bases de Cálculo (por kWh)

Mantendo a tarifa de referência da Cosern de R$ 1,02/kWh e o Fio B de R$ 0,21/kWh:

Plano Ultra (15% de Desconto):

Desconto do assinante (15%): R$ 0,153/kWh

Fio B: R$ 0,210/kWh

Base líquida Ultra: 1,02−0,153−0,21=R$0,657 / kWh (aprox. R$ 0,66/kWh)

Plano Premium (20% de Desconto):

Desconto do assinante (20%): R$ 0,204/kWh

Fio B: R$ 0,210/kWh

Base líquida Premium: 1,02−0,204−0,21=R$0,606 / kWh

2. Ponto de Equilíbrio para o Embaixador

O Embaixador ganha no Plano Premium um pagamento único de 50% da base líquida do Premium. No Plano Ultra, ele recebe 4% recorrente em L1 (indicação direta).

Ganho Único no Premium:

Ganho 
U
ˊ
nico=50%×R$0,606=R$0,303 / kWh

Ganho Recorrente Mensal no Ultra (L1):

Ganho Mensal=4%×R$0,657=R$0,02628 / kWh

Cálculo do Breakeven:

Meses=
R$0,02628
R$0,303
	​

≈11,53 meses

Para um cliente de 300 kWh:

Ganho único no Premium: 300×R$0,303=R$90,90

Ganho mensal no Ultra: 300×R$0,02628=R$7,88 / m
e
ˆ
s

Veredito para o Embaixador: O ponto de equilíbrio é de 12 meses. A partir do 12º mês de contrato ativo, o Plano Ultra passa a ser mais lucrativo.

3. Ponto de Equilíbrio para o Coordenador

O Coordenador ganha no Plano Premium um pagamento único de 50% da base líquida do Premium. No Plano Ultra, ele recebe 1% recorrente por mês.

Ganho Único no Premium:

Ganho 
U
ˊ
nico=50%×R$0,606=R$0,303 / kWh

Ganho Recorrente Mensal no Ultra:

Ganho Mensal=1%×R$0,657=R$0,00657 / kWh

Cálculo do Breakeven:

Meses=
R$0,00657
R$0,303
	​

≈46,12 meses

Para um cliente de 300 kWh:

Ganho único no Premium: 300×R$0,303=R$90,90

Ganho mensal no Ultra: 300×R$0,00657=R$1,97 / m
e
ˆ
s

Veredito para o Coordenador: O ponto de equilíbrio é de 47 meses (quase 4 anos).

Comparativo Consolidado
Beneficiário	Ganho Único (Plano Premium)*	Ganho Mensal Recorrente (Plano Ultra)*	Ponto de Equilíbrio (Breakeven)
Embaixador (L1 - 4%)	R$ 90,90	R$ 7,88 / mês	12 meses
Coordenador (1%)	R$ 90,90	R$ 1,97 / mês	47 meses

*Valores simulados para um assinante padrão de 300 kWh/mês.

Insights Estratégicos do Modelo:

Para o Embaixador: O Plano Ultra é viável e atrativo a médio prazo (1 ano de contrato já empata com a bonificação imediata).

Para o Coordenador: O Plano Premium entrega liquidez imediata muito superior. No Plano Ultra, a rentabilidade do Coordenador só empata se a carteira tiver baixa taxa de cancelamento (churn) e contratos muito longos, a menos que ele compense isso pelo volume gerado pelas indicações indiretas da rede (L2 e L3).

You said Considere os ganhos L1 e L2 para o embaixador e ganhos L1, L2 e L3 para o coordenador e veja o Break…

Considere os ganhos L1 e L2 para o embaixador e ganhos L1, L2 e L3 para o coordenador e veja o Breakeven comparado ao plano premium

Para comparar com precisão os ganhos acumulados da rede no Plano Ultra frente ao Plano Premium, consideramos uma cadeia de 3 clientes (L1, L2 e L3), onde cada assinante consome a média de 300 kWh/mês.

1. Parâmetros e Bases Financeiras

Tarifa de Referência: R$ 1,02 / kWh (sem CIP)

Fio B: R$ 0,21 / kWh

Consumo por cliente: 300 kWh/mês

Bases Líquidas por Fatura

Plano Premium (20% desconto):

Base Premium=1,02−0,204−0,210=R$0,606 / kWh

Plano Ultra (15% desconto):

Base Ultra=1,02−0,153−0,210=R$0,657 / kWh
2. Ponto de Equilíbrio do Embaixador

O Embaixador recebe em L1 (4%) e L2 (2%), parando em L3.

Cenário Premium (Pagamento Único)

Hipótese A (Apenas no cliente direto L1):

50%×R$0,606×300 kWh=R$90,90

Hipótese B (Se receber pelos 2 clientes L1 + L2):

2×R$90,90=R$181,80
Cenário Ultra (Recorrência Mensal L1 + L2)

L1 (4%): 4%×R$0,657×300 kWh=R$7,88 / m
e
ˆ
s

L2 (2%): 2%×R$0,657×300 kWh=R$3,94 / m
e
ˆ
s

Total Mensal (L1 + L2): 7,88+3,94=R$11,83 / m
e
ˆ
s

Breakeven (Embaixador)

Comparando apenas com o ganho do direto (R$ 90,90):

R$11,83
R$90,90
	​

≈7,7 meses

Comparando com os 2 clientes no Premium (R$ 181,80):

R$11,83
R$181,80
	​

≈15,4 meses
3. Ponto de Equilíbrio do Coordenador

O Coordenador recebe 1% recorrente sobre L1, L2 e L3 no Plano Ultra.

Cenário Premium (Pagamento Único)

Hipótese A (Apenas na entrada do L1):

50%×R$0,606×300 kWh=R$90,90

Hipótese B (Sobre a entrada dos 3 clientes da cadeia):

3×R$90,90=R$272,70
Cenário Ultra (Recorrência Mensal L1 + L2 + L3)

Por cliente (1%): 1%×R$0,657×300 kWh=R$1,97 / m
e
ˆ
s

Total Mensal dos 3 clientes (L1 + L2 + L3):

3×R$1,97=R$5,91 / m
e
ˆ
s
Breakeven (Coordenador)

Comparando com 1 comissão Premium (R$ 90,90):

R$5,91
R$90,90
	​

≈15,4 meses

Comparando com os 3 clientes no Premium (R$ 272,70):

R$5,91
R$272,70
	​

≈46,1 meses
Síntese Comparativa
Papel	Ganho Mensal Recorrente (Ultra)	Breakeven vs. 1 Entrada Premium (R$ 90,90)	Breakeven vs. Entradas Totais da Rede no Premium
Embaixador (L1 + L2)	R$ 11,83 / mês	8 meses	16 meses (considerando 2 vendas)
Coordenador (L1 + L2 + L3)	R$ 5,91 / mês	16 meses	47 meses (considerando 3 vendas)

Para o Embaixador: A inclusão de L2 reduz o ponto de equilíbrio para 8 a 16 meses, tornando a recorrência competitiva e muito atrativa frente ao pagamento pontual.

Para o Coordenador: Como a taxa é de 1% diluída, o modelo Premium com pagamento único de 50% oferece um retorno imediato consideravelmente superior. No Plano Ultra, o Coordenador só empata se os contratos forem mantidos por cerca de 4 anos ou se o volume total da equipe for expressivamente alto.

You said Um detalhe o coordenador quando não possui o embaixador como intermediário na contratação do assinan…

Um detalhe o coordenador quando não possui o embaixador como intermediário na contratação do assinante o coordenador absorve a recorrência do Embaixador




Quando o Embaixador não tem coordenador a recorrência do coordenador retornar para a B2W




Para ser coordenador é necessário pagar o Premium Pass de R$ 1.900 que podem ser usado o pagamento embutido da comissão (start ) dos Planos premium para esse pagamento




Se um embaixador pertence a equipe do coordenador ascender a coordenação o valor do premium passa é revertido em 50% do valor ao coordenador como forma de indenização pela perda da força de trabalho




Monte um playbook com a estruturação, modelos e regras definidas até aqui

Playbook Comercial: Programa de Assinatura Solar B2W
1. Premissas Tarifárias e Base de Cálculo Líquida

As bonificações e descontos são calculados com base na fatura de energia da concessionária (exemplo de referência: Cosern), expurgada a Contribuição de Iluminação Pública (CIP). As comissões incidem estritamente sobre a base de cálculo líquida, após a dedução do desconto concedido ao cliente e do encargo regulatório de distribuição (Fio B).

Formação da Base de Cálculo (por kWh)

Tarifa de Referência (Cosern sem CIP): R$ 1,020 / kWh

(-) Fio B (Custo regulatório): R$ 0,210 / kWh

Parâmetro	Plano Ultra (15% Desconto)	Plano Premium (20% Desconto)
Desconto Comercial do Assinante	- R$ 0,153 / kWh (15%)	- R$ 0,204 / kWh (20%)
Base Líquida de Comissionamento	R$ 0,657 / kWh (~R$ 0,66)	R$ 0,606 / kWh
2. Portfólio de Ofertas ao Assinante
Plano Ultra

Desconto ao Assinante: 15% recorrente na tarifa de energia (sem CIP).

Mecânica Member-Get-Member (Originador): Permite indicar novos assinantes e receber 2% de bônus recorrente sobre a base líquida da fatura do indicado direto (L1).

Modalidade de Pagamento do Bônus: Exclusivamente como dedução na própria fatura de energia, limitado ao valor de consumo do mês (não gera repasse em dinheiro via PIX/TED).

Ponto de Equilíbrio de Quitação: A proporção para zerar a fatura é de 65,7 kWh indicados para cada 1 kWh consumido (aprox. 66 clientes com o mesmo perfil de consumo).

Plano Premium

Desconto ao Assinante: 20% fixo recorrente na tarifa de energia (sem CIP).

Mecânica de Indicação: Não participa do programa de recorrência para originadores.

Modelo de Comissionamento: Comissionamento de aquisição em pagamento único (upfront / start).

3. Matriz de Comissionamento e Regras de Transbordo
   [ Coordenador ] (1% Recorrente L1 a L3 | Cutoff em L4)
          │
   [ Embaixador ]  (4% em L1, 2% em L2    | Cutoff em L3)
          │
  [ Assinante 1 ]  (Originador: 2% em L1  | Cutoff em L2)
          │
  [ Assinante 2 ]  (Originador: 2% em L1  | Cutoff em L2)
          │
  [ Assinante 3 ]  (Consumidor ponta)

Regras do Plano Ultra (Recorrência Mensal)

Assinante Originador: Recebe 2% exclusivamente sobre as faturas do seu indicado direto (L1). Interrompe os ganhos a partir de L2.

Embaixador: Recebe 4% sobre a base líquida em L1 (indicação direta) e 2% em L2 (indicação indireta). Interrompe os ganhos em L3.

Coordenador: Recebe 1% fixo sobre a base líquida nas faturas de L1, L2 e L3. Interrompe os ganhos em L4.

Regras de Absorção e Retorno de Margem

Venda Direta do Coordenador (Sem Embaixador): Caso o Coordenador cadastre diretamente o assinante, ele absorve a comissão do Embaixador:

Em L1: Recebe 1% (coordenação) + 4% (embaixador) = 5% sobre o líquido.

Em L2: Recebe 1% (coordenação) + 2% (embaixador) = 3% sobre o líquido.

Em L3: Recebe 1% sobre o líquido.

Embaixador Sem Coordenador: A parcela de 1% destinada à coordenação retorna integralmente para a B2W.

Regras do Plano Premium (Pagamento Único / Start)

O pool de aquisição distribui 100% da base líquida de 1 fatura dividida igualmente entre a equipe comercial:

Embaixador: 50% da base líquida em parcela única (50%×R$0,606=R$0,303 / kWh).

Coordenador: 50% da base líquida em parcela única (50%×R$0,606=R$0,303 / kWh).

Em caso de venda direta pelo Coordenador (sem embaixador), ele absorve os 100% da base líquida (R$ 0,606 / kWh).

4. Carreira, Acesso e Transição (Premium Pass)
[ Embaixador ] ──(Paga R$ 1.900 ou retém comissões Premium)──> [ Novo Coordenador ]
       │
       └──> 50% (R$ 950) pago ao Coordenador original (Indenização)
       └──> 50% (R$ 950) retido pela B2W


Investimento de Adesão: Para ascender ao cargo de Coordenador, o profissional deve adquirir a licença Premium Pass por R$ 1.900,00.

Financiamento via Comissões: O valor do Premium Pass pode ser amortizado retendo o pagamento embutido da comissão única (start) proveniente das vendas do Plano Premium.

Indenização por Ascensão (Perda de Força de Trabalho):

Quando um Embaixador vinculado a um Coordenador ascende para a Coordenação:

50% do valor do Premium Pass (R$ 950,00) é revertido diretamente ao seu Coordenador de origem, como compensação pela perda da força produtiva na sua árvore.

50% do valor (R$ 950,00) permanece com a B2W.

5. Matriz Consolidada de Distribuição por Fatura

Distribuição percentual calculada sobre a base líquida de cada nível no Plano Ultra:

Fatura Geradora	Desconto na Conta	Assinante Originador	Embaixador	Coordenador	Carga Total do Pool
Assinante 1 (L1)	15%	—	4% (R$ 0,026/kWh)	1% (R$ 0,006/kWh)	5%
Assinante 2 (L2)	15%	2% (Assinante 1)	2% (R$ 0,013/kWh)	1% (R$ 0,006/kWh)	5%
Assinante 3 (L3)	15%	2% (Assinante 2)	0% (Cutoff L3)	1% (R$ 0,006/kWh)	3%
Assinante 4 (L4)	15%	2% (Assinante 3)	0% (Cutoff)	0% (Cutoff L4)	2%

Todas as bonificações financeiras externas (Embaixador e Coordenador) são pagas exclusivamente mediante a liquidação e confirmação de pagamento da fatura pelo assinante.

Gostaria de detalhar os prazos de repasse mensal (fechamento vs. pagamento) ou adicionar políticas contratuais de cancelamento e inadimplência ao playbook?

You said Gere uma apresentação no Notebook LLM deste playbook

Gere uma apresentação no Notebook LLM deste playbook

Para estruturar este conteúdo no NotebookLM, o ideal é organizar o playbook em formato de Briefing Executivo / Fonte Central de Conhecimento (Source Document). O NotebookLM processa melhor documentos que trazem títulos claros, seções bem delimitadas, tabelas e perguntas e respostas frequentes (FAQ), permitindo gerar resumos executivos, mapas conceituais e até o podcast (Audio Overview) com alta precisão.

Copie o conteúdo estruturado abaixo e cole diretamente em uma nova nota ou documento de texto para fazer o upload no NotebookLM:

PLAYBOOK COMERCIAL & MODELAGEM DE NEGÓCIOS: B2W ENERGIA SOLAR POR ASSINATURA
1. Visão Geral e Arquitetura Financeira

Este documento estabelece as regras de comissionamento, precificação, programas de incentivo (Member-Get-Member) e plano de carreira do programa de geração distribuída solar por assinatura da B2W.

Premissas Tarifárias e Base de Cálculo Líquida

Para blindar a operação contra variações de encargos setoriais e garantir a sustentabilidade de caixa, nenhuma comissão incide sobre a tarifa bruta. As comissões incidem estritamente sobre a Base de Cálculo Líquida Faturável, expurgando-se a Contribuição de Iluminação Pública (CIP), o Fio B (Lei 14.300) e o desconto do assinante.

Tarifa de Referência (Cosern sem CIP): R$ 1,020 / kWh

Custo Regulatório de Distribuição (Fio B): R$ 0,210 / kWh

Métrica Financeira	Plano Ultra (15% Desconto)	Plano Premium (20% Desconto)
Tarifa Bruta Concessionária	R$ 1,020 / kWh	R$ 1,020 / kWh
(-) Fio B	- R$ 0,210 / kWh	- R$ 0,210 / kWh
(-) Desconto Comercial do Assinante	- R$ 0,153 / kWh (15%)	- R$ 0,204 / kWh (20%)
(=) Base Líquida de Bonificação	R$ 0,657 / kWh (~R$ 0,66)	R$ 0,606 / kWh
2. Portfólio de Ofertas ao Assinante Final
Plano Ultra (Foco em Viralidade e Retenção)

Desconto: 15% recorrente na tarifa de energia da concessionária (sem CIP).

Mecânica Member-Get-Member (Originador): O assinante que indicar outro cliente torna-se um Assinante Originador, recebendo 2% de bônus recorrente sobre a base líquida da fatura do indicado direto (Nível 1).

Forma de Liquidação do Bônus: Exclusivamente como abatimento em crédito na própria fatura de energia, com teto limitado ao valor do seu consumo mensal (sem repasse financeiro via PIX/TED).

Regra de Quitação (Conta Zerada): A proporção para zerar a fatura é de 65,7 kWh indicados para cada 1 kWh consumido (aproximadamente 66 assinantes com perfil similar de consumo).

Plano Premium (Foco em Conversão Imediata e Caixa)

Desconto: 20% fixo recorrente na tarifa de energia da concessionária (sem CIP).

Mecânica de Indicação: Não participa do programa de recorrência para originadores.

Modelo de Comissionamento: Comissionamento de aquisição em pagamento único (start / upfront).

3. Matriz de Comissionamento e Cadeia de Repasse
[ COORDENADOR ] ──> 1% Recorrente sobre L1, L2 e L3 (Corte no L4)
       │
[ EMBAIXADOR ]  ──> 4% Recorrente em L1 | 2% Recorrente em L2 (Corte no L3)
       │
[ ASSINANTE 1 ] ──> Originador: 2% Recorrente em L1 (Corte no L2 via Crédito em Conta)
       │
[ ASSINANTE 2 ] ──> Originador: 2% Recorrente em L1 (Corte no L2 via Crédito em Conta)
       │
[ ASSINANTE 3 ] ──> Assinante Ponta (Desconto de 15% na Fatura)

Regras de Distribuição no Plano Ultra (Recorrência Mensal)

Assinante Originador: Ganha 2% exclusivamente no seu indicado direto (L1). Encerra o ganho no L2.

Embaixador: Ganha 4% em L1 (indicação direta) e 2% em L2 (indicação indireta). Encerra o ganho no L3.

Coordenador: Ganha 1% fixo em L1, L2 e L3 da rede de seus embaixadores. Encerra o ganho no L4.

Tabela de Distribuição do Pool por Fatura (Plano Ultra)

Valores em R$/kWh baseados na base líquida de R$ 0,657/kWh.

Nível da Fatura	Assinante Consumidor	Assinante Originador	Embaixador	Coordenador	Carga Total do Pool
Fatura L1 (Assinante 1)	15% Desconto	—	4% (R$ 0,026/kWh)	1% (R$ 0,006/kWh)	5% Líquido
Fatura L2 (Assinante 2)	15% Desconto	2% crédito (Assinante 1)	2% (R$ 0,013/kWh)	1% (R$ 0,006/kWh)	5% Líquido
Fatura L3 (Assinante 3)	15% Desconto	2% crédito (Assinante 2)	0% (Corte de nível)	1% (R$ 0,006/kWh)	3% Líquido
Fatura L4 em diante	15% Desconto	2% crédito (Assinante 3)	0% (Corte de nível)	0% (Corte de nível)	2% Líquido
Regras de Absorção e Vacância

Venda Direta do Coordenador (Sem Embaixador): O Coordenador absorve integralmente a comissão de Embaixador:

L1 Direto: 1% (coordenação) + 4% (embaixador) = 5% sobre o líquido.

L2 Indireto: 1% (coordenação) + 2% (embaixador) = 3% sobre o líquido.

L3 Indireto: 1% sobre o líquido.

Embaixador Sem Coordenador: A parcela de 1% que seria destinada à coordenação retorna automaticamente para a margem da B2W.

Regras de Distribuição no Plano Premium (Pagamento Único / Start)

O comissionamento é pago em cota única sobre 100% da base líquida da primeira fatura (R$ 0,606 / kWh):

Embaixador: 50% da base líquida em pagamento único (R$ 0,303 / kWh).

Coordenador: 50% da base líquida em pagamento único (R$ 0,303 / kWh).

Em vendas diretas do Coordenador, este absorve 100% da cota única (R$ 0,606 / kWh).

4. Plano de Carreira e Governança (Premium Pass)
[ EMBAIXADOR ATIVO ] ───> Adquire o Premium Pass (R$ 1.900,00) ───> [ NOVO COORDENADOR ]
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
50% (R$ 950,00) ao Coordenador Antigo                50% (R$ 950,00) Retido pela B2W
(Indenização por quebra de equipe)                   (Taxa administrativa / Sistema)


Investimento de Habilitação: A posição de Coordenador exige a aquisição da licença Premium Pass no valor de R$ 1.900,00.

Mecanismo de Financiamento por Vendas: O Embaixador pode financiar a licença utilizando o saldo acumulado das comissões únicas de vendas do Plano Premium.

Indenização por Perda de Força Produtiva: Caso um Embaixador atinja a qualificação e se torne Coordenador, ele se desvincula da árvore de seu antigo líder. Para compensar essa perda:

R$ 950,00 (50%) são creditados diretamente ao antigo Coordenador como verba indenizatória.

R$ 950,00 (50%) são retidos pela B2W para custeio operacional e infraestrutura de rede.

5. Análise de Ponto de Equilíbrio (Breakeven) Comercial

Cenário base: Cliente padrão com consumo de 300 kWh/mês.

Embaixador (Ultra Recorrente vs. Premium Único):

O pagamento único no Premium rende R$ 90,90.

No Ultra, gerando L1 (4%) e L2 (2%), o ganho mensal combinado é de R$ 11,83/mês.

Breakeven: O modelo recorrente supera a comissão única a partir de 8 meses (considerando 1 entrada direta) ou 16 meses (caso compare com 2 entradas diretas).

Coordenador:

O pagamento único no Premium rende R$ 90,90.

No Ultra, recebendo 1% sobre L1, L2 e L3, o ganho mensal total é de R$ 5,91/mês.

Breakeven: Atingido em 16 meses (contra 1 entrada direta) ou 47 meses (contra as 3 entradas únicas da cadeia). O Coordenador foca em escala e volume para viabilizar sua receita recorrente.

6. FAQ Estrutural para Treinamento e IA

P: Por que o desconto do originador não é pago via PIX?

R: Para evitar dreno de caixa, simplificar a contabilidade da operação e maximizar a retenção (LTV), já que o assinante mantém a fidelidade para abater sua própria conta.

P: Há risco de déficit se a rede crescer até o Nível 10?

R: Não. Como o Embaixador é cortado no L3, o Originador no L2 e o Coordenador no L4, a carga máxima sobre a base líquida diminui com a profundidade, estabilizando em apenas 2% a partir de L4.

P: Quando as comissões são liberadas?

R: Exclusivamente após a compensação bancária e confirmação de pagamento da fatura pelo assinante final. Inadimplência suspende bonificações imediatas e acumuladas.

Como usar no NotebookLM:

Acesse o Google NotebookLM e crie um novo caderno.

Adicione este texto como Fonte (Source) colando diretamente na opção Copied Text (Texto Copiado).

Na barra de ferramentas lateral, você poderá:

Clicar em Generate Audio Overview para ouvir um podcast em duas vozes debatendo a viabilidade deste modelo.

Gerar automaticamente Study Guides, Briefing Documents e simular perguntas sobre regras de corte e remuneração da equipe.

You said Me apresente uma solução para o Legado das recorrências quando o embaixador ascender a coordenação. …

Me apresente uma solução para o Legado das recorrências quando o embaixador ascender a coordenação.




Como ficaria as recorrências atuais dele como embaixador quando virar coordenador?




Acumula ? Deixa de receber como embaixador?

A melhor prática para não desestimular o embaixador a crescer e, ao mesmo tempo, proteger rigorosamente a margem líquida da B2W é aplicar o princípio dos Direitos Adquiridos com Congelamento de Função (Safra Fechada).

Se o embaixador perdesse a carteira que construiu, ele simplesmente recusaria a promoção para Coordenador (ou abriria outra conta no nome de um parente). Se ele apenas acumulasse os papéis indefinidamente sem travas, a margem de 5% estouraria.

A Solução Recomendada: Modelo de "Safra Fechada" (Grandfathering)

O profissional separa a atuação em dois momentos: Carteira Legada (Safra Passada) e Nova Produção (Safra Futura).

                  MOMENTO DA PROMOÇÃO (Compra do Premium Pass)
                                      │
     ┌────────────────────────────────┴────────────────────────────────┐
     ▼                                                                 ▼
[ CARTEIRA LEGADA ]                                            [ NOVA PRODUÇÃO ]
Mantém as regras de Embaixador:                                Atua 100% como Coordenador:
• L1: 4% até L2 atingir o corte                               • L1 a L3: 1% de Coordenação
• L2: 2% até L3 atingir o corte                               • Venda Direta s/ Embaixador: 5% (L1) / 3% (L2)
• Não adiciona 1% de coordenador em cima                      • Forma nova equipe de Embaixadores

1. Como funciona na prática?
A. Carteira Legada (Clientes trazidos ANTES da promoção)

Regra de Pagamento: Mantém os percentuais originais de Embaixador (4% no L1 dele e 2% no L2 dele).

Trava de Margem: Ele NÃO acumula o 1% de Coordenador sobre essa carteira legada. Como esses contratos já foram precificados com o Coordenador anterior recebendo o 1% correspondente (ou retido pela B2W), adicionar +1% romperia o teto do pool.

Ciclo Natural de Encerramento: Como os originadores dessa base continuam crescendo e atingindo os níveis de corte (L3 para o embaixador), a carteira legada vai naturalmente reduzindo o pagamento com o tempo, sem gerar passivo perpétuo.

B. Nova Produção (Clientes trazidos APÓS virar Coordenador)

Como Gestor de Equipe: Recebe 1% sobre L1, L2 e L3 das faturas geradas pelos novos embaixadores que ele recrutar.

Em Vendas Pessoais Diretas (sem embaixador intermediário): Aplica-se a regra de absorção já aprovada: recebe 5% em L1, 3% em L2 e 1% em L3.

2. Análise Comparativa dos 3 Modelos Possíveis
Modelo	Mecânica	Impacto no Caixa / Margem	Engajamento Comercial	Veredito
1. Safra Fechada (Recomendado)	Mantém o ganho de Embaixador na base antiga (4%/2%) e inicia como Coordenador apenas para a base nova.	Risco Zero: A margem continua cravada no teto de 5%.	Máximo: Sente-se seguro para promover e expandir.	Ideal
2. Perda Imediata da Carteira	Corta os 4% e 2% antigos; passa a receber apenas 1% de tudo.	Margem da B2W aumenta, mas gera atrito jurídico/comercial.	Péssimo: O embaixador recusa a promoção para não perder renda.	Inviável
3. Acúmulo Integral Irrestrito	Recebe 4% + 1% em toda a base antiga e nova simultaneamente.	Estouro de Caixa: Custo do pool sobe para 6% em contratos antigos.	Alto, porém destrutivo para a empresa.	Inviável
3. Cláusula Regulatória Sugerida para o Playbook

"Cláusula de Transição de Carreira e Carteira Legada:

Ao adquirir o Premium Pass e ascender ao cargo de Coordenador, o profissional mantém integralmente o direito à percepção dos honorários recorrentes da sua carteira de assinantes originada na condição de Embaixador, respeitadas as alíquotas originais (4% em L1 e 2% em L2) e as regras ordinárias de corte por nível.

Sobre a referida carteira legada, é vedada a sobreposição ou cumulatividade do adicional de 1% de Coordenação. O comissionamento de coordenação (1%) incidirá exclusivamente sobre as ativações ocorridas sob sua nova árvore de liderança após a data de homologação do status de Coordenador."

Deseja manter o Modelo de Safra Fechada como padrão definitivo para incluir na seção de Governança do Playbook?

You said E como fica as recorrências L1, L2 e L3 do Coordenador que teve um embaixador que ascendeu a coorde…

E como fica as recorrências L1, L2 e L3 do Coordenador que teve um embaixador que ascendeu a coordenação?

Segue a mesma política de safra fechada ?

Sim, segue exatamente a mesma política de Safra Fechada (Grandfathering).

Essa regra é indispensável para evitar que o Coordenador tente segurar ou boicotar o crescimento dos seus melhores embaixadores por medo de perder a receita que já ajudou a construir.

Mecânica da Safra Fechada para o Coordenador

Quando o Embaixador se torna um novo Coordenador, a relação entre eles é dividida em dois momentos:

                      MOMENTO DA ASCENSÃO DO EMBAIXADOR
                                      │
     ┌────────────────────────────────┴────────────────────────────────┐
     ▼                                                                 ▼
[ CARTEIRA LEGADA / BASE ANTIGA ]                             [ NOVA PRODUÇÃO / BASE FUTURA ]
Contratos ativados antes da promoção:                         Contratos ativados após a promoção:
• Coordenador Mantém 1% em L1, L2 e L3                        • Novo Coordenador ganha autonomia de liderança
• Respeita as regras normais de corte                         • Coordenador antigo recebe a Indenização de R$ 950
• Margem B2W blindada (já provisionada)                       • Sem sobreposição perpétua de coordenação

1. Na Carteira Legada (Contratos fechados ANTES da promoção)

O Coordenador antigo continua recebendo o seu 1% recorrente sobre os assinantes ativos daquela árvore (L1, L2 e L3).

Por que isso é seguro para a B2W? Porque o pool de 5% sobre a base líquida desses contratos já foi desenhado com essa fatia de 1% alocada para ele. Manter o repasse não aumenta em nada os custos da empresa.

Término natural: À medida que esses contratos chegam aos limites de nível (L4 para coordenação) ou sofrem cancelamento natural (churn), a comissão vai cessando organicamente.

2. Na Nova Produção (Contratos fechados APÓS a promoção)

O novo Coordenador agora forma a sua própria liderança independente.

Os novos embaixadores e clientes trazidos por ele passam a pagar o 1% de coordenação diretamente a ele, e não mais ao Coordenador antigo.

O papel da Indenização de R$ 950,00: Os 50% do Premium Pass pagos ao antigo Coordenador servem exatamente para quitar antecipadamente a "perda da força de trabalho futura" dessa linha que se emancipou.

Resumo Comparativo: O que acontece na Transição
Elemento Financeiro	Regra Aplicada	Justificativa Comercial
Recorrência Antiga (L1, L2, L3)	Mantida integralmente para o Coordenador original até os cortes naturais de nível.	Segurança jurídica e estímulo à liderança (o líder não é punido pelo sucesso do liderado).
Produção Nova da Equipe	Desvinculada. O 1% da nova produção fica com o novo Coordenador.	Evita criar múltiplos níveis de gerência que estourariam a margem da B2W.
Compensação Imediata	R$ 950,00 à vista (50% do Premium Pass) repassados ao Coordenador original.	Liquidez imediata para compensar o descolamento da árvore.

Essa combinação entrega o melhor dos dois mundos: paz operacional (ninguém perde o que já conquistou) e orçamento protegido (a B2W nunca paga mais de 1% de coordenação em nenhuma fatura).

You said Atualize o playbook com essas novas diretrizes de safra fechada - gere o playbook completo - planos …

Atualize o playbook com essas novas diretrizes de safra fechada - gere o playbook completo - planos , recorrências , Níveis de recorrência e legado de carteira ( safra fechado )

PLAYBOOK COMERCIAL & GOVERNANÇA: B2W ENERGIA SOLAR POR ASSINATURA
1. Premissas Tarifárias e Base de Cálculo Líquida

As bonificações e descontos são calculados com base na fatura de energia da concessionária (referência: Cosern), expurgada a Contribuição de Iluminação Pública (CIP). Para blindar a operação contra variações tributárias ou elevações regulatórias, todas as comissões incidem estritamente sobre a Base de Cálculo Líquida Faturável, após dedução do desconto comercial do assinante e do encargo de distribuição (Fio B - Lei 14.300).   
JPG
+ 1

Composição da Tarifa e Deduções Estruturais

Tarifa de Referência (Cosern sem CIP): R$ 1,020 / kWh   
JPG

Custo Regulatório de Distribuição (Fio B): R$ 0,210 / kWh   
JPG

Métrica Financeira	Plano Ultra (15% Desconto)	Plano Premium (20% Desconto)


Tarifa Bruta Concessionária

 
JPG

	

R$ 1,020 / kWh 
JPG

	R$ 1,020 / kWh


(-) Fio B

 
JPG

	

- R$ 0,210 / kWh 
JPG

	- R$ 0,210 / kWh


(-) Desconto Comercial do Assinante

 
JPG

	

- R$ 0,153 / kWh (15%) 
JPG

	- R$ 0,204 / kWh (20%)


(=) Base Líquida de Bonificação

 
JPG

	

R$ 0,657 / kWh (~R$ 0,66) 
JPG

	R$ 0,606 / kWh
2. Portfólio de Ofertas ao Assinante Final
Plano Ultra (Foco em Viralidade e Retenção)

Desconto ao Assinante: 15% recorrente na tarifa de energia da concessionária (sem incidência sobre a CIP).   
JPG

Mecânica Member-Get-Member (Originador): O assinante que indicar outro cliente torna-se um Assinante Originador, recebendo 2% de bônus recorrente sobre a base líquida da fatura do indicado direto (Nível 1).   
JPG

Modalidade de Pagamento: Exclusivamente como dedução na própria fatura de energia, limitado ao valor total da conta do mês (não gera repasse financeiro via PIX/TED nem saldo devedor acumulado).

Regra de Quitação (Conta Zerada): A proporção para liquidar 100% da própria fatura é de 65,7 kWh indicados para cada 1 kWh consumido (aproximadamente 66 clientes de perfil idêntico de consumo).

Plano Premium (Foco em Conversão Rápida e Liquidez)

Desconto ao Assinante: 20% fixo recorrente na tarifa de energia da concessionária (sem CIP).

Mecânica de Indicação: Não participa do programa de recorrência para originadores.

Modelo de Comissionamento: Comissionamento de aquisição em pagamento único (start / upfront).

3. Matriz de Comissionamento e Regras de Níveis
[ COORDENADOR ] ──> 1% Recorrente sobre L1, L2 e L3 (Corte no L4)
       │
[ EMBAIXADOR ]  ──> 4% Recorrente em L1 | 2% Recorrente em L2 (Corte no L3)
       │
[ ASSINANTE 1 ] ──> Originador: 2% Recorrente em L1 (Corte no L2 via Crédito)
       │
[ ASSINANTE 2 ] ──> Originador: 2% Recorrente em L1 (Corte no L2 via Crédito)
       │
[ ASSINANTE 3 ] ──> Assinante de Ponta (15% de Desconto na Fatura)

Regras do Plano Ultra (Recorrência Mensal)

Assinante Originador: Ganha 2% exclusivamente no seu indicado direto (L1). Encerra os ganhos a partir de L2.   
JPG
+ 1

Embaixador: Ganha 4% em L1 (indicação direta) e 2% em L2 (indicação indireta). Encerra os ganhos em L3.   
JPG
+ 1

Coordenador: Ganha 1% fixo em L1, L2 e L3 da rede de seus embaixadores. Encerra os ganhos em L4.   
JPG

Tabela de Distribuição do Pool por Fatura (Plano Ultra)

Valores unitários calculados sobre a base líquida de R$ 0,657/kWh.

Nível da Fatura	

Assinante Consumidor 
JPG

	

Assinante Originador 
JPG

	

Embaixador 
JPG

	

Coordenador 
JPG

	Pool Total da B2W


Fatura L1 (Assinante 1)

 
JPG

	

15% Desconto 
JPG

	—	

4% (R$ 0,026/kWh) 
JPG

	

1% (R$ 0,006/kWh) 
JPG

	5% Líquido


Fatura L2 (Assinante 2)

 
JPG

	

15% Desconto 
JPG

	

2% crédito (Assinante 1)

 
JPG

	

2% (R$ 0,013/kWh) 
JPG

	

1% (R$ 0,006/kWh) 
JPG

	5% Líquido


Fatura L3 (Assinante 3)

 
JPG

	

15% Desconto 
JPG

	

2% crédito (Assinante 2)

 
JPG

	

0% (Corte de nível)

 
JPG

	

1% (R$ 0,006/kWh) 
JPG

	3% Líquido
Fatura L4 em diante	15% Desconto	2% crédito (Assinante 3)	0% (Corte de nível)	0% (Corte de nível)	2% Líquido
Regras de Absorção e Retorno de Margem

Venda Direta do Coordenador (Sem Embaixador): Caso o Coordenador cadastre diretamente o assinante, ele absorve a remuneração do Embaixador:

L1 Direto: 1% (coordenação) + 4% (embaixador) = 5% sobre o líquido.

L2 Indireto: 1% (coordenação) + 2% (embaixador) = 3% sobre o líquido.

L3 Indireto: 1% sobre o líquido.

Embaixador Sem Coordenador: A parcela de 1% que seria destinada à coordenação retorna integralmente para a B2W.

Regras do Plano Premium (Pagamento Único / Start)

O comissionamento totaliza 100% da base líquida da primeira fatura (R$ 0,606 / kWh), dividido igualmente entre a linha comercial:

Embaixador: 50% da base líquida em pagamento único (R$ 0,303 / kWh).

Coordenador: 50% da base líquida em pagamento único (R$ 0,303 / kWh).

Venda Direta pelo Coordenador: Recebe 100% da cota única (R$ 0,606 / kWh).

4. Plano de Carreira e Governança (Premium Pass)
[ EMBAIXADOR ATIVO ] ───(Adquire o Premium Pass: R$ 1.900)───> [ NOVO COORDENADOR ]
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
50% (R$ 950,00) ao Coordenador Antigo                50% (R$ 950,00) Retido pela B2W
(Indenização por descolamento de equipe)             (Taxa administrativa e plataforma)


Investimento de Habilitação: A posição de Coordenador exige a aquisição da licença Premium Pass por R$ 1.900,00.

Financiamento por Produção: O Embaixador pode custear o Premium Pass utilizando o saldo acumulado das suas comissões únicas de vendas do Plano Premium.

Indenização por Ascensão Comercial: Quando um Embaixador vinculado a um Coordenador ascende para a Coordenação, ele ganha autonomia e sua produção futura se descola:

R$ 950,00 (50%) são pagos ao antigo Coordenador como indenização imediata pela emancipação da sua linha.

R$ 950,00 (50%) são retidos pela B2W para cobertura de custos operacionais.

5. Diretrizes de Transição e Legado de Carteira (Safra Fechada)

Para garantir segurança jurídica, previsibilidade de receita e proteger o teto orçamentário da B2W, adota-se a política de Safra Fechada (Grandfathering) para todas as transições de carreira.

                          HOMOLOGAÇÃO DO PREMIUM PASS
                                       │
     ┌─────────────────────────────────┴─────────────────────────────────┐
     ▼                                                                   ▼
[ CARTEIRA LEGADA / SAFRA FECHADA ]                             [ PRODUÇÃO NOVA / SAFRA FUTURA ]
Contratos ativados ANTES da promoção                            Contratos ativados APÓS a promoção
• Papéis e percentuais anteriores congelados                    • Aplicação das regras de nova coordenação
• Sem sobreposição cumulativa de comissões                      • Emancipação da árvore comercial

1. Legado do Embaixador que virou Coordenador

Carteira Legada (Safra Passada): O profissional mantém 100% das recorrências conquistadas como Embaixador (4% em L1 e 2% em L2) até que ocorram os cortes ordinários de nível ou o cancelamento natural do contrato.   
JPG

Vedação de Cumulatividade: É proibido somar o 1% de Coordenador sobre essa carteira legada, garantindo que o pool desses contratos permaneça travado em 5%.

Produção Nova (Safra Futura): Todos os novos contratos originados por sua equipe de embaixadores após a data de promoção passam a pagar 1% de Coordenação (L1 a L3). Caso faça vendas diretas, aplica-se a regra de absorção (5% em L1, 3% em L2 e 1% em L3).

2. Legado do Coordenador Antigo (Líder da Linha Emancipada)

Carteira Legada (Safra Passada): O Coordenador original continua recebendo normalmente o 1% recorrente sobre todos os contratos ativados pela rede do antigo embaixador até o momento da promoção (respeitando os cortes em L1, L2 e L3).

Produção Nova (Safra Futura): Desvincula-se totalmente. Os novos clientes trazidos pelo novo Coordenador não geram mais repasse ao antigo líder (compensado pela taxa indenizatória de R$ 950,00).

6. Regras de Compliance e Operação Financeira

Condição de Liquidação: Nenhuma comissão (recorrente ou única) é provisionada ou adiantada antes da compensação bancária da fatura pelo assinante final. Inadimplência suspende imediatamente o fluxo de bonificações.

Prioridade de Crédito: Os créditos de desconto concedidos ao Assinante Originador não acumulam para meses posteriores e não são conversíveis em dinheiro vivo sob nenhuma hipótese.

Limite de Nível (Blindagem Antitransbordamento): Nenhum contrato poderá, em qualquer cenário, remunerar mais de 2 níveis para o originador, mais de 2 níveis para o embaixador ou mais de 3 níveis para o coordenador, assegurando a solvência permanente da B2W.   
JPG

You said Conseguimos fechar as contas do lado do assinante, onde com um remuneração agressiva manter o time d…

Conseguimos fechar as contas do lado do assinante, onde com um remuneração agressiva manter o time de originadores engajados.

Porém nosso HUB não se resume ao assinante, dentro da cadeia produtiva temos as usinas e os investidores e agora tambem os eletroposto.




Faça um brainstorming para atrair Steakholders irão trazer os investidores em usina, como oferecer ganhos na construção ou até mesmo uma recorrência para que alguns profissionais que hoje são meus concorrentes a trazer a usina dos clientes deles para o nosso HUB.

Quero remunerar o integrador e também o corretor que vai atrair o investidor

Transformar concorrentes (integradores) e intermediários de alto padrão (corretores de imóveis/investimentos) em parceiros do HUB é o movimento mais inteligente para destravar a oferta de energia sem imobilizar capital próprio.

O segredo aqui é eliminar a maior dor de cada um deles:

A dor do Integrador: Ele sabe vender e construir o EPC, mas não sabe ou não quer fazer gestão de créditos, lidar com inadimplência de assinantes, cobrança e burocracia na concessionária.

A dor do Corretor: Ele tem o investidor com capital (às vezes dono de terras ou capital líquido), mas não domina o setor elétrico e precisa de comissão de liquidez imediata com segurança jurídica.

A dor do Investidor: Quer retorno de 1,5% a 2% ao mês limpo, sem dor de cabeça de condomínio solar ou risco de vacância da usina.

Abaixo estão ideias práticas e estruturadas para o seu brainstorming, divididas por perfil:

1. Estratégias para o Integrador (De Concorrente a Parceiro do HUB)

O integrador quer faturar a obra (EPC). Se o seu HUB não competir na montagem da usina, ele vira seu maior vendedor de usinas para o HUB.

O Modelo "Construção Blindada + O&M Garantido":

Ganho Imediato (Obra 100% dele): O HUB garante que o integrador faça todo o EPC (equipamentos + engenharia + instalação) e fique com 100% da margem de venda da usina para o investidor. O HUB entra apenas como o "locatário/gestor da energia".

Recorrência no O&M (Operação e Manutenção): O integrador é contratado como parceiro preferencial para fazer a lavagem de placas, monitoramento e manutenção preventiva/corretiva daquela usina, garantindo uma receita fixa mensal contratual.

Recorrência de Gestão de Injeção (Ex: R$ 0,01 a R$ 0,02 por kWh gerado): Dê a ele uma fatia recorrente pequena por cada kWh que a usina dele injetar no HUB. Isso faz com que ele torça para a usina operar no pico e não migre para outra plataforma.

Solução "White Label / Powered by HUB":

O integrador vende o projeto para o cliente dele com a promessa: "Eu construo e o nosso consórcio parceiro já compra/aluga toda a sua energia no dia seguinte à ligação do medidor". O HUB resolve a maior objeção de venda do integrador: o medo do investidor de ficar com energia sobrando.

2. Estratégias para o Corretor de Imóveis e de Investimentos

Corretores tradicionais vendem terrenos, loteamentos, galpões e ativos financeiros. Eles têm a confiança dos investidores de médio e grande porte, mas precisam de incentivos claros:

Comissão de Sucesso no Terreno + Comissão no Investimento (Split):

Se o corretor traz o terreno e o investidor para construir: ganha a comissão imobiliária tradicional da venda/arrendamento da terra (6%) + Fee de Originação de Capital (1% a 2% do valor total do capex da usina) pago no fechamento do negócio.

Opção de Escolha: "Upfront" vs. "Recorrência Patrimonial":

Opção A (Liquidez Imediata): 2% do Capex da usina à vista (pago via faturamento de intermediação na entrada do investidor).

Opção B (Pensão Energética): 1% do Capex na entrada + 1% recorrente sobre a receita líquida da usina durante os primeiros 24 a 36 meses. Corretores de alta renda adoram construir carteiras com renda passiva.

Produto Pronto para Venda (Yield Claro):

Crie para o corretor um "One-Pager" (lâmina de investimentos) simples. O corretor não quer explicar Fio B ou inversor; ele quer mostrar: "Invista R$ 500 mil nesta usina solar alugada pelo HUB B2W e receba R$ 8.500/mês líquidos com contrato de 10 anos".

3. Conexão Estratégica: Usinas + Hub de Eletropostos

A entrada dos eletropostos muda completamente o jogo da margem e pode ser o grande diferencial para atrair o investidor:

Arbitragem de Margem (Onde a conta fecha muito mais alto):

Na assinatura residencial/comercial, você vende energia com 15% a 20% de desconto sobre ~R$ 1,02.

No Eletroposto (recarga rápida/ultrarrápida), o kWh é vendido ao motorista final por valores entre R$ 1,80 a R$ 2,50/kWh (taxa de conveniência/serviço de recarga).

A Proposta para o Investidor: Parte da energia da usina dele abastece a carteira de assinantes (baixo risco, previsibilidade) e parte é direcionada para a rede de eletropostos do HUB (maior rentabilidade). Isso eleva o yield médio do investidor para patamares que nenhum banco ou imóvel tradicional consegue bater.

Oportunidade para o Integrador: Ele também pode ser o integrador credenciado para a instalação dos carregadores veiculares (estações AC/DC), abrindo uma nova linha de receita de obras para ele.

4. Desenho da Parceria em Tabela (Resumo das Propostas)
Stakeholder	O que ele busca?	Ganho Imediato (Upfront)	Ganho Recorrente	O que ele entrega ao HUB?
Integrador de Energia Solar	Vender EPC sem dor de cabeça pós-obra	Margem total da venda/instalação da usina	

• Contrato de O&M mensal




• R$ 0,015/kWh gerado pela usina

	Usinas prontas, clientes investidores e expansão de capacidade
Corretor de Imóveis / Investimentos	Monetizar sua carteira de clientes de alto patrimônio	1,5% a 2% do valor do Capex captado	Opção de 1% da receita líquida por 24 meses	Terrenos viáveis e investidores com liquidez financeira
Investidor da Usina	Retorno seguro e passivo (Yield alto)	—	Aluguel garantido de 1,5% a 1,8% a.m. com gestão 100% assumida pelo HUB	Capital para infraestrutura e geração limpa
Pergunta para refinarmos:

Desses modelos, você prefere que o HUB feche com os investidores contratos no formato de Arrendamento Fixo da Usina (garantindo um valor mensal mínimo ao investidor) ou de Repasse de Performance Variável (pagando um percentual sobre o que a usina efetivamente gerar e for faturado)?

Sign in

Gemini may display inaccurate info, including about people, so double-check its responses.

Google Privacy Policy
Opens in a new window
Google Terms of Service
Opens in a new window
Your privacy & Gemini Apps
Opens in a new window
Uploaded image not shown