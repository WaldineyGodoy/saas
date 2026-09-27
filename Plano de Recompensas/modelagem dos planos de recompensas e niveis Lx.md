# ARQUITETURA DE NEGÓCIO, RECORRÊNCIA E GOVERNANÇA: B2W ENERGIA SOLAR POR ASSINATURA

> **Documento Fonte e Especificação Formal para Aprendizado de Máquina (LLM Context Base).**  
> Este documento consolida a modelagem matemática, a taxonomia de rede, os níveis de comissionamento e as políticas de transição de carteira (Safra Fechada vs. Safra Futura) da operação de Geração Distribuída Compartilhada da B2W.

---

## 1. FUNDAMENTOS MATEMÁTICOS E BASE DE CÁLCULO LÍQUIDA

A sustentabilidade do ecossistema baseia-se na **separação estrita entre tarifa bruta e base líquida faturável**. Nenhuma comissão, honorário ou bônus incide sobre a tarifa cheia ou sobre encargos que não pertencem ao caixa da geradora.

### 1.1 Premissas Regulatórias e Tarifárias (Referência Concessionária / Cosern)
* **Tarifa Bruta Concessionária ($T_{bruta}$):** Tarifa homologada sem incidência de tributação municipal de iluminação pública (CIP/COSIP). Exemplo base: `R$ 1,0300 / kWh` (ou `R$ 1,0200 / kWh` em contratos legados).
* **CIP (Contribuição de Iluminação Pública):** Elemento 100% expurgado de qualquer cálculo de desconto ou repasse.
* **Fio B ($C_{fioB}$):** Componente tarifária da distribuidora (remuneração de infraestrutura de rede - Lei 14.300/2022).
  * *Vigência Atual:* `R$ 0,2100` a `R$ 0,2130 / kWh`.
  * *Projeção de Escalonamento (2027):* `R$ 0,2712 / kWh`.
* **Desconto Comercial do Assinante ($D_{ass}$):** Percentual concedido na fatura de energia em relação à tarifa bruta homologada.

### 1.2 Dedução da Base de Cálculo Líquida ($B_{liq}$)
A **Base de Cálculo Líquida** é a receita real gerada por kWh sobre a qual incidem as alíquotas do ecossistema:

$$B_{liq} = T_{bruta} - D_{ass} - C_{fioB}$$

#### Exemplo Prático de Formação:
1. $T_{bruta}$ = R$ 1,0300 / kWh
2. $D_{ass}$ (15% no Plano Ultra) = R$ 0,1545 / kWh
3. $C_{fioB}$ = R$ 0,2130 / kWh
4. $B_{liq} = 1,0300 - 0,1545 - 0,2130 = \mathbf{\text{R\$} 0,6625 \text{ / kWh}}$

---

## 2. PORTFÓLIO DE PRODUTOS AO ASSINANTE

### 2.1 Plano Ultra (Foco em Retenção e Crescimento Orgânico)
* **Desconto ao Assinante:** 15% fixo e recorrente na tarifa de energia (sem CIP).
* **Mecânica Member-Get-Member (Assinante Originador):** O assinante que indicar outro consumidor torna-se um originador e recebe **2% de bônus recorrente** calculado sobre a $B_{liq}$ do seu indicado direto (Nível 1).
* **Natureza da Liquidação:** O bônus do originador é creditado **exclusivamente como abatimento na própria fatura de energia**, limitado ao valor total da conta do mês. Não há repasse em dinheiro (PIX/TED) nem geração de saldo credor cumulativo para resgate.
* **Proporção de Quitação Total (Conta Zerada):** Para liquidar 100% da própria fatura via indicações, a razão de consumo exigida é de **65,7 kWh indicados para cada 1 kWh consumido** (aproximadamente 66 clientes de porte equivalente).

### 2.2 Plano Premium (Foco em Aquisição Rápida e Liquidez Imediata)
* **Desconto ao Assinante:** 20% fixo e recorrente na tarifa de energia (sem CIP).
* **Mecânica de Indicação:** Assinantes Premium não acumulam bônus recorrentes por indicação.
* **Comissionamento Comercial:** Remuneração estruturada em **pagamento único (*upfront / start*)**, equivalendo a 100% da base líquida de 1 mês dividida entre a equipe comercial:
  * 50% para o Parceiro Power (Vendedor).
  * 50% para o Líder/Coordenador.

---

## 3. TAXONOMIA DE ATORES E ESTRUTURA COMERCIAL

A estrutura comercial da B2W substitui a nomenclatura legada de *Embaixador* pela classificação unificada de **Parceiros Power**:

1. **Assinante Ponta:** Consumidor final de energia que usufrui dos descontos (15% no Ultra ou 20% no Premium).
2. **Assinante Originador:** Assinante do Plano Ultra que indicou outros assinantes e converte 2% da base do indicado em abatimento na sua conta.
3. **PPF (Parceiro Power Free):** Nível de entrada de parceiros de indicação sem licença avançada.
4. **PPP (Parceiro Power Premium):** Força de vendas profissional ativa, apta a receber até 4% de recorrência sobre faturas ativas.
5. **PPE (Parceiro Power Embaixador):** Categoria de liderança intermediária/reconhecimento por volume da rede de Parceiros Power.
6. **Líder / Coordenador:** Gestor de equipe responsável pela expansão territorial, governança e suporte aos Parceiros Power.
7. **Fornecedor / Investidor:** Gerador de energia proprietário da usina solar (UFGD), cujo retorno contratual mínimo garantido é de **50% da tarifa bruta** ($T_{bruta} \times 0,50$).
8. **B2W:** Operadora do consórcio/plataforma de gestão de créditos, com retenção padrão de **10% sobre a Base Líquida**.

---

## 4. POLÍTICAS DE NÍVEIS (L1, L2, L3) E CORDÕES DE CORTE (*CUTOFFS*)

A política de remuneração em rede da B2W possui blindagem contra endividamento e efeito piramidal através de **tetos decrescentes de profundidade**. Nenhum nível gera comissões perpétuas.