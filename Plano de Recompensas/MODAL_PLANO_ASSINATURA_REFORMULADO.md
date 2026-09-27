# Reformulação dos Modais: Energia por Assinatura & Eletropostos (Matriz Multinível + UI/UX CRM)

Este documento consolida a arquitetura financeira, regras de negócio multinível (`L1`, `L2`, `L3`, `L4+`) e melhorias de UI/UX aplicadas nos modais:
- [`src/pages/settings/components/PlanModal.jsx`](file:///c:/Users/Godoy/Documents/HTML/WorkSpace%201%20Antigravity/src/pages/settings/components/PlanModal.jsx) (Energia por Assinatura)
- [`src/pages/settings/components/EletropostoPlanModal.jsx`](file:///c:/Users/Godoy/Documents/HTML/WorkSpace%201%20Antigravity/src/pages/settings/components/EletropostoPlanModal.jsx) (Eletropostos)
- [`src/pages/settings/PlansServicesSettings.jsx`](file:///c:/Users/Godoy/Documents/HTML/WorkSpace%201%20Antigravity/src/pages/settings/PlansServicesSettings.jsx) (Gestão unificada com abas ativas)

---

## 1. Correções de UI/UX Implementadas

### 1.1. Alinhamento Horizontal Estrito no Bloco 1
- **Rótulo em Linha Única (`white-space: nowrap`):** O título `"Selecionar Concessionária (Define Tarifa e Fio B)"` não quebra mais em duas linhas, mantendo a mesma altura de label dos demais campos da fileira (`Nome do Plano` e `Desconto Assinante (%)`).
- **Nivelamento na Base (`alignItems: 'end'` + `height: '44px'`):** Todos os `inputs` e `selects` da primeira fileira possuem exatamente `44px` de altura e alinhamento inferior na grid CSS, eliminando qualquer degrau visual.

### 1.2. Bloqueio de Edição no Demonstrativo Dinâmico (`Read-Only`)
- **Em Planos de Assinatura (`PlanModal.jsx`):**
  - Os campos **Tarifa Bruta (Concessionária)** e **Fio B - Valor Unitário** dentro do *Demonstrativo Dinâmico* são **somente leitura (`read-only`)**, identificados com badge `<Lock /> Fixo Concessionária` e `<Lock /> Fixo Fio B`.
  - A alteração desses valores ocorre exclusivamente pela seleção da Concessionária no Bloco 1 ou nas configurações da Concessionária.
- **Em Planos de Eletropostos (`EletropostoPlanModal.jsx`):**
  - O campo **Lastro (Plano de Assinatura)** e a linha **Fio B (Isento / R$ 0,0000)** são **somente leitura (`read-only`)**, derivados automaticamente do Plano de Assinatura vinculado (`Tarifa da Concessionária - Desconto do Assinante do Plano`).

---

## 2. Matriz de Variações por Níveis de Recompensa (Marketing Multinível - MMN)

Dentro do **Demonstrativo Dinâmico**, o sistema agora calcula simultaneamente o **Superávit / Margem Livre** para cada nível da árvore de indicação (`L1`, `L2`, `L3` e `L4+`), permitindo configurar:
1. **Direito de Recebimento (`Até Nível L1 / L2 / L3 / L4+ / Infinito`):** Quantos níveis de profundidade cada cargo tem direito a receber. Quando o nível simulado ultrapassa o limite do cargo (`max_niveis`), o sistema aplica automaticamente o **Corte de Nível (`0%`)**.
2. **Percentuais por Nível (`L1`, `L2`, `L3`, `L4+`):** Permite visualizar e editar individualmente a alíquota de cada cargo em cada geração ou alternar para a **Visão Matriz Completa (L1 a L4+)** lado a lado.

### Tabela de Comissionamento e Evolução do Superávit (Exemplo Referência: Cosern R$ 1,03 / Fio B R$ 0,2130 / Desc. 15%)
- **Base de Cálculo Líquida (Assinatura):** $\text{R\$ } 1,0300 - \text{R\$ } 0,2130 - \text{R\$ } 0,1545 = \mathbf{\text{R\$ } 0,6625/\text{kWh}}$ (`64,32%` da Tarifa)
- **Mínimo Exigido pelo Fornecedor:** `50,00%` da Tarifa ($\text{R\$ } 0,5150/\text{kWh}$)

| Cargo / Função | Direito (`max_niveis`) | Nível 1 (Venda Direta) | Nível 2 (1ª Indicação) | Nível 3 (2ª Indicação) | Nível 4+ (Rede Profunda) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Comissão Gestão B2W** | **Infinito (`L1 a L4+`)** | `10,00%` (R$ 0,06625) | `10,00%` (R$ 0,06625) | `10,00%` (R$ 0,06625) | `10,00%` (R$ 0,06625) |
| **Líder Regional** | **Até 3 Níveis (`L1 a L3`)** | `1,00%` (R$ 0,006625) | `1,00%` (R$ 0,006625) | `1,00%` (R$ 0,006625) | `0,00%` *(Corte L4+)* |
| **Parceiro Power (PPE / PPP)** | **Até 2 Níveis (`L1 e L2`)** | `4,00%` (R$ 0,02650) | `2,00%` (R$ 0,01325) | `0,00%` *(Corte L3)* | `0,00%` *(Corte L4+)* |
| **Assinante Conect (MGM)** | **Infinito a partir de L2** | `0,00%` *(Sem ind.)* | `2,00%` (R$ 0,01325) | `2,00%` (R$ 0,01325) | `2,00%` (R$ 0,01325) |
| **Soma Comissões (% s/ Base)** | — | **15,00% s/ Base** (`9,65% Tarifa`) | **15,00% s/ Base** (`9,65% Tarifa`) | **13,00% s/ Base** (`8,36% Tarifa`) | **12,00% s/ Base** (`7,72% Tarifa`) |
| **Líquido Fornecedor / Usina** | — | **R$ 0,563125** (`54,67%`) | **R$ 0,563125** (`54,67%`) | **R$ 0,576375** (`55,96%`) | **R$ 0,583000** (`56,60%`) |
| **Superávit / Margem Livre** | — | **+R$ 0,048125 (+4,67%)** | **+R$ 0,048125 (+4,67%)** | **+R$ 0,061375 (+5,96%)** | **+R$ 0,068000 (+6,60%)** |

> **Trava Anti-Déficit Multinível:** O botão de salvamento valida todos os 4 níveis (`L1`, `L2`, `L3`, `L4+`). Se qualquer nível ficar abaixo do repasse mínimo do fornecedor, o modal bloqueia a gravação e indica exatamente qual nível está deficitário.
