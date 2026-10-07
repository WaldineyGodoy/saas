# Handoff — Leitura de conta, termo aditivo e adesão por documentos

Atualizado em 05/10/2026. Branch `claude/laughing-galileo-ayvgqt` (repo `WaldineyGodoy/saas`).
Supabase: projeto `abbysvxnnhwvvzhftoms`.

## Onde paramos

O **termo aditivo** (assinante existente inclui UC nova pelo app) está implementado e publicado.
A **adesão começando pelos documentos** (CNH/RG → assinante, conta → UC) está **planejada e
aprovada, sem código**: [plano-adesao-por-documentos.md](plano-adesao-por-documentos.md).

### Git

- Commits desta frente (do mais antigo ao mais novo): `0bdd3ca`, `a8ba6a0`, `20a6734`, `94dc9df`,
  `6b7e2a1` (já no GitHub) e `d694ea2`, `da81bb5`, `e7d8085`, `3ebdf0f` + este handoff
  (**só locais, falta `git push`**).
- Fora do git de propósito: `Imagens provisorias/` (foto e PDF de clientes reais; o repositório é
  público) e `supabase/.temp/cli-latest`.
- `tests/fixtures/*.pdf` estão no `.gitignore` (contas reais); os testes usam `*.txt` anonimizados.

### Já está em produção (Supabase)

| O quê | Detalhe |
|---|---|
| Migration `20261004h_pedido_nova_uc` | `leads.conta_lida`, `leads.solicitante_assinante_id`, `app_solicitar_nova_uc`, `fn_lead_adesao`, `fn_uc_normalizada` |
| Migration `20261005a_termo_aditivo_nova_uc` | `planos_distribuidoras`, `leads.plano_id`, `app_planos_para_uc`, `app_meus_pedidos_uc`, `fn_uc_ja_cadastrada`, `fn_nome_comparavel`, `fn_criar_uc_do_aditivo` |
| `parse-invoice-image` | Lê foto **e PDF** de conta (OpenRouter; PDF pelo conversor gratuito `cloudflare-ai`); devolve campos derivados |
| `aditivo-nova-uc` (nova) | Pedido + plano + PDF do termo no servidor (pdf-lib) + Autentique |
| `autentique-webhook` | Termo `aditivo_uc` assinado → `fn_criar_uc_do_aditivo` (UC em `em_ativacao`) |
| `create-autentique-document` | **Fechada**: só equipe interna ou chave de servidor (antes era aberta a qualquer um) |
| Secret `OPENROUTER_MODEL` | `openai/gpt-6-luna` (testado contra Gemini 3.8 Flash e Sonnet 5.5: os três acertaram tudo) |
| Autentique | Em **sandbox** (`integrations_config.environment`) |

### O que cada tela faz hoje

- **CRM, modal "Upload Conta" da UC:** aceita PDF ou foto; foto vira PDF de uma página.
  (Corrigidos dois erros antigos: import faltando e pdfjs nunca carregado — PDF nunca era lido.)
- **CRM, lead → aba "Conta de Energia":** lê PDF/foto, guarda em `conta_lida`, preenche endereço e
  consumo vazios, copia o link de adesão `/contrato?lead_id=`.
- **Adesão `/contrato?lead_id=`:** nome, contato, endereço e a 1ª UC vêm preenchidos.
- **CRM, Configurações → Planos:** seção "Disponível nas distribuidoras".
- **App (Expo), aba Energia → "Adicionar UC pela conta de luz":** foto/PDF → plano → conferir →
  assinar o termo (navegador interno); pedidos em andamento com "Assinar termo".

## Pendências antes de liberar o termo aditivo para clientes

1. **Marcar as distribuidoras dos planos** no CRM (hoje nenhum plano marcado → o app mostra
   "Ainda sem plano para esta região").
2. **Revisão jurídica** do texto do termo (`supabase/functions/_shared/termo-aditivo.ts`).
3. **Teste ponta a ponta com login de assinante** (não feito: falta conta de assinante de teste):
   app → assinar na Autentique sandbox → webhook cria a UC em "Em ativação" → WhatsApp padrão sai.
4. Ao virar a Autentique para produção, refazer o teste do item 3.

## Próximos passos (adesão por documentos)

Ordem aprovada no plano:

1. **Leitura da CNH/RG** (Edge Function nova, mesmo padrão de `parse-invoice-image`) e funções de
   banco por etapa: `fn_adesao_criar_assinante` e `fn_adesao_incluir_uc` (plano obrigatório da
   distribuidora; marca "TT pendente" quando o nome da conta difere). Testes em transação desfeita.
2. **Site `/contrato`:** Identidade → Contato → Contas → Contrato; fluxo antigo fica como
   alternativa ("não estou com a CNH agora").
3. **App:** cadastro de cliente novo (criar login + mesmos passos).
4. **CRM:** sinal de "TT pendente" na UC e no assinante.

Estimativa: 4 a 5 dias.

## Avisos para quem continuar

- `supabase/migrations/20261004f_funcoes_definer_restritas.sql` revoga EXECUTE por lista; se for
  reaplicada, tira a permissão das funções novas (`app_solicitar_nova_uc`, `fn_lead_adesao`,
  `app_planos_para_uc`, `app_meus_pedidos_uc`). Incluir na lista se ela for rodada de novo.
- Arquivos do repo usam CRLF em parte; editar preservando o fim de linha.
- O `expo start` reescreve `mobile/tsconfig.json` (include de typed routes); não commitar sem querer.
- Leitura de conta só conhece **Neoenergia Cosern** (dois layouts).
- Para ver o app sem login: configuração `app-mobile-web-demo` em `.claude/launch.json` do workspace
  (Expo web com `EXPO_PUBLIC_DEMO=1`, porta 8081). CRM local: `saas-mobile-dev` (porta 5173; usa
  `saas-mobile/.env.local`, ignorado pelo git).

---

# Lançamento do app para consulta (iniciado em 05/10/2026)

A adesão por documentos está **suspensa** até nova ordem do dono. Foco: publicar o app para
assinantes, UCs, faturas, usinas e fornecedores consultarem o que já existe no CRM.

## Decisões do dono

| Item | Decisão |
|---|---|
| Segurança dos dados | Fechar tudo antes de abrir — **feito** (abaixo) |
| Extrato de pagamento | Fica para a **V1.1** |
| Convite de quem não tem login | O dono envia pelo WhatsApp |
| Recuperar senha | Criar tela no app |
| Excluir conta / cancelar | Criar botão no app |
| Política de privacidade | O dono já tem; vai mandar os links |
| Contas Apple e Google | O dono vai criar |
| EAS (build e envio) | Claude configura |
| Ficha das lojas | Claude escreve |
| Conta de teste para a revisão | O dono cria |
| Teste em celular (TestFlight / teste interno) | Na etapa de testes |

## Feito

- `20261005b` e `20261005c` (produção): fim das policies "true". Equipe vê tudo como antes;
  originador só a própria comissão e o histórico da própria carteira; fornecedor só protocolos,
  rateios e áreas das próprias usinas; assinante e fornecedor não leem o histórico do CRM.
  Testado por papel em transação desfeita e nas telas do CRM com sessão de admin.

- `e38be0d`: **recuperar senha por código** (tela `(auth)/recuperar-senha`), **excluir conta**
  (opção b do dono: apaga o login e abre protocolo de cancelamento; `excluir-conta-app` +
  `20261005d`) e **política de privacidade** no login e em "Mais".

## Pendências do dono para o lançamento

- **Template de e-mail de recuperação** (Supabase → Authentication → Emails → Reset password):
  incluir o código `{{ .Token }}` além do link, senão o app não tem o que digitar.
- Proteção contra senhas vazadas (Authentication → Password security).
- Contas Apple e Google, conta de teste para revisão, convites por WhatsApp (depois dos testes).

## Próximos passos (Claude)

1. **EAS**: `eas init` (projectId no app.json), variáveis `EXPO_PUBLIC_*` no EAS, perfis de build.
2. **Ficha das lojas**: textos, palavras-chave, classificação, respostas de privacidade/Data safety.
3. Teste do fluxo de recuperação com e-mail real, quando houver conta de teste.
