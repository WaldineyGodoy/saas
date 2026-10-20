# Bel, a recepção — Implementation Plan

> **For agentic workers:** executado inline em 20/10/2026 (executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** recepção do WhatsApp que identifica o contato, colhe nome/cidade/estado, descobre a concessionária, não despeja lista e grava os dados no card e no lead da B2W; rastreio de indicação/campanha do site.

**Architecture:** abertura comum nas regras dos 8 agentes (o roteador do Deskcomm troca de agente no mesmo turno); servidor MCP próprio (`b2w-mcp`) com duas ferramentas de leitura; gatilhos da ponte copiam campos do card para o lead; o site põe um código no texto do WhatsApp.

**Tech Stack:** Postgres/Supabase, Edge Functions Deno (MCP JSON-RPC por Streamable HTTP), vitest, HTML estático (Hostinger, branch `Home`).

## Global Constraints

- Falas exatas da spec §3 (abertura, nome, cidade, estado, produto, origem, cliente ativo, lead que voltou, não-lead).
- Ponte nunca sobrescreve dado preenchido no CRM; gatilhos com `exception when others` → `ponte_deskcomm.erros`.
- `b2w-mcp` só leitura, só tipo + primeiro nome, telefone só pelo cabeçalho `X-Deskcomm-Contato-Telefone`.
- Termômetro só em funil de produto com ≥ 3 mensagens do cliente.

---

### Task 1: Servidor MCP `b2w-mcp`
**Files:** `supabase/functions/b2w-mcp/logica.ts`, `index.ts`; Test `tests/b2w-mcp.test.ts`
- [x] Normalização (cidade sem acento, UF por sigla/nome, telefone), protocolo (initialize, notificação, tools/list, tools/call, erros), token em tempo constante → 13 testes passando.
- [x] Publicada com `--no-verify-jwt`; sem token e token errado → 401; GET → 405.

### Task 2: Migration da ponte
**Files:** `supabase/migrations/20261020c_bel_recepcao.sql`, `20261020d_concessionaria_uf_com_espaco.sql`
- [x] RPCs `b2w_mcp_concessionaria` / `b2w_mcp_identificar`; `fn_card_para_lead` ignora `nao_lead`; gatilhos `trg_ponte_card_campos_preencher` (antes), `trg_ponte_card_para_lead_campos` (depois), `trg_ponte_contato_para_lead`, `trg_ponte_mensagem_rastreio`; `ponte_deskcomm_para_avaliar` só especialista.
- [x] Teste em transação desfeita: concessionária preenchida pela cidade/UF ("Rio Grande do Norte" → RN, Cosern); lead com cidade, UF, concessionária, consumo 414, origem/indicado_por e indicador; nome real substitui o do WhatsApp; spam arquivado e vínculo desfeito; código `IND-` acha o assinante pelo prefixo; zero erros.
- [x] Correção: siglas da tabela com espaço ("RS ") → `btrim` (20261020d).

### Task 3: Campos dos funis
**Files:** `scripts/deskcomm/campos_funis.sql`
- [x] 7 campos nos 8 funis (idempotente).

### Task 4: Prompts e roteador
**Files:** `scripts/deskcomm/bel_recepcao.sql`; Modify `scripts/deskcomm/base_investidor.sql` (mesmo bloco comum)
- [x] Bel v3 (divisão desligada), abertura comum nos 7 especialistas, ferramentas `mcp_externo:leitura:b2w_*`, `mcp_externo_no_atendimento`, membro "Suporte ao cliente" sem funil de destino.

### Task 5: Site
**Files:** `index.html` no repo `WaldineyGodoy/paginas` (PR para `Home`)
- [x] `?indicador`, `?id`, `utm_source` na sessão; código no texto de todo `wa.me` no clique; `indicador_assinante_id` no formulário. Testado servido localmente (indicação e Instagram, `%20` nos espaços, sem duplicar, console limpo).

### Task 6: Documentação e entrega
- [x] `playbook/DESKCOMM.md` §7 e §8.2; spec atualizado; commit e PR.
- [ ] Usuário: criar `B2W_MCP_TOKEN` nos Secrets das Edge Functions e cadastrar o servidor no Deskcomm (endereço + mesma chave).
- [ ] Usuário: merge do PR do site e conferir no ar.
- [ ] Conversas de teste no WhatsApp (spec §12).
