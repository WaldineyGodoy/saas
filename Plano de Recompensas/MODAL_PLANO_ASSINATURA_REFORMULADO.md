# Especificação Técnica: Modais de Planos de Assinatura e Eletropostos

> **Diretório do Projeto:** `Plano de Recompensas`  
> **Componentes Implementados:**
> - [`src/pages/settings/components/PlanModal.jsx`](file:///c:/Users/Godoy/Documents/HTML/WorkSpace%201%20Antigravity/src/pages/settings/components/PlanModal.jsx) *(Plano de Assinatura — Lastro na Concessionária)*
> - [`src/pages/settings/components/EletropostoPlanModal.jsx`](file:///c:/Users/Godoy/Documents/HTML/WorkSpace%201%20Antigravity/src/pages/settings/components/EletropostoPlanModal.jsx) *(Plano de Eletroposto — Lastro no Plano de Assinatura, sem Fio B)*
> - [`src/pages/settings/PlansServicesSettings.jsx`](file:///c:/Users/Godoy/Documents/HTML/WorkSpace%201%20Antigravity/src/pages/settings/PlansServicesSettings.jsx) *(Central de Planos e Serviços com abas ativas)*

---

## 1. Plano de Assinatura (`PlanModal.jsx`)

* **Lastro e Ponto de Partida:** Tarifa Bruta da Concessionária selecionada (via `view_concessionarias_resumo`).
* **Ordem do Demonstrativo Recorrente:**
  1. `Tarifa Bruta [Concessionária]` (`100%`)
  2. `(-) Fio B` *(2º Item da Lista — Custo Regulatório)*
  3. `(-) Desconto do Assinante` (`% s/ Tarifa`)
  4. `(=) Base de Cálculo Líquida` (`Tarifa Bruta - Fio B - Desconto do Assinante`)
  5. `(-) B2W (Gestão / Plataforma)` (`% s/ Base`)
  6. `(-) Líder` (`% s/ Base`)
  7. `(-) Categorias Parceiro Power`:
     * `PPE — Parceiro Power Embaixador` (`% s/ Base`)
     * `PPP — Parceiro Power Premium` (`% s/ Base`)
     * `PPF — Parceiro Power Free` (`% s/ Base`)
  8. `(-) Assinante Conect` (`% s/ Base`)
  9. `(=) Líquido Efetivo do Fornecedor`
  10. `Piso Contratual do Fornecedor` (`50% s/ Tarifa` por padrão, editável)
  11. `MARGEM LIVRE / EXCEDENTE` (`Líquido Efetivo - Piso Contratual`, com trava antidéficit).

---

## 2. Plano de Eletropostos (`EletropostoPlanModal.jsx`)

* **Lastro e Ponto de Partida:** Vinculado a um **Plano de Assinatura** cadastrado.
  $$\text{Lastro Eletroposto} = \text{Tarifa Bruta da Concessionária} - \text{Desconto do Assinante ofertado no Plano de Assinatura}$$
  *(Exemplo: Tarifa Cosern `R$ 1,0300` - Desconto do Plano `15%` (`R$ 0,1545`) = **Lastro `R$ 0,8755 / kWh`**).*
* **Isenção de Fio B:** O **Fio B não é considerado** no demonstrativo do Eletroposto, pois já foi deduzido na formação do Plano de Assinatura vinculado.
* **Ordem do Demonstrativo Recorrente (Eletroposto):**
  1. `Lastro: [Plano de Assinatura Vinculado]` (`100% Sem Fio B` | `R$ 0,8755`)
  2. `(-) Desconto do Assinante (Eletroposto)` (`% s/ Lastro`)
  3. `(=) Base de Cálculo Líquida` (`Lastro - Desconto Eletroposto`)
  4. `(-) B2W (Gestão / Plataforma)` (`% s/ Base`)
  5. `(-) Líder` (`% s/ Base`)
  6. `(-) Categorias Parceiro Power` (`PPE`, `PPP` e `PPF` com teto de segurança automático)
  7. `(-) Assinante Conect` (`% s/ Base`)
  8. `(=) Líquido Efetivo do Fornecedor`
  9. `Piso Contratual do Fornecedor` (`50% s/ Lastro` por padrão, editável)
  10. `MARGEM LIVRE / EXCEDENTE` (`Líquido Efetivo - Piso Contratual`, com trava antidéficit).

---

## 3. Regras Globais de Governança Aplicadas em Ambos
* **Vigência:** Vinculada ao **Status Ativo da Entidade no Sistema** (`vigencia_tipo: 'status_ativo_entidade'`), sem a limitação anterior de 48 meses.
* **Trava Antidéficit:** Bloqueio automático de gravação caso `Margem Livre / Excedente < 0`.
