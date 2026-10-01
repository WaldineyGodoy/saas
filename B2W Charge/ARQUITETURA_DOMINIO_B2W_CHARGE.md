# B2W Charge — Arquitetura de Domínio de Negócio e Fluxogramas Técnicos

> **Documento de Especificação para o Time de Desenvolvimento**
> **Ecossistema:** B2W (B2W Pay Charger · B2W GE · B2W Invest · B2W Energia)
> **Diferencial Estrutural:** Split financeiro nativo de **3 partes no MVP** (`B2W Pay Charger` + `B2W GE` + `Proprietário do Local`) e **4 partes na Fase 2** (`+ Investidor B2W Invest`).

---

## 1. Decisões de Arquitetura Consolidadas (ADRs)

| Dimensão Técnica | Decisão Definida | Impacto na Arquitetura |
| :--- | :--- | :--- |
| **Multi-Tenancy & Banco** | **Banco Único com `tenant_id` + Row-Level Security (RLS)** | Isolamento lógico rigoroso por operador (`B2W GE`), permitindo que a `B2W Pay Charger` tenha visão consolidada global e que um `Usuário` ou `Proprietário` acesse múltiplos tenants quando aplicável. |
| **Hardware & Protocolo** | **Carregadores Joult (60 kW e 80 kW) via OCPP 1.6J / 2.0.1** | Servidor CSMS WebSocket gerenciando `BootNotification`, `StatusNotification`, `RemoteStartTransaction`, `MeterValues` (kWh em tempo real) e `StopTransaction`. |
| **PSP & Split Financeiro** | **Stripe (Stripe Connect / Marketplace) — PIX e Cartão** | Captura do pagamento na sessão (App ou QR Code sem App) com taxas diferenciadas por meio (PIX < Cartão) e subcontas conectadas (`stripe_account_id`) para cada `B2W GE` e `Proprietário`. |
| **Motor de Liquidação** | **Fechamento Diário em Lote (Daily Batch Settlement)** | As sessões concluídas no dia acumulam no razão transitório (`ledger_entries`) e um Cron Job diário consolida e executa as transferências/splits na Stripe, reduzindo custo operacional e facilitando conciliação. |
| **Compliance Fiscal** | **Emissão Automática de NFS-e Municipal** | Disparo assíncrono via fila pós-liquidação da transação, respeitando as regras tributárias do município da estação (Lei 14.300 / REN 1000 ANEEL). |

---

## 2. Mapa Geral de Domínios e Conexões (Visão Executiva)

```mermaid
flowchart LR
    subgraph ATORES["1. Atores & Canais"]
        M["🚗 Motorista<br/>(App iOS/Android ou QR Sem App)"]
        GE["⚡ B2W GE<br/>(Operador do Eletroposto)"]
        PL["🏢 Proprietário do Local<br/>(Posto / Condomínio / Empresa)"]
        PC["🛡️ B2W Pay Charger<br/>(Gestora Multi-Tenant)"]
        INV["📈 Investidor B2W Invest<br/>(Fase 2 - 4ª Parte do Split)"]
    end

    subgraph CORE["2. Core B2W Charge (Single DB + tenant_id RLS)"]
        CAD["Gestão de Ativos & Tarifas<br/>(Local, Estação, Conector, Tarifa)"]
        OCPP["Broker CSMS OCPP<br/>(Joult 60kW / 80kW)"]
        SESS["Motor de Sessão de Recarga<br/>(Início, Telemetria kWh, Fim)"]
        BATCH["Job Fechamento Diário em Lote<br/>(Cálculo Split 3/4 Partes)"]
        CART["Carteiras Digitais & Ledger<br/>(Saldos e Recebíveis)"]
    end

    subgraph EXT["3. Integrações Externas"]
        STRIPE["💳 Stripe Connect<br/>(PIX / Cartão + Split Nativo)"]
        NFSE["🧾 Provedor NFS-e Municipal<br/>(Emissão Fiscal Automática)"]
    end

    GE -->|"Configura estações e R$/kWh"| CAD
    PL -->|"Hospeda estação (Coincidente ou Terceiro)"| CAD
    M -->|"Escaneia QR / Inicia"| SESS
    SESS <-->|"RemoteStart / MeterValues / Stop"| OCPP
    SESS -->|"Cobra PIX ou Cartão"| STRIPE
    STRIPE -->|"Webhook Pagamento Confirmado"| SESS
    SESS -->|"Registra transação pendente"| BATCH
    BATCH -->|"Executa Split Diário"| STRIPE
    BATCH -->|"Atualiza saldos"| CART
    BATCH -->|"Dispara nota fiscal"| NFSE
    CART -->|"Saque / Relatórios"| GE
    CART -->|"Extrato de Comissão"| PL
    CART -->|"Fee da Plataforma"| PC
    CART -.->|"Yield por Estação (Fase 2)"| INV
```

---

## 3. Fluxograma 1: Jornada de Recarga (OCPP Joult 60/80kW + Stripe)

```mermaid
sequenceDiagram
    autonumber
    actor Motorista
    participant AppQR as App / Web QR (Sem App)
    participant Core as B2W Charge Core (RLS)
    participant Stripe as Stripe (PIX / Cartão)
    participant CSMS as Broker OCPP (CSMS)
    participant Joult as Carregador Joult (60/80 kW)

    Motorista->>AppQR: Escaneia QR Code do Conector
    AppQR->>Core: Consulta Conector + Tarifa vigente (R$/kWh + taxa método)
    Core-->>AppQR: Exibe status "Disponível" e preço (PIX vs Cartão)
    Motorista->>AppQR: Seleciona valor/crédito e paga via PIX ou Cartão
    AppQR->>Stripe: Cria PaymentIntent (captura ou pré-autorização)
    Stripe-->>Core: Webhook payment_intent.succeeded
    Core->>CSMS: Envia comando RemoteStartTransaction(connectorId)
    CSMS->>Joult: OCPP RemoteStartTransaction
    Joult-->>CSMS: OCPP StartTransaction + MeterValues (kWh em tempo real)
    CSMS-->>AppQR: Atualiza telemetria ao vivo (kW, kWh, R$, % bateria)
    Motorista->>AppQR: Solicita parada (ou carga atinge 100%)
    Core->>CSMS: RemoteStopTransaction
    Joult-->>Core: StopTransaction (Total kWh consumido)
    Core->>Core: Calcula valor final da Sessão e agenda para o Lote Diário
```

---

## 4. Fluxograma 2: Motor de Fechamento Diário em Lote (Split 3/4 Partes + NFS-e)

```mermaid
flowchart TD
    T1["⏰ Gatilho Diário (Cron 23:59)<br/>Job de Fechamento em Lote"] --> T2["Busca Transações Pagas no Dia<br/>(status = 'captured' AND settled = false)"]
    T2 --> T3{"B2W GE == Proprietário do Local?<br/>(owner_id == operator_tenant_id)"}
    
    T3 -- "SIM (Operador é dono do imóvel)" --> S2["Split Simplificado (2 Recebedores):<br/>1. Taxa Plataforma ➔ B2W Pay Charger<br/>2. Saldo Líquido (Operação + Local) ➔ B2W GE"]
    
    T3 -- "NÃO (Imóvel de Terceiro)" --> S3["Split Completo (3 Partes MVP):<br/>1. Taxa Plataforma + Gateway ➔ B2W Pay Charger<br/>2. Comissão de Hospedagem (%) ➔ Proprietário do Local<br/>3. Receita Operacional Líquida ➔ B2W GE"]
    
    S2 --> F2{"Há Vínculo B2W Invest?<br/>(Fase 2)"}
    S3 --> F2
    
    F2 -- "SIM" --> S4["Deduz % de Retorno da Estação<br/>➔ Carteira do Investidor"]
    F2 -- "NÃO (MVP)" --> EXEC["Executa Stripe Transfers em Lote<br/>(Stripe Connect Accounts)"]
    S4 --> EXEC
    
    EXEC --> LEDGER["Grava lançamentos contábeis no Ledger<br/>e atualiza Carteiras Digitais (tenant_id)"]
    LEDGER --> NF["Dispara Fila de Emissão Automática de NFS-e<br/>e envia recibo fiscal ao Motorista"]
```

---

## 5. Modelagem de Dados Multi-Tenant (`tenant_id` + RLS)

```mermaid
erDiagram
    TENANTS_B2W_GE ||--o{ STATIONS : "opera (tenant_id)"
    LOCATIONS ||--o{ STATIONS : "hospeda (location_id)"
    USERS ||--o{ USER_ROLES : "possui papéis (Motorista, GE, Proprietário, Investidor, Admin)"
    USERS ||--o{ LOCATIONS : "é proprietário de (owner_user_id)"
    STATIONS ||--|{ CONNECTORS : "possui (Joult 60kW/80kW)"
    STATIONS ||--|{ TARIFFS : "aplica horário/preço"
    STATIONS ||--o{ INVESTMENT_LINKS : "financiada por (Fase 2)"
    CONNECTORS ||--o{ CHARGING_SESSIONS : "realiza"
    CHARGING_SESSIONS ||--|| TRANSACTIONS : "gera cobrança"
    TRANSACTIONS ||--|{ SPLIT_ITEMS : "divide em lote diário"
    TRANSACTIONS ||--|| NFSE_INVOICES : "emite nota"
    USERS ||--|| DIGITAL_WALLETS : "acumula saldo"
```
