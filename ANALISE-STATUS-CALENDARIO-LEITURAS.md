# Inconsistência de Status no Calendário de Leituras — Diagnóstico e Solução

> Documento de especificação para correção. Levantado em 31/07/2026 a partir do código real
> (`src/pages/dashboards/InvoiceListManager.jsx`) e de consultas ao Supabase **B2W Energia**
> (`abbysvxnnhwvvzhftoms`). Todos os números citados foram medidos, não estimados.

---

## 1. Resumo executivo

O Calendário de Leituras pinta a cor de cada UC cruzando **duas fontes de verdade concorrentes**:

| Fonte | Granularidade | Onde |
|---|---|---|
| `invoices.energy_bill_status` / `invoices.status` | **por mês** (tem `mes_referencia`) | tabela `invoices` |
| `consumer_units.last_scraping_status` | **por UC, sem mês** | tabela `consumer_units` |

Isso gera 4 defeitos, sendo **um deles ativo em produção hoje: 5 UCs aparecem VERDE (Sucesso) em
Junho/2026 sem existir fatura nenhuma** — nem no CRM, nem no portal da concessionária (verificado
manualmente no site da Cosern em 31/07/2026).

---

## 2. Como funciona hoje

`src/pages/dashboards/InvoiceListManager.jsx`, linhas **2812–2845**:

```js
const matchingInvoice = invoices.find(inv =>
    inv.uc_id === unit.id &&
    (inv.mes_referencia?.startsWith(mes) || inv.vencimento?.startsWith(mes)) &&
    inv.status?.trim().toLowerCase() !== 'cancelado'
);
const hasInvoice = !!matchingInvoice;

let status = 'pending';
const isFuture = (filterYear > currentYearNum)
    || (filterYear === currentYearNum && filterMonth > currentMonthNum)
    || (isCurrentMonth && day > currentDayNum);

if (hasInvoice) {
    if (mi.status === 'erro' || mi.energy_bill_status === 'erro' || mi.status === 'error') status = 'error';
    else if (mi.status === 'processing' || mi.energy_bill_status === 'processing')          status = 'processing';
    else if (mi.energy_bill_status === 'pending')                                            status = 'pending';
    else                                                                                     status = 'success';  // ⚠️ catch-all
} else if (isFuture) {
    status = 'not_available';
} else {
    // fallback do scraper — SÓ no mês corrente
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

---

## 3. Defeitos encontrados

### 🔴 D1 — Catch-all `else → success` pinta VERDE sem fatura (ATIVO EM PRODUÇÃO)

O `else` da linha 2834 assume que "qualquer status não reconhecido = sucesso". Como o banco
guarda os status em **português** (`pago`, `pendente`, `parcelada`, `contestada`,
`inconsistente`, `consistente`) e o código compara com **inglês** (`'pending'`, `'processing'`),
praticamente tudo cai no catch-all e vira verde.

**Evidência — 5 faturas fantasma de Junho/2026 com `energy_bill_status='success'`, `valor_concessionaria = 0.00`, sem PDF:**

| UC | Titular | Mês | Situação real no portal (verificada em 31/07) |
|---|---|---|---|
| 7029990055 | Brigitte Caturano | 2026-06 | não existe (última: Abril) |
| 7030043183 | Maria da Conceição | 2026-06 | não existe (última: Maio) |
| 7030839085 | Green Park CD Ilmun | 2026-06 | não existe (só Julho) |
| 7030839166 | Green Park SE-02 | 2026-06 | não existe (só Julho) |
| 7030839328 | Green Park 1600 EE | 2026-06 | não existe (só Julho) |

Essas 5 estão **verdes** no calendário de Junho. Não há fatura alguma.

Distribuição atual de `energy_bill_status` (invoices de 2026, `fantasma` = valor 0 **e** sem PDF):

| energy_bill_status | qtd | fantasmas |
|---|---:|---:|
| pago | 28 | 0 |
| erro | 13 | 13 |
| pendente | 8 | 2 |
| parcelada | 8 | 0 |
| inconsistente | 6 | 0 |
| processing | 6 | 6 |
| success | 5 | **5** |
| contestada | 5 | 0 |
| consistente | 1 | 0 |

### 🔴 D2 — Comparação PT vs EN: `'pendente'` nunca casa com `'pending'`

Linha 2831 testa `energy_bill_status === 'pending'`, mas o banco grava `'pendente'`.
Resultado: fatura pendente → cai no catch-all → **verde** em vez de laranja.

Mesmo problema na escrita: `src/pages/dashboards/AuditGraphViewInvoiceSummary.jsx:1854` grava

```js
.update({ last_scraping_status: 'pendente' })   // ❌ português
```

enquanto todo o resto usa `'pending'`. Esse valor entra na linha 2841 (`!== 'success'` é
verdadeiro), vira `displayStatus = 'pendente'`, **não bate com nenhuma chave de cor** e o card
some das contagens do dia.

### 🟠 D3 — `last_scraping_status` é praticamente letra morta

Ele só é lido quando **não há invoice** do mês **e** é o mês corrente (linha 2840). Como o CRM
cria fatura fantasma ao entrar em "processando", `hasInvoice` é quase sempre `true` → o campo é
ignorado.

**Consequência prática observada:** em 31/07 marcamos 5 UCs como `error` via
`last_scraping_status` e **o calendário não mudou de cor**, porque a invoice do mês tinha
prioridade. Atualizar esse campo dá falsa sensação de correção.

### 🟠 D4 — `last_scraping_status` não tem mês (colisão entre meses)

O campo é um só por UC. Marcar `error` por causa de Julho sobrescreve o que valia para Junho —
o histórico "Julho ficou indisponível" não fica registrado em lugar nenhum. Hoje o dano visual é
contido pelo guard `isCurrentMonth`, mas outros consumidores do campo já sofrem:
`src/pages/dashboards/SubscriberList.jsx:264-265` conta leitura do mês com
`last_scraping_at.startsWith(month) && last_scraping_status === 'success'`, o que quebra assim
que o campo é sobrescrito por outro mês.

---

## 4. Solução proposta

### Princípio
**`invoices` (que tem `mes_referencia`) é a única fonte de verdade do status por mês.**
`consumer_units.last_scraping_status` passa a significar apenas *"resultado da última execução do
robô"* (telemetria operacional), **nunca** cor de calendário.

### Fase 1 — Correções imediatas (baixo risco, alto impacto)

**1.1 — Eliminar o catch-all `else → success`.** Só é verde o que for comprovadamente sucesso:

```js
const norm = s => (s ?? '').toString().trim().toLowerCase();

const ERROR_SET      = new Set(['erro', 'error', 'indisponivel', 'indisponível']);
const PROCESSING_SET = new Set(['processing', 'processando']);
const PENDING_SET    = new Set(['pending', 'pendente', 'aguardando']);
const SUCCESS_SET    = new Set(['success', 'sucesso', 'pago', 'parcelada', 'contestada', 'consistente']);

if (hasInvoice) {
    const s  = norm(matchingInvoice.status);
    const eb = norm(matchingInvoice.energy_bill_status);

    // fatura fantasma: sem valor E sem PDF => não é sucesso
    const isGhost = !Number(matchingInvoice.valor_concessionaria)
                 && !matchingInvoice.concessionaria_pdf_url;

    if (ERROR_SET.has(s) || ERROR_SET.has(eb))            status = 'error';
    else if (PROCESSING_SET.has(s) || PROCESSING_SET.has(eb)) status = 'processing';
    else if (PENDING_SET.has(s) || PENDING_SET.has(eb))   status = 'pending';
    else if (isGhost)                                     status = 'pending';   // ⬅️ nunca verde
    else if (SUCCESS_SET.has(s) || SUCCESS_SET.has(eb))   status = 'success';
    else                                                  status = 'pending';   // default seguro
}
```

> Regra de ouro: **o default deixa de ser `success` e passa a ser `pending`.** Verde só com prova.

**1.2 — Padronizar o vocabulário.** Escolher **inglês** (`pending | processing | success | error`)
e corrigir a escrita em português:
- `AuditGraphViewInvoiceSummary.jsx:1854` → `'pending'`
- Normalizar na leitura com os `Set`s acima (compatibilidade com o legado do banco).

**1.3 — Aplicar a regra de negócio de status** (confirmada pelo operador em 31/07/2026):

| Situação | Status |
|---|---|
| Fatura **baixada** do portal | `processing` |
| Revisão + upload concluídos no CRM | `success` |
| Leitura **vencida** e fatura **não disponível** no portal | `error` |
| Dia de leitura ainda não chegou | `not_available` (calculado no front) |

Hoje `ManualInvoiceUploadModal.jsx:401` já grava `success` no upload manual — **correto**, é o
único ponto que deve gravar `success`.

### Fase 2 — Correção estrutural (status por mês)

**2.1 — Marcar a fatura fantasma explicitamente.** Adicionar em `invoices`:

```sql
ALTER TABLE invoices ADD COLUMN is_placeholder boolean NOT NULL DEFAULT false;
```

Quem cria a fantasma passa a gravar `is_placeholder = true`. O front trata placeholder como
"aguardando" e nunca como sucesso. Isso elimina a heurística `isGhost` da Fase 1.

**2.2 — Status de leitura por mês.** Mover a semântica de leitura para a linha da fatura:

```sql
ALTER TABLE invoices ADD COLUMN reading_status text
  CHECK (reading_status IN ('pending','processing','success','error'));
ALTER TABLE invoices ADD COLUMN reading_checked_at timestamptz;
ALTER TABLE invoices ADD COLUMN reading_error text;
```

O calendário passa a ler `reading_status` da invoice do mês. `last_scraping_status` fica só como
telemetria do robô (última execução), sem influenciar cor.

**2.3 — Alternativa** (se não quiser tocar em `invoices`): tabela dedicada

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

Vantagem: não polui `invoices` e registra meses sem fatura (hoje impossível).

---

## 5. Ordem de execução sugerida

1. **1.1 + 1.2** (front + normalização) — resolve os verdes falsos sem migração.
2. Rodar a query de auditoria (seção 6) e conferir se o calendário de Junho/2026 mudou.
3. **2.1** (`is_placeholder`) — remove a heurística.
4. **2.2 ou 2.3** (status por mês) — resolve a colisão entre meses de vez.
5. Ajustar `SubscriberList.jsx:264-265` para ler o status por mês.

---

## 6. Validação — o que precisa ficar verdadeiro depois da correção

```sql
-- Nenhuma fatura sem valor e sem PDF pode contar como sucesso
SELECT trim(cu.numero_uc) AS uc, to_char(i.mes_referencia,'YYYY-MM') AS mes,
       i.status, i.energy_bill_status, i.valor_concessionaria
FROM invoices i JOIN consumer_units cu ON cu.id = i.uc_id
WHERE coalesce(i.valor_concessionaria,0) = 0
  AND i.concessionaria_pdf_url IS NULL
  AND i.energy_bill_status IN ('success','sucesso','pago')
  AND i.status::text <> 'cancelado';
-- Esperado APÓS a correção: 0 linhas.
-- Hoje (31/07/2026): 5 linhas (as 5 UCs de Junho/2026 da seção D1).
```

Checklist visual no Calendário de Leituras:
- [ ] Junho/2026: as 5 UCs da seção D1 deixam de aparecer verdes.
- [ ] Faturas com `energy_bill_status='pendente'` aparecem **laranja**, não verde.
- [ ] Nenhum card desaparece das contagens do dia (efeito do valor `'pendente'` inválido).
- [ ] Junho continua verde para quem tem fatura real com PDF (ex.: 7030004129, 7030004455).
- [ ] Julho permanece vermelho para as UCs sem fatura no portal.

---

## 7. Observações para quem for implementar

- **Não alterar dados sem alinhar antes**: a decisão sobre o que fazer com as 13 fantasmas
  `energy_bill_status='erro'` e as 5 `='success'` (apagar × marcar `is_placeholder`) é do
  operador. A recomendação é **marcar, não apagar**, para preservar histórico.
- `numero_uc` em `consumer_units` **pode conter espaço à esquerda** — sempre usar `trim()`.
- As UCs do assinante "ASSOCIACAO DE USINAS B2W ENERGIA"
  (`5a67c7d6-1f80-408d-bcf4-fe51aa8c0f3a`) vinculam por **`titular_fatura_id`**, não por
  `subscriber_id` (só 1 UC usa esse último).
- O filtro de fatura do mês aceita `mes_referencia` **ou** `vencimento` (linha 2815) — uma
  fatura de Junho vencendo em Julho aparece nos dois meses. Avaliar se é intencional.
