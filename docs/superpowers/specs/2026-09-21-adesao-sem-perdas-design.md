# Adesão sem perdas — subprojeto A da Jornada do Lead

Data: 21/09/2026 · Branch: `impl/adesao-sem-perdas` · Ordem dos subprojetos: **A → C → B**

- **A — Adesão sem perdas** (este documento): do clique na página até "contrato assinado com documentos anexados".
- **C — Notificações da jornada**: um evento por etapa, no servidor, com cadeado. A 1ª parte (fechar `send-whatsapp`/`send-email`) entra aqui, em §5.
- **B — Esteira operacional**: vínculo com capacidade → TT → rateio → 15 dias → ativo.

## Por que

Mapeamento de 21/09/2026 (4 agentes, só leitura):

- 32 dos 38 leads parados em `simulacao`; 0 dos 13 assinantes tem `lead_id`; nenhuma adesão pública concluída em produção.
- Link curto de todo embaixador cai em 404 (`/convite/`). "Seja um embaixador" da raiz leva a `/embaixador` → 404.
- O cadastro de embaixador grava `profiles.role = 'lead'` (o `signUp` roda antes do INSERT em `originators_v2`).
- `originator_id` que não é UUID derruba a adesão; a RPC não herda o originador do lead.
- A RPC não grava `desconto_assinante` nem `dia_vencimento`: o contrato sai em 20% e dia 10 fixos, diferente do que o simulador mostrou.
- Signatário com e-mail na Autentique pode devolver link de gestão (404 para o cliente); `onboarding-finalizar` não confere.
- `send-email` ignora `text`: o e-mail de contrato do CRM chega com "Sua fatura está disponível." e sem link.
- Não existe anexo de CNH/RG nem de conta de energia; faltam CPF do titular da conta, representante legal (CNPJ), tipo de ligação, vencimento e aceite LGPD.
- `onboarding-finalizar`, `send-whatsapp` e `send-email` são anônimos e sem portão.

## §1 Entrada

1. **Hostinger (`.htaccess` do `public_html`)**: `301` de `/convite/` e `/assine/` para `/`, preservando a query string. A raiz já lê `?name=&id=` e grava `leads.originator_id`. Os links curtos do YOURLS voltam a funcionar sem regravação. Aplicado pelo dono no gerenciador de arquivos; o texto vai pronto.
2. **Página "cadastro para ser embaixador"** (`Paginas/landingpage cadastro para ser embaixador`): build com `base: '/embaixador/'` (já configurado), sem o `<link href="/index.css">`, commitado na pasta `embaixador/` do **branch `Home`** do repo `WaldineyGodoy/paginas` (o branch que publica a raiz). Endereço: `https://b2wenergia.com.br/embaixador/` — o mesmo para onde o botão da raiz já aponta. A página de convite (`landingpage_embaixador`) **não** é publicada: o 301 a substitui.
3. **Papel do embaixador**: gatilho `trg_originador_confirma_perfil` AFTER INSERT em `originators_v2` (função SECURITY DEFINER `fn_originador_confirmar_perfil()`): grava `profiles.role = 'originator'` onde `profiles.id = NEW.id`, `role IN ('lead')` e o e-mail bate. Gatilho, e não chamada do front, porque o `signUp` com confirmação de e-mail pode não abrir sessão e o INSERT roda como `anon`. Migração corrige os perfis `lead` que têm linha em `originators_v2`.
4. **Login do embaixador**: botão "Ir para Login" → `https://crm.b2wenergia.com.br/login`.
5. **Colunas do anon em `originators_v2`**: INSERT anônimo restrito por grant de coluna às colunas do formulário; `split_commission`, `short_url` e similares ficam fora.
6. **Atribuição**: em `SubscriberSignup.jsx`, `originator_id` que não casa com regex de UUID é descartado. Na RPC, `p_originator_id` nulo ⇒ usa `leads.originator_id` do `p_lead_id`.

## §2 Passo "Dados" — `fn_criar_assinante_publico` v2

Campos novos coletados em `/contrato`:

| Campo | Onde grava | Regra |
|---|---|---|
| Representante legal: nome e CPF | `subscribers.representante_nome`, `representante_cpf` (novas) | obrigatórios quando o documento é CNPJ; CPF validado por `fn_documento_valido` |
| CPF/CNPJ do titular da conta, por UC | `consumer_units.cpf_cnpj_fatura` | obrigatório e válido |
| Tipo de ligação, por UC | `consumer_units.tipo_ligacao` | obrigatório (mono/bi/tri) |
| Dia de vencimento | `consumer_units.dia_vencimento` de todas as UCs | 5, 10, 15 ou 20 |
| Aceite de termos e LGPD | `subscribers.aceite_termos_em`, `aceite_termos_versao` (novas) | obrigatório; sem aceite a RPC recusa |

Regras da RPC:

- **Desconto no servidor**: `desconto_assinante` de cada UC = `"Desconto Assinante"` da `Concessionaria` pelo `"Cod. Ibge"` (novo parâmetro `p_ibge`, vindo do ViaCEP); sem linha para o município, a média da UF — a mesma regra da raiz. Valor da URL é ignorado. Desconto resolvido nulo ou zero ⇒ a RPC recusa ("Ainda não temos desconto disponível para este município"): o contrato não pode imprimir o padrão de 20% para quem não tem desconto.
- **Duplicidade**: CPF/CNPJ bloqueado se houver assinante em qualquer status exceto `cancelado`/`cancelado_inadimplente` (mesma regra do `SubscriberModal`, que passa a usar a mesma função). Número de UC bloqueado se já existir em UC não cancelada de outro assinante.
- **Retorno**: `{subscriber_id, onboarding_token}`. Token = `uuid` em `subscribers.onboarding_token` (nova), válido por 30 dias (`onboarding_token_expira_em`), anulado quando o contrato é assinado.
- **Retomada**: o front grava `?retomar=<token>` na URL (`history.replaceState`). Abrir `/contrato?retomar=<token>` carrega o estado pela RPC `fn_onboarding_estado(p_token)` (SECURITY DEFINER, anon): etapa atual, dados do assinante e das UCs (o PDF do contrato é gerado no navegador e precisa deles) e documentos já enviados. O token é a credencial: só o dono do link o tem.

## §3 Passo "Documentos"

- Bucket privado `documentos-assinante`; caminho `<subscriber_id>/<tipo>/<uuid>.<ext>`.
- Tabela `subscriber_documents (id, subscriber_id, consumer_unit_id null, tipo, storage_path, mime, tamanho, criado_em)`, `tipo ∈ {identidade, conta_energia, contrato_social}`. RLS: leitura e escrita só `authenticated` com papel interno; anon nunca lê.
- Obrigatórios: 1 `identidade` (do titular, ou do representante se CNPJ); 1 `conta_energia` por UC; 1 `contrato_social` se CNPJ.
- Edge Function `onboarding-documentos` (anônima, portão = token válido): ação `url` devolve URL de upload assinada (PDF/JPG/PNG, ≤ 10 MB); ação `registrar` confere que o objeto existe e grava a linha.
- CRM: aba "Documentos" no `SubscriberModal`, lista com visualização por URL assinada.

## §4 Passo "Contrato" — `onboarding-finalizar` v4

- Exige `onboarding_token` válido; `subscriber_id` vem do token, não do corpo.
- Recusa (409) se faltar documento obrigatório, dizendo qual.
- **Idempotente**: se já existe `signatures` pendente do assinante, reenvia o mesmo link curto; não cria outro documento.
- Signatário **sem e-mail** na Autentique. Se `signingLinkFound` for falso: não envia nada, grava `crm_history` com o erro e responde 502; a tela diz que a equipe vai entrar em contato.
- Mesmo link curto (YOURLS) no WhatsApp e no e-mail. `send-email` passa a aceitar `text` e `html`; e-mail com modelo HTML e botão "Assinar contrato".
- Texto do contrato (`src/lib/contrato.js`): desconto e vencimento das UCs; qualificação do representante quando CNPJ.
- Página de termos (`Paginas/Contrato`): recebe `Linkdocontrato`, `nome`, `concessionaria`, `desconto`; **não** recebe CPF nem endereço; resumo alinhado às 22 cláusulas da versão 3.0.
- Aviso ao originador sai do navegador e passa a ser enviado por `onboarding-finalizar`.

## §5 Segurança do envio (1ª parte do subprojeto C)

- `send-whatsapp` e `send-email` passam pelo portão `_shared/auth.ts`: administrador logado, `service_role`, ou header `x-b2w-internal` igual ao segredo do Vault `b2w:internal_secret`. O `fn_dispatch_notification` lê o segredo do Vault e manda no header; a Edge Function o confere pela RPC `fn_segredo_interno_confere(p_valor)` (só `service_role`), sem depender de variável de ambiente.
- Chamadas do navegador que hoje usam essas funções continuam funcionando para usuário interno logado; a única chamada anônima (`SubscriberSignup.jsx`) é removida em §4.

## §6 Limpeza

Apagar `src/pages/LeadSignup.jsx`, `src/pages/ReferralLanding.jsx`, `src/pages/LeadSimulation.jsx` (sem rota nem import).

## §7 Testes

- **Banco** (`supabase/tests/*.test.sql`, padrão `SANDBOX_OK`): RPC v2 (desconto por IBGE e por UF, recusa sem aceite, recusa de CNPJ sem representante, duplicidade de CPF e de UC, herança do originador do lead, `originator_id` inválido), `fn_onboarding_estado`, gatilho `trg_originador_confirma_perfil`.
- **Edge Functions** (`deno test`): regras puras extraídas em módulos — completude de documentos, escolha e validação do link de assinatura, idempotência, portão interno.
- **Front** (Vitest, novo): `contrato.js` — desconto, vencimento, representante.
- **Ponta a ponta real, Autentique em Sandbox**, dois caminhos: raiz com `?name=&id=` de um embaixador, e raiz sem embaixador. Contato real: WhatsApp **5533999991234**, e-mail **b2wnotificacoes@gmail.com**; demais dados fictícios válidos, CEP 59158-155. Conferir: WhatsApp e e-mail com o mesmo link curto, documentos no bucket, entidades no CRM (lead, assinante, UCs com desconto/vencimento, perfil, assinatura), lead derivado pelo gatilho. Webhook de assinatura em Sandbox → `contrato_assinado`. Autentique volta a produção e os dados de teste são apagados no fim.

## Dados anteriores

Decisão do dono (21/09/2026): os leads e vínculos lead→assinante criados antes desta implementação têm vício de dados e são descartados da jornada. Sem backfill de `lead_id`, sem migração de status, sem reprocessar os 32 leads em `simulacao`. Só leads gerados depois do deploy contam como válidos. Nada é apagado por esta implementação.

## Fora do escopo

Lembretes de adesão incompleta e notificações por etapa (C); TT, rateio, capacidade e ativação (B); unificar os três simuladores (o desconto passa a vir do servidor, a divergência deixa de chegar ao contrato); OCR da conta de energia.
