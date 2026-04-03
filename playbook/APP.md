# Playbook APP (Experiência do Assinante)

Este documento documenta todas as funcionalidades do APP do Assinante e as regras de negócio associadas aos leads e usuários finais.

---

## 1. Funcionalidades do Assinante

### Visão Geral (Dashboard)
Painel principal do cliente logado.
- **Economia Acumulada**: Exibição da economia em Reais gerada desde a assinatura.
- **Minhas Unidades**: Lista de UCs vinculadas ao perfil do assinante.
- **Última Fatura**: Destaque para a fatura mais recente emitida no CRM.

---

## 2. Gatilhos e Processos do APP (Triggers)

| Evento (Trigger) | Ação | Resultado |
| :--- | :--- | :--- |
| **Login do Usuário** | Checagem de Perfil (Subscriber) | Redireciona para o SubscriberDashboard ou AdminDashboard. |
| **Aceite de Novo Lead** | Conversão em Assinante | Cria registro na tabela `subscribers` e notifica via CRM. |
| **Simulação de Crédito** | Salvamento de Dados de Contato | Cria registro na tabela `leads` para prospecção. |

---

## 3. Experiência Visual (Design System)

### Cores Principais (B2W Design)
- **Primary Blue**: `#003366` (Header, Botão Principal) — `--color-blue`
- **Accent Orange**: `#FF6600` (Call to Action, Referral) — `--color-orange`
- **Success Green**: `#10b981` (Economia, Paga) — `--color-success`

### Simbologia
- **Badge Verde**: Status 'Pago' ou 'Ativo'.
- **Badge Vermelho**: Status 'Atrasado' ou 'Vencido'.
- **Card Hover**: Efeito de elevação para interatividade.

---

## 4. Legendas e Símbolos
- **Ver Boleto**: Botão que abre a URL do boleto gerado no Asaas (se disponível).
- **Editar (Modo Admin)**: Botão visível apenas para funções `admin`/`manager` para ajustes rápidos de faturas.
