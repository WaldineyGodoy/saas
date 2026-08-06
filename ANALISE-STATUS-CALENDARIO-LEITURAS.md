# Inconsistência de Status no Calendário de Leituras — Diagnóstico, Correções e Próximos Passos

> **Levantado em 31/07/2026 · Revisado em 05/08/2026** a partir do código real
> (`src/pages/dashboards/InvoiceListManager.jsx`) e de consultas ao Supabase **B2W Energia**
> (`abbysvxnnhwvvzhftoms`). Todos os números citados foram medidos, não estimados.

---

## 0. Status da implementação (leia primeiro)

| Item | Situação | Onde |
|---|---|---|
| Fase 1.1 — fim do catch-all `else → success` | ✅ **implementado** | commit `c59c606` |
| Fase 1.2 — normalização PT/EN + fix `'pendente'` | ✅ **implementado** | commit `c59c606` |
| Ajuste complementar — `PAID_SET` + `hasRealBill` | ⚠️ **no working tree, sem commit/deploy** | `InvoiceListManager.jsx:2828,2841` |
| Fase 2 — status de leitura por mês | ⛔ **não iniciado** | — |

**Resultado medido da Fase 1** (invoices de Julho/2026):

| | |
|---|---:|
| Total de invoices | 14 |
| Fantasmas (valor 0 + sem PDF) | **8** (57%) |
| Fantasmas pintando **verde** | **0** ✅ *(eram 5 em Junho antes da correção)* |
| Fantasmas pintando vermelho | 7 |
| Faturas reais | 6 |

O risco grave foi eliminado: o calendário não afirma mais "leitura OK" sem existir conta.
O que resta é ruído operacional — tratado na Fase 2.

---

## 1. Resumo executivo

O Calendário de Leituras pinta a cor de cada UC cruzando **duas fontes de verdade concorrentes**:

| Fonte | Granularidade | Onde |
|---|---|---|
| `invoices.energy_bill_status` / `invoices.status` | **por mês** (tem `mes_referencia`) | tabela `invoices` |
| `consumer_units.last_scraping_status` | **por UC, sem mês** | tabela `consumer_units` |

A primeira **sempre vence** quando existe fatura do mês. Como o CRM cria uma "fatura fantasma"
ao entrar em Processando/Baixada, quase sempre existe fatura — logo, `last_scraping_status`
é, na prática, **invisível para o calendário**.

---

## 2. Como funciona hoje

`src/pages/dashboards/InvoiceListManager.jsx`, linhas **2812–2856**:

```js
const matchingInvoice = invoices.find(inv =>
    inv.uc_id === unit.id &&
    (inv.mes_referencia?.startsWith(mes) || inv.vencimento?.startsWith(mes)) &&
    inv.status?.trim().toLowerCase() !== 'cancelado'
);
const hasInvoice = !!matchingInvoice;

if (hasInvoice) {
    // ... decide pela INVOICE (ver seção 4.1)
} else if (isFuture) {
    status = 'not_available';
} else {
    // fallback do scraper — SÓ no mês corrente E só se não houver invoice
    if (isCurrentMonth && unit.last_scraping_status && unit.last_scraping_status !== 'success') {
        status = unit.last_scraping_status;
    } else {
        status = 'pending';
    }
}
```

Chaves de cor válidas (linhas **2931–2935**) — qualquer outro valor **não é renderizado**:

```
success | pending | error | processing | not_available
```

**Rótulos exibidos** (renomeação de 04/08/2026 — só na UI, os valores no banco não mudaram):

| Valor no banco | Rótulo na tela |
|---|---|
| `processing` | 🔵 **Baixada** |
| `success` | 🟢 **Processada** |
| `pending` | 🟠 Pendente |
| `error` | 🔴 Indisponível |

---

## 3. Defeitos

### ✅ D1 — Catch-all `else → success` pintava VERDE sem fatura — **CORRIGIDO**

O `else` assumia "status não reconhecido = sucesso". Como o banco grava em **português**
(`pago`, `pendente`, `parcelada`) e o código comparava com **inglês**, quase tudo caía no
catch-all e virava verde.

Evidência na época: 5 UCs verdes em Junho/2026 sem fatura alguma (Brigitte Caturano,
Maria da Conceição e 3× Green Park). Hoje: **0 casos**.

### ✅ D2 — Comparação PT vs EN — **CORRIGIDO**

`energy_bill_status === 'pending'` nunca casava com `'pendente'` do banco.
E `AuditGraphViewInvoiceSummary.jsx:1854` gravava `last_scraping_status: 'pendente'`,
valor que não bate com nenhuma chave de cor e fazia o card **sumir das contagens**.
Corrigido para `'pending'`.

### 🔴 D3 — `last_scraping_status` é invisível para o calendário — **ABERTO (prioridade)**

Só é lido quando **não há invoice do mês** *e* é o mês corrente. Com 57% das invoices sendo
fantasmas, o campo quase nunca é consultado.

> #### ⚠️ Incidente real — 05/08/2026 (comprova o defeito)
>
> A fatura de **Julho/2026 da UC 7030004129** (Guanabara, R$ 314,38) foi baixada do portal.
> Marcou-se corretamente `consumer_units.last_scraping_status = 'processing'` (Baixada).
> **O calendário continuou vermelho (Indisponível).**
>
> Causa: existia a fantasma de Julho (`id 4e0c59a1-22e3-4a21-a387-23fb200273a4`) com
> `energy_bill_status = 'erro'`, valor 0, sem PDF. A invoice tem prioridade → vermelho.
>
> Correção aplicada (paliativa): `UPDATE invoices SET energy_bill_status = 'processing'`
> naquela linha.
>
> **Lição:** corrigir `last_scraping_status` dá *falsa sensação de resolução*. Quem opera
> o CRM precisa hoje corrigir **em dois lugares** — e não há nada no sistema que indique isso.
> Esse é o custo recorrente que a Fase 2 elimina.

### 🟠 D4 — `last_scraping_status` não tem mês (colisão entre meses) — **ABERTO**

Um único valor por UC. Marcar `error` por causa de Julho sobrescreve o que valia para Junho;
o histórico "Julho ficou indisponível" não fica registrado em lugar nenhum. O dano visual é
contido pelo guard `isCurrentMonth`, mas `SubscriberList.jsx:264-265` já sofre: conta leitura
do mês com `last_scraping_at.startsWith(month) && last_scraping_status === 'success'`, o que
quebra assim que o campo é sobrescrito por outro mês.

### 🟠 D5 — Fatura fantasma identificada por heurística — **ABERTO**

Não há campo que diga "esta linha é um placeholder". O front deduz por
`valor_concessionaria = 0 && !concessionaria_pdf_url`. Funciona, mas é frágil: uma fatura real
de valor zero (isenção, conta mínima quitada) seria classificada como fantasma.

---

## 4. Correções

### 4.1 — Lógica atual do `if (hasInvoice)` (Fase 1 + ajuste complementar)

```js
const norm = s => (s ?? '').toString().trim().toLowerCase();

const ERROR_SET      = new Set(['erro', 'error', 'indisponivel', 'indisponível']);
const PROCESSING_SET = new Set(['processing', 'processando']);
const PENDING_SET    = new Set(['pending', 'pendente', 'aguardando']);
const SUCCESS_SET    = new Set(['success', 'sucesso', 'pago', 'parcelada', 'contestada', 'consistente']);
// status terminais de pagamento: vencem um energy_bill_status 'pendente'
const PAID_SET       = new Set(['pago', 'parcelada', 'contestada']);

if (hasInvoice) {
    const s  = norm(matchingInvoice.status);
    const eb = norm(matchingInvoice.energy_bill_status);

    // fatura fantasma: sem valor E sem PDF => não é sucesso
    const isGhost = !Number(matchingInvoice.valor_concessionaria)
                 && !matchingInvoice.concessionaria_pdf_url;

    // leitura comprovada: fatura com valor E PDF baixado da concessionária
    const hasRealBill = Number(matchingInvoice.valor_concessionaria) > 0
                     && !!matchingInvoice.concessionaria_pdf_url;

    if (ERROR_SET.has(s) || ERROR_SET.has(eb))                status = 'error';
    else if (PROCESSING_SET.has(s) || PROCESSING_SET.has(eb)) status = 'processing';
    else if (PAID_SET.has(s))                                 status = 'success';  // pago vence eb 'pendente'
    else if (hasRealBill)                                     status = 'success';  // leitura funcionou
    else if (PENDING_SET.has(s) || PENDING_SET.has(eb))       status = 'pending';
    else if (isGhost)                                         status = 'pending';  // nunca verde
    else if (SUCCESS_SET.has(s) || SUCCESS_SET.has(eb))       status = 'success';
    else                                                      status = 'pending';  // default seguro
}
```

**Por que cada regra existe:**

| Regra | Motivo |
|---|---|
| default `pending` (não `success`) | verde só com prova; erro anterior pintava verde por omissão |
| normalização PT/EN | banco grava em português, código comparava em inglês |
| `PAID_SET` antes de `PENDING_SET` | fatura **paga** com `eb='pendente'` aparecia laranja (caso real: UC 7030004579, Junho, R$ 388,12) |
| `hasRealBill → success` | decisão do operador (04/08): no calendário de **leituras**, fatura com PDF = leitura funcionou, mesmo com auditoria `inconsistente` |
| `isGhost → pending` | placeholder nunca pode contar como leitura feita |
| `ERROR`/`PROCESSING` antes de tudo | erro explícito e processamento em curso vencem qualquer inferência |

### 4.2 — Regras de negócio do status de leitura

| Situação | Status no banco | Rótulo |
|---|---|---|
| Fatura **baixada** do portal | `processing` | 🔵 Baixada |
| Revisão + upload concluídos no CRM | `success` | 🟢 Processada |
| Leitura **vencida** e fatura **não disponível** no portal | `error` | 🔴 Indisponível |
| **Conta mínima** que não gera PDF (valor baixo, acumula p/ o mês seguinte) | `processing` | 🔵 Baixada |
| Dia de leitura ainda não chegou | *(calculado no front)* | ⚪ Não Disponível |

> A regra da **conta mínima** existe para a automação **parar de buscar** um PDF que nunca
> existirá. A Cosern não emite PDF/boleto para valor mínimo — acumula para o mês seguinte.
> Sintomas no portal: *"Fatura indisponível no canal digital"* ou *"Campos obrigatórios
> ausentes: [vlocity_cmt__CustomerInteractionId__c]"*. Casos: UC 7030834911 e 7030839085
> (Julho/2026, R$ 31,69). Itens de conta mínima **não têm checkbox** na lista do portal.

---

## 5. Fase 2 — ordem revisada ⚠️

> **Correção de prioridade (05/08/2026):** a versão anterior deste documento sugeria
> `is_placeholder` **antes** do status por mês. **A ordem estava invertida.** O incidente da
> UC 7030004129 (seção D3) mostrou que a dor real é a duplicidade de fonte, não a heurística
> do placeholder. Ordem corrigida abaixo.

### 🥇 Prioridade 1 — Status de leitura por mês (resolve D3 e D4)

**Por que primeiro:** é a única mudança que elimina a duplicidade de fonte. Enquanto não
existir, toda correção de status precisa ser feita em dois lugares, e quem corrige só um
acredita ter resolvido — exatamente o que aconteceu em 05/08.

```sql
ALTER TABLE invoices ADD COLUMN reading_status text
  CHECK (reading_status IN ('pending','processing','success','error'));
ALTER TABLE invoices ADD COLUMN reading_checked_at timestamptz;
ALTER TABLE invoices ADD COLUMN reading_error text;
```

O calendário passa a ler `reading_status` da invoice do mês.
`consumer_units.last_scraping_status` vira **telemetria do robô** (resultado da última
execução) e **deixa de influenciar cor**.

**Alternativa** (se não quiser tocar em `invoices`): tabela dedicada — vantagem extra de
registrar meses **sem** fatura, hoje impossível.

```sql
CREATE TABLE reading_status (
  uc_id uuid REFERENCES consumer_units(id),
  mes_referencia date,
  status text CHECK (status IN ('pending','processing','success','error')),
  checked_at timestamptz DEFAULT now(),
  error_message text,
  PRIMARY KEY (uc_id, mes_referencia)
);
```

### 🥈 Prioridade 2 — `is_placeholder` explícito (resolve D5)

**Por que depois:** resolve sintoma, não causa. É barato e melhora a clareza, mas a heurística
atual (`valor 0 && sem PDF`) já funciona nos dados de hoje.

```sql
ALTER TABLE invoices ADD COLUMN is_placeholder boolean NOT NULL DEFAULT false;
```

Quem cria a fantasma grava `is_placeholder = true`; o front troca a heurística `isGhost` por
esse campo.

### 🥉 Prioridade 3 — Consumidores do campo global

`src/pages/dashboards/SubscriberList.jsx:264-265` conta leituras do mês usando
`last_scraping_at` + `last_scraping_status === 'success'`. Migrar para o status por mês.

### Prioridade 4 — Commit do ajuste pendente

`PAID_SET` + `hasRealBill` estão no working tree sem commit. Publicar antes de iniciar a Fase 2.

---

## 6. Validação

> ⚠️ **Correção:** a versão anterior deste documento trazia, como "validação da correção", uma
> query que na verdade inspeciona **dados**, não código. Como (corretamente) não alteramos os
> dados, ela continuava retornando 5 linhas mesmo com o front já corrigido — o que podia ser
> lido como falha. As validações corretas são as duas abaixo.

### 6.1 — Simulação da lógica (valida o CÓDIGO)

Replica a árvore de decisão em SQL e confere a distribuição. **Regra de ouro: nenhum verde
pode vir de fatura fantasma.**

```sql
WITH base AS (
  SELECT trim(cu.numero_uc) AS uc, to_char(i.mes_referencia,'YYYY-MM') AS mes,
         lower(trim(i.status::text)) AS s,
         lower(trim(coalesce(i.energy_bill_status,''))) AS eb,
         (coalesce(i.valor_concessionaria,0)=0 AND i.concessionaria_pdf_url IS NULL) AS is_ghost,
         (coalesce(i.valor_concessionaria,0)>0 AND i.concessionaria_pdf_url IS NOT NULL) AS has_real
  FROM invoices i JOIN consumer_units cu ON cu.id = i.uc_id
  WHERE i.mes_referencia >= date '2026-06-01' AND i.mes_referencia < date '2026-08-01'
    AND lower(trim(i.status::text)) <> 'cancelado'
)
SELECT mes,
  CASE WHEN s IN ('erro','error','indisponivel','indisponível') OR eb IN ('erro','error','indisponivel','indisponível') THEN 'error'
       WHEN s IN ('processing','processando') OR eb IN ('processing','processando') THEN 'processing'
       WHEN s IN ('pago','parcelada','contestada') THEN 'success'
       WHEN has_real THEN 'success'
       WHEN s IN ('pending','pendente','aguardando') OR eb IN ('pending','pendente','aguardando') THEN 'pending'
       WHEN is_ghost THEN 'pending'
       ELSE 'pending' END AS status_final,
  count(*) AS qtd, count(*) FILTER (WHERE has_real) AS com_fatura_real,
  count(*) FILTER (WHERE is_ghost) AS fantasmas
FROM base GROUP BY 1,2 ORDER BY 1,2;
```

**Esperado:** toda linha `status_final = 'success'` deve ter `fantasmas = 0` e
`com_fatura_real = qtd`. Medido em 05/08: ✅ conforme.

### 6.2 — Divergência entre as duas fontes (mede a dor da Fase 2)

```sql
SELECT trim(cu.numero_uc) AS uc, cu.last_scraping_status AS status_uc,
       i.energy_bill_status AS status_invoice, to_char(i.mes_referencia,'YYYY-MM') AS mes
FROM consumer_units cu
JOIN invoices i ON i.uc_id = cu.id
 AND i.mes_referencia >= date_trunc('month', current_date)
 AND lower(trim(i.status::text)) <> 'cancelado'
WHERE lower(coalesce(i.energy_bill_status,'')) <> lower(coalesce(cu.last_scraping_status,''))
ORDER BY 1;
```

Cada linha é uma UC onde o operador vê uma cor e o registro diz outra coisa.
**Após a Fase 2 esta query perde o sentido** — passa a existir uma fonte só.

### Checklist visual no Calendário

- [x] Junho/2026: as 5 UCs fantasma deixaram de aparecer verdes
- [x] Faturas `energy_bill_status='pendente'` aparecem laranja, não verde
- [x] Nenhum card some das contagens do dia
- [x] Junho continua verde para quem tem fatura real com PDF
- [ ] *(após commit do ajuste)* fatura **paga** com `eb='pendente'` aparece verde — UC 7030004579

---

## 7. Observações para quem for implementar

- **Não alterar dados sem alinhar antes.** O que fazer com as fantasmas (apagar × marcar
  `is_placeholder`) é decisão do operador. Recomendação: **marcar, não apagar** — preserva
  histórico.
- **`numero_uc` pode ter espaço à esquerda** — sempre `trim()`.
- As UCs do assinante "ASSOCIACAO DE USINAS B2W ENERGIA"
  (`5a67c7d6-1f80-408d-bcf4-fe51aa8c0f3a`) vinculam por **`titular_fatura_id`**, não por
  `subscriber_id` (só 1 UC usa esse último).
- O filtro de fatura do mês aceita `mes_referencia` **ou** `vencimento` (linha 2815) — uma
  fatura de Junho vencendo em Julho aparece nos dois meses. Avaliar se é intencional.
- **Nunca gravar `'baixada'`/`'processada'` no banco** — são apenas rótulos de UI. Os valores
  permanecem `processing` e `success`. O front aceita ambos na leitura
  (`ReadingCalendarModal.jsx:18-41`), mas a escrita deve seguir o padrão em inglês.
