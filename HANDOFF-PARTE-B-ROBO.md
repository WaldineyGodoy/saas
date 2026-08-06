# Handoff — Parte B: Robô de Download de Contas de Energia

> Documento para o Antigravity. Objetivo: automatizar a **entrega** da conta de energia no CRM —
> do portal da concessionária até a fatura pronta para processamento, sem upload manual.
> Escrito em 05/08/2026, após conclusão da Parte A (trigger) e da blindagem do bucket.

---

## 0. Pré-requisitos já concluídos ✅

| Item | Estado | Impacto na Parte B |
|---|---|---|
| Coluna `reading_status` + trigger `ensure_reading_status` | ✅ em produção | O robô grava o status por mês; o trigger cobre omissões |
| Bucket `energy-bills` **privado** + RLS `authenticated` | ✅ validado (HTTP 400 no acesso público) | O robô precisa subir **autenticado** |
| `concessionaria_pdf_url` passou a guardar **só o path** | ✅ padrão novo | O robô deve gravar path, nunca URL completa |
| Helper `getSecurePdfUrl` | ✅ `src/lib/pdfHelper.js` | Leitura já resolvida, não mexer |

---

## 1. O fluxo operacional (como é hoje)

**Vocabulário — não confundir:**
- **conta de energia** = documento emitido pela concessionária (Cosern)
- **fatura** = cobrança da B2W ao assinante, já com desconto aplicado

**Processo atual:**
1. As contas são baixadas do portal da Cosern → ficam no Drive local do operador
2. Operador abre *conta de energia → visualização por lista* e procura **baixadas sem faturamento**
3. Processa no Standalone → a conta fica `a_vencer` ou `atrasado`
4. Gera a fatura para o assinante

**O gargalo:** entre (1) e (2) existe trabalho braçal — garimpar o PDF no Drive e subir um a um.
**A Parte B elimina exatamente esse passo.**

---

## 2. Multi-titular: qual login usar

Existe **mais de um cliente Cosern** no CRM. O robô precisa saber com qual acesso entrar para
cada UC.

```
consumer_units.titular_fatura_id → subscribers
   subscribers.name               = nome do cliente na concessionária
   subscribers.cpf_cnpj           = LOGIN do portal
   subscribers.portal_credentials = { url, login, password }  ← jsonb
```

`InvoiceListManager.jsx:653` já traz os três campos no join.
O `ReadingCalendarModal` já exibe **"Titular da Conta de Energia (concessionária)"** com nome +
CPF/CNPJ — assim o operador sabe qual acesso está em uso.

**Titulares ativos (todos Neoenergia Cosern):**

| Titular | Login (`cpf_cnpj`) | UCs |
|---|---|---:|
| ASSOCIACAO DE USINAS B2W ENERGIA | `64.561.352/0001-07` | 16 |
| Waldiney Godoy | `83731830604` | 4 |
| Nilton Paulino da Costa | `785.118.364-20` | 2 |

### ⚠️ Formato inconsistente do documento

`64.561.352/0001-07` e `785.118.364-20` estão **com máscara**; `83731830604` **sem**.
O campo de login do portal espera o documento formatado. **Normalizar antes de preencher:**

```js
const formatDoc = (v) => {
  const d = (v || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
};
```

### 🔑 As credenciais estão completas

**Todas as 13 subscribers têm `url`, `login` E `password`** em `portal_credentials`.
Ou seja, **o Playwright do CRM tem autonomia total no login** — não depende do operador.

> Observação: a restrição de "só o operador digita a senha" vale para o **assistente (Claude)**,
> não para o robô do CRM rodando com credenciais próprias do sistema.

### Agrupar por titular

Cada login só enxerga as UCs do próprio titular. A fila de download deve ser **agrupada por
`titular_fatura_id`**: um login → todas as UCs daquele titular → próximo titular.
Evita relogar a cada UC.

---

## 3. O que já existe (não reinventar)

| Componente | O que faz | Local |
|---|---|---|
| `ManualInvoiceUploadModal` | extrai dados do PDF (pdf.js), carimba, sobe ao storage, faz upsert | `:344-404` |
| `BatchInvoiceProcessor` | **processa em lote** com extração completa + cobrança de tokens (10/conta) | `:540-607` |
| `getSecurePdfUrl` | converte path/URL legada em Signed URL | `src/lib/pdfHelper.js` |

**Princípio: automatizar a entrega, NÃO a extração.**
A extração roda no navegador (pdf.js), tem regex maduro adaptado às faturas e tratamento de
falhas pelo operador. Reimplementá-la em Edge Function criaria duas implementações da mesma
regra de negócio — que divergem com o tempo. *(Já acordado entre nós.)*

---

## 4. Desenho proposto

```
para cada TITULAR (agrupado):
   ├─ resolve credenciais: subscribers.portal_credentials { url, login, password }
   ├─ login no portal (Playwright)  ← autônomo, credenciais no banco
   └─ para cada UC daquele titular:
        ├─ busca a UC pelo código do cliente
        ├─ abre a lista de faturas
        ├─ identifica a referência-alvo (mês)
        ├─ baixa o PDF
        ├─ upload AUTENTICADO em energy-bills
        │     path: invoices/{numero_uc}/{fileName}.pdf
        └─ UPSERT em invoices (contrato na seção 5)

→ CRM lista "contas de energia baixadas aguardando processamento"
→ operador processa em LOTE com o BatchInvoiceProcessor existente
```

---

## 5. Contrato de dados — o que o robô grava

Seguir **exatamente** o padrão do `ManualInvoiceUploadModal:361-390`, com **uma diferença
essencial** no `reading_status`:

```js
{
  uc_id,
  mes_referencia,                       // 1º dia do mês de referência
  vencimento_concessionaria,            // do portal
  valor_concessionaria,                 // do portal
  concessionaria_pdf_url: storagePath,  // ⚠️ SÓ O PATH, nunca URL completa
  status: 'sem_faturamento',            // ainda não virou cobrança ao assinante
  reading_status: 'processing',         // ⚠️ BAIXADA — não 'success'
  reading_checked_at: new Date().toISOString(),
  is_placeholder: false                 // tem dados reais
}
// upsert com onConflict: 'uc_id,mes_referencia'
```

**Por que `processing` e não `success`:**
regra de negócio do operador — `success` (**"Processada"**) só após **revisão + upload/processamento
no CRM**. O robô apenas baixa, então marca **"Baixada"**. O `ManualInvoiceUploadModal` grava
`success` porque ele *também executa a extração completa*; o robô não.

**Nomenclatura na UI (renomeada em 04/08):**

| Valor no banco | Rótulo na tela |
|---|---|
| `pending` | 🟠 Pendente |
| `processing` | 🔵 **Baixada** |
| `success` | 🟢 **Processada** |
| `error` | 🔴 Indisponível |

⚠️ **Nunca gravar `'baixada'`/`'processada'` no banco** — são apenas rótulos.

### Também atualizar a UC

```js
supabase.from('consumer_units')
  .update({ last_scraping_status: 'processing', last_scraping_at: new Date().toISOString() })
  .eq('id', uc.id);
```

---

## 6. Regras de negócio que o robô precisa respeitar

### 6.1 Conta mínima não gera PDF

Quando o valor é baixo, a Cosern **não emite PDF nem boleto** — o valor **acumula para o mês
seguinte**. No portal a fatura aparece na lista (ex.: R$ 31,69, marcada **"CONTA MÍNIMA"**), mas
o download falha com uma destas mensagens:

- *"Fatura indisponível no canal digital. Favor procurar demais canais."*
- *"Campos obrigatórios ausentes: [vlocity_cmt__CustomerInteractionId__c]"*

**Não é erro da automação e não deve ser retentado.** Ação correta:

```js
{
  reading_status: 'processing',        // Baixada — para a automação parar de buscar
  reading_error: '[INFO] Conta minima - concessionaria nao emite PDF/boleto; saldo acumula para o mes seguinte. Nao reprocessar.',
  valor_concessionaria: <valor da lista>,
  is_placeholder: false
}
```

**Detector:** itens de conta mínima **não têm checkbox** na lista do portal — só abrem via
`MAT-EXPANSION-PANEL-HEADER` com botão "Baixar" (que falha). Casos reais: UC `7030834911` e
`7030839085` (Julho/2026, R$ 31,69).

### 6.2 Leitura vencida sem fatura → `error`

Passou o `dia_leitura` do mês e a conta não saiu no portal → `reading_status = 'error'`
(🔴 Indisponível). Não deixar em `pending`.

### 6.3 A ordem da lista NÃO é cronológica

O portal às vezes lista Junho antes de Abril, ou Julho antes de Junho.
**Ler a REFERÊNCIA de cada item** e casar pelo mês — nunca assumir que o índice 0 é o mais
recente. Erro observado várias vezes na operação manual.

---

## 7. Detalhes técnicos do portal (aprendidos na operação manual)

Portal: `https://agenciavirtual.neoenergia.com`

| Etapa | Como funciona |
|---|---|
| Navegação | SPA Angular por **hash**: `#/home/meus-imoveis`, `#/home/servicos/consultar-debitos` |
| Estado | Selecionar **Rio Grande do Norte** após o login |
| Buscar UC | Campo com placeholder contendo `"digo"` (Código do Cliente) → botão **Pesquisar** |
| Selecionar UC | O código aparece com zeros à esquerda: `00` + `numero_uc` (ex.: `007030003980`). Subir até o `LI` e clicar em `div.row` |
| Após selecionar | O app **redireciona para `#/home`** — navegar para `consultar-debitos` **depois**, com espera |
| Lista de faturas | Checkboxes com id `checkItem-{N}-input` |
| Download | marcar checkbox → botão **Download** → modal *"Por qual motivo…"* → selecionar **"Não Estou Com Fatura Em Mãos"** → botão **BAIXAR** |
| Entre downloads | Fechar o diálogo *"Download realizado com sucesso"* (botão OK) antes do próximo — o empilhamento causa falha |
| Status da UC | `span.btn-status-imovel` com texto `LIGADA` / `DESLIGADA`. ⚠️ vem colado ao CEP no `textContent` — usar o seletor de classe, não regex no texto |
| Paginação | ~5 UCs por página; links numéricos no rodapé |

**Instabilidades observadas:** o portal trava em *"Aguarde um instante…"* com alguma frequência
e pode derrubar a sessão. Prever **timeout + retry com backoff**, e não assumir que a sessão
sobrevive a toda a fila.

**Nome de arquivo:** o download chega com nome aleatório `.tmp` (é PDF válido — header `%PDF`).
Renomear/validar antes de subir.

---

## 8. Perguntas em aberto

1. **Fila de processamento:** existe alguma tela de "contas aguardando processamento", ou o
   `BatchInvoiceProcessor` só aceita arquivos vindos do input do navegador? Se só aceita input,
   qual a menor mudança para ele consumir contas já no storage?
2. **Onde o robô roda:** já existe um runner Playwright no CRM (o `last_scraping_error` sugere
   que sim — havia erros do tipo `locator.waitFor: Timeout 35000ms exceeded`). É serviço
   próprio? Cron? Onde ficam os logs?
3. **Upload autenticado:** com o bucket privado, o robô precisa de sessão válida ou service role
   para subir. Qual credencial ele usa hoje?
4. **`BatchInvoiceProcessor` grava em `standalone_contas`** (linha 607), não em `invoices` — ele
   atende o fluxo de UCs vinculadas ou só o Standalone avulso? Isso muda o desenho da fila.
5. **Tokens:** o processamento em lote consome 10 tokens por conta. Uma automação em volume
   impacta esse saldo — há política definida?

---

## 9. Riscos e cuidados

- **Não retentar conta mínima** (seção 6.1) — geraria loop infinito de falhas.
- **Não assumir ordem cronológica** da lista (seção 6.3).
- **Nunca gravar URL completa** em `concessionaria_pdf_url` — só path (bucket agora é privado).
- **Idempotência:** usar `upsert` com `onConflict: 'uc_id,mes_referencia'`. Rodar o robô duas
  vezes no mesmo mês não pode duplicar conta.
- **Não sobrescrever `reading_status` já definido:** o trigger só preenche quando vem `NULL`.
  Se o robô mandar valor explícito, ele prevalece — cuidado para não rebaixar uma conta já
  `success` (processada) de volta para `processing`. **Sugestão:** ao reprocessar, só gravar
  `processing` se o `reading_status` atual não for `success`.
- **Credenciais em `portal_credentials`:** contêm senha em texto. Vale avaliar criptografia ou
  Vault do Supabase — fora do escopo desta etapa, mas registrado.

---

## 10. Ordem sugerida

1. Responder as perguntas da seção 8 (principalmente 1, 2 e 3 — definem a arquitetura).
2. Fechar as **escritas de `reading_status`** pendentes da Parte A
   (`StandaloneAnalysisModal` e demais) — sem isso, a conta processada pelo operador aparece
   como Pendente.
3. Implementar a fila + o robô conforme seções 4 e 5.
4. Piloto com **um titular** (Associação B2W, 16 UCs) antes de liberar para todos.
