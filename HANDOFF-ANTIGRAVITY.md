# Handoff — Validação da Fase 2 + Proposta de Automação da Entrega

> Documento para o Antigravity. Duas partes independentes:
> **A)** validação do que foi implementado (com 1 lacuna crítica a fechar);
> **B)** proposta da próxima etapa (automatizar a entrega da conta de energia).
> Todos os números foram medidos no Supabase `abbysvxnnhwvvzhftoms` e no código em 05/08/2026.

---

# PARTE A — Validação da implementação (commits `8a4f292` + `147ae45`)

## ✅ Aprovado

| Item | Resultado |
|---|---|
| 4 colunas em `invoices` | ✅ `reading_status`, `reading_checked_at`, `reading_error`, `is_placeholder` |
| Backfill `reading_status` | ✅ **51 `success` — nenhum é fantasma** (regra de ouro cumprida) |
| Backfill `is_placeholder` | ✅ 12 `error` = 12 placeholders = 12 fantasmas reais |
| Faturas canceladas | ✅ 11 registros com `reading_status = NULL` (corretamente fora) |
| Filtro `cancelado` + `cancelada` | ✅ `InvoiceListManager.jsx:2855` |
| Calendário lendo a nova fonte | ✅ `InvoiceListManager.jsx:2866` |
| `SubscriberList` migrado | ✅ linhas 212 e 264 |

**Decisão de arquitetura elogiável:** em vez de duplicar a árvore 4.1 no front, o resultado foi
materializado no `reading_status` via backfill e o calendário passou a apenas *ler*. Isso é mais
limpo do que o originalmente proposto — mantém uma única implementação da regra.

## 🔴 Lacuna crítica — as ESCRITAS não foram fechadas

**11 arquivos** fazem `insert`/`upsert`/`update` em `invoices`.
**Apenas 2** preenchem `reading_status`:

- `ManualInvoiceUploadModal.jsx:388` → `'success'` ✅
- `AuditGraphViewInvoiceSummary.jsx:1854` → `'pending'` ✅

### O caso mais grave: `StandaloneAnalysisModal.jsx`

É o fluxo de processamento usado pelo operador no dia a dia.

```
linha 957:  energy_bill_status: finalEnergyBillStatus     ← grava
linha 963:  supabase.from('invoices').insert(payload)
linha 973:  supabase.from('invoices').upsert(payload, { onConflict: 'uc_id,mes_referencia' })
            reading_status                                 ← NÃO grava
```

**Efeito:** ao processar uma conta pelo Standalone, `reading_status` fica `NULL` e o calendário
exibe **"Pendente"**, mesmo com a conta processada e `energy_bill_status = 'a_vencer'`.

É o mesmo defeito de antes, na direção inversa: a **fonte de leitura** foi trocada sem migrar
todas as **fontes de escrita**. Hoje está mascarado porque o backfill preencheu o histórico —
mas a primeira conta processada após o deploy some do radar.

**Regra esperada:** processamento/extração concluída → `reading_status = 'success'` e
`reading_checked_at = now()`.

### Demais arquivos a revisar (escrevem em `invoices` sem preencher o campo)

`InvoiceFormModal` · `InvoiceSummaryModal` · `SubscriberModal` · `ProtocolModal` ·
`PlantClosingModal` · `ConsumerUnitModal` · `ReadingCalendarModal`

### 💡 Sugestão: trigger no Postgres em vez de disciplina em 11 lugares

Confiar que todos os fluxos (atuais e futuros) lembrem de preencher a coluna é frágil.
Um trigger `BEFORE INSERT OR UPDATE` que derive `reading_status` quando ele vier `NULL`,
aplicando **a mesma árvore 4.1 usada no backfill**, garante consistência mesmo em fluxos que
ninguém mapeou ainda. Os fluxos que quiserem gravar explicitamente continuam podendo.

### Teste que reproduz o problema

1. Processar uma conta de energia pelo Standalone.
2. Abrir o Calendário de Leituras no mês dela.
3. **Hoje:** aparece como *Pendente*. **Esperado:** *Processada*.

---

# PARTE B — Proposta: automatizar a entrega da conta de energia no CRM

## Contexto do fluxo atual (descrito pelo operador)

**Vocabulário — importante não confundir:**
- **conta de energia** = documento emitido pela concessionária (Cosern)
- **fatura** = cobrança da B2W ao assinante, já com o desconto aplicado

**Processo hoje:**
1. As contas são baixadas do portal da Cosern e ficam no Drive local
   (`G:\Meu Drive\Procon\Faturas\{Mês}`).
2. O operador abre *conta de energia → visualização por lista* e procura contas baixadas
   sem faturamento.
3. Faz o processamento no Standalone → a conta fica `a_vencer` ou `atrasado`.
4. Gera a fatura para o assinante.

**O incômodo:** entre (1) e (2) existe um passo manual — garimpar o PDF no Drive e subir um a um.

## O que já existe (levantado no código)

| Componente | O que faz | Local |
|---|---|---|
| `ManualInvoiceUploadModal` | extrai dados do PDF (pdfjs), carimba, sobe ao storage, faz upsert na invoice | `:300-404` |
| `BatchInvoiceProcessor` | **processa em lote** com extração completa (consumo, injetada, saldo, valor) + cobrança de tokens | `:540-607` |
| Storage | bucket `energy-bills` **público, 113 arquivos** já em uso | — |

**Conclusão:** o processamento automático **já existe**. Falta apenas a *entrega do arquivo*.

## ⚠️ Bloqueador a resolver antes: buckets inconsistentes

| Bucket | Existe? | Público | Arquivos | Usado por |
|---|---|---|---|---|
| `energy-bills` | ✅ | sim | **113** | `ManualInvoiceUploadModal:349` |
| `invoices_pdfs` | ✅ | não | 79 | `InvoiceFormModal`, `SubscriberModal` |
| `invoices` | ❌ **NÃO EXISTE** | — | — | `BatchInvoiceProcessor:570`, `StandaloneAccountModal:322` |

`BatchInvoiceProcessor` grava em `storage.from('invoices')`, um bucket inexistente. Como o
upload está dentro de `if (!uploadError && uploadData)`, **a falha parece ser silenciosa**: o PDF
não sobe e a invoice é salva sem anexo.

**Perguntas:**
1. Confirma que esse upload está falhando silenciosamente?
2. Qual bucket deve ser o padrão para conta de energia — `energy-bills`?
3. Há motivo para `invoices_pdfs` ser separado (privado), ou é legado a consolidar?

## 🔑 Multi-titular: qual login usar (novo — 05/08/2026)

O `ReadingCalendarModal` passou a exibir o campo **"Titular da Conta de Energia
(concessionária)"** com nome + CPF/CNPJ. Esse dado **é o login do portal** e resolve um ponto
essencial da automação: existe **mais de um cliente Cosern** no CRM, então o robô precisa saber
com qual acesso entrar para cada UC.

**Origem do dado (já disponível na query):**

```
consumer_units.titular_fatura_id → subscribers
   subscribers.name               = nome do cliente na concessionária
   subscribers.cpf_cnpj           = LOGIN do portal
   subscribers.portal_credentials = credenciais (jsonb)
```

`InvoiceListManager.jsx:653` já traz os três campos no join:
`titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name, cpf_cnpj, portal_credentials)`

**Titulares ativos hoje (todos Neoenergia Cosern):**

| Titular | Login (cpf_cnpj) | UCs | Credenciais |
|---|---|---:|:---:|
| ASSOCIACAO DE USINAS B2W ENERGIA | `64.561.352/0001-07` | 16 | ✅ |
| Waldiney Godoy | `83731830604` | 4 | ✅ |
| Nilton Paulino da Costa | `785.118.364-20` | 2 | ✅ |

### ⚠️ Problema: formato do CPF/CNPJ está inconsistente

Dois registros estão **com máscara** e um **sem**:

- `64.561.352/0001-07` — formatado
- `785.118.364-20` — formatado
- `83731830604` — **sem máscara**

O campo de login do portal da Cosern espera o documento formatado. Preencher com o valor cru
pode falhar. **A automação deve normalizar antes de preencher** — remover tudo que não é dígito
e reaplicar a máscara conforme o tamanho (11 = CPF, 14 = CNPJ):

```js
const formatDoc = (v) => {
  const d = (v || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
};
```

Vale também **padronizar os dados em `subscribers.cpf_cnpj`** para evitar o problema na origem.

### Regra operacional do login

O assistente/robô **preenche o campo de login com o `cpf_cnpj` do titular da UC** e para aí.
**Senha e captcha são sempre digitados pelo operador** — é uma barreira de segurança, não uma
limitação técnica. Exibir o titular + documento na tela deixa explícito **qual acesso está sendo
usado no momento**, evitando baixar conta na conta errada quando há vários clientes.

## Desenho proposto

```
para cada UC a processar:
   └─> resolve o login: consumer_units.titular_fatura_id → subscribers.cpf_cnpj (normalizado)
   └─> preenche o campo de login no portal  [operador digita senha + captcha]
robô baixa a conta do portal
   └─> upload direto no bucket padrão (energy-bills)
   └─> INSERT em invoices:
         reading_status   = 'processing'   (Baixada)
         status           = 'sem_faturamento'
         is_placeholder   = false
         valor_concessionaria, vencimento_concessionaria, concessionaria_pdf_url
   └─> CRM lista "contas de energia baixadas aguardando processamento"
   └─> operador processa em LOTE com o componente que já existe
```

**Agrupar por titular:** como cada login dá acesso apenas às UCs daquele titular, a fila de
download deve ser **agrupada por `titular_fatura_id`** — um login, todas as UCs daquele titular,
depois o próximo. Evita relogar a cada UC.

**Princípio: automatizar a entrega, não a extração.**
A extração roda no navegador (pdfjs) e está acoplada ao sistema de tokens (10 por conta).
Reimplementá-la numa Edge Function criaria duas implementações da mesma regra de negócio — que
divergem com o tempo. Melhor manter o cálculo em um lugar só e automatizar apenas o que hoje é
trabalho braçal.

**Ganho:** o passo manual cai de *"achar o arquivo no Drive e subir um a um"* para *um clique em
lote*, sem duplicar lógica.

## Perguntas para fechar o desenho

1. Existe alguma fila/tela de "contas aguardando processamento", ou o `BatchInvoiceProcessor` só
   aceita arquivos vindos do input do navegador?
2. O `BatchInvoiceProcessor` grava em `standalone_contas` (linha 607), não em `invoices` — ele
   atende o fluxo de UCs vinculadas ou só o Standalone avulso?
3. Concorda em manter a extração no front, ou vê motivo para movê-la ao backend?
4. Vale padronizar `subscribers.cpf_cnpj` (aplicar máscara em todos) ou é melhor normalizar só
   no consumo? Hoje há registro sem máscara (`83731830604`).
5. O que `subscribers.portal_credentials` guarda hoje — apenas usuário, ou também senha? Isso
   define o quanto o robô consegue fazer sozinho no login.

## Restrição conhecida (não contornável)

O **login no portal da Cosern exige a senha do operador** — essa etapa não é automatizável por
assistente. O robô Playwright do CRM (que já possui `portal_credentials`) é quem deve executar
o download. Do upload em diante, tudo pode ser automatizado.

---

## Ordem sugerida

1. **Fechar a Parte A** (escritas do `reading_status` + trigger) — sem isso, o processamento do
   operador quebra a exibição no calendário.
2. **Resolver os buckets** — pré-requisito da automação.
3. **Implementar a Parte B.**
