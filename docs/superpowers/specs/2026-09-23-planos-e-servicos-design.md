# Especificação Técnica: Planos e Serviços

**Data:** 2026-09-23  
**Status:** Aprovado pelo Usuário  
**Módulo:** Configurações > Planos e Serviços  

---

## 1. Visão Geral
Criação do submenu **"Planos e Serviços"** dentro de Configurações, posicionado no topo da lista lateral em `SettingsLayout.jsx`. O submenu contém 3 abas horizontais:
1. **Energia por Assinatura** (Ativa, com gestão completa de planos e recompensas).
2. **Eletropostos** (Placeholder informativo para expansão futura).
3. **Usinas** (Placeholder informativo para expansão futura).

Dentro de **Energia por Assinatura**, o usuário pode cadastrar, listar, editar, ativar/desativar e excluir planos de assinatura, parametrizando descontos de assinantes e modelos de recompensas (Start, Recorrente e Híbrido).

---

## 2. Modelo de Dados (Supabase)

### Tabela: `public.planos_assinatura_energia`

```sql
CREATE TABLE IF NOT EXISTS public.planos_assinatura_energia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    desconto_assinante NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    ativo BOOLEAN NOT NULL DEFAULT true,
    
    -- Configurações de Recompensas
    recompensas_ativo BOOLEAN NOT NULL DEFAULT true,
    tipo_recompensa TEXT NOT NULL DEFAULT 'start' CHECK (tipo_recompensa IN ('start', 'recorrente', 'hibrido')),
    
    -- JSONB para o Plano Start
    -- Contém array das faturas elegíveis selecionadas [1, 2, 3]
    -- e os percentuais específicos para cada fatura e cada papel
    start_config JSONB DEFAULT '{
      "faturas_elegiveis": [2],
      "regras": {
        "1": {"associacao": 0, "coordenador": 0, "embaixador": 0, "assinante": 0},
        "2": {"associacao": 0, "coordenador": 0, "embaixador": 0, "assinante": 0},
        "3": {"associacao": 0, "coordenador": 0, "embaixador": 0, "assinante": 0}
      }
    }'::jsonb,
    
    -- JSONB para o Plano Recorrente
    -- Quantidade de meses de vigência da recorrência e percentuais dos 4 papéis
    recorrente_config JSONB DEFAULT '{
      "meses": 48,
      "regras": {"associacao": 0, "coordenador": 0, "embaixador": 0, "assinante": 0}
    }'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.planos_assinatura_energia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura para autenticados" ON public.planos_assinatura_energia
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permitir inserção e atualização para autenticados" ON public.planos_assinatura_energia
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Não vinculamos chaves estrangeiras com entidades existentes até revisão do usuário.
```

---

## 3. Regras de Negócio e Recompensas

1. **Papéis bonificados**:
   - Associação / Consórcio (%)
   - Coordenador / Líder (%)
   - Embaixador / Originador (%)
   - Assinante Originador (%)
2. **Modalidade Start**:
   - Faturas elegíveis: seleção individual de faturas (1, 2 e/ou 3).
   - Percentuais individuais por fatura elegível.
3. **Modalidade Recorrente**:
   - Faturas elegíveis: quantidade de meses contínuos (padrão: 48 meses).
   - Percentuais únicos contínuos por fatura paga durante o período.
4. **Modalidade Híbrida**:
   - Ativa simultaneamente Start e Recorrente.
   - **Regra de Não-Sobreposição**: As recompensas não se sobrepõem. A contagem dos meses da Recorrência inicia estritamente a partir do ciclo posterior ao último ciclo configurado no Start (ex: se o Start contemplar até a fatura 2, a recorrência se inicia na fatura 3).

---

## 4. Estrutura de Arquivos Frontend

1. `src/pages/dashboards/SettingsLayout.jsx`:
   - Adicionar `{ id: 'plans', label: 'Planos e Serviços', icon: Layers, desc: 'Planos de energia, eletropostos e usinas' }` como o **primeiro item** da lista de menu lateral.
   - Adicionar renderização de `<PlansServicesSettings />` no `switch(activeTab)`.
2. `src/pages/settings/PlansServicesSettings.jsx` (Novo):
   - Layout com 3 abas horizontais: `Energia por Assinatura`, `Eletropostos` e `Usinas`.
   - Grid de planos cadastrados, carregando dados do Supabase.
   - Botão para abrir o modal de cadastro.
   - Ações de editar, ativar/desativar e excluir.
3. `src/pages/settings/components/PlanModal.jsx` (Novo):
   - Modal com formulário reativo para criação e edição dos planos com todas as validações de campos e regras de transição Start/Recorrente/Híbrido.

---

## 5. Deploy Git
- Commitar arquivos criados e modificados.
- Fazer push para a branch `main` no remote `origin` para visualização imediata no frontend deployado.
