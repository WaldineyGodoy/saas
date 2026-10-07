# Plano — Termo aditivo para nova UC de assinante existente

Status: **implementado em 05/10/2026** (commits `d694ea2`, `da81bb5` e o do app). Pendente: revisão
jurídica do texto, marcar as distribuidoras dos planos no CRM e um teste ponta a ponta com login de
assinante na Autentique (sandbox).

## Contexto

Hoje (commits `94dc9df` e `6b7e2a1`):

- O assinante pede uma UC nova no app fotografando a conta → `app_solicitar_nova_uc` cria um **lead**
  com `conta_lida` e `solicitante_assinante_id` preenchidos. Não cria UC.
- Cliente novo segue pela adesão pública (`/contrato?lead_id=`), que cria assinante + UCs e manda o
  Termo de Ingresso e Adesão para a Autentique. Ela **recusa CPF/CNPJ que já tem assinatura**.
- Para o assinante existente não há o que assinar: o pedido fica parado no lead.

Regra do dono: a UC só nasce depois do termo assinado; se não assinar ou for reprovado na análise
de crédito, nada avança.

## 1. Decisões do dono (05/10/2026)

1. **Texto:** o rascunho da seção 3 é a base; o jurídico revisa antes do primeiro envio real.
2. **Quem assina:** só o assinante. Conta em nome de outra pessoa segue pelo termo de
   transferência de titularidade que já existe no CRM.
3. **Desconto:** o assinante escolhe um **plano** entre os disponíveis para a região da UC; o
   desconto é o do plano (`planos_assinatura_energia.desconto_assinante`).
4. **Análise de crédito:** não há para assinante existente; o termo sai direto.
5. **Tudo no app:** ler a conta → escolher o plano → conferir → assinar. Sem passo da equipe.
6. **Link:** só dentro do app (botão "Assinar termo" e aviso de termo pendente na aba Energia).
7. **Depois de assinado:** a UC é criada automaticamente em "Em Ativação", com o plano escolhido.

8. **Plano por região:** ligação **plano × distribuidora**. Cada plano é criado para determinadas
   distribuidoras; o app mostra só os planos ativos ligados à distribuidora da UC lida.
   Implica: tabela `planos_distribuidoras` (plano_id, concessionaria) e marcação das distribuidoras
   no cadastro de planos em Configurações.

## 2. Fluxo (atualizado)

```
app: lê a conta → escolhe plano (região da UC) → confere → "Assinar termo"
servidor (Edge Function nova, com sessão do assinante):
     cria o lead/pedido (app_solicitar_nova_uc) com plano_id
     gera o PDF do aditivo NO SERVIDOR (pdf-lib), porque não há CRM no meio
     cria o documento na Autentique (signatário sem e-mail → link público)
     signatures: signer_type='lead', signer_id=lead.id, document_type='aditivo_uc'
     devolve o link → o app abre a assinatura no navegador interno
assinante assina
webhook: signed + 'aditivo_uc' → fn_criar_uc_do_aditivo(lead_id): UC 'em_ativacao' com
     plano_assinatura_id, idempotente; lead 'ativacao'; crm_history
app: aviso "Termo pendente" enquanto não assinar (pode reabrir o link)
```

## 3. Rascunho do texto (para revisão jurídica)

> **TERMO ADITIVO AO TERMO DE INGRESSO E ADESÃO — INCLUSÃO DE UNIDADE CONSUMIDORA**
>
> (I) ASSOCIAÇÃO: Associação de Usinas B2W Energia, CNPJ 64.561.352/0001-07 (qualificação igual à
> do termo de adesão). (II) ASSOCIADO: [nome, CPF/CNPJ, endereço — do cadastro do assinante].
>
> **Cláusula 1 – Do objeto.** Inclui no Termo de Ingresso e Adesão firmado pelo ASSOCIADO a unidade
> consumidora nº [numero_uc], titular na distribuidora [titular da conta], localizada em
> [endereço da UC], atendida pela [distribuidora].
>
> **Cláusula 2 – Das condições.** Aplicam-se à UC incluída todas as cláusulas do Termo de Ingresso
> e Adesão, inclusive elegibilidade (Cl. 3), contribuição e desconto (Cl. 5 e 6), faturamento
> (Cl. 7), titularidade (Cl. 16) e representação operacional (Cl. 17).
>
> **Cláusula 3 – Do desconto.** Para a UC incluída, o desconto por pagamento pontual é de [X]%.
>
> **Cláusula 4 – Do início.** A compensação na UC incluída só começa após a análise de
> elegibilidade e o aceite da distribuidora, nos termos da Cláusula 3 do Termo de Adesão.
>
> **Cláusula 5 – Da ratificação.** Permanecem inalteradas as demais cláusulas do Termo de
> Ingresso e Adesão.
>
> Folha final: **Procuração para liberação de acesso** da UC incluída (mesmo modelo da adesão).

## 4. O que muda no código

| Parte | Mudança |
|---|---|
| Banco (migration nova) | `fn_criar_uc_do_aditivo(p_lead uuid)` (service_role), idempotente; `app_meus_pedidos_uc()` para o app listar pedidos e o link de assinatura pendente |
| `src/lib/contratoAditivo.js` | Texto + PDF no padrão de `contratoTransferencia.js` (usa `contratoBase`) |
| CRM, aba Conta de Energia do lead | Para pedido do app: desconto, "Aprovar e enviar termo", situação da assinatura, reenviar/cancelar |
| `autentique-webhook` | Ramo `signer_type='lead'` + `document_type='aditivo_uc'` → chama a função do banco |
| App | Card "Termo pendente — assinar" na aba Energia; o pedido mostra a situação |
| Testes | Texto do termo (vitest), função do banco em transação desfeita, ramo do webhook |

## 5. Riscos e pré-requisitos

- **`create-autentique-document` está aberta** (`verify_jwt = false`, sem checagem de login): qualquer
  um cria documentos na Autentique e insere linhas em `signatures`. Precisa ser fechada **antes**
  de o webhook criar UC a partir de assinatura. Já há uma tarefa sugerida para isso.
- O PDF do aditivo é gerado no servidor (pdf-lib), diferente dos outros contratos, que saem do
  navegador. O layout precisa ficar equivalente ao do termo de adesão.
- Leitura de conta só da Neoenergia Cosern.

## 6. Esforço estimado

Cerca de 2 dias depois das respostas da seção 1: meio dia de banco e webhook, um dia de CRM (texto,
PDF, envio) e meio dia de app e testes.
