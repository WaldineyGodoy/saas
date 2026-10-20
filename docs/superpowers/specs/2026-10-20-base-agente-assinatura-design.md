# Base de conhecimento do Agente Assinatura (Energia por Assinatura)

Data: 20/10/2026 · Estado: desenho aprovado, aguardando revisão do spec
Contexto: `playbook/DESKCOMM.md` (§8.1 base do Investidor, §8.2 Bel/recepção). Segunda base por produto.

## 1. Objetivo

Dar ao Agente Assinatura (funil "Energia por Assinatura" no Deskcomm) o conhecimento e a ferramenta para:
explicar o produto sem erro, estimar a economia em reais com a mesma conta do simulador do site, saber se há
vaga em usina, tratar os casos que não podem assinar e levar o cliente à adesão pelo link — sozinho, passando a
humano só quando preciso.

Fora do escopo:
- Revisão do termo de adesão (ver §9, divergências).
- Agente Suporte (cliente que já assina).
- Completar a tabela `"Concessionaria"`.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Arquitetura | Híbrida (como o Investidor): prompt = comportamento; base = fatos; ferramenta MCP = conta e vaga ao vivo. |
| Números | Estimativa em R$ permitida, sempre como estimativa ("o valor exato sai da sua conta"). Calculada pela ferramenta, nunca pelo modelo. |
| Por que a base também traz a fórmula | A trava de promessas do Deskcomm (`lib/agent-engine/guardrails/promise/evidencias-comerciais.ts`) só aceita como prova trechos de fonte `faq`/`documento`/`catalogo` consultados no MESMO turno; resultado de ferramenta MCP não conta. O agente busca a base no turno da simulação, e a Fonte B traz desconto, tarifa e fórmula. |
| Cobrança | Um boleto (ou PIX) só, da B2W, que já inclui o devido à distribuidora; a B2W quita a conta da concessionária. |
| Desconto | Percentual do plano vigente da distribuidora (`fn_desconto_plano_vigente`; Cosern = Plano Ultra Connect, 15%). Vale sobre a energia compensada, **Fio B incluído**. |
| Fora do desconto | Iluminação pública; custo mínimo (30/50/100 kWh mono/bi/tri) quando o consumo não o cobre. |
| Bandeira tarifária | Não é cobrada na Energia por Assinatura: em bandeira amarela/vermelha a economia percebida aumenta. Nunca dizer "30% de desconto". |
| Titularidade | Há troca de titularidade (TT): a UC passa para o nome da Associação, que representa o cliente na distribuidora. |
| Prazo | 30 a 60 dias (1 a 2 ciclos). Até 2 contas proporcionais sem desconto: uma ainda no nome do cliente (até a TT) e outra já no nome da Associação (processamento da lista de rateio). |
| Vencimento | Sempre dia 5. |
| Vaga | Usina gerando com capacidade livre → adesão imediata. Sem vaga, mas com vaga em usina em pré-operação/em conexão → assina agora, desconto começa quando a usina operar. Sem nada → fila de espera (sem link). |
| Fechamento | Só o link de adesão; o agente segue sozinho tirando dúvidas. Humano só se o cliente pedir, reclamar ou travar. Para este agente substitui a regra comum "contrato → humano". |
| Link com indicação | Se o lead tem indicador (assinante) ou originador, o link sai com `?indicador=` / `?id=`. |
| Consumo mínimo | 150 kWh/mês. Abaixo: explica (o custo mínimo come a economia), não insiste, registra. |
| Grupo A (média/alta tensão) | Humano, motivo "Grupo A — avaliar Mercado Livre/Gestora". |
| B optante | Regra da ANEEL: só recebe créditos de usina instalada no local. ≥ 5.000 kWh/mês → oferece análise de usina no local em comodato, contrato de 48 meses; aceitou → humano. < 5.000 → explica e encerra cordialmente, registra. |
| Já tem placa solar ou está em outra cooperativa/associação | Humano. |
| Tarifa social | Fluxo normal. |
| Indicação | Pode explicar o abatimento: link e QR próprios; cada indicado ativo gera crédito mensal na fatura de quem indicou (2% da base líquida do plano, nível 1), enquanto ambos ativos e em dia; abate a fatura mais próxima; sobra do ciclo é descartada. |
| Proibido | "30% de desconto"; fidelidade ou multa de saída; desconto sobre a conta inteira; qualquer número que não veio da ferramenta ou da base; dizer qual usina atende o cliente. |

## 3. Comportamento do agente (nova versão do prompt)

O prompt mantém o bloco comum (`## Regras de todo atendimento` + `## Abertura`, de `scripts/deskcomm/bel_recepcao.sql`)
e troca o bloco próprio do agente pelo roteiro abaixo.

1. **Consumo:** "Quanto vem sua conta de luz por mês? Pode ser em kWh, em reais ou a foto da conta." Grava
   `consumo_kwh` (se veio em reais, grava o consumo convertido devolvido pela ferramenta).
2. **Sinal de média tensão:** se é empresa, consumo > 5.000 kWh ou a conta mostra "Grupo A"/"B Optante":
   "Sua conta é de média tensão ou B optante?"
3. **Simulação:** no mesmo turno, `crm_search_knowledge` ("simulação desconto assinatura") e
   `b2w_simular_assinatura`.
4. **Resposta por caso:**

| Caso | Ação |
|---|---|
| < 150 kWh | Explica o consumo baixo, não insiste, deixa a porta aberta. |
| Grupo A | `crm_request_human_handoff` "Grupo A — avaliar Mercado Livre/Gestora". |
| B optante ≥ 5.000 kWh | Explica a regra; oferece análise de usina no local em comodato (48 meses); aceitou → handoff "B optante — usina no local em comodato". |
| B optante < 5.000 kWh | Explica a regra e encerra cordialmente. |
| Placa solar / outra cooperativa | Handoff "já gera energia ou participa de outra associação". |
| `vaga = imediata` | Estimativa mensal e anual + prazo de 30–60 dias com até 2 contas proporcionais sem desconto + link. |
| `vaga = pre_operacao` | Estimativa + "assina agora; o desconto começa quando a usina entrar em operação" (com a previsão, se houver) + link. |
| `vaga = fila` | Grava `lista_espera = true`, explica a fila, "a equipe avisa quando abrir vaga". Sem link. |
| `desconto = null` | Handoff "distribuidora sem desconto vigente único". |

5. **Depois do link:** tira dúvidas da adesão (documentos, assinatura eletrônica, link válido por 30 dias, várias
   UCs). Humano só se pedir, reclamar ou travar.

Etapas:

| Situação | Etapa |
|---|---|
| Cidade e consumo informados | Qualificando |
| Estimativa enviada | Simulação / Proposta enviada |
| Link enviado e o cliente diz que vai assinar | Contrato enviado |

## 4. Conteúdo da base

### 4.1 Fonte A — "Assinatura — Perguntas e respostas" (tipo `faq`, estática)

Arquivo `supabase/functions/deskcomm-base/bases/assinatura-faq.ts`, mesmo formato de `investidor-faq.ts`
(`## Pergunta:` / `## Resposta:`). Sem números que mudam (desconto, tarifa, valor da indicação): esses ficam na
Fonte B. Conteúdo aprovado (18 pares):

1. **Como funciona a energia por assinatura?** A B2W tem usinas solares ligadas à Associação de Usinas B2W
   Energia, no modelo de geração compartilhada da Lei 14.300. A energia gerada vira crédito na sua unidade
   consumidora, e você paga a energia compensada com desconto. Sem obra e sem instalar placas.
2. **Qual é o desconto?** É o percentual do plano vigente da sua distribuidora (veja "Assinatura: cobertura,
   desconto e indicação"). Vale sobre a energia compensada, com o Fio B incluído.
3. **O que fica sem desconto?** A iluminação pública e, quando o consumo não chega a cobri-lo, o custo mínimo da
   distribuidora: 30 kWh (monofásico), 50 kWh (bifásico) ou 100 kWh (trifásico).
4. **E a bandeira tarifária?** Na energia por assinatura a bandeira não é cobrada. Em bandeira amarela ou
   vermelha, a economia que você percebe na conta fica maior.
5. **Como é calculada a economia?** Consumo mensal × tarifa da distribuidora × percentual de desconto. É uma
   estimativa: o valor exato sai da sua conta de energia.
6. **Em quanto tempo começa o desconto?** Em 30 a 60 dias (1 a 2 ciclos). Podem vir até 2 contas proporcionais
   sem desconto: uma ainda no seu nome, até a troca de titularidade, e outra já no nome da Associação, enquanto a
   distribuidora processa a lista de rateio.
7. **Precisa ter vaga?** Sim. Com vaga numa usina que já gera, a adesão é imediata. Com vaga só numa usina em
   pré-operação, você assina agora e o desconto começa quando ela entrar em operação. Sem vaga, você entra na
   fila de espera e a equipe avisa quando abrir.
8. **A conta muda de nome?** Sim. A unidade consumidora passa para o nome da Associação, que representa você na
   distribuidora. O imóvel e o consumo continuam seus.
9. **Como eu pago?** Um único boleto ou PIX da B2W por mês, que já inclui o que é devido à distribuidora: a B2W
   quita a conta da concessionária. Ele chega por e-mail ou WhatsApp com 5 dias de antecedência, e a 2ª via sai
   pelo app.
10. **Qual o vencimento?** Todo dia 5.
11. **E se eu atrasar?** Aquela fatura sai pelo valor cheio, sem o desconto, com multa de 2%, juros de 1% ao mês e
    correção pelo IPCA. O desconto volta no ciclo seguinte. Com 30 dias de atraso a unidade sai do rateio; com 45,
    o débito pode ir a protesto; com 60, o contrato é rescindido.
12. **Tem fidelidade? Como cancelo?** Não há fidelidade nem multa. Para sair, avise com 90 dias ou 3 ciclos de
    compensação, o que vier por último.
13. **E se a usina gerar menos?** No ciclo sem compensação você paga o valor normal da distribuidora, sem desconto
    e sem nenhum custo extra.
14. **Vou mudar ou vender o imóvel.** Avise a B2W com 30 dias de antecedência.
15. **Como faço a adesão?** Pelo link: CEP e consumo, documento com foto e a conta de energia de cada unidade; se
    for empresa, também o contrato social. A assinatura é eletrônica e o link vale 30 dias. Dá para aderir com
    várias unidades.
16. **Como funciona a indicação?** Depois de assinar você ganha link e QR code próprios. Cada indicado que assina
    gera um crédito mensal abatido na sua fatura (valor em "Assinatura: cobertura, desconto e indicação"),
    enquanto vocês dois estiverem ativos e em dia. O crédito abate primeiro a fatura mais próxima; o que sobrar no
    ciclo é descartado.
17. **É um investimento?** Não. O benefício é o desconto na conta. Para quem quer renda, a B2W tem as Usinas de
    Investimento.
18. **Quem é a B2W?** Mesmo texto da pergunta 15 da base do Investidor (empresa mineira, 8 anos no RN, mais de
    1.000 usinas de varejo construídas, visita às usinas e ao escritório).

### 4.2 Fonte B — "Assinatura: cobertura, desconto e indicação" (tipo `documento`, gerada do CRM)

Uma seção por distribuidora com plano vigente único (`fn_desconto_plano_vigente` não nulo), ordenadas por nome:

```
## Neoenergia Cosern (RN)
Desconto do assinante: 15% sobre a energia compensada (Fio B incluído; bandeira tarifária não é cobrada)
Tarifa usada na estimativa: R$ 1,0347/kWh
Fórmula: economia mensal estimada = consumo (kWh) × tarifa × desconto
Exemplo: 300 kWh/mês → economia estimada de R$ 46,56/mês (R$ 558,74/ano)
Custo mínimo da distribuidora: 30 kWh (mono), 50 kWh (bi), 100 kWh (tri)
Consumo mínimo para assinar: 150 kWh/mês
Crédito de indicação: cerca de R$ 1,33 a cada 100 kWh compensados pelo indicado
Vencimento do boleto: dia 5
```

Origem: desconto = `fn_desconto_plano_vigente(concessionaria)`; tarifa = `"Concessionaria"."Tarifa Concessionaria"`
(mesma do site); UF = UFs da distribuidora na tabela; crédito de indicação = `base_calculo_liquida` do
`recorrente_config.lastro_tarifario` do plano × percentual L1 do Assinante Connect / 100 × 100 kWh.
Sem nenhuma distribuidora: "No momento a energia por assinatura não está disponível em nenhuma região."
Vagas não entram (mudam a toda hora; consulta ao vivo pela ferramenta).

## 5. Ferramenta `b2w_simular_assinatura` (servidor MCP `b2w-mcp`)

Só leitura. Entrada: `cidade`, `uf`, `consumo_kwh` **ou** `valor_conta_reais`. Telefone do lead só pelo cabeçalho `X-Deskcomm-Contato-Telefone`.

Saída:

```json
{ "atende": true, "concessionaria": "Neoenergia Cosern", "desconto_pct": 15,
  "tarifa": 1.0347, "consumo_kwh": 300, "consumo_convertido": false,
  "economia_mensal": 46.56, "economia_anual": 558.74,
  "atinge_minimo": true, "vaga": "imediata", "previsao_operacao": null,
  "link_adesao": "https://b2wenergia.com.br/?indicador=…" }
```

- Conta: igual a `calc()` de `index.html` do site — `economia = consumo × tarifa × desconto`. Valor em reais →
  `consumo = valor / tarifa` (arredondado), `consumo_convertido = true`.
- `atende = false` quando a cidade não está na tabela ou a distribuidora não tem plano; `desconto_pct = null`
  quando há mais de um plano ativo.
- Vaga: para cada usina da distribuidora com `geracao_estimada_kwh` preenchida,
  `livre = geracao_estimada_kwh − Σ franquia` das UCs com status ativo, aguardando conexão ou vinculado.
  Alguma usina `gerando` com `livre ≥ consumo` → `imediata`; senão alguma `pre_operacao`/`em_conexao` com
  `livre ≥ consumo` → `pre_operacao` (+ `previsao_entrega` mais próxima, se houver); senão `fila`. Nome da usina
  não é devolvido.
- Link: `https://b2wenergia.com.br/`; com `?indicador=<assinante>` se o lead do telefone tem
  `indicador_assinante_id`, senão `?id=<originador>` se tem originador.
- Implementação: RPC `b2w_mcp_simular_assinatura` (security definer, só `service_role`), chamada pela Edge Function
  como as outras duas ferramentas; `logica.ts` ganha a descrição e o esquema da ferramenta.

## 6. Mudanças

- Migration: RPC `b2w_mcp_simular_assinatura`; RPC `ponte_deskcomm_assinatura_cobertura()` (dados da Fonte B);
  gatilhos que chamam `deskcomm-base` em mudança de `planos_assinatura_energia`, `planos_distribuidoras` e das
  colunas de tarifa/desconto de `"Concessionaria"` (com `exception when others` → `ponte_deskcomm.erros`).
- `supabase/functions/deskcomm-base`: chaves `assinatura_faq` e `assinatura_cobertura`, agente lido de
  `ponte_deskcomm.categorias` (`energia_assinatura`); `montar.ts` ganha o montador da Fonte B.
- `supabase/functions/b2w-mcp`: ferramenta nova.
- `scripts/deskcomm/base_assinatura.sql` (idempotente): nova versão do Agente Assinatura com o roteiro da §3,
  as fontes A e B em `knowledge_source_ids` e `mcp_externo:leitura:b2w_simular_assinatura` em `tool_ids`;
  publicação via `fn_publish_ai_agent_version` + `event_log`.
- `playbook/DESKCOMM.md`: §8.3.

## 7. Erros

| Situação | Comportamento |
|---|---|
| Ferramenta não responde | "Vou confirmar a simulação com a equipe" + link do simulador do site; segue a conversa. |
| Região sem plano | `atende = false` → regra da abertura (lista de espera + Investimento/Cotas). |
| Mais de um plano ativo na distribuidora | `desconto_pct = null` → handoff. |
| Usina sem geração estimada | Fora da conta de vagas. |
| Trava de promessas barra o valor | Responde com o percentual e o link do simulador, sem R$. |
| Falha na sincronização da base | Não grava; `erros`; a base anterior continua valendo (mesmo da `deskcomm-base`). |
| Gatilho falha | Não bloqueia a gravação; o cron de hora em hora corrige. |

## 8. Testes

1. Vitest:
   - simulação 300 kWh Cosern = R$ 46,56/mês e R$ 558,74/ano (igual ao site);
   - conversão de R$ para kWh; consumo < 150; vaga imediata, pré-operação e fila; link com indicador e com
     originador; `desconto_pct = null`;
   - montador da Fonte B (uma distribuidora, nenhuma, sem dado pessoal) e FAQ com 18 pares.
2. SQL em transação desfeita: RPC de simulação com usinas e UCs de teste; crédito de indicação da Fonte B confere
   com `fn_calcular_split_recompensa` para 100 kWh.
3. Ensaio da `deskcomm-base` e indexação das duas fontes com `last_index_status = success`.
4. Conversas no WhatsApp: Natal 300 kWh; 100 kWh; 4.000 kWh (pré-operação, com os dados de hoje); "sou B optante,
   8.000 kWh"; "tem fidelidade?"; "e a bandeira vermelha?"; lead vindo por indicação (link com indicador).

## 9. Riscos e divergências

- **Termo de adesão diverge do que o agente vai explicar** (`supabase/functions/_shared/termo-adesao.js`):
  cláusula 16 (o associado continua titular × TT para a Associação); cláusula 8.2 (Fio B e bandeiras devidos à
  distribuidora sem desconto × Fio B com desconto e bandeira não cobrada); vencimento padrão dia 10 × dia 5.
  Revisar o contrato com o jurídico: hoje o cliente assina um texto diferente do que o agente diz.
- **Ocupação das usinas pela franquia:** a UFV Bom Jesus aparece acima da capacidade (franquias 14.272 kWh ×
  geração estimada 13.558 kWh). Confirmar se a franquia é a medida certa de ocupação.
- **Tabela `"Concessionaria"` incompleta** (registrado na spec da Bel).
- **Desconto do município × plano:** a tabela ainda tem "Desconto Assinante" por município (Natal 20%), que não é
  usado; a fonte é o plano vigente.
