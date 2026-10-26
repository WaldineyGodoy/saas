# Adesão pelo WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Bia faz a adesão à Energia por Assinatura na conversa do WhatsApp: colhe dados e documentos, o CRM cria o assinante e gera o contrato, e a Bia entrega o link de assinatura.

**Architecture:** O card do Deskcomm (`crm_leads.custom_fields`) é o formulário que a Bia preenche. Gatilhos da ponte (`ponte_deskcomm`) levam mídia e mudanças do card para a Edge Function `adesao-whatsapp`, que lê a conta, valida, cria o assinante pelas funções do site e gera o contrato. A Bia acompanha pela ferramenta de leitura `b2w_status_adesao`.

**Tech Stack:** Postgres/Supabase (migration, RPC security definer, gatilhos, pg_net via `ponte_deskcomm.fn_chamar_funcao`), Edge Functions Deno, OpenRouter (leitura de conta), vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md`

## Global Constraints

- Worktree `C:\Users\Godoy\Documents\HTML\wt-adesao`, branch `feat/adesao-whatsapp`. `node_modules` por junção para a pasta principal (`cmd /c mklink /J`).
- Projeto Supabase `abbysvxnnhwvvzhftoms`. **Migration, deploy, script de funil e publicação da Bia: só com aprovação explícita do usuário.**
- Repositório **público**: nenhum dado real de cliente em código, teste, commit ou PR. Testes com dados fictícios (CPF de teste `52998224725`).
- O modelo nunca grava fora do card; tudo que vai ao assinante sai da ponte, validado.
- `aceite_versao = 'whatsapp-v1'`; vencimento dia 5; telefone do contato só pelo cabeçalho `X-Deskcomm-Contato-Telefone`.
- Ferramentas MCP só de leitura (`mcp_externo:leitura:*`). CPF sempre mascarado fora do banco.
- Gatilhos: `exception when others` → `ponte_deskcomm.erros`; nunca bloqueiam gravação.
- Mudanças nos agentes: cirúrgicas sobre a versão publicada (preservam a persona), como `scripts/deskcomm/ajuste_bia_fechamento.sql`.
- Horários para o usuário em Brasília (UTC-3).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/functions/_shared/leitura-conta.ts` (novo) | Leitura de conta por OpenRouter (esquema, instruções, `completarLeitura`, `lerConta`). Extraído de `parse-invoice-image`. |
| `supabase/functions/parse-invoice-image/index.ts` | Passa a usar o módulo compartilhado (sem mudança de comportamento). |
| `supabase/functions/adesao-whatsapp/regras.ts` (novo) | Regras puras: CPF, e-mail, máscara, compatibilidade CPF × conta, endereço, parâmetros de `fn_criar_assinante_publico`, erros e status. |
| `supabase/functions/adesao-whatsapp/index.ts` (novo) | Orquestração: ações `conta`, `documento`, `validar`, `criar`. |
| `supabase/functions/onboarding-finalizar/index.ts` | Opção `sem_whatsapp` (só e-mail). |
| `supabase/functions/b2w-mcp/logica.ts`, `index.ts` | Ferramenta `b2w_status_adesao`. |
| `supabase/migrations/20261027a_adesao_whatsapp.sql` (novo) | Tabela `ponte_deskcomm.adesoes`, RPCs, gatilhos. |
| `supabase/tests/adesao_whatsapp.test.sql` (novo) | Teste em transação desfeita. |
| `scripts/deskcomm/adesao_funil.sql` (novo) | Campos do card e etapa "Pendência de adesão" no funil da Assinatura. |
| `scripts/deskcomm/ajuste_bia_adesao.sql` (novo) | Roteiro de adesão na Bia + ferramenta. |
| `tests/leitura-conta.test.ts`, `tests/adesao-whatsapp.test.ts` (novos), `tests/b2w-mcp.test.ts` | Testes vitest. |
| `playbook/DESKCOMM.md` | §8.4. |

---

### Task 1: Leitor de conta compartilhado

**Files:**
- Create: `supabase/functions/_shared/leitura-conta.ts`
- Modify: `supabase/functions/parse-invoice-image/index.ts`
- Test: `tests/leitura-conta.test.ts`

**Interfaces:**
- Produces:
  - `completarLeitura(lido: any): ContaCompleta` (mesmo comportamento atual).
  - `lerConta(base64: string, mime: string, cfg: { apiKey: string; modelo: string }): Promise<{ ok: true; dados: ContaCompleta; modelo: string } | { ok: false; status: number; erro: string }>`.
  - `TIPOS_IMAGEM`, `TIPO_PDF`.
  - `type ContaCompleta` com: `legivel, observacoes, titular, documentoTipo ('CPF'|'CNPJ'|''), documento, numeroUc, endereco ({logradouro, complemento, bairro, cep, cidade, uf, completo} | null), ligacao ('monofasico'|'bifasico'|'trifasico'|''), mediaKwh, concessionaria`, mais os campos originais do esquema.

- [ ] **Step 1: Teste que falha**

`tests/leitura-conta.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { completarLeitura } from '../supabase/functions/_shared/leitura-conta'

describe('completarLeitura', () => {
    const base = {
        legivel: true, observacoes: '', numeroUcNovo: '', codigoCliente: '7012345', codigoInstalacao: '',
        titular: 'MARIA TESTE', documentoTipo: 'CPF', documento: '529.9**.***-**',
        endereco: { logradouro: 'RUA DAS FLORES, 120', complemento: '', bairro: 'CENTRO', cep: '59000-000', cidade: 'NATAL', uf: 'RN' },
        classificacao: 'B1 RESIDENCIAL', tipoFornecimento: 'Conv. Monômia - Bifásico',
        historico: [{ mes: '2026-08', kwh: 300, dias: 30 }, { mes: '2026-09', kwh: 0, dias: 30 }, { mes: '2026-07', kwh: 200, dias: 31 }],
    }
    it('número da UC: novo > cliente > instalação', () => {
        expect(completarLeitura(base).numeroUc).toBe('7012345')
        expect(completarLeitura({ ...base, numeroUcNovo: '1.234.567.890-12' }).numeroUc).toBe('1.234.567.890-12')
    })
    it('ligação pelo tipo de fornecimento', () => {
        expect(completarLeitura(base).ligacao).toBe('bifasico')
        expect(completarLeitura({ ...base, tipoFornecimento: 'Trifásico' }).ligacao).toBe('trifasico')
    })
    it('média só dos meses com consumo', () => {
        expect(completarLeitura(base).mediaKwh).toBe(250)
    })
    it('endereço completo e concessionária', () => {
        const c = completarLeitura(base)
        expect(c.endereco?.completo).toBe('RUA DAS FLORES, 120, CENTRO, 59000-000 NATAL RN')
        expect(c.concessionaria).toBe('Neoenergia Cosern')
    })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (PowerShell, no worktree): `npx vitest run tests/leitura-conta.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Criar `_shared/leitura-conta.ts`**

Mover de `parse-invoice-image/index.ts` para o módulo, sem mudar o texto: `OPENROUTER_URL`, `TIPOS_IMAGEM`, `TIPO_PDF`, os auxiliares `texto`/`numero`/`objeto`, `ESQUEMA`, `INSTRUCOES`, `ligacaoDoFornecimento` e `completarLeitura` (exportar `completarLeitura`, `TIPOS_IMAGEM`, `TIPO_PDF`). O módulo não importa nada de Deno nem de Supabase. Acrescentar:

```ts
export type ContaCompleta = ReturnType<typeof completarLeitura>

/**
 * Chama o OpenRouter e devolve a conta lida. Mesmos status de erro que o
 * parse-invoice-image devolvia (400 entrada, 422 ilegível, 502 falha).
 */
export async function lerConta(base64: string, mime: string, cfg: { apiKey: string; modelo: string }):
    Promise<{ ok: true; dados: ContaCompleta; modelo: string } | { ok: false; status: number; erro: string }> {
    const ehPdf = mime === TIPO_PDF
    if (!ehPdf && !TIPOS_IMAGEM.includes(mime)) return { ok: false, status: 400, erro: `Tipo de arquivo não suportado: ${mime}.` }
    if (base64.length > 7_000_000) return { ok: false, status: 400, erro: 'Arquivo grande demais. Envie uma foto menor.' }
    let resposta: Response
    try {
        resposta = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'B2W Energia - leitura de conta' },
            body: JSON.stringify({
                model: cfg.modelo,
                max_tokens: 8000,
                response_format: { type: 'json_schema', json_schema: { name: 'conta_energia', strict: true, schema: ESQUEMA } },
                provider: { require_parameters: true },
                ...(ehPdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] } : {}),
                messages: [
                    { role: 'system', content: INSTRUCOES },
                    { role: 'user', content: [
                        ehPdf
                            ? { type: 'file', file: { filename: 'conta.pdf', file_data: `data:${TIPO_PDF};base64,${base64}` } }
                            : { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
                        { type: 'text', text: 'Transcreva esta conta de energia.' },
                    ] },
                ],
            }),
        })
    } catch (err) {
        console.error('leitura-conta: falha de rede', err)
        return { ok: false, status: 502, erro: 'Falha ao ler a foto. Tente de novo.' }
    }
    const corpo = await resposta.json().catch(() => null)
    if (!resposta.ok || !corpo || corpo.error) {
        console.error('leitura-conta: OpenRouter', resposta.status, JSON.stringify(corpo?.error ?? corpo))
        return { ok: false, status: 502, erro: 'Falha ao ler a foto. Tente de novo.' }
    }
    const escolha = corpo.choices?.[0]
    if (escolha?.finish_reason === 'length') return { ok: false, status: 502, erro: 'Não foi possível ler a foto.' }
    let dados
    try {
        dados = JSON.parse(String(escolha?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } catch {
        return { ok: false, status: 502, erro: 'Leitura da foto veio em formato inesperado.' }
    }
    if (!dados.legivel) {
        return { ok: false, status: 422, erro: dados.observacoes || (ehPdf ? 'Não foi possível ler este PDF de conta de energia.' : 'Foto ilegível. Tire outra com boa luz, a conta inteira e sem dobras.') }
    }
    return { ok: true, dados: completarLeitura(dados), modelo: corpo.model }
}
```

- [ ] **Step 4: `parse-invoice-image` usa o módulo**

Em `parse-invoice-image/index.ts`: importar `import { lerConta } from '../_shared/leitura-conta.ts'`, apagar o que foi movido, e trocar tudo de `let resposta: Response` até o `return json({ ok: true, ...})` final por:

```ts
    const r = await lerConta(imageBase64, mediaType, { apiKey, modelo })
    if (!r.ok) return json({ ok: false, error: r.erro }, r.status)
    return json({ ok: true, dados: r.dados, modelo: r.modelo })
```

Manter a validação de tipo/tamanho e o portão de autenticação como estão (o `lerConta` repete a checagem; inofensivo).

- [ ] **Step 5: Rodar**

Run: `npx vitest run` → PASS (inclui os 4 novos).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/leitura-conta.ts supabase/functions/parse-invoice-image/index.ts tests/leitura-conta.test.ts
git commit -m "refactor(conta): leitor de conta em módulo compartilhado"
```

---

### Task 2: Regras puras da adesão

**Files:**
- Create: `supabase/functions/adesao-whatsapp/regras.ts`
- Test: `tests/adesao-whatsapp.test.ts`

**Interfaces:**
- Consumes: `ContaCompleta` (Task 1).
- Produces (exports de `regras.ts`):
  - `soDigitos(s: string | null | undefined): string`
  - `cpfValido(cpf: string): boolean`
  - `emailValido(email: string): boolean`
  - `documentoCompativel(cpf: string, mascarado: string): boolean`
  - `separarNumero(logradouro: string): { rua: string; numero: string }`
  - `errosDaConta(c: ContaCompleta, sim: { atende: boolean; atinge_minimo: boolean | null } | null): string[]`
  - `errosDeValidacao(cf: CamposCard, conta: ContaCompleta | null, cpfJaExiste: boolean): string[]`
  - `parametrosAssinante(a: EntradaAssinante): Record<string, unknown>` (nomes `p_*` de `fn_criar_assinante_publico`)
  - `statusDaAdesao(erros: string[], temLink: boolean): 'pendencia' | 'coletando' | 'contrato_pronto'`
  - `PENDENCIAS: Set<string>`
  - `type CamposCard = { adesao_cpf?: string; adesao_email?: string; adesao_telefone?: string; adesao_titular_ok?: boolean | null }`
  - `type EntradaAssinante = { conta: ContaCompleta; cpf: string; email: string; telefone: string; ibge: string | null; leadId: string; originatorId: string | null; indicadorId: string | null }`

- [ ] **Step 1: Testes que falham**

`tests/adesao-whatsapp.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
    soDigitos, cpfValido, emailValido, documentoCompativel, separarNumero, errosDaConta,
    errosDeValidacao, parametrosAssinante, statusDaAdesao,
} from '../supabase/functions/adesao-whatsapp/regras'
import { completarLeitura } from '../supabase/functions/_shared/leitura-conta'

const conta = completarLeitura({
    legivel: true, observacoes: '', numeroUcNovo: '', codigoCliente: '7012345', codigoInstalacao: '',
    titular: 'MARIA TESTE', documentoTipo: 'CPF', documento: '529.9**.***-**',
    endereco: { logradouro: 'RUA DAS FLORES, 120', complemento: 'AP 2', bairro: 'CENTRO', cep: '59000-000', cidade: 'NATAL', uf: 'RN' },
    tipoFornecimento: 'Bifásico', historico: [{ mes: '2026-08', kwh: 300, dias: 30 }],
})

describe('CPF e e-mail', () => {
    it('cpfValido', () => {
        expect(cpfValido('529.982.247-25')).toBe(true)
        expect(cpfValido('52998224724')).toBe(false)
        expect(cpfValido('11111111111')).toBe(false)
        expect(cpfValido('123')).toBe(false)
    })
    it('emailValido', () => {
        expect(emailValido('maria@exemplo.com')).toBe(true)
        expect(emailValido('maria@exemplo')).toBe(false)
        expect(emailValido('maria exemplo.com')).toBe(false)
    })
    it('documentoCompativel compara só os dígitos visíveis da máscara', () => {
        expect(documentoCompativel('52998224725', '529.9**.***-**')).toBe(true)
        expect(documentoCompativel('12345678909', '529.9**.***-**')).toBe(false)
        expect(documentoCompativel('52998224725', '')).toBe(true)
    })
    it('soDigitos', () => expect(soDigitos('(84) 9 9999-0001')).toBe('84999990001'))
})

describe('separarNumero', () => {
    it('separa o número do fim do logradouro', () => {
        expect(separarNumero('RUA DAS FLORES, 120')).toEqual({ rua: 'RUA DAS FLORES', numero: '120' })
        expect(separarNumero('AV BRASIL 45A')).toEqual({ rua: 'AV BRASIL', numero: '45A' })
        expect(separarNumero('TRAVESSA SEM NUMERO')).toEqual({ rua: 'TRAVESSA SEM NUMERO', numero: 'S/N' })
    })
})

describe('erros', () => {
    it('da conta: CNPJ, sem cobertura, abaixo do mínimo', () => {
        expect(errosDaConta(conta, { atende: true, atinge_minimo: true })).toEqual([])
        expect(errosDaConta({ ...conta, documentoTipo: 'CNPJ' }, { atende: true, atinge_minimo: true })).toContain('titular_cnpj')
        expect(errosDaConta(conta, { atende: false, atinge_minimo: null })).toContain('sem_cobertura')
        expect(errosDaConta(conta, { atende: true, atinge_minimo: false })).toContain('abaixo_minimo')
        expect(errosDaConta({ ...conta, numeroUc: '' }, null)).toContain('conta_ilegivel')
    })
    it('de validação', () => {
        expect(errosDeValidacao({ adesao_cpf: '529.982.247-25', adesao_email: 'm@x.com', adesao_titular_ok: true }, conta, false)).toEqual([])
        expect(errosDeValidacao({ adesao_cpf: '52998224724' }, conta, false)).toContain('cpf_invalido')
        expect(errosDeValidacao({ adesao_cpf: '12345678909' }, conta, false)).toContain('cpf_diferente_conta')
        expect(errosDeValidacao({ adesao_cpf: '52998224725' }, conta, true)).toContain('cpf_ja_cadastrado')
        expect(errosDeValidacao({ adesao_email: 'x' }, conta, false)).toContain('email_invalido')
        expect(errosDeValidacao({ adesao_titular_ok: false }, conta, false)).toContain('titular_divergente')
    })
    it('status', () => {
        expect(statusDaAdesao(['cpf_invalido'], false)).toBe('coletando')
        expect(statusDaAdesao(['titular_divergente'], false)).toBe('pendencia')
        expect(statusDaAdesao([], true)).toBe('contrato_pronto')
    })
})

describe('parametrosAssinante', () => {
    it('monta os parâmetros de fn_criar_assinante_publico com originador e indicador', () => {
        const p = parametrosAssinante({
            conta, cpf: '529.982.247-25', email: ' Maria@Exemplo.com ', telefone: '5584999990001', ibge: '2408102',
            leadId: 'lead-1', originatorId: 'orig-1', indicadorId: null,
        })
        expect(p).toMatchObject({
            p_nome: 'MARIA TESTE', p_cpf_cnpj: '52998224725', p_email: 'maria@exemplo.com', p_telefone: '5584999990001',
            p_cep: '59000000', p_rua: 'RUA DAS FLORES', p_numero: '120', p_complemento: 'AP 2', p_bairro: 'CENTRO',
            p_cidade: 'NATAL', p_uf: 'RN', p_ibge: '2408102', p_originator_id: 'orig-1', p_lead_id: 'lead-1',
            p_dia_vencimento: 5, p_aceite_versao: 'whatsapp-v1', p_indicador_assinante_id: null,
            p_representante_nome: null, p_representante_cpf: null,
        })
        expect((p.p_ucs as any[])[0]).toMatchObject({
            numero_uc: '7012345', titular_conta: 'MARIA TESTE', cpf_cnpj_fatura: '52998224725', tipo_ligacao: 'bifasico',
            concessionaria: 'Neoenergia Cosern', franquia: '300', ibge: '2408102', cep: '59000000',
            rua: 'RUA DAS FLORES', numero: '120', bairro: 'CENTRO', cidade: 'NATAL', uf: 'RN', complemento: 'AP 2',
        })
    })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/adesao-whatsapp.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `regras.ts`**

```ts
/**
 * Regras puras da adesão pelo WhatsApp
 * (spec docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md §5.2).
 * Sem Deno nem Supabase: roda na Edge Function e no vitest.
 */
import type { ContaCompleta } from '../_shared/leitura-conta.ts'

export type CamposCard = { adesao_cpf?: string; adesao_email?: string; adesao_telefone?: string; adesao_titular_ok?: boolean | null }
export type EntradaAssinante = {
    conta: ContaCompleta; cpf: string; email: string; telefone: string; ibge: string | null
    leadId: string; originatorId: string | null; indicadorId: string | null
}

/** Erros que param a adesão e chamam humano (etapa "Pendência de adesão"). */
export const PENDENCIAS = new Set([
    'titular_divergente', 'titular_cnpj', 'cpf_diferente_conta', 'cpf_ja_cadastrado', 'falha_criacao',
])

export const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function cpfValido(cpf: string): boolean {
    const d = soDigitos(cpf)
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
    const dv = (n: number) => {
        let soma = 0
        for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i)
        const r = (soma * 10) % 11
        return r === 10 ? 0 : r
    }
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

export const emailValido = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email ?? '').trim())

/** A conta mostra o CPF mascarado ("529.9**.***-**"): compara só os dígitos visíveis. */
export function documentoCompativel(cpf: string, mascarado: string): boolean {
    const d = soDigitos(cpf)
    const m = (mascarado ?? '').replace(/[^\d*]/g, '')
    if (m.length !== 11) return true
    for (let i = 0; i < 11; i++) if (m[i] !== '*' && m[i] !== d[i]) return false
    return true
}

export function separarNumero(logradouro: string): { rua: string; numero: string } {
    const t = (logradouro ?? '').trim()
    const m = t.match(/^(.*?)[,\s]+(\d+[A-Za-z]?)\s*$/)
    return m ? { rua: m[1].trim(), numero: m[2] } : { rua: t, numero: 'S/N' }
}

export function errosDaConta(c: ContaCompleta, sim: { atende: boolean; atinge_minimo: boolean | null } | null): string[] {
    const erros: string[] = []
    if (!c?.numeroUc || !c?.titular) erros.push('conta_ilegivel')
    if (c?.documentoTipo === 'CNPJ') erros.push('titular_cnpj')
    if (sim && !sim.atende) erros.push('sem_cobertura')
    if (sim && sim.atende && sim.atinge_minimo === false) erros.push('abaixo_minimo')
    return erros
}

export function errosDeValidacao(cf: CamposCard, conta: ContaCompleta | null, cpfJaExiste: boolean): string[] {
    const erros: string[] = []
    if (cf.adesao_cpf) {
        if (!cpfValido(cf.adesao_cpf)) erros.push('cpf_invalido')
        else {
            if (conta && conta.documentoTipo === 'CPF' && !documentoCompativel(cf.adesao_cpf, conta.documento)) erros.push('cpf_diferente_conta')
            if (cpfJaExiste) erros.push('cpf_ja_cadastrado')
        }
    }
    if (cf.adesao_email && !emailValido(cf.adesao_email)) erros.push('email_invalido')
    if (cf.adesao_titular_ok === false) erros.push('titular_divergente')
    return erros
}

export function statusDaAdesao(erros: string[], temLink: boolean): 'pendencia' | 'coletando' | 'contrato_pronto' {
    if (erros.some((e) => PENDENCIAS.has(e))) return 'pendencia'
    return temLink ? 'contrato_pronto' : 'coletando'
}

export function parametrosAssinante(a: EntradaAssinante): Record<string, unknown> {
    const e = a.conta.endereco ?? { logradouro: '', complemento: '', bairro: '', cep: '', cidade: '', uf: '' }
    const { rua, numero } = separarNumero(e.logradouro)
    const cep = soDigitos(e.cep)
    const cpf = soDigitos(a.cpf)
    const uf = (e.uf ?? '').toUpperCase()
    const complemento = e.complemento || null
    return {
        p_nome: a.conta.titular.trim(), p_cpf_cnpj: cpf, p_email: a.email.trim().toLowerCase(),
        p_telefone: soDigitos(a.telefone), p_cep: cep, p_rua: rua, p_numero: numero, p_complemento: complemento,
        p_bairro: e.bairro, p_cidade: e.cidade, p_uf: uf, p_ibge: a.ibge,
        p_originator_id: a.originatorId, p_lead_id: a.leadId,
        p_ucs: [{
            numero_uc: a.conta.numeroUc, titular_conta: a.conta.titular.trim(), cpf_cnpj_fatura: cpf,
            tipo_ligacao: a.conta.ligacao, concessionaria: a.conta.concessionaria, franquia: String(a.conta.mediaKwh || 0),
            ibge: a.ibge, cep, rua, numero, bairro: e.bairro, cidade: e.cidade, uf, complemento,
        }],
        p_dia_vencimento: 5, p_representante_nome: null, p_representante_cpf: null,
        p_aceite_versao: 'whatsapp-v1', p_indicador_assinante_id: a.indicadorId,
    }
}
```

- [ ] **Step 4: Rodar** → `npx vitest run tests/adesao-whatsapp.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/adesao-whatsapp/regras.ts tests/adesao-whatsapp.test.ts
git commit -m "feat(adesao): regras puras da adesão pelo WhatsApp"
```

---

### Task 3: Migration — tabela, RPCs e gatilhos

**Files:**
- Create: `supabase/migrations/20261027a_adesao_whatsapp.sql`
- Create: `supabase/tests/adesao_whatsapp.test.sql`

**Interfaces:**
- Produces:
  - `ponte_deskcomm.adesoes(card_id uuid pk, b2w_lead_id uuid, contact_id uuid, conta_message_id uuid, documento_message_id uuid, conta_lida jsonb, erros jsonb default '{}' (chaves conta/documento/validacao/criacao → text[]), status text default 'coletando', subscriber_id uuid, onboarding_token text, signature_link text, documentos_copiados boolean default false, criado_em, atualizado_em)`.
  - `public.ponte_deskcomm_adesao_dados(p_card uuid) returns jsonb` → `{card_id, b2w_lead_id, contact_id, telefone, campos (custom_fields), originator_id, indicador_id, adesao (linha), conta_midia {path, mime, tamanho} | null, documento_midia {...} | null}`.
  - `public.ponte_deskcomm_adesao_salvar(p_card uuid, p_patch jsonb) returns void` — chaves aceitas: `conta_lida`, `erros_conta`, `erros_documento`, `erros_validacao`, `erros_criacao` (cada uma substitui a lista daquela origem), `status`, `subscriber_id`, `onboarding_token`, `signature_link`, `documentos_copiados`.
  - `public.ponte_deskcomm_ibge(p_cidade text, p_uf text) returns text`.
  - `public.ponte_deskcomm_cpf_existe(p_cpf text) returns boolean`.
  - `public.b2w_mcp_status_adesao(p_telefone text) returns jsonb` → `{etapa, status, conta {titular, endereco, numero_cliente, consumo_kwh}, cpf_mascarado, erros [], link_assinatura, assinado}`; `{etapa: null}` sem card.
  - Gatilhos `trg_ponte_adesao_midia` (messages), `trg_ponte_adesao_card` (crm_leads), `trg_ponte_card_originador` (crm_leads, BEFORE).
  - Todas as RPCs só `service_role`.

- [ ] **Step 1: Teste SQL (falha: objetos não existem)**

`supabase/tests/adesao_whatsapp.test.sql` (dados fictícios; tudo desfeito no RAISE final):

```sql
-- Sandbox da adesão pelo WhatsApp (spec 2026-10-26-adesao-whatsapp-design.md).
-- Rodar depois da migration 20261027a. Desfaz tudo no RAISE final.
DO $t$
DECLARE
  v_org uuid; v_pipe uuid; v_contato uuid; v_card uuid; v_lead uuid; v_orig uuid; r jsonb; v_msg uuid; v_conv uuid; v_sessao uuid;
BEGIN
  SELECT c.pipeline_id, cp.organization_id INTO v_pipe, v_org
    FROM ponte_deskcomm.categorias c JOIN crm_pipelines cp ON cp.id = c.pipeline_id WHERE c.slug = 'energia_assinatura';
  SELECT id INTO v_orig FROM originators_v2 WHERE ativo ORDER BY created_at LIMIT 1;

  INSERT INTO contacts (organization_id, name, phone_number) VALUES (v_org, 'Contato Teste', '+5584999990009') RETURNING id INTO v_contato;
  INSERT INTO crm_leads (organization_id, pipeline_id, stage_id, contact_id, title, custom_fields)
  VALUES (v_org, v_pipe, (SELECT id FROM crm_stages WHERE pipeline_id = v_pipe ORDER BY position LIMIT 1), v_contato, 'Teste', '{}')
  RETURNING id INTO v_card;
  -- A ponte (trg_ponte_card_para_lead) pode já ter criado o lead da B2W e o vínculo.
  SELECT b2w_lead_id INTO v_lead FROM ponte_deskcomm.vinculos WHERE deskcomm_lead_id = v_card;
  IF v_lead IS NULL THEN
    INSERT INTO leads (name, phone) VALUES ('Contato Teste', '84999990009') RETURNING id INTO v_lead;
    INSERT INTO ponte_deskcomm.vinculos (deskcomm_lead_id, b2w_lead_id, contact_id, organization_id, categoria)
    VALUES (v_card, v_lead, v_contato, v_org, 'energia_assinatura');
  END IF;
  UPDATE leads SET originator_id = v_orig WHERE id = v_lead;

  -- 1. Originador preenchido no card.
  UPDATE crm_leads SET custom_fields = custom_fields || '{"cidade":"Natal"}' WHERE id = v_card;
  IF v_orig IS NOT NULL AND (SELECT custom_fields->>'originador' FROM crm_leads WHERE id = v_card) IS NULL THEN
    RAISE EXCEPTION 'FALHOU originador'; END IF;

  -- 2. Etapa aguardando_conta + mídia recebida -> slot da conta.
  UPDATE crm_leads SET custom_fields = custom_fields || '{"adesao_etapa":"aguardando_conta"}' WHERE id = v_card;
  SELECT channel_session_id INTO v_sessao FROM conversations WHERE organization_id = v_org AND channel = 'whatsapp' ORDER BY created_at DESC LIMIT 1;
  INSERT INTO conversations (organization_id, contact_id, channel_session_id, channel, status)
  VALUES (v_org, v_contato, v_sessao, 'whatsapp', 'open') RETURNING id INTO v_conv;
  INSERT INTO messages (organization_id, conversation_id, channel_session_id, contact_id, direction, type, media_storage_path, media_mime, media_size_bytes)
  VALUES (v_org, v_conv, v_sessao, v_contato, 'inbound', 'image', v_org || '/teste/conta.jpg', 'image/jpeg', 1000) RETURNING id INTO v_msg;
  IF (SELECT conta_message_id FROM ponte_deskcomm.adesoes WHERE card_id = v_card) IS DISTINCT FROM v_msg THEN
    RAISE EXCEPTION 'FALHOU midia conta'; END IF;

  -- 3. Dados para a Edge Function.
  r := public.ponte_deskcomm_adesao_dados(v_card);
  IF r->>'b2w_lead_id' <> v_lead::text OR r->'conta_midia'->>'mime' <> 'image/jpeg' OR r->>'telefone' <> '5584999990009' THEN
    RAISE EXCEPTION 'FALHOU dados: %', r; END IF;

  -- 4. Salvar e status para a Bia (CPF mascarado).
  PERFORM public.ponte_deskcomm_adesao_salvar(v_card, '{"conta_lida":{"titular":"CONTATO TESTE","numeroUc":"7012345","mediaKwh":300,"endereco":{"completo":"RUA A, 1, CENTRO, 59000-000 NATAL RN"}},"erros_validacao":["cpf_invalido"],"status":"coletando"}');
  UPDATE crm_leads SET custom_fields = custom_fields || '{"adesao_cpf":"52998224725","adesao_etapa":"aguardando_email"}' WHERE id = v_card;
  r := public.b2w_mcp_status_adesao('5584999990009');
  IF r->>'etapa' <> 'aguardando_email' OR r->>'cpf_mascarado' <> '***.982.247-**' OR NOT (r->'erros' ? 'cpf_invalido')
     OR r->'conta'->>'numero_cliente' <> '7012345' THEN RAISE EXCEPTION 'FALHOU status: %', r; END IF;

  -- 5. Telefone de outro contato não vê nada.
  r := public.b2w_mcp_status_adesao('5584000000000');
  IF r->>'etapa' IS NOT NULL THEN RAISE EXCEPTION 'FALHOU isolamento: %', r; END IF;

  -- 6. Auxiliares.
  IF public.ponte_deskcomm_ibge('natal', 'RN') IS NULL THEN RAISE EXCEPTION 'FALHOU ibge'; END IF;
  IF public.ponte_deskcomm_cpf_existe('00000000000') THEN RAISE EXCEPTION 'FALHOU cpf_existe'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK %', r;
END
$t$;
```

Antes de rodar, conferir as colunas obrigatórias de `contacts`, `conversations`, `messages` e `crm_leads` (`select column_name from information_schema.columns where table_name = '<tabela>' and is_nullable = 'NO' and column_default is null`) e acrescentar valores fictícios ao INSERT se faltar algum.

- [ ] **Step 2: Rodar e ver falhar** (`execute_sql`): erro de objeto inexistente.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261027a_adesao_whatsapp.sql`:

```sql
-- =====================================================================
-- Adesão à Energia por Assinatura pelo WhatsApp
-- (spec docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md §4-5)
--   1. ponte_deskcomm.adesoes: estado da adesão por card.
--   2. RPCs da Edge Function adesao-whatsapp e da ferramenta b2w_status_adesao.
--   3. Gatilhos: mídia recebida, card mudou, originador no card.
-- =====================================================================

create table if not exists ponte_deskcomm.adesoes (
    card_id              uuid primary key,
    b2w_lead_id          uuid,
    contact_id           uuid,
    conta_message_id     uuid,
    documento_message_id uuid,
    conta_lida           jsonb,
    erros                jsonb not null default '{}'::jsonb,
    status               text not null default 'coletando'
                         check (status in ('coletando', 'pendencia', 'criando', 'contrato_pronto', 'assinado', 'erro')),
    subscriber_id        uuid,
    onboarding_token     text,
    signature_link       text,
    documentos_copiados  boolean not null default false,
    criado_em            timestamptz not null default now(),
    atualizado_em        timestamptz not null default now()
);

-- Card da Assinatura de um contato (o mais recente).
create or replace function ponte_deskcomm.fn_card_assinatura(p_contato uuid)
returns uuid language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    select cl.id from crm_leads cl
      join ponte_deskcomm.categorias c on c.pipeline_id = cl.pipeline_id and c.slug = 'energia_assinatura'
     where cl.contact_id = p_contato
     order by cl.updated_at desc nulls last limit 1
$$;

create or replace function public.ponte_deskcomm_adesao_dados(p_card uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    select jsonb_build_object(
        'card_id', cl.id,
        'b2w_lead_id', v.b2w_lead_id,
        'contact_id', cl.contact_id,
        'telefone', ponte_deskcomm.fn_telefone(ct.phone_number),
        'campos', coalesce(cl.custom_fields, '{}'::jsonb),
        'originator_id', l.originator_id,
        'indicador_id', l.indicador_assinante_id,
        'adesao', to_jsonb(a),
        'conta_midia', (select jsonb_build_object('path', m.media_storage_path, 'mime', m.media_mime, 'tamanho', m.media_size_bytes)
                          from messages m where m.id = a.conta_message_id),
        'documento_midia', (select jsonb_build_object('path', m.media_storage_path, 'mime', m.media_mime, 'tamanho', m.media_size_bytes)
                              from messages m where m.id = a.documento_message_id))
      from crm_leads cl
      join contacts ct on ct.id = cl.contact_id
      left join ponte_deskcomm.vinculos v on v.deskcomm_lead_id = cl.id
      left join leads l on l.id = v.b2w_lead_id
      left join ponte_deskcomm.adesoes a on a.card_id = cl.id
     where cl.id = p_card
$$;

create or replace function public.ponte_deskcomm_adesao_salvar(p_card uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
    k text;
begin
    insert into ponte_deskcomm.adesoes (card_id) values (p_card) on conflict do nothing;
    update ponte_deskcomm.adesoes a set
        conta_lida          = case when p_patch ? 'conta_lida' then p_patch->'conta_lida' else a.conta_lida end,
        status              = coalesce(p_patch->>'status', a.status),
        subscriber_id       = coalesce((p_patch->>'subscriber_id')::uuid, a.subscriber_id),
        onboarding_token    = coalesce(p_patch->>'onboarding_token', a.onboarding_token),
        signature_link      = coalesce(p_patch->>'signature_link', a.signature_link),
        documentos_copiados = coalesce((p_patch->>'documentos_copiados')::boolean, a.documentos_copiados),
        atualizado_em       = now()
     where a.card_id = p_card;
    foreach k in array array['conta', 'documento', 'validacao', 'criacao'] loop
        if p_patch ? ('erros_' || k) then
            update ponte_deskcomm.adesoes set erros = erros || jsonb_build_object(k, p_patch->('erros_' || k))
             where card_id = p_card;
        end if;
    end loop;
end
$$;

create or replace function public.ponte_deskcomm_ibge(p_cidade text, p_uf text)
returns text language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    select btrim(c."Cod. Ibge") from "Concessionaria" c
     where ponte_deskcomm.fn_sem_acento(c."Município") = ponte_deskcomm.fn_sem_acento(p_cidade)
       and upper(btrim(c."UF")) = ponte_deskcomm.fn_uf(p_uf)
     limit 1
$$;

create or replace function public.ponte_deskcomm_cpf_existe(p_cpf text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    select exists (select 1 from subscribers s
                    where public.fn_so_digitos(s.cpf_cnpj) = public.fn_so_digitos(p_cpf)
                      and s.status::text <> 'cancelado')
$$;

-- Ferramenta da Bia: só o card do telefone do cabeçalho; CPF mascarado.
create or replace function public.b2w_mcp_status_adesao(p_telefone text)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    with ct as (
        select c.id from contacts c
         where ponte_deskcomm.fn_telefone(c.phone_number) = ponte_deskcomm.fn_telefone(p_telefone)
         order by c.updated_at desc nulls last limit 1),
    card as (
        select cl.* from crm_leads cl where cl.id = ponte_deskcomm.fn_card_assinatura((select id from ct)))
    select coalesce((
        select jsonb_build_object(
            'etapa', card.custom_fields->>'adesao_etapa',
            'status', coalesce(a.status, 'coletando'),
            'conta', case when a.conta_lida is null then null else jsonb_build_object(
                'titular', a.conta_lida->>'titular',
                'endereco', a.conta_lida->'endereco'->>'completo',
                'numero_cliente', a.conta_lida->>'numeroUc',
                'consumo_kwh', (a.conta_lida->>'mediaKwh')::numeric) end,
            'cpf_mascarado', case when length(public.fn_so_digitos(card.custom_fields->>'adesao_cpf')) = 11
                then '***.' || substr(public.fn_so_digitos(card.custom_fields->>'adesao_cpf'), 4, 3) || '.'
                     || substr(public.fn_so_digitos(card.custom_fields->>'adesao_cpf'), 7, 3) || '-**' end,
            'erros', coalesce((select jsonb_agg(distinct e) from jsonb_each(coalesce(a.erros, '{}'::jsonb)) x,
                                      jsonb_array_elements_text(x.value) e), '[]'::jsonb),
            'link_assinatura', a.signature_link,
            'assinado', exists (select 1 from signatures s where s.signer_id = a.subscriber_id and s.status = 'signed'))
          from card left join ponte_deskcomm.adesoes a on a.card_id = card.id),
        jsonb_build_object('etapa', null))
$$;

do $$
declare f text;
begin
    foreach f in array array['ponte_deskcomm_adesao_dados(uuid)', 'ponte_deskcomm_adesao_salvar(uuid, jsonb)',
        'ponte_deskcomm_ibge(text, text)', 'ponte_deskcomm_cpf_existe(text)', 'b2w_mcp_status_adesao(text)']
    loop
        execute format('revoke all on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------

-- Mídia recebida numa etapa que espera arquivo. O Deskcomm pode gravar o
-- caminho depois do INSERT (download assíncrono), por isso também no UPDATE.
create or replace function ponte_deskcomm.fn_adesao_midia()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
    v_card  uuid;
    v_etapa text;
begin
    if new.direction <> 'inbound' or new.media_storage_path is null then return null; end if;
    if tg_op = 'UPDATE' and old.media_storage_path is not null then return null; end if;
    select ponte_deskcomm.fn_card_assinatura(cv.contact_id) into v_card from conversations cv where cv.id = new.conversation_id;
    if v_card is null then return null; end if;
    select custom_fields->>'adesao_etapa' into v_etapa from crm_leads where id = v_card;
    if v_etapa not in ('aguardando_conta', 'aguardando_documento') then return null; end if;

    insert into ponte_deskcomm.adesoes (card_id) values (v_card) on conflict do nothing;
    if v_etapa = 'aguardando_conta' then
        update ponte_deskcomm.adesoes set conta_message_id = new.id, atualizado_em = now() where card_id = v_card;
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'conta', 'card_id', v_card));
    else
        update ponte_deskcomm.adesoes set documento_message_id = new.id, atualizado_em = now() where card_id = v_card;
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'documento', 'card_id', v_card));
    end if;
    return null;
exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem) values ('fn_adesao_midia', new.id, sqlstate, sqlerrm);
    return null;
end
$$;

drop trigger if exists trg_ponte_adesao_midia on public.messages;
create trigger trg_ponte_adesao_midia
    after insert or update of media_storage_path on public.messages
    for each row execute function ponte_deskcomm.fn_adesao_midia();

-- Card mudou: valida dados ou cria a adesão.
create or replace function ponte_deskcomm.fn_adesao_card()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
    n jsonb := coalesce(new.custom_fields, '{}'::jsonb);
    o jsonb := coalesce(old.custom_fields, '{}'::jsonb);
begin
    if not exists (select 1 from ponte_deskcomm.categorias c where c.pipeline_id = new.pipeline_id and c.slug = 'energia_assinatura') then
        return null;
    end if;
    if n->>'adesao_etapa' = 'confirmado' and coalesce(o->>'adesao_etapa', '') <> 'confirmado' then
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'criar', 'card_id', new.id));
    elsif (n->>'adesao_cpf') is distinct from (o->>'adesao_cpf')
       or (n->>'adesao_email') is distinct from (o->>'adesao_email')
       or (n->>'adesao_telefone') is distinct from (o->>'adesao_telefone')
       or (n->>'adesao_titular_ok') is distinct from (o->>'adesao_titular_ok') then
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'validar', 'card_id', new.id));
    end if;
    return null;
exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem) values ('fn_adesao_card', new.id, sqlstate, sqlerrm);
    return null;
end
$$;

drop trigger if exists trg_ponte_adesao_card on public.crm_leads;
create trigger trg_ponte_adesao_card
    after update of custom_fields on public.crm_leads
    for each row execute function ponte_deskcomm.fn_adesao_card();

-- Originador do lead da B2W visível no card (só se vazio).
create or replace function ponte_deskcomm.fn_card_originador()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_nome text;
begin
    if coalesce(new.custom_fields->>'originador', '') <> '' then return new; end if;
    select o.name into v_nome
      from ponte_deskcomm.vinculos v join leads l on l.id = v.b2w_lead_id join originators_v2 o on o.id = l.originator_id
     where v.deskcomm_lead_id = new.id;
    if v_nome is not null then
        new.custom_fields := coalesce(new.custom_fields, '{}'::jsonb) || jsonb_build_object('originador', v_nome);
    end if;
    return new;
exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem) values ('fn_card_originador', new.id, sqlstate, sqlerrm);
    return new;
end
$$;

drop trigger if exists trg_ponte_card_originador on public.crm_leads;
create trigger trg_ponte_card_originador
    before insert or update on public.crm_leads
    for each row execute function ponte_deskcomm.fn_card_originador();
```

Observação: o vínculo card ↔ lead da B2W pode nascer depois do card (a ponte cria o lead no AFTER INSERT). O `before update` seguinte (qualquer gravação do card) preenche o originador.

- [ ] **Step 4: Ensaio sem efeito, aprovação e aplicação**

Rodar migration + teste num único `execute_sql` (o RAISE final desfaz tudo). Esperado `SANDBOX_OK`. Conferir em seguida que nada ficou (`to_regclass('ponte_deskcomm.adesoes') is null`). Pedir aprovação; aplicar com `apply_migration` (`20261027a_adesao_whatsapp`); rodar o teste de novo → `SANDBOX_OK`.

Atenção: no teste, a inserção da mensagem dispara `fn_chamar_funcao('adesao-whatsapp', …)`; dentro da transação desfeita o pedido HTTP do pg_net também é desfeito.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261027a_adesao_whatsapp.sql supabase/tests/adesao_whatsapp.test.sql
git commit -m "feat(adesao): estado, RPCs e gatilhos da adesão pelo WhatsApp"
```

---

### Task 4: `onboarding-finalizar` sem WhatsApp automático

**Files:** Modify `supabase/functions/onboarding-finalizar/index.ts`

- [ ] **Step 1: Opção `sem_whatsapp`**

1. No cabeçalho, acrescentar: `POST { token, gerar_no_servidor: true, sem_whatsapp: true }  (adesão pelo WhatsApp: a Bia entrega o link na conversa; só e-mail)`.
2. `enviarAoAssinante` ganha o 4º parâmetro `semWhatsapp: boolean` e o bloco do WhatsApp fica `if (semWhatsapp) { /* a Bia entrega o link na conversa */ } else if (sub.phone) { ...como hoje... } else { ...como hoje... }`.
3. Em `const { token, gerar_no_servidor } = body ?? {};` acrescentar `sem_whatsapp`.
4. Em todas as chamadas `enviarAoAssinante(` (`grep -n "enviarAoAssinante(" index.ts`: a do reenvio e a do envio novo), passar `sem_whatsapp === true` como 4º argumento.

Sem teste unitário (o arquivo é um handler Deno sem partes puras); a verificação é o ensaio da Task 7.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/onboarding-finalizar/index.ts
git commit -m "feat(onboarding): opção sem_whatsapp no onboarding-finalizar"
```

---

### Task 5: Edge Function `adesao-whatsapp`

**Files:** Create `supabase/functions/adesao-whatsapp/index.ts`

**Interfaces:**
- Consumes: `regras.ts` (Task 2), `lerConta` (Task 1), RPCs (Task 3), `onboarding-finalizar` com `sem_whatsapp` (Task 4), `b2w_mcp_simular_assinatura`, `fn_criar_assinante_publico`, `onboarding-regras.ts` (`caminhoDocumento`, `validarArquivo`).
- Produces: `POST {acao: 'conta'|'documento'|'validar'|'criar', card_id, ensaio?}` → `{ok, status, erros}`.

- [ ] **Step 1: Escrever a função**

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { lerConta, type ContaCompleta } from '../_shared/leitura-conta.ts'
import { caminhoDocumento, validarArquivo } from '../_shared/onboarding-regras.ts'
import {
    errosDaConta, errosDeValidacao, parametrosAssinante, statusDaAdesao, cpfValido, emailValido, soDigitos,
} from './regras.ts'

/**
 * Adesão à Energia por Assinatura pelo WhatsApp
 * (spec docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md §5.2).
 *
 * Chamada pelos gatilhos da ponte (fn_adesao_midia, fn_adesao_card) com o
 * token do Vault em x-ponte-token. Estado em ponte_deskcomm.adesoes; a Bia lê
 * por b2w_status_adesao. Nada aqui fala com o cliente.
 *
 *   conta     lê a foto/PDF da conta (bucket whatsapp-media do Deskcomm)
 *   documento confere tipo e tamanho do documento
 *   validar   CPF, e-mail, titular
 *   criar     cria o assinante, copia os documentos e gera o contrato (sem WhatsApp)
 */

const MIDIA = 'whatsapp-media'
const DOCUMENTOS = 'documentos-assinante'
const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function base64(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
}

serve(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: confere } = await db.rpc('ponte_deskcomm_token_confere', { p_token: req.headers.get('x-ponte-token') ?? '' })
    if (confere !== true) return json(401, { error: 'token_invalido' })

    const corpo = await req.json().catch(() => ({}))
    const acao = String(corpo?.acao ?? '')
    const card = String(corpo?.card_id ?? '')
    const salvar = async (patch: Record<string, unknown>) => {
        const { error } = await db.rpc('ponte_deskcomm_adesao_salvar', { p_card: card, p_patch: patch })
        if (error) throw new Error(`salvar: ${error.message}`)
    }
    const erroPonte = (msg: string) =>
        db.rpc('ponte_deskcomm_erro_base', { p_onde: 'adesao-whatsapp', p_mensagem: `${acao} ${card}: ${msg}` })

    try {
        const { data: d, error } = await db.rpc('ponte_deskcomm_adesao_dados', { p_card: card })
        if (error || !d) return json(404, { error: 'card_nao_encontrado' })
        const campos = d.campos ?? {}
        const adesao = d.adesao ?? {}
        const erros = (adesao.erros ?? {}) as Record<string, string[]>
        const todos = () => Object.values(erros).flat()

        if (acao === 'conta') {
            const m = d.conta_midia
            if (!m?.path) return json(400, { error: 'sem_midia' })
            const { data: arq, error: dlErr } = await db.storage.from(MIDIA).download(m.path)
            if (dlErr || !arq) throw new Error(`download: ${dlErr?.message}`)
            const r = await lerConta(base64(new Uint8Array(await arq.arrayBuffer())), m.mime,
                { apiKey: Deno.env.get('OPENROUTER_API_KEY')!, modelo: Deno.env.get('OPENROUTER_MODEL')! })
            if (!r.ok) {
                erros.conta = ['conta_ilegivel']
                await salvar({ erros_conta: erros.conta, status: statusDaAdesao(todos(), false) })
                return json(200, { ok: true, status: 'coletando', erros: erros.conta })
            }
            const c = r.dados
            const { data: sim } = await db.rpc('b2w_mcp_simular_assinatura', {
                p_cidade: c.endereco?.cidade ?? '', p_uf: c.endereco?.uf ?? '', p_consumo_kwh: c.mediaKwh || null,
                p_valor_reais: null, p_telefone: null,
            })
            erros.conta = errosDaConta(c, sim ? { atende: !!sim.atende, atinge_minimo: sim.atinge_minimo ?? null } : null)
            const status = statusDaAdesao(todos(), false)
            await salvar({ conta_lida: c, erros_conta: erros.conta, status })
            return json(200, { ok: true, status, erros: erros.conta })
        }

        if (acao === 'documento') {
            const m = d.documento_midia
            const erro = m?.path ? validarArquivo({ mime: m.mime, tamanho: Number(m.tamanho) }) : 'sem arquivo'
            erros.documento = erro ? ['documento_invalido'] : []
            await salvar({ erros_documento: erros.documento })
            return json(200, { ok: true, erros: erros.documento })
        }

        if (acao === 'validar') {
            const cpf = soDigitos(campos.adesao_cpf)
            let existe = false
            if (cpfValido(cpf)) {
                const { data } = await db.rpc('ponte_deskcomm_cpf_existe', { p_cpf: cpf })
                existe = data === true
            }
            const titularOk = campos.adesao_titular_ok === undefined ? undefined : campos.adesao_titular_ok === true || campos.adesao_titular_ok === 'true'
            erros.validacao = errosDeValidacao({ ...campos, adesao_titular_ok: titularOk }, adesao.conta_lida as ContaCompleta | null, existe)
            const status = statusDaAdesao(todos(), !!adesao.signature_link)
            await salvar({ erros_validacao: erros.validacao, status })
            return json(200, { ok: true, status, erros: erros.validacao })
        }

        if (acao === 'criar') {
            const conta = adesao.conta_lida as ContaCompleta | null
            const faltam = [
                !conta && 'conta', !d.documento_midia?.path && 'documento',
                !cpfValido(campos.adesao_cpf ?? '') && 'cpf', !emailValido(campos.adesao_email ?? '') && 'email',
            ].filter(Boolean)
            if (faltam.length || todos().length) {
                return json(409, { ok: false, faltam, erros: todos() })
            }
            if (corpo?.ensaio === true) {
                return json(200, { ok: true, ensaio: true, parametros: parametrosAssinante({
                    conta: conta!, cpf: campos.adesao_cpf, email: campos.adesao_email,
                    telefone: campos.adesao_telefone || d.telefone, ibge: null,
                    leadId: d.b2w_lead_id, originatorId: d.originator_id, indicadorId: d.indicador_id }) })
            }
            await salvar({ status: 'criando' })
            let sub = adesao.subscriber_id as string | null
            let token = adesao.onboarding_token as string | null
            if (!sub) {
                const { data: ibge } = await db.rpc('ponte_deskcomm_ibge', { p_cidade: conta!.endereco?.cidade ?? '', p_uf: conta!.endereco?.uf ?? '' })
                const params = parametrosAssinante({
                    conta: conta!, cpf: campos.adesao_cpf, email: campos.adesao_email,
                    telefone: campos.adesao_telefone || d.telefone, ibge: ibge ?? null,
                    leadId: d.b2w_lead_id, originatorId: d.originator_id, indicadorId: d.indicador_id,
                })
                const { data: criado, error: cErr } = await db.rpc('fn_criar_assinante_publico', params)
                if (cErr || !criado?.subscriber_id) throw new Error(`criar_assinante: ${cErr?.message ?? 'sem id'}`)
                sub = criado.subscriber_id
                token = criado.onboarding_token
                await salvar({ subscriber_id: sub, onboarding_token: token })
            }
            if (!adesao.documentos_copiados) {
                const { data: uc } = await db.from('consumer_units').select('id').eq('subscriber_id', sub).limit(1).maybeSingle()
                for (const [tipo, m, ucId] of [
                    ['conta_energia', d.conta_midia, uc?.id ?? null],
                    ['identidade', d.documento_midia, null],
                ] as const) {
                    const { data: arq, error: dlErr } = await db.storage.from(MIDIA).download(m.path)
                    if (dlErr || !arq) throw new Error(`download ${tipo}: ${dlErr?.message}`)
                    const path = caminhoDocumento(sub!, tipo, crypto.randomUUID(), m.mime)
                    const { error: upErr } = await db.storage.from(DOCUMENTOS).upload(path, arq, { contentType: m.mime })
                    if (upErr) throw new Error(`upload ${tipo}: ${upErr.message}`)
                    const { error: insErr } = await db.from('subscriber_documents').insert({
                        subscriber_id: sub, consumer_unit_id: ucId, tipo, storage_path: path, mime: m.mime, tamanho: Number(m.tamanho),
                    })
                    if (insErr) throw new Error(`registrar ${tipo}: ${insErr.message}`)
                }
                await salvar({ documentos_copiados: true })
            }
            const { data: fin, error: fErr } = await db.functions.invoke('onboarding-finalizar', {
                body: { token, gerar_no_servidor: true, sem_whatsapp: true },
            })
            if (fErr || !fin?.signature_link) throw new Error(`contrato: ${fErr?.message ?? JSON.stringify(fin)}`)
            await salvar({ signature_link: fin.signature_link, status: 'contrato_pronto', erros_criacao: [] })
            return json(200, { ok: true, status: 'contrato_pronto' })
        }

        return json(400, { error: 'acao_invalida' })
    } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        await erroPonte(msg)
        if (acao === 'criar') await salvar({ status: 'pendencia', erros_criacao: ['falha_criacao'] }).catch(() => {})
        return json(500, { ok: false, erro: 'falha' })
    }
})
```

Notas:
- O `onboarding-finalizar` reenvia o mesmo link se já houver assinatura pendente (idempotente); repetir `criar` não duplica assinante (guarda `subscriber_id`) nem documentos (`documentos_copiados`).
- `fn_criar_assinante_publico` é chamada com `service_role`: conferir que o `grant` inclui `service_role` (`select has_function_privilege('service_role', 'public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,integer,text,text,text,text)', 'execute')`).

- [ ] **Step 2: Suíte**

Run: `npx vitest run` → PASS (a função em si é verificada no ensaio da Task 7).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/adesao-whatsapp/index.ts
git commit -m "feat(adesao): Edge Function adesao-whatsapp"
```

---

### Task 6: Ferramenta `b2w_status_adesao`

**Files:**
- Modify: `supabase/functions/b2w-mcp/logica.ts`, `supabase/functions/b2w-mcp/index.ts`
- Test: `tests/b2w-mcp.test.ts`

**Interfaces:**
- Consumes: RPC `b2w_mcp_status_adesao(p_telefone text)` (Task 3).
- Produces: `Dependencias.statusAdesao(telefone: string): Promise<StatusAdesao>`; ferramenta `b2w_status_adesao` (4ª em `FERRAMENTAS`, sem argumentos).

- [ ] **Step 1: Testes que falham**

Em `tests/b2w-mcp.test.ts`: no `deps()` acrescentar

```ts
    statusAdesao: vi.fn(async () => ({ etapa: 'aguardando_cpf', status: 'coletando', conta: null, cpf_mascarado: null,
        erros: [], link_assinatura: null, assinado: false })),
```

trocar a lista esperada em `tools/list` para
`['b2w_concessionaria', 'b2w_identificar_contato', 'b2w_simular_assinatura', 'b2w_status_adesao']`
e acrescentar:

```ts
describe('b2w_status_adesao', () => {
    it('usa só o telefone do cabeçalho, ignora argumento', async () => {
        const d = deps()
        const r: any = await chamar('b2w_status_adesao', { telefone: '5511000000000' }, d, '(84) 99999-0009')
        expect(d.statusAdesao).toHaveBeenCalledWith('5584999990009')
        expect(r.result.structuredContent.etapa).toBe('aguardando_cpf')
    })
    it('sem telefone responde etapa vazia sem consultar', async () => {
        const d = deps()
        const r: any = await chamar('b2w_status_adesao', {}, d, null)
        expect(d.statusAdesao).not.toHaveBeenCalled()
        expect(r.result.structuredContent.etapa).toBeNull()
    })
})
```

- [ ] **Step 2: Rodar e ver falhar** → `npx vitest run tests/b2w-mcp.test.ts`.

- [ ] **Step 3: Implementar**

`logica.ts`: tipo

```ts
export interface StatusAdesao {
    etapa: string | null
    status?: string
    conta?: { titular: string | null; endereco: string | null; numero_cliente: string | null; consumo_kwh: number | null } | null
    cpf_mascarado?: string | null
    erros?: string[]
    link_assinatura?: string | null
    assinado?: boolean
}
```

em `Dependencias`: `statusAdesao(telefone: string): Promise<StatusAdesao>`; em `FERRAMENTAS`, 4º item:

```ts
    {
        name: 'b2w_status_adesao',
        title: 'Status da adesão pelo WhatsApp',
        description:
            'Mostra como está a adesão deste contato: etapa, o que foi lido da conta, CPF mascarado, erros a corrigir ' +
            '(conta_ilegivel, cpf_invalido, email_invalido, documento_invalido) ou pendências para a equipe ' +
            '(titular_divergente, titular_cnpj, cpf_diferente_conta, cpf_ja_cadastrado, falha_criacao), o link de assinatura ' +
            'quando o contrato estiver pronto e se já foi assinado. Não recebe argumentos: usa o telefone da conversa.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
```

em `chamarFerramenta`:

```ts
    if (nome === 'b2w_status_adesao') {
        const telefone = normalizarTelefone(ctx.telefone)
        if (!telefone) return resultadoDeFerramenta({ etapa: null })
        return resultadoDeFerramenta(await deps.statusAdesao(telefone))
    }
```

`index.ts`: import de `StatusAdesao` e

```ts
        async statusAdesao(telefone: string): Promise<StatusAdesao> {
            const { data, error } = await supabase.rpc('b2w_mcp_status_adesao', { p_telefone: telefone })
            if (error) throw error
            return data as StatusAdesao
        },
```

Atualizar as listas de ferramentas nos comentários do topo dos dois arquivos.

- [ ] **Step 4: Rodar** → PASS. **Step 5: Commit**

```bash
git add supabase/functions/b2w-mcp tests/b2w-mcp.test.ts
git commit -m "feat(b2w-mcp): ferramenta b2w_status_adesao"
```

---

### Task 7: Funil, publicação e ensaio

**Files:**
- Create: `scripts/deskcomm/adesao_funil.sql`

- [ ] **Step 1: Script do funil**

```sql
-- Campos do card e etapa "Pendência de adesão" no funil da Energia por Assinatura
-- (spec docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md §4.1 e §4.3). Idempotente.
do $$
declare
    v_pipe uuid := (select pipeline_id from ponte_deskcomm.categorias where slug = 'energia_assinatura');
    v_campos constant jsonb := $j$[
        {"key": "adesao_etapa", "label": "Adesão: etapa", "type": "select", "options": [
            {"value": "aguardando_conta", "label": "Aguardando conta"},
            {"value": "titular", "label": "Confirmando titular"},
            {"value": "aguardando_cpf", "label": "Aguardando CPF"},
            {"value": "aguardando_email", "label": "Aguardando e-mail"},
            {"value": "aguardando_telefone", "label": "Aguardando telefone"},
            {"value": "aguardando_documento", "label": "Aguardando documento"},
            {"value": "revisao", "label": "Revisão"},
            {"value": "confirmado", "label": "Confirmado"}]},
        {"key": "adesao_cpf", "label": "Adesão: CPF", "type": "text"},
        {"key": "adesao_email", "label": "Adesão: e-mail", "type": "text"},
        {"key": "adesao_telefone", "label": "Adesão: telefone", "type": "text"},
        {"key": "adesao_titular_ok", "label": "Adesão: titular confirmado", "type": "boolean"},
        {"key": "adesao_revisao_ok", "label": "Adesão: revisão confirmada", "type": "boolean"},
        {"key": "originador", "label": "Originador", "type": "text"}
    ]$j$;
    v_atuais jsonb;
    v_novos  jsonb;
begin
    if v_pipe is null then raise exception 'funil da Assinatura nao encontrado'; end if;
    select case when jsonb_typeof(settings->'fields') = 'array' then settings->'fields' else '[]'::jsonb end
      into v_atuais from crm_pipelines where id = v_pipe;
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_novos
      from jsonb_array_elements(v_campos) f
     where not exists (select 1 from jsonb_array_elements(v_atuais) a where a->>'key' = f->>'key');
    if jsonb_array_length(v_novos) > 0 then
        update crm_pipelines set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('fields', v_atuais || v_novos)
         where id = v_pipe;
    end if;

    -- Etapa nova copiando "Negociação" (todas as colunas obrigatórias vêm junto).
    if not exists (select 1 from crm_stages where pipeline_id = v_pipe and slug = 'pendencia-adesao') then
        insert into crm_stages
        select (jsonb_populate_record(null::crm_stages, to_jsonb(s) || jsonb_build_object(
            'id', gen_random_uuid(), 'name', 'Pendência de adesão', 'slug', 'pendencia-adesao', 'position', 4500,
            'description', 'Adesão pelo WhatsApp parada: titular divergente, CNPJ, várias UCs, CPF já cadastrado ou falha ao gerar o contrato. A equipe valida e dá sequência.',
            'requires_human', true, 'avisar_na_central', true, 'agent_stage_hint', null,
            'last_change_at', null, 'last_change_actor_kind', null,
            'created_at', now(), 'updated_at', now()))).*
          from crm_stages s where s.pipeline_id = v_pipe and s.slug = 'negociacao';
    end if;
end $$;
```

- [ ] **Step 2: Aprovação e publicação** (pedir ao usuário; depois, nesta ordem)

1. Rodar `scripts/deskcomm/adesao_funil.sql`; conferir 7 campos novos e a etapa (posição 4500).
2. Publicar as funções (no worktree):

```bash
npx supabase functions deploy adesao-whatsapp --project-ref abbysvxnnhwvvzhftoms --no-verify-jwt
npx supabase functions deploy onboarding-finalizar --project-ref abbysvxnnhwvvzhftoms --no-verify-jwt
npx supabase functions deploy parse-invoice-image --project-ref abbysvxnnhwvvzhftoms
npx supabase functions deploy b2w-mcp --project-ref abbysvxnnhwvvzhftoms --no-verify-jwt
```

Antes, conferir o `verify_jwt` atual de cada função (`list_edge_functions` do MCP do Supabase) e manter o mesmo.

- [ ] **Step 3: Ensaio da leitura e da criação (sem contrato)**

Com um card de teste (contato fictício, conta de exemplo em PDF sem dados reais carregada no bucket `whatsapp-media` sob um caminho `teste/`), chamar `adesao-whatsapp` `{acao:'conta'}` e depois `{acao:'criar', ensaio:true}` por `ponte_deskcomm.fn_chamar_funcao`; ler a resposta em `net._http_response`. Esperado: `conta_lida` gravada; `parametros` com originador. Apagar o card, a mensagem, o arquivo e a linha de `adesoes` de teste ao fim.

---

### Task 8: Roteiro da Bia

**Files:** Create `scripts/deskcomm/ajuste_bia_adesao.sql`

- [ ] **Step 1: Script cirúrgico**

Mesma estrutura de `scripts/deskcomm/ajuste_bia_fechamento.sql` (ler o arquivo inteiro antes): uma versão nova só da Bia, publicada por `fn_publish_ai_agent_version`, com `event_log` `origem = 'ajuste_bia_adesao'`, idempotente (pula se já contém `b2w_status_adesao` no prompt e na lista de ferramentas), e erro se o trecho antigo não for encontrado. Diferenças:

- `tool_ids`: `array(select distinct unnest(v.tool_ids || array['mcp_externo:leitura:b2w_status_adesao']))`.
- Trecho antigo (início do passo 5 publicado pela v6): substituir o parágrafo que começa com `5. Adesão: quando o cliente topar, envie o link_adesao e conduza a adesão passo a passo` e vai até `aqui ela não exige humano.` (inclusive) pelo bloco abaixo. Localizar com `position('5. Adesão: quando o cliente topar' in v_prompt)` e `position('aqui ela não exige humano.' in v_prompt)` e montar com `substr`, para não depender do texto inteiro.

```
5. Adesão aqui no chat (caminho padrão quando o cliente topa):
- Se ele perguntar o que precisa para aderir, contratar ou seguir, mande duas mensagens. A primeira: "Para fazer sua adesão, vou precisar de:
• endereço do imóvel
• número do cliente (está na conta de energia)
• nome completo do titular da conta
• CPF
• e-mail e telefone para contato
• foto do seu documento (RG ou CNH)
• foto ou PDF da conta de energia mais recente
A conta precisa estar no seu nome. Se estiver no nome de outra pessoa ou de empresa, me avisa que a equipe te orienta.
Com tudo em mãos, gero o contrato e te envio para assinar aqui mesmo, pelo celular." A segunda: "Tá com os documentos fácil aí em mãos? Podemos seguir?"
- Peça um dado por vez, gravando a etapa no negócio (crm_update_lead, campo adesao_etapa) ANTES de pedir: aguardando_conta ("Me manda uma foto (ou o PDF) da sua conta de luz mais recente, com todas as informações aparecendo.") → titular → aguardando_cpf → aguardando_email → aguardando_telefone → aguardando_documento ("Agora uma foto do seu RG ou CNH (frente).") → revisao → confirmado.
- Depois de cada envio do cliente, consulte b2w_status_adesao. O que a conta trouxer (endereço, número do cliente, titular) você só confirma, sem perguntar de novo.
- titular: "A conta está no nome de {titular}. É você?" Grave adesao_titular_ok (sim/não).
- CPF, e-mail e telefone: grave em adesao_cpf, adesao_email e adesao_telefone (para o telefone, pergunte "Posso usar este número do WhatsApp como telefone de contato?"; se sim, grave o número desta conversa).
- Erros em b2w_status_adesao: conta_ilegivel → "Essa foto não ficou legível, pode mandar outra mais nítida?"; cpf_invalido → "Esse CPF não está certo, pode conferir e mandar de novo?"; email_invalido e documento_invalido → diga que está errado e peça de novo. sem_cobertura e abaixo_minimo → mesmas regras da simulação.
- Pendências (titular_divergente, titular_cnpj, cpf_diferente_conta, cpf_ja_cadastrado, falha_criacao) ou o cliente mencionar mais de uma conta/unidade: mova o negócio para "Pendência de adesão" (crm_move_lead_stage), passe para humano (crm_request_human_handoff) com o motivo e diga que a equipe vai dar sequência.
- revisao: resuma (nome, CPF mascarado, e-mail, telefone, endereço, número do cliente, desconto, vencimento dia 5) e pergunte "Está tudo certo?". Se ele corrigir algo, volte à etapa daquele dado. Se confirmar, grave adesao_revisao_ok = sim e adesao_etapa = confirmado e diga "Perfeito! Estou gerando seu contrato, em instantes te mando o link aqui."
- O contrato leva alguns segundos para ficar pronto e você só fala quando há mensagem. Por isso, logo depois de confirmar, agende um retorno para daqui a 2 minutos (schedule_followup) com o motivo "entregar o link do contrato". Se o agendamento não for possível (fora do horário de envio), diga que o contrato também chega no e-mail dele e que, assim que ele responder aqui, você manda o link.
- Quando b2w_status_adesao trouxer link_assinatura (no retorno agendado ou na próxima mensagem do cliente): "Pronto! É só abrir, conferir e assinar: {link}" e mova para "Contrato enviado". Se ainda não houver link e não houver erro, diga que está quase pronto e agende outro retorno em 2 minutos. Quando vier assinado = true, agradeça.
- O link do site (link_adesao) só se o cliente preferir fazer sozinho, ou disser que vai pensar ou que volta depois: "Fico aguardando! Se preferir, pode continuar pelo {link_adesao}".
- Passe para humano também se o cliente pedir, reclamar ou travar.
```

- [ ] **Step 2: Ensaio sem gravar** — conferir que o trecho antigo existe na versão publicada (`position(...) > 0`) e que a lista de ferramentas da Bia ainda não tem `b2w_status_adesao`.

- [ ] **Step 3: Aprovação, rodar e conferir** — versão nova publicada; `## Quem você é` preservado; `b2w_status_adesao` no prompt e em `tool_ids`; regra da energia solar e de várias contas preservadas.

- [ ] **Step 4: Commit**

```bash
git add scripts/deskcomm/adesao_funil.sql scripts/deskcomm/ajuste_bia_adesao.sql
git commit -m "feat(deskcomm): funil e roteiro da Bia para adesão pelo WhatsApp"
```

---

### Task 9: Documentação, PR e teste de ponta a ponta

**Files:** Modify `playbook/DESKCOMM.md`, `docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md`

- [ ] **Step 1: Playbook §8.4** (depois da §8.3):

```
### 8.4 Adesão pelo WhatsApp — no ar desde <data, Brasília>

Spec: `docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md`.

- **Fluxo:** a Bia grava `adesao_etapa` e os dados no card; o gatilho `trg_ponte_adesao_midia` leva foto/PDF da conta e do documento, e `trg_ponte_adesao_card` leva CPF/e-mail/telefone/titular e o `confirmado`, para a Edge Function `adesao-whatsapp`. Estado em `ponte_deskcomm.adesoes`; a Bia lê por `b2w_status_adesao`.
- **Criação:** `fn_criar_assinante_publico` (com originador e indicador do lead) + documentos em `documentos-assinante` + contrato pelo `onboarding-finalizar` com `sem_whatsapp` (só e-mail; a Bia entrega o link).
- **Pendência de adesão:** etapa nova do funil (exige humano, avisa na central) para titular divergente, CNPJ, várias UCs, CPF já cadastrado e falha ao criar.
- **Checklist pós-atualização do Deskcomm:** mídia ainda em `messages.media_storage_path` no bucket `whatsapp-media`.
- **Pendência:** regra de retenção para limpar `adesao_cpf` e afins do card depois da adesão fechada.
```

Estado do spec: "implementado em <data> (ver `playbook/DESKCOMM.md` §8.4)".

- [ ] **Step 2: Suíte, push e PR** (sem dados de cliente no texto)

```bash
npx vitest run
git add playbook/DESKCOMM.md docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md docs/superpowers/plans/2026-10-26-adesao-whatsapp.md
git commit -m "docs(deskcomm): playbook da adesão pelo WhatsApp"
git push -u origin feat/adesao-whatsapp
gh pr create --repo WaldineyGodoy/saas --base main --head feat/adesao-whatsapp --title "feat(deskcomm): adesão à Energia por Assinatura pelo WhatsApp"
```

- [ ] **Step 3: Conversa de teste (usuário, número de teste)** até o link de assinatura, sem assinar. Conferir em cada passo `ponte_deskcomm.adesoes`, o card e `ponte_deskcomm.erros`. Ao fim, apagar o assinante de teste (e o documento na Autentique pelo `cancel-autentique-document`), com aprovação do usuário.
