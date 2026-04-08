# Playbook APP (Experiência do Assinante)

Este documento documenta todas as funcionalidades do APP do Assinante e as regras de negócio associadas aos leads e usuários finais.

---

## 1. Experiência do Assinante

### Visão Geral (Dashboard)
Painel principal do cliente logado.
- **Economia Acumulada**: Exibição da economia em Reais gerada desde a assinatura.
- **Minhas Unidades**: Lista de UCs vinculadas ao perfil do assinante.
- **Última Fatura**: Destaque para a fatura mais recente emitida no CRM.

### Notificações (Multicanal)
Sempre que uma nova fatura é emitida ou baixada, o assinante recebe:
- **E-mail**: Detalhamento B2W em PDF mesclado com o boleto.
- **WhatsApp**: Mensagem formatada com emojis e anexo em PDF (`sendMedia`).

---

## 2. Gatilhos e Processos do APP (Triggers)

| Evento (Trigger) | Ação | Resultado |
| :--- | :--- | :--- |
| **Emissão de Fatura** | Disparo de Notificações | Envio simultâneo via e-mail e WhatsApp. |
| **Login do Usuário** | Checagem de Perfil | Redireciona para o `SubscriberDashboard` ou `AdminDashboard`. |
| **Aceite de Novo Lead** | Conversão em Assinante | Criação automática do perfil de cobrança no Asaas. |
| **Pagamento de Fatura** | Pagamento Automático | Se autorizado em Configurações, liquida a conta de energia na concessionária. |

---

## 3. Experiência Visual (Design System)

### Cores Principais (B2W Design)
- **Primary Blue**: `#003366` (Header, Botão Principal).
- **Accent Orange**: `#FF6600` (Call to Action).
- **Success Green**: `#10b981` (Economia e Pagamentos Quitados).

### Simbologia
- **Badge Verde**: Status 'Pago' ou 'Ativo'.
- **Badge Vermelho**: Status 'Atrasado' ou 'Vencido'.
- **Animações (Feedback)**: Uso de *spinners* em botões durante o processamento de faturas.

---

## 4. Legendas e Símbolos
- **Ver Boleto**: Botão que abre a URL do boleto gerado no Asaas.
- **Download PDF**: Baixa o **PDF Combinado** (Demonstrativo B2W + Boleto).
