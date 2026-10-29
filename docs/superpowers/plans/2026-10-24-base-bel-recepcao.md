# Base da Bel (Recepção) e rastreio do anúncio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à Bel uma base de conhecimento de fatos (institucional, triagem e mapa de entradas) e fazer o Deskcomm marcar cada contato com o anúncio de origem, gravando também o anúncio no lead do CRM da B2W.

**Architecture:** Uma migration cria a tabela `ponte_deskcomm.anuncios`, um gatilho em `contacts` que registra o anúncio e põe a etiqueta `anuncio:<slug>`, um gatilho em `ponte_deskcomm.vinculos` que copia o anúncio para o lead, e uma view de relatório. A Edge Function `deskcomm-base` ganha duas fontes ligadas à Bel (FAQ em arquivo `.ts` e documento "Recepção: entradas" gerado da tabela). Um script publica a Bel v7 por alteração cirúrgica do prompt vigente.

**Tech Stack:** PostgreSQL (Supabase, schema `ponte_deskcomm`), Edge Function Deno (`deskcomm-base`), vitest (`tests/deskcomm-base.test.ts`), MCP do Supabase para aplicar migration e consultar o banco.

Spec: `docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md`.
Worktree: `C:/Users/Godoy/AppData/Local/Temp/claude/C--Users-Godoy-Documents-HTML-WorkSpace-1-Antigravity/fa71387d-bea4-4cbb-8dda-45ac9dca7068/scratchpad/wt-base-bel` (branch `feat/base-bel-recepcao`). Nos comandos abaixo, `$WT` é esse caminho.
Banco: projeto Supabase `abbysvxnnhwvvzhftoms`.

## Global Constraints

- A base da Bel **não traz** percentual de desconto, preço, retorno nem lista de estados do site (`\d%`, `R$` e nomes de estados proibidos no FAQ; teste obrigatório).
- A linha **Gestora / Comercializadora atende fornecedores** (donos de usina que querem fornecer energia à B2W). A palavra "mercado livre" não aparece no FAQ.
- Quem quer desconto na conta de luz, pessoa física ou CNPJ, é sempre **Energia por Assinatura**. A Bel pergunta pessoa física ou empresa e nunca presume.
- O CNPJ não é citado como número: a Bel diz "O CNPJ consta no contrato".
- Endereço: Olavo Lacerda Montenegro, 467, Parque das Nações, Parnamirim, Rio Grande do Norte. Horário da equipe: 9h às 17h (horário de Brasília), sem afirmar dias da semana.
- "Como sei que é real?": oferecer **videochamada com o time comercial**; a Bel passa para humano com o motivo `videochamada` (ela não agenda sozinha).
- Etiqueta do anúncio: `anuncio:<slug>` no contato; slug provisório `anuncio-<8 últimos dígitos do ad_id>`.
- **Não renomear nem alterar o prefixo `fu:`** (renomeação cancelada pelo dono em 24/10/2026). `aplicar_etiqueta_fu` só remove tags `fu:%`, então preserva `anuncio:*`.
- **Não alterar** `fn_card_para_lead`, `fn_contato_para_lead` nem `fn_contato_etiqueta_fu`: o anúncio vai para o lead por gatilho em `ponte_deskcomm.vinculos`.
- Todo gatilho novo é **falha aberta**: `exception when others` grava em `ponte_deskcomm.erros` e o atendimento segue.
- Prompts de produção têm a seção de persona (`## Quem você é`): a Bel v7 é **alteração cirúrgica** sobre a versão publicada, nunca regeneração do prompt inteiro.
- A trava de promessas só aceita número provado por fonte `faq`/`documento`; o indexador pula fonte cujo `content_hash` bate.
- Datas e horas relatadas ao dono: UTC-3.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261024a_anuncios_ponte.sql` | tabela `anuncios`, gatilhos, view `v_leads_por_anuncio`, RPC de leitura, chaves em `fontes_base` |
| `supabase/functions/deskcomm-base/bases/recepcao-faq.ts` | texto do FAQ da Recepção (`FAQ_RECEPCAO`) |
| `supabase/functions/deskcomm-base/montar.ts` | + `montarEntradas`, `AnuncioEntrada`, `SEM_ANUNCIOS` |
| `supabase/functions/deskcomm-base/index.ts` | + duas fontes da categoria `triagem` |
| `scripts/deskcomm/base_bel.sql` | publica a Bel v7 |
| `tests/deskcomm-base.test.ts` | + testes do FAQ da Recepção e de `montarEntradas` |
| `docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md`, `playbook/DESKCOMM.md` | desvios do spec e §8.5 |

---

### Task 0: Preparar o ambiente de testes

**Files:** nenhum arquivo versionado.

- [ ] **Step 1: Ligar o `node_modules` do projeto principal ao worktree**

```powershell
$wt = "C:\Users\Godoy\AppData\Local\Temp\claude\C--Users-Godoy-Documents-HTML-WorkSpace-1-Antigravity\fa71387d-bea4-4cbb-8dda-45ac9dca7068\scratchpad\wt-base-bel"
New-Item -ItemType Junction -Path "$wt\node_modules" -Target "C:\Users\Godoy\Documents\HTML\WorkSpace 1 Antigravity\node_modules"
```

Expected: o link é criado. `node_modules` já está no `.gitignore`, então não entra em commit.

- [ ] **Step 2: Rodar a suíte existente como linha de base**

```bash
cd "$WT" && npx vitest run tests/deskcomm-base.test.ts
```

Expected: PASS em todos os testes atuais (Investidor, Assinatura, Cotas, `lerFaq`, `hashTexto`).

---

### Task 1: FAQ da Recepção (TDD)

**Files:**
- Create: `supabase/functions/deskcomm-base/bases/recepcao-faq.ts`
- Modify: `tests/deskcomm-base.test.ts` (import + novo `describe`)

**Interfaces:**
- Produces: `export const FAQ_RECEPCAO: string` (formato `## Pergunta:` / `## Resposta:`, lido por `lerFaq`), 18 pares.

- [ ] **Step 1: Escrever o teste que falha**

No topo de `tests/deskcomm-base.test.ts`, junto dos outros imports de FAQ, acrescentar:

```ts
import { FAQ_RECEPCAO } from '../supabase/functions/deskcomm-base/bases/recepcao-faq'
```

No fim do arquivo, acrescentar:

```ts
describe('FAQ da Recepção', () => {
    it('tem as 18 perguntas aprovadas, com os fatos do dono e sem número comercial', () => {
        const pares = lerFaq(FAQ_RECEPCAO)
        expect(pares).toHaveLength(18)
        const tudo = FAQ_RECEPCAO.toLowerCase()

        // fatos informados pelo dono em 24/10/2026
        expect(tudo).toContain('olavo lacerda montenegro, 467')
        expect(tudo).toContain('parnamirim')
        expect(tudo).toContain('das 9h às 17h')
        expect(tudo).toContain('videochamada')
        expect(tudo).toContain('o cnpj consta no contrato')
        expect(tudo).toContain('(31) 99536-7744')
        expect(tudo).toContain('contato@b2wenergia.com.br')
        expect(tudo).toContain('donos de usina')

        // nenhum percentual, preço ou lista de estados do site
        expect(tudo).not.toMatch(/\d\s?%/)
        expect(tudo).not.toContain('r$')
        for (const estado of ['mato grosso', 'paraná', 'goiás', 'são paulo', 'rio de janeiro']) {
            expect(tudo, estado).not.toContain(estado)
        }

        // a Gestora não é mercado livre, e nada de promessa
        expect(tudo).not.toContain('mercado livre')
        for (const proibido of ['garantid', 'risco zero', 'fidelidade de', 'multa']) {
            expect(tudo, proibido).not.toContain(proibido)
        }
    })

    it('a primeira resposta é a mesma "Quem é a B2W Energia" do FAQ do Investidor', () => {
        const rec = lerFaq(FAQ_RECEPCAO)[0]
        const inv = lerFaq(FAQ_INVESTIDOR).find((p) => p.question.startsWith('Quem é a B2W Energia'))
        expect(inv).toBeDefined()
        expect(rec.question).toBe(inv!.question)
        expect(rec.answer).toBe(inv!.answer)
    })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd "$WT" && npx vitest run tests/deskcomm-base.test.ts -t "FAQ da Recepção"
```

Expected: FAIL com erro de importação (`recepcao-faq` não existe).

- [ ] **Step 3: Escrever o FAQ**

Criar `supabase/functions/deskcomm-base/bases/recepcao-faq.ts`. A primeira resposta é cópia literal da do `investidor-faq.ts` (a mesma que a Assinatura e as Cotas reutilizam):

```ts
/**
 * FAQ da Bel (Recepção) no DeskcommCRM
 * (spec docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md §5.1).
 * Em .ts porque a Edge Function so publica arquivo importado.
 * So fatos: nada de percentual, preco, retorno nem lista de estados. O que muda
 * (anuncios) fica em "Recepção: entradas", gerado da tabela ponte_deskcomm.anuncios.
 * A primeira resposta e copia literal da de investidor-faq.ts.
 */
export const FAQ_RECEPCAO = `## Pergunta: Quem é a B2W Energia? Posso visitar uma usina?
## Resposta: A B2W Energia é uma empresa mineira que opera há 8 anos no Rio Grande do Norte, estado de alto potencial energético. É especializada em usinas de investimento e acompanha o investidor de ponta a ponta, da prospecção da área à gestão dos assinantes que consomem a energia gerada. São mais de 1.000 usinas de varejo construídas e dezenas de usinas de investimento entregues. Você pode visitar uma usina em funcionamento e o nosso escritório no Rio Grande do Norte: recebemos você no aeroporto e levamos até usinas próximas.

## Pergunta: A B2W é uma empresa de verdade? Como sei que não é golpe?
## Resposta: Faz bem em conferir! A B2W Energia fica em Parnamirim, no Rio Grande do Norte, e tem site (b2wenergia.com.br), WhatsApp comercial (31) 99536-7744, e-mail contato@b2wenergia.com.br e perfis no Instagram, Facebook e LinkedIn. O CNPJ consta no contrato. Se preferir, podemos agendar uma videochamada com o time comercial para você conhecer a equipe e tirar as dúvidas. Por aqui eu nunca peço senha nem dados bancários.

## Pergunta: Qual é o CNPJ da B2W?
## Resposta: O CNPJ consta no contrato. Se quiser conferir antes de seguir, agendamos uma videochamada com o time comercial.

## Pergunta: Onde fica a B2W? Qual é o endereço?
## Resposta: O endereço é Olavo Lacerda Montenegro, 467, Parque das Nações, Parnamirim, Rio Grande do Norte. Para visitar, combine antes com a equipe.

## Pergunta: Qual é o horário de atendimento?
## Resposta: A equipe atende das 9h às 17h, no horário de Brasília. Fora desse horário eu continuo por aqui e deixo tudo registrado para a equipe retornar.

## Pergunta: Quero falar com uma pessoa.
## Resposta: Claro! Eu chamo alguém da equipe, que atende das 9h às 17h. Se preferir ver quem é antes, também podemos agendar uma videochamada com o time comercial.

## Pergunta: Dá para fazer uma videochamada antes de decidir?
## Resposta: Dá, sim. Agendamos uma videochamada com o time comercial para você tirar as dúvidas. Me diga o melhor dia e horário, entre 9h e 17h, e eu passo para a equipe confirmar.

## Pergunta: Quais serviços a B2W oferece?
## Resposta: Temos Energia por Assinatura (desconto na conta de luz, sem obra e sem instalar placas), Usinas de Investimento (investir em uma usina solar para ter renda), Cotas (uma fração da geração de uma usina), Eletropostos (recarga de carro elétrico e parceria para ter um eletroposto, na rede VOLT), Áreas de Arrendamento (arrendar um terreno para usina solar), Gestora / Comercializadora (para donos de usina que querem fornecer energia à B2W) e Locação de Vagas (alugar ou oferecer vagas de estacionamento).

## Pergunta: Quero pagar menos na conta de luz. É com vocês?
## Resposta: É, sim! Isso é a Energia por Assinatura: desconto na conta de luz, sem obra e sem instalar placas. Atende pessoa física e empresa. Me conta de qual cidade e estado você é, que eu confiro se já chegou na sua região.

## Pergunta: Tenho uma empresa. Vocês atendem CNPJ?
## Resposta: Atendemos, sim. A Energia por Assinatura serve para pessoa física e para empresa. Me diz se é para a sua casa ou para a empresa, e de qual cidade e estado, para eu seguir com o atendimento certo.

## Pergunta: Tenho uma usina e quero vender energia para a B2W.
## Resposta: Isso é com a nossa área Gestora / Comercializadora, que atende donos de usina que querem fornecer energia para a B2W. Me conta onde fica a usina, cidade e estado, que eu sigo o atendimento.

## Pergunta: Quero investir. Qual a diferença entre usina e cotas?
## Resposta: Em Usinas de Investimento você investe em uma usina solar para ter renda. Em Cotas você compra uma fração da geração de uma usina. Me conta qual das duas combina mais com você que eu sigo daqui.

## Pergunta: Tenho um terreno. Vocês arrendam?
## Resposta: A B2W arrenda áreas para instalar usinas solares, e cada área passa por uma avaliação da equipe. Me conta a cidade e o estado do terreno para começarmos.

## Pergunta: Quero um carregador de carro elétrico ou uma vaga.
## Resposta: A B2W tem a rede de recarga VOLT para carro elétrico e faz parceria com quem quer ter um eletroposto no seu estabelecimento. Também temos locação de vagas de estacionamento: dá para alugar uma vaga ou oferecer as suas. Me conta o que você procura que eu direciono.

## Pergunta: Já sou cliente. Preciso de fatura, boleto, contrato, repasse ou ajuda com o aplicativo.
## Resposta: Entendi. Esse atendimento é com a equipe, então eu chamo uma pessoa para te ajudar. Ela atende das 9h às 17h, e fica registrado o que você precisa.

## Pergunta: A energia por assinatura já chega na minha cidade?
## Resposta: Eu confiro pela sua cidade e estado, porque a cobertura depende da distribuidora. Me diz onde você está?

## Pergunta: Vi um anúncio com desconto. Qual é o percentual?
## Resposta: O percentual depende da sua distribuidora e é confirmado na simulação com a sua conta de luz. Os anúncios falam em "até", e eu só confirmo um número depois de simular. Me conta cidade e estado para eu começar.

## Pergunta: O que acontece com os meus dados?
## Resposta: Seus dados são usados para o atendimento comercial da B2W. Se quiser pedir acesso, correção ou exclusão, fale com a equipe pelo e-mail contato@b2wenergia.com.br.
`
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd "$WT" && npx vitest run tests/deskcomm-base.test.ts -t "FAQ da Recepção"
```

Expected: PASS (2 testes). Se o segundo falhar, a primeira pergunta/resposta não está idêntica à do `investidor-faq.ts`: copiar de novo, sem alterar.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add supabase/functions/deskcomm-base/bases/recepcao-faq.ts tests/deskcomm-base.test.ts && git commit -m "feat(deskcomm): FAQ da Recepção (18 perguntas) com os fatos informados pelo dono

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Documento "Recepção: entradas" (TDD)

**Files:**
- Modify: `supabase/functions/deskcomm-base/montar.ts` (acrescentar no fim do arquivo, antes de `lerFaq`, ou após `montarUsinasCotas`)
- Modify: `tests/deskcomm-base.test.ts`

**Interfaces:**
- Produces: `export interface AnuncioEntrada { slug: string; nome: string; titulo: string | null; plataformas: string[]; publico: string; categoria_nome: string; promessa: string | null }`, `export const SEM_ANUNCIOS: string`, `export function montarEntradas(anuncios: AnuncioEntrada[]): string`.
- Consumes: `A_CONFIRMAR` já definido em `montar.ts` (`'a confirmar com o consultor'`).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/deskcomm-base.test.ts`, acrescentar `montarEntradas`, `SEM_ANUNCIOS` e `type AnuncioEntrada` ao import de `'../supabase/functions/deskcomm-base/montar'`, e no fim do arquivo:

```ts
const anuncioPf: AnuncioEntrada = {
    slug: 'conta-pf-20', nome: 'Conta de luz PF', titulo: 'Sua conta de luz até 20% menor',
    plataformas: ['instagram', 'facebook'], publico: 'ambos', categoria_nome: 'Energia por Assinatura',
    promessa: 'Desconto na conta de luz, sem obra',
}

describe('montarEntradas', () => {
    it('monta o bloco de cada anúncio com etiqueta, plataformas, público, produto, título e promessa', () => {
        const md = montarEntradas([anuncioPf])
        expect(md).toContain('# Recepção: entradas')
        expect(md).toContain('### anuncio:conta-pf-20 — Conta de luz PF')
        expect(md).toContain('Plataformas: instagram, facebook · Público: pessoa física e empresa · Produto: Energia por Assinatura')
        expect(md).toContain('Título do anúncio: Sua conta de luz até 20% menor')
        expect(md).toContain('Promessa do anúncio: Desconto na conta de luz, sem obra')
    })

    it('público não definido manda perguntar; campos vazios saem como "a confirmar"', () => {
        const md = montarEntradas([{ ...anuncioPf, publico: 'nao_definido', promessa: null, titulo: null, plataformas: [] }])
        expect(md).toContain('Público: não definido (pergunte se é pessoa física ou empresa)')
        expect(md).toContain('Promessa do anúncio: a confirmar com o consultor')
        expect(md).toContain('Título do anúncio: a confirmar com o consultor')
        expect(md).toContain('Plataformas: a confirmar')
    })

    it('sem anúncio devolve o aviso e mantém as seções fixas', () => {
        const md = montarEntradas([])
        expect(md).toContain(SEM_ANUNCIOS)
        for (const secao of ['## Site (botões e simulador)', '## Indicação e origem', '## App do assinante', '## Cliente já cadastrado', '## Mensagem genérica de anúncio']) {
            expect(md, secao).toContain(secao)
        }
    })

    it('regras de abertura: pergunta pessoa física ou empresa e nunca repete percentual do anúncio como garantia', () => {
        const md = montarEntradas([anuncioPf])
        expect(md).toContain('nunca presuma, mesmo no anúncio de CNPJ')
        expect(md).toContain('nunca repita um percentual do anúncio como valor garantido')
        expect(md).toContain('vale a última')
    })

    it('traz as mensagens prontas do site e o motivo de humano do app', () => {
        const md = montarEntradas([])
        expect(md).toContain('Olá! Vim pelo site da B2W Energia e quero assinar e começar a economizar.')
        expect(md).toContain('Olá! Tenho uma dúvida sobre a energia solar por assinatura da B2W Energia.')
        expect(md).toContain('Olá! Simulei no site da B2W Energia:')
        expect(md).toContain('motivo "cadastro no app"')
        expect(md).toContain('(cód. IND-xxxxxxxx)')
    })

    it('ordena como veio e não carrega campo fora do contrato', () => {
        const comLixo = { ...anuncioPf, ad_id: '120250561928760337', cnpj: '12.345.678/0001-90', corpo: 'texto longo' } as AnuncioEntrada
        const md = montarEntradas([comLixo, { ...anuncioPf, slug: 'cnpj-20', nome: 'Faturamento alto' }])
        expect(md).not.toContain('120250561928760337')
        expect(md).not.toContain('12.345.678')
        expect(md).not.toContain('texto longo')
        expect(md.indexOf('anuncio:conta-pf-20')).toBeLessThan(md.indexOf('anuncio:cnpj-20'))
    })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd "$WT" && npx vitest run tests/deskcomm-base.test.ts -t "montarEntradas"
```

Expected: FAIL (`montarEntradas` não é exportado).

- [ ] **Step 3: Implementar em `montar.ts`**

Acrescentar logo antes do comentário de `lerFaq`:

```ts
export interface AnuncioEntrada {
    slug: string
    nome: string
    titulo: string | null
    plataformas: string[]
    publico: string
    categoria_nome: string
    promessa: string | null
}

export const SEM_ANUNCIOS =
    'Nenhum anúncio identificado até agora. Contato de anúncio sem etiqueta: veja "Contato da Meta sem etiqueta de anúncio".\n'

const PUBLICO: Record<string, string> = {
    pf: 'pessoa física',
    pj: 'empresa (CNPJ)',
    ambos: 'pessoa física e empresa',
}
const PUBLICO_INDEFINIDO = 'não definido (pergunte se é pessoa física ou empresa)'

function blocoAnuncio(a: AnuncioEntrada): string {
    const plataformas = a.plataformas.length > 0 ? a.plataformas.join(', ') : 'a confirmar'
    return [
        `### anuncio:${a.slug} — ${a.nome}`,
        `Plataformas: ${plataformas} · Público: ${PUBLICO[a.publico] ?? PUBLICO_INDEFINIDO} · Produto: ${a.categoria_nome}`,
        `Título do anúncio: ${a.titulo?.trim() || A_CONFIRMAR}`,
        `Promessa do anúncio: ${a.promessa?.trim() || A_CONFIRMAR}`,
    ].join('\n')
}

const ABERTURA_ANUNCIO =
    'Com a etiqueta, abra falando do que o anúncio ofereceu e não pergunte o que a pessoa procura. ' +
    'Confirme se é pessoa física ou empresa: nunca presuma, mesmo no anúncio de CNPJ. ' +
    'A promessa do anúncio não é garantia: nunca repita um percentual do anúncio como valor garantido; ' +
    'o percentual do cliente sai da simulação. Se o contato tiver mais de uma etiqueta de anúncio, vale a última.'

const ENTRADAS_FIXAS = `## Contato da Meta sem etiqueta de anúncio
Contato com origem meta_ads e sem etiqueta anuncio:… é interesse em desconto na conta de luz (Energia por Assinatura). Pergunte se é pessoa física ou empresa.

## Mensagem genérica de anúncio
"Olá! Posso ter mais informações sobre isso?" vem do botão do anúncio e não diz o produto. Use a etiqueta do anúncio; sem etiqueta, siga a regra acima.

## Site (botões e simulador)
Mensagens prontas dos botões do site b2wenergia.com.br. Todas são de Energia por Assinatura:
- "Olá! Vim pelo site da B2W Energia e quero assinar e começar a economizar." — quer assinar.
- "Olá! Quero assinar a energia solar da B2W Energia e começar a economizar." — quer assinar.
- "Olá! Tenho uma dúvida sobre a energia solar por assinatura da B2W Energia." — tem dúvida.
- "Olá! Vim pelo site da B2W Energia." — botão flutuante, sem intenção clara; o mais provável é Energia por Assinatura.
Mensagem do simulador: "Olá! Simulei no site da B2W Energia: <distribuidora>, <consumo> kWh/mês, economia estimada de R$ <valor> por mês. Quero assinar." Ela já traz distribuidora e consumo: grave o consumo (consumo_kwh) e não pergunte de novo. A economia é estimativa do simulador; a confirmação sai da simulação do atendimento.

## Indicação e origem
O texto pronto do site pode terminar com um código. (cód. IND-xxxxxxxx) é indicação de um assinante ou originador; (cód. IG), (cód. GG) e (cód. FB) são Instagram, Google e Facebook. Se a origem ou o indicador já estiver gravado, não pergunte de novo.

## App do assinante
Quem diz que não conseguiu se cadastrar pelo link do app: passe para humano (crm_request_human_handoff) com o motivo "cadastro no app".

## Cliente já cadastrado
Se b2w_identificar_contato disser cliente_ativo, abra como cliente, sem dizer qual produto ele tem. Fatura, boleto, contrato, repasse ou app: humano, motivo "suporte".
`

/** Documento "Recepção: entradas". Anúncios na ordem recebida; o resto é texto fixo. */
export function montarEntradas(anuncios: AnuncioEntrada[]): string {
    const secaoAnuncios = anuncios.length === 0 ? SEM_ANUNCIOS : anuncios.map(blocoAnuncio).join('\n\n') + '\n'
    return [
        '# Recepção: entradas',
        '',
        'Como cada porta de entrada chega à Recepção e como a Bel abre a conversa.',
        '',
        '## Anúncios da Meta (etiqueta anuncio:… no contato)',
        ABERTURA_ANUNCIO,
        '',
        secaoAnuncios,
        ENTRADAS_FIXAS,
    ].join('\n')
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd "$WT" && npx vitest run tests/deskcomm-base.test.ts
```

Expected: PASS em todos os testes do arquivo (os novos e os anteriores).

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add supabase/functions/deskcomm-base/montar.ts tests/deskcomm-base.test.ts && git commit -m "feat(deskcomm): documento Recepção: entradas, gerado da tabela de anúncios

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration — rastreio do anúncio

**Files:**
- Create: `supabase/migrations/20261024a_anuncios_ponte.sql`

**Interfaces:**
- Produces: tabela `ponte_deskcomm.anuncios`; função `ponte_deskcomm.copiar_anuncio_para_lead(p_contact uuid) returns void`; RPC `public.ponte_deskcomm_anuncios_entradas()` com as colunas `slug, nome, titulo, plataformas, publico, categoria_nome, promessa`; view `ponte_deskcomm.v_leads_por_anuncio`; linhas `recepcao_faq` e `recepcao_entradas` em `ponte_deskcomm.fontes_base`.
- Consumes: `ponte_deskcomm.categorias`, `ponte_deskcomm.vinculos`, `ponte_deskcomm.erros`, `ponte_deskcomm.fn_assinatura_para_base()` (já chama a `deskcomm-base`).

- [ ] **Step 1: Escrever a migration**

```sql
-- Rastreio do anuncio de origem (spec 2026-10-24-base-bel-recepcao-design.md §4).
--
-- O dado do anuncio chega no contato numa ATUALIZACAO de source_metadata, depois
-- da criacao; por isso o gatilho e AFTER INSERT OR UPDATE OF source_metadata.
-- O lead da B2W recebe o anuncio por gatilho em ponte_deskcomm.vinculos (cobre as
-- duas ordens: anuncio antes ou depois do lead) sem tocar em fn_card_para_lead.
-- Tudo falha aberto: erro vai para ponte_deskcomm.erros e o atendimento segue.

create table if not exists ponte_deskcomm.anuncios (
  ad_id             text primary key,
  slug              text not null unique,
  nome              text not null,
  titulo            text,
  corpo             text,
  url_origem        text,
  plataformas       text[] not null default '{}',
  publico           text not null default 'nao_definido'
                      check (publico in ('pf', 'pj', 'ambos', 'nao_definido')),
  categoria         text not null default 'energia_assinatura'
                      references ponte_deskcomm.categorias(slug),
  promessa          text,
  ativo             boolean not null default true,
  visto_primeiro_em timestamptz not null default now(),
  constraint anuncios_slug_formato check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$')
);
grant all on ponte_deskcomm.anuncios to service_role;

-- Copia o anuncio do contato para o(s) lead(s) vinculado(s), sem apagar o que ja
-- existe em qualificacao.deskcomm (origem, indicado_por, lista_espera...).
create or replace function ponte_deskcomm.copiar_anuncio_para_lead(p_contact uuid) returns void
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
declare
  v_ad record;
begin
  select a.ad_id, a.slug, a.titulo,
         c.source_metadata->>'ad_platform'    as plataforma,
         c.source_metadata->>'ad_captured_at' as em
    into v_ad
    from contacts c
    join ponte_deskcomm.anuncios a on a.ad_id = c.source_metadata->>'ad_id'
   where c.id = p_contact and c.source = 'meta_ads';
  if not found then return; end if;

  update leads l
     set qualificacao = jsonb_set(
           coalesce(l.qualificacao, '{}'::jsonb),
           '{deskcomm}',
           coalesce(l.qualificacao->'deskcomm', '{}'::jsonb)
             || jsonb_build_object('anuncio', jsonb_build_object(
                  'ad_id', v_ad.ad_id, 'slug', v_ad.slug, 'titulo', v_ad.titulo,
                  'plataforma', v_ad.plataforma, 'em', v_ad.em)),
           true)
    from ponte_deskcomm.vinculos v
   where v.contact_id = p_contact and l.id = v.b2w_lead_id;
end $$;

-- Contato -> registra o anuncio, poe a etiqueta anuncio:<slug> e copia para o lead.
create or replace function ponte_deskcomm.fn_contato_anuncio() returns trigger
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
declare
  v_ad_id text := nullif(new.source_metadata->>'ad_id', '');
  v_plat  text := nullif(new.source_metadata->>'ad_platform', '');
  v_slug  text;
begin
  if new.source is distinct from 'meta_ads' or v_ad_id is null then return null; end if;
  if coalesce(new.is_personal, false) or coalesce(new.is_anonymized, false)
     or coalesce(new.is_blocked, false) then
    return null;
  end if;

  insert into ponte_deskcomm.anuncios (ad_id, slug, nome, titulo, corpo, url_origem, plataformas)
  values (v_ad_id, 'anuncio-' || right(v_ad_id, 8),
          coalesce(nullif(new.source_metadata->>'ad_title', ''), 'Anúncio ' || right(v_ad_id, 8)),
          new.source_metadata->>'ad_title', new.source_metadata->>'ad_body',
          new.source_metadata->>'ad_source_url',
          case when v_plat is null then '{}'::text[] else array[v_plat] end)
  on conflict (ad_id) do update
     set plataformas = (select array_agg(distinct p order by p)
                          from unnest(ponte_deskcomm.anuncios.plataformas || excluded.plataformas) p)
   where not (ponte_deskcomm.anuncios.plataformas @> excluded.plataformas);

  select slug into v_slug from ponte_deskcomm.anuncios where ad_id = v_ad_id;

  if not (('anuncio:' || v_slug) = any(coalesce(new.tags, '{}'))) then
    update contacts set tags = array_append(coalesce(tags, '{}'), 'anuncio:' || v_slug)
     where id = new.id;
  end if;

  perform ponte_deskcomm.copiar_anuncio_para_lead(new.id);
  return null;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_contato_anuncio', new.id, sqlstate, sqlerrm);
  return null;
end $$;

drop trigger if exists trg_ponte_contato_anuncio on public.contacts;
create trigger trg_ponte_contato_anuncio
  after insert or update of source_metadata on public.contacts
  for each row execute function ponte_deskcomm.fn_contato_anuncio();

-- Lead criado depois do anuncio: o vinculo novo dispara a copia.
create or replace function ponte_deskcomm.fn_vinculo_anuncio() returns trigger
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
begin
  perform ponte_deskcomm.copiar_anuncio_para_lead(new.contact_id);
  return null;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_vinculo_anuncio', new.deskcomm_lead_id, sqlstate, sqlerrm);
  return null;
end $$;

drop trigger if exists trg_ponte_vinculo_anuncio on ponte_deskcomm.vinculos;
create trigger trg_ponte_vinculo_anuncio
  after insert on ponte_deskcomm.vinculos
  for each row execute function ponte_deskcomm.fn_vinculo_anuncio();

-- O dono troca o slug provisorio por um nome de verdade: contatos e leads acompanham.
create or replace function ponte_deskcomm.fn_anuncio_renomeado() returns trigger
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
begin
  if new.slug is distinct from old.slug then
    update contacts set tags = array_replace(tags, 'anuncio:' || old.slug, 'anuncio:' || new.slug)
     where ('anuncio:' || old.slug) = any(tags);
    update leads set qualificacao = jsonb_set(qualificacao, '{deskcomm,anuncio,slug}', to_jsonb(new.slug))
     where qualificacao #>> '{deskcomm,anuncio,ad_id}' = new.ad_id;
  end if;
  return null;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_anuncio_renomeado', null, sqlstate, sqlerrm);
  return null;
end $$;

drop trigger if exists trg_ponte_anuncio_renomeado on ponte_deskcomm.anuncios;
create trigger trg_ponte_anuncio_renomeado
  after update of slug on ponte_deskcomm.anuncios
  for each row execute function ponte_deskcomm.fn_anuncio_renomeado();

-- Mudou um anuncio (nome, promessa...): a deskcomm-base regera o documento de entradas.
-- Fora da lista de colunas de proposito: plataformas so muda quando surge uma nova.
drop trigger if exists trg_ponte_anuncios_base on ponte_deskcomm.anuncios;
create trigger trg_ponte_anuncios_base
  after insert or update of nome, slug, titulo, publico, categoria, promessa, ativo, plataformas
  on ponte_deskcomm.anuncios
  for each statement execute function ponte_deskcomm.fn_assinatura_para_base();

-- Leitura para a Edge Function deskcomm-base (service role).
create or replace function public.ponte_deskcomm_anuncios_entradas()
returns table (slug text, nome text, titulo text, plataformas text[], publico text,
               categoria_nome text, promessa text)
language sql stable security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
  select a.slug, a.nome, a.titulo, a.plataformas, a.publico, c.nome, a.promessa
    from ponte_deskcomm.anuncios a
    join ponte_deskcomm.categorias c on c.slug = a.categoria
   where a.ativo
   order by a.visto_primeiro_em, a.slug
$$;
revoke execute on function public.ponte_deskcomm_anuncios_entradas() from public, anon, authenticated;
grant  execute on function public.ponte_deskcomm_anuncios_entradas() to service_role;

-- As duas fontes novas da Bel: a deskcomm-base so ATUALIZA estas linhas.
insert into ponte_deskcomm.fontes_base (chave)
values ('recepcao_faq'), ('recepcao_entradas')
on conflict (chave) do nothing;

-- Relatorio para o dono avaliar cada anuncio (acesso so pela service role).
create or replace view ponte_deskcomm.v_leads_por_anuncio as
select a.slug, a.nome, a.publico, c.nome as produto, a.promessa,
       count(distinct ct.id)                                                        as contatos,
       count(distinct l.id)                                                         as leads,
       count(distinct l.id) filter (where l.status = 'sem_interacao')               as sem_interacao,
       count(distinct l.id) filter (where l.status = 'simulacao')                   as simulacao,
       count(distinct l.id) filter (where l.status = 'negociacao')                  as negociacao,
       count(distinct l.id) filter (where l.status = 'reuniao_agendada')            as reuniao_agendada,
       count(distinct l.id) filter (where l.status = 'contrato_enviado')            as contrato_enviado,
       count(distinct l.id) filter (where l.status in ('ativacao', 'ativo', 'pago')) as fechados,
       count(distinct l.id) filter (where l.status = 'negocio_perdido')             as perdidos,
       count(distinct l.id) filter (where l.qualificacao #>> '{jev,temperatura}' in ('quente', 'fechando')) as quentes,
       round(avg((l.qualificacao #>> '{jev,probabilidade_fechamento_30d}')::numeric), 3) as prob_fechar_30d_media,
       min(ct.created_at)                                                           as primeiro_contato,
       max(ct.created_at)                                                           as ultimo_contato
  from ponte_deskcomm.anuncios a
  join ponte_deskcomm.categorias c on c.slug = a.categoria
  left join contacts ct on ('anuncio:' || a.slug) = any(ct.tags)
  left join ponte_deskcomm.vinculos v on v.contact_id = ct.id
  left join leads l on l.id = v.b2w_lead_id
 group by a.slug, a.nome, a.publico, c.nome, a.promessa, a.visto_primeiro_em
 order by a.visto_primeiro_em;
grant select on ponte_deskcomm.v_leads_por_anuncio to service_role;
```

- [ ] **Step 2: Ensaiar em transação desfeita (nada fica gravado)**

Pelo MCP do Supabase (`execute_sql`, projeto `abbysvxnnhwvvzhftoms`), enviar `begin;` + o conteúdo inteiro da migration + a verificação abaixo + `rollback;`:

```sql
-- 1. retroativo: um UPDATE sem mudança de dado dispara o gatilho nos contatos da Meta
update contacts set source_metadata = source_metadata where source = 'meta_ads';

select 'anuncios' k, count(*)::text v from ponte_deskcomm.anuncios                                  -- esperado: 2
union all select 'contatos_com_etiqueta', count(*)::text from contacts
          where exists (select 1 from unnest(tags) t where t like 'anuncio:%')                       -- esperado: 10
union all select 'plataformas', string_agg(slug||'='||array_to_string(plataformas, '/'), ' | ') from ponte_deskcomm.anuncios
union all select 'leads_com_anuncio', count(*)::text from leads where qualificacao #> '{deskcomm,anuncio}' is not null
union all select 'erros_novos', count(*)::text from ponte_deskcomm.erros where criado_em > now() - interval '5 minutes'  -- esperado: 0
union all select 'fu_preservado', count(*)::text from contacts where exists (select 1 from unnest(tags) t where t like 'fu:%');  -- esperado: 13 (como antes)

-- 2. renomear o slug propaga para contato e lead
update ponte_deskcomm.anuncios set slug = 'teste-renomeado'
 where ad_id = (select ad_id from ponte_deskcomm.anuncios order by visto_primeiro_em limit 1);
select 'renomeado_contatos' k, count(*)::text v from contacts where 'anuncio:teste-renomeado' = any(tags)
union all select 'renomeado_leads', count(*)::text from leads where qualificacao #>> '{deskcomm,anuncio,slug}' = 'teste-renomeado';

-- 3. relatório e RPC respondem
select * from ponte_deskcomm.v_leads_por_anuncio;
select * from public.ponte_deskcomm_anuncios_entradas();
select chave from ponte_deskcomm.fontes_base where chave like 'recepcao_%' order by 1;  -- esperado: 2 linhas

rollback;
```

Expected: 2 anúncios; 10 contatos com etiqueta; `erros_novos` = 0; `fu_preservado` = 13; renomeação propaga a contatos e leads; relatório e RPC devolvem linhas; 2 chaves de `fontes_base`. Qualquer erro em `ponte_deskcomm.erros` ou número diferente: parar e corrigir a migration (pode ser reação de outro gatilho de `contacts` ao `UPDATE` de `tags`).

- [ ] **Step 3: Conferir que o ensaio não deixou rastro**

```sql
select (select count(*) from pg_namespace n join pg_class c on c.relnamespace = n.oid
         where n.nspname = 'ponte_deskcomm' and c.relname = 'anuncios') as tabela_existe,   -- esperado: 0
       (select count(*) from pg_trigger where tgname = 'trg_ponte_contato_anuncio') as gatilho; -- esperado: 0
```

- [ ] **Step 4: Aplicar de verdade**

MCP `apply_migration` com `name: "20261024a_anuncios_ponte"` e o mesmo SQL do Step 1. Repetir só a primeira parte da verificação do Step 2 (sem `begin`/`rollback` e **sem** o `update ... set slug = 'teste-renomeado'`), depois do `UPDATE` retroativo do item 1. Expected: os mesmos números.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add supabase/migrations/20261024a_anuncios_ponte.sql && git commit -m "feat(deskcomm): rastreio do anúncio de origem (tabela, etiqueta, lead e relatório)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ligar as duas fontes à função `deskcomm-base` e publicar

**Files:**
- Modify: `supabase/functions/deskcomm-base/index.ts`

**Interfaces:**
- Consumes: `FAQ_RECEPCAO`, `montarEntradas`, `AnuncioEntrada`, RPC `ponte_deskcomm_anuncios_entradas`, chaves `recepcao_faq` e `recepcao_entradas` em `fontes_base`, categoria `triagem` (a RPC `ponte_deskcomm_agente_da_categoria('triagem')` devolve a Bel).

- [ ] **Step 1: Editar `index.ts`**

1. Imports: trocar o bloco do `montar.ts` por

```ts
import {
    hashTexto, lerFaq, montarUsinasAVenda, montarCoberturaAssinatura, montarUsinasCotas, montarEntradas,
    type UsinaAVenda, type CoberturaAssinatura, type UsinaCotas, type AnuncioEntrada,
} from './montar.ts'
```

e acrescentar depois do import de `FAQ_COTAS`:

```ts
import { FAQ_RECEPCAO } from './bases/recepcao-faq.ts'
```

2. Na interface `Conteudo`, trocar as duas uniões:

```ts
    chave: 'investidor_faq' | 'usinas_a_venda' | 'assinatura_faq' | 'assinatura_cobertura' | 'cotas_faq' | 'usinas_cotas'
        | 'recepcao_faq' | 'recepcao_entradas'
    categoria: 'usina_investimento' | 'energia_assinatura' | 'cotas' | 'triagem'
```

3. Em `montarConteudos`, depois de `const paresCot = lerFaq(FAQ_COTAS)` acrescentar `const paresRec = lerFaq(FAQ_RECEPCAO)`; trocar a linha do `faq_vazio` por

```ts
    if (paresInv.length === 0 || paresAss.length === 0 || paresCot.length === 0 || paresRec.length === 0) throw new Error('faq_vazio')
```

depois do bloco `cotErr` acrescentar

```ts
    const { data: entradas, error: entErr } = await supabase.rpc('ponte_deskcomm_anuncios_entradas')
    if (entErr) throw new Error(`entradas_ilegiveis: ${entErr.message}`)
```

e acrescentar ao array retornado, depois da linha de `usinas_cotas`:

```ts
        { chave: 'recepcao_faq', categoria: 'triagem', tipo: 'faq', nome: 'Recepção — Perguntas e respostas', texto: JSON.stringify(paresRec), pares: paresRec },
        { chave: 'recepcao_entradas', categoria: 'triagem', tipo: 'documento', nome: 'Recepção: entradas', texto: montarEntradas((entradas ?? []) as AnuncioEntrada[]) },
```

4. Em `sincronizar`, trocar a escolha do script na mensagem de fonte recriada por

```ts
        const script = c.categoria === 'energia_assinatura' ? 'base_assinatura.sql'
            : c.categoria === 'cotas' ? 'base_cotas.sql'
            : c.categoria === 'triagem' ? 'base_bel.sql' : 'base_investidor.sql'
```

5. Atualizar o comentário do topo do arquivo: onde diz "Mantem seis fontes", passar a "oito fontes" e acrescentar as duas linhas das fontes da Recepção.

- [ ] **Step 2: Checar sintaxe e testes**

```bash
cd "$WT" && npx esbuild supabase/functions/deskcomm-base/index.ts --bundle=false --loader:.ts=ts --log-level=warning > /dev/null && echo "index.ts: sintaxe ok" && npx vitest run tests/deskcomm-base.test.ts
```

Expected: `index.ts: sintaxe ok` e todos os testes passando.

- [ ] **Step 3: Publicar a função**

```bash
cd "$WT" && npx supabase functions deploy deskcomm-base --project-ref abbysvxnnhwvvzhftoms
```

Se a CLI não estiver autenticada, publicar pelo MCP `deploy_edge_function` (`name: deskcomm-base`, `verify_jwt: true`) enviando `index.ts`, `montar.ts` e os quatro arquivos de `bases/` com os mesmos nomes e caminhos relativos.

- [ ] **Step 4: Chamar em modo ensaio e conferir os textos**

```sql
select ponte_deskcomm.fn_chamar_funcao('deskcomm-base', '{"ensaio": true}'::jsonb) as req;
```

Depois, com o `req` devolvido:

```sql
select status_code, left(content::text, 1500) from net._http_response where id = <req>;
```

Expected: `status_code = 200`, `ok: true`, e na lista de conteúdos aparecem `recepcao_faq` (18 pares) e `recepcao_entradas` (documento com os 2 anúncios, de nomes provisórios).

- [ ] **Step 5: Sincronizar de verdade e conferir a indexação**

```sql
select ponte_deskcomm.fn_chamar_funcao('deskcomm-base', '{}'::jsonb) as req;
```

Aguardar cerca de 1 minuto, então:

```sql
select f.chave, f.knowledge_source_id is not null as tem_fonte, f.sincronizado_em,
       k.name, k.status, k.last_index_status, k.chunks_count
  from ponte_deskcomm.fontes_base f
  left join ai_knowledge_sources k on k.id = f.knowledge_source_id
 where f.chave like 'recepcao_%' order by f.chave;
```

Expected: as duas com `tem_fonte = true`, `last_index_status = success` e `chunks_count > 0`. Se `chunks_count = 0`, esperar o debounce do indexador (o cron de hora em hora reemite) e repetir.

- [ ] **Step 6: Conferir que a busca acha as frases-chave**

```sql
select k.name, count(*) filter (where c.content ilike '%videochamada%') videochamada,
       count(*) filter (where c.content ilike '%olavo lacerda montenegro%') endereco,
       count(*) filter (where c.content ilike '%cadastro no app%') app,
       count(*) filter (where c.content ilike '%Simulei no site%') simulador,
       count(*) filter (where c.content ilike '%anuncio:%') etiqueta
  from ai_chunks c join ai_knowledge_sources k on k.id = c.knowledge_source_id
 where k.name in ('Recepção — Perguntas e respostas', 'Recepção: entradas') group by 1;
```

Expected: FAQ com `videochamada` e `endereco` > 0; documento com `app`, `simulador` e `etiqueta` > 0.

- [ ] **Step 7: Commit**

```bash
cd "$WT" && git add supabase/functions/deskcomm-base/index.ts && git commit -m "feat(deskcomm): deskcomm-base sincroniza as fontes da Recepção (FAQ e entradas)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bel v7 (alteração cirúrgica do prompt publicado)

**Files:**
- Create: `scripts/deskcomm/base_bel.sql`

**Interfaces:**
- Consumes: `ponte_deskcomm_agente_da_categoria('triagem')`; chaves `recepcao_faq` e `recepcao_entradas` já com `knowledge_source_id` (Task 4); a âncora `Quem não é cliente nem lead —` do prompt vigente da Bel.

- [ ] **Step 1: Escrever o script**

```sql
-- Bel (Recepção) v7: base de conhecimento e regra de anúncio
-- (spec docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md §5.3 e §6).
--
-- Rodar DEPOIS da primeira execução da Edge Function deskcomm-base com as fontes da
-- Recepção (grava os ids em ponte_deskcomm.fontes_base).
--
-- CIRÚRGICO sobre a VERSÃO PUBLICADA: o prompt de produção tem a seção de persona
-- ("## Quem você é"); regenerar pelo bel_recepcao.sql a apagaria. O script insere a
-- regra antes do parágrafo "Quem não é cliente nem lead —" e anexa as duas fontes.
-- Idempotente: pula se o prompt já tem a regra e a versão já lê as duas fontes.
-- Publica por fn_publish_ai_agent_version, a mesma função da tela.

do $$
declare
    v_org     uuid;
    v_agente  uuid;
    v_atual   uuid;
    v_versao  uuid := gen_random_uuid();
    v_fontes  uuid[];
    v_prompt  text;
    v_ok      boolean;

    v_ancora constant text := 'Quem não é cliente nem lead —';
    v_marca  constant text := 'Anúncio e entradas: consulte as etiquetas do contato';
    v_regra  constant text := $r$Anúncio e entradas: consulte as etiquetas do contato (crm_get_contact). Com etiqueta anuncio:…, o contato clicou em um anúncio (se houver mais de uma, vale a última): busque "entradas anúncios" na base (crm_search_knowledge) para saber o que o anúncio ofereceu e abra falando disso, sem perguntar o que a pessoa procura. Confirme se é pessoa física ou empresa: nunca presuma, mesmo no anúncio de CNPJ. Contato de anúncio sem etiqueta (source meta_ads) é interesse em desconto na conta de luz. Nunca repita um percentual do anúncio como valor garantido: o percentual do cliente sai da simulação. Para dúvidas sobre quem é a B2W, endereço, horário, CNPJ e canais, busque na base antes de responder. Se o cliente pedir uma videochamada ou quiser confirmar que a B2W é real, ofereça a videochamada com o time comercial e passe para humano (crm_request_human_handoff) com o motivo "videochamada". Quem não conseguiu se cadastrar pelo app: humano, motivo "cadastro no app".$r$ || E'\n\n';
begin
    select organization_id, agent_id into v_org, v_agente
      from public.ponte_deskcomm_agente_da_categoria('triagem');
    if v_agente is null then raise exception 'Bel nao encontrada'; end if;

    select array_agg(knowledge_source_id order by chave) into v_fontes
      from ponte_deskcomm.fontes_base
     where chave in ('recepcao_faq', 'recepcao_entradas') and knowledge_source_id is not null;
    if coalesce(array_length(v_fontes, 1), 0) < 2 then
        raise exception 'Fontes ainda nao criadas: rode a Edge Function deskcomm-base primeiro';
    end if;

    select published_version_id into v_atual from ai_agents where id = v_agente;
    select system_prompt into v_prompt from ai_agent_versions where id = v_atual;

    if position(v_marca in v_prompt) = 0 then
        if position(v_ancora in v_prompt) = 0 then
            raise exception 'ancora da Bel nao encontrada no prompt publicado';
        end if;
        v_prompt := replace(v_prompt, v_ancora, v_regra || v_ancora);
    end if;

    select v.system_prompt = v_prompt and v.knowledge_source_ids @> v_fontes into v_ok
      from ai_agent_versions v where v.id = v_atual;
    if v_ok then
        raise notice 'Bel ja esta com a regra de anuncio e as fontes; nada a fazer';
        return;
    end if;

    insert into ai_agent_versions (
        id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
        tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
        history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
        created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
        cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
        knowledge_source_ids, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms)
    select v_versao, v.organization_id, v.agent_id,
           (select max(version_number) + 1 from ai_agent_versions where agent_id = v_agente),
           v_prompt, v.provider, v.model, v.credential_id,
           (select array_agg(distinct t) from unnest(v.tool_ids || array['crm_search_knowledge',
                'crm_get_contact', 'crm_request_human_handoff']) t),
           v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
           v.history_message_window, v.history_token_window, v.handoff_keywords, true, 'draft',
           a.created_by, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
           v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
           (select array_agg(distinct s) from unnest(coalesce(v.knowledge_source_ids, '{}') || v_fontes) s),
           v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
      from ai_agent_versions v join ai_agents a on a.id = v.agent_id
     where v.id = v_atual;

    perform * from fn_publish_ai_agent_version(v_org, v_agente, v_versao);

    insert into event_log (organization_id, event_type, entity_kind, payload)
    values (v_org, 'ai_agent.published', 'ai_agent',
            jsonb_build_object('agent_id', v_agente, 'version_id', v_versao, 'previous_version_id', v_atual,
                               'origem', 'base_bel'));
end $$;
```

- [ ] **Step 2: Executar no banco (MCP `execute_sql`) com o conteúdo do arquivo**

Expected: a execução termina sem erro. Segunda execução: `NOTICE: Bel ja esta com a regra de anuncio e as fontes; nada a fazer` (idempotência).

- [ ] **Step 3: Verificar a versão publicada**

```sql
select a.name, v.version_number, v.status,
       position('Anúncio e entradas: consulte as etiquetas do contato' in v.system_prompt) > 0 as tem_regra,
       position('## Quem você é' in v.system_prompt) > 0 as manteve_persona,
       position('Quem não é cliente nem lead —' in v.system_prompt) > 0 as manteve_nao_lead,
       v.knowledge_source_ids @> (select array_agg(knowledge_source_id) from ponte_deskcomm.fontes_base where chave like 'recepcao_%') as le_as_fontes,
       v.tool_ids @> array['crm_search_knowledge', 'crm_get_contact', 'crm_request_human_handoff'] as tem_ferramentas,
       cardinality(v.knowledge_source_ids) as n_fontes
  from ai_agents a join ai_agent_versions v on v.id = a.published_version_id
 where a.name like 'Bel%';
```

Expected: `version_number` 7 (ou a seguinte à vigente), `status = published`, as cinco colunas booleanas `true`, `n_fontes` = 3 (Conversas anteriores + as duas novas).

- [ ] **Step 4: Conferir que o roteador e as outras versões não mudaram**

```sql
select a.name, v.version_number from ai_agents a join ai_agent_versions v on v.id = a.published_version_id order by a.name;
select count(*) as intencoes from ai_router_members;   -- esperado: 8
select count(*) as erros_recentes from ponte_deskcomm.erros where criado_em > now() - interval '30 minutes';  -- esperado: 0
```

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add scripts/deskcomm/base_bel.sql && git commit -m "feat(deskcomm): Bel v7 com a base de conhecimento e a regra de anúncio

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentação, desvios do spec e pull request

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md`
- Modify: `playbook/DESKCOMM.md`

- [ ] **Step 1: Registrar no spec os dois desvios decididos ao planejar**

```bash
cd "$WT" && python - <<'PY'
import io, re
p = 'docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md'
s = io.open(p, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'

# 4.1: sem visto_ultimo_em (derivado do relatório)
s = s.replace('| `ativo`, `visto_primeiro_em`, `visto_ultimo_em` | controle |',
              '| `ativo`, `visto_primeiro_em` | controle. O último contato sai do relatório (§4.4): gravar `visto_ultimo_em` a cada contato dispararia a regeração do documento |')

# 4.3: gatilho em vinculos, sem tocar em fn_card_para_lead
ini = s.index('### 4.3 Lead')
fim = s.index('### 4.4 Relatório')
novo = ('### 4.3 Lead' + nl + nl +
        'O anúncio vai para `leads.qualificacao.deskcomm.anuncio = {ad_id, slug, titulo, plataforma, em}`, preservando o que já '
        'existe em `qualificacao.deskcomm` (origem, indicado_por, lista_espera). **Desvio do desenho inicial:** em vez de estender '
        '`fn_card_para_lead` (3,5 mil caracteres, com gatilhos de outras sessões em volta), a cópia roda por um gatilho pequeno '
        'em `ponte_deskcomm.vinculos` (`AFTER INSERT`) e pelo gatilho do §4.2 item 3. Cobre as duas ordens (anúncio antes ou depois '
        'do lead) sem alterar nenhuma função existente.' + nl + nl)
s = s[:ini] + novo + s[fim:]

# 7: nome da migration e linhas afetadas
s = s.replace('| 1 | Tabela, gatilho, extensão de `fn_card_para_lead`, relatório | `supabase/migrations/20261024a_anuncios_ponte.sql` |',
              '| 1 | Tabela, gatilhos (contato, vínculo, renomeação, regeração), RPC de leitura, relatório | `supabase/migrations/20261024a_anuncios_ponte.sql` |')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
PY
git diff --stat docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md | tail -1
```

Expected: `ok` e o diff do spec com poucas linhas alteradas.

- [ ] **Step 2: Acrescentar a §8.5 ao playbook**

Abrir `playbook/DESKCOMM.md`, localizar o fim da seção `### 8.4` (Cotas) e acrescentar depois dela:

```markdown
### 8.5 Bel (Recepção): base de conhecimento e anúncio de origem (24/10/2026)

Spec `docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md`, plano `docs/superpowers/plans/2026-10-24-base-bel-recepcao.md`.

- **Rastreio do anúncio.** O contato que vem da Meta ganha a etiqueta `anuncio:<slug>`, e o anúncio é registrado em `ponte_deskcomm.anuncios` (nome provisório `anuncio-<8 últimos dígitos>`; o dono troca o slug, o nome, o público e a promessa). O lead da B2W recebe o anúncio em `qualificacao.deskcomm.anuncio`. Relatório: `select * from ponte_deskcomm.v_leads_por_anuncio;`.
- **Base da Bel.** Duas fontes: "Recepção — Perguntas e respostas" (18 itens, arquivo `bases/recepcao-faq.ts`) e "Recepção: entradas" (documento gerado da tabela de anúncios, regerado quando ela muda). Só fatos: sem percentual, preço nem lista de estados.
- **Bel v7.** Regra de anúncio no roteiro (abre pelo que o anúncio ofereceu, pergunta pessoa física ou empresa, nunca repete percentual do anúncio como garantia, oferece videochamada com o time comercial e passa para humano com o motivo `videochamada`).
- **Dados do dono:** CNPJ "consta no contrato"; endereço Olavo Lacerda Montenegro, 467, Parque das Nações, Parnamirim/RN; equipe das 9h às 17h (Brasília), dias não informados.
- **Pendências:** nome, público e promessa de cada anúncio (inclusive o Plano Connect 15%); regras do Connect na base da Assinatura; razão social; dias de atendimento; cobertura real em estados (o site lista 8, o sistema tem plano só para a Cosern). `base_assinatura.sql` e `base_investidor.sql` ainda citam a Gestora como destino de repasse.
```

- [ ] **Step 3: Commit, empurrar e abrir o PR**

```bash
cd "$WT" && git add docs playbook && git commit -m "docs(deskcomm): plano, desvios do spec e §8.5 do playbook

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" && git push -q origin feat/base-bel-recepcao
gh pr create --repo WaldineyGodoy/saas --base main --head feat/base-bel-recepcao --title "feat(deskcomm): base de conhecimento da Bel (Recepção) e rastreio do anúncio de origem" --body-file - <<'EOF'
## O que muda
- Etiqueta `anuncio:<slug>` no contato da Meta, tabela de anúncios, cópia para o lead da B2W e relatório por anúncio.
- Base de conhecimento da Bel (FAQ de 18 itens + documento "Recepção: entradas" gerado) e Bel v7.

Já aplicado em produção (registrado aqui para o histórico): migration `20261024a_anuncios_ponte`, função `deskcomm-base`, Bel v7.

Spec e plano em `docs/superpowers/`. Sem mudança de front.

## Verificação
- Migration ensaiada em transação desfeita nos 10 contatos reais (2 anúncios, 10 etiquetas, 0 erros, `fu:` preservado).
- vitest do FAQ e do documento passando; fontes indexadas e frases-chave encontradas nos chunks.
- Pendente: teste real com anúncio quando chegar o próximo lead do Connect.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Expected: URL do PR. O merge é decisão do dono.

---

## Self-Review (spec × plano)

| Requisito do spec | Tarefa |
|---|---|
| §4.1 tabela `anuncios` | Task 3 |
| §4.2 gatilho no contato, etiqueta, falha aberta | Task 3 (`fn_contato_anuncio`) |
| §4.3 anúncio no lead, nas duas ordens | Task 3 (`fn_vinculo_anuncio` + passo 3 do gatilho) — desvio registrado na Task 6 |
| §4.4 relatório | Task 3 (`v_leads_por_anuncio`) |
| §4.5 retroativo nos 10 contatos | Task 3 passos 2 e 4 |
| §5.1 FAQ de 18 perguntas | Task 1 |
| §5.2 documento gerado e regerado | Tasks 2, 3 (gatilho `trg_ponte_anuncios_base`) e 4 |
| §5.3 regras de uso e §6 Bel v7 | Task 5 |
| §8 verificação (ensaio, ordens, indexação, busca, "não cita 20%/15%") | Tasks 1 (teste sem `\d%`), 3, 4 |
| §9 dados do dono | Task 1 (texto e testes) |
| `fu:` intocado | Global Constraints + Task 3 passo 2 (`fu_preservado`) |

Conferências de consistência: `FAQ_RECEPCAO` (Task 1) é o nome importado em `index.ts` (Task 4); `montarEntradas`/`AnuncioEntrada` (Task 2) batem com o uso em `index.ts` e com as colunas da RPC `ponte_deskcomm_anuncios_entradas` (Task 3); as chaves `recepcao_faq`/`recepcao_entradas` são as mesmas na migration, em `index.ts` e em `base_bel.sql`; a categoria `triagem` é a mesma da tabela `categorias`.

Teste real fim a fim (anúncio → etiqueta → abertura da Bel) depende de um lead novo da Meta e fica registrado como pendente, não como feito.
