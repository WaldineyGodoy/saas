/**
 * Leitura de documento de identificação (CNH ou RG, foto ou PDF) pelo OpenRouter,
 * para o modal do assinante preencher nome, CPF e data de nascimento.
 * Sem Deno nem Supabase: roda no vitest. Segredos de quem chama:
 * OPENROUTER_API_KEY e OPENROUTER_MODEL (os mesmos da leitura de conta de energia).
 *
 * O modelo só TRANSCREVE. Tudo o que ele devolve passa por `normalizarDocumento`
 * antes de chegar à tela: CPF com dígito verificador errado e data impossível
 * viram vazio, porque um dígito mal lido que entra no cadastro vai parar no contrato.
 */
import { cpfValido, nascimentoIso, nomeProprio, soDigitos } from './consulta-cpf.ts'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const TIPOS_IMAGEM_DOCUMENTO = ['image/jpeg', 'image/png', 'image/webp']
export const TIPO_PDF_DOCUMENTO = 'application/pdf'
export const TIPOS_ARQUIVO_DOCUMENTO = [...TIPOS_IMAGEM_DOCUMENTO, TIPO_PDF_DOCUMENTO]
const TIPOS_DOCUMENTO = ['CNH', 'RG', 'CPF', 'OUTRO']

const texto = { type: 'string' }
const ESQUEMA = {
    type: 'object',
    properties: {
        legivel: { type: 'boolean' },
        observacoes: texto,
        tipoDocumento: { type: 'string', enum: [...TIPOS_DOCUMENTO, ''] },
        nome: texto,
        cpf: texto,
        dataNascimento: texto,
    },
    required: ['legivel', 'observacoes', 'tipoDocumento', 'nome', 'cpf', 'dataNascimento'],
    additionalProperties: false,
}

const INSTRUCOES = `Você lê documentos de identificação brasileiros (CNH, RG/carteira de identidade, cartão de CPF), em foto ou PDF, e transcreve três campos para o JSON pedido.

Regras:
- Transcreva só o que está impresso. Campo que não aparece ou que você não consegue ler com segurança fica como "". Não deduza dígitos borrados, cortados, cobertos por reflexo ou dobra: um CPF errado associa o contrato à pessoa errada.
- nome: o nome completo do titular (campo "Nome"), não o nome dos pais nem o de outra pessoa citada no documento.
- cpf: o CPF do titular, com os 11 dígitos, como impresso. Na CNH o campo é "CPF"; no RG novo o CPF aparece no verso ou ao lado do número do registro. Se o documento não traz CPF, deixe "".
- dataNascimento: a data de nascimento do titular no formato DD/MM/AAAA. Não use a data de emissão, de validade nem a de primeira habilitação.
- tipoDocumento: "CNH", "RG" ou "CPF" quando for um desses; "OUTRO" para qualquer outro documento.
- legivel: false se o arquivo não for um documento de identificação ou estiver ilegível demais para identificar o titular. Use observacoes para avisar, em uma frase, sobre partes que não deu para ler.`

/**
 * Resultado seguro da leitura. `cpf` só vem preenchido se passar na validação
 * dos dígitos; o número lido (mesmo errado) fica em `cpfLido` para a tela
 * poder dizer "li X, mas não confere".
 */
export interface DocumentoLido {
    tipoDocumento: string
    nome: string
    cpf: string
    cpfLido: string
    nascimento: string
    observacoes: string
}

// deno-lint-ignore no-explicit-any
export function normalizarDocumento(lido: any): DocumentoLido {
    const l = lido && typeof lido === 'object' ? lido : {}
    const cpfLido = soDigitos(l.cpf)
    const nome = nomeProprio(l.nome)
    const tipo = String(l.tipoDocumento ?? '').toUpperCase()
    return {
        tipoDocumento: TIPOS_DOCUMENTO.includes(tipo) ? tipo : 'OUTRO',
        // Nome de uma palavra só é leitura pela metade (ou apelido): não preenche.
        nome: nome.split(' ').length >= 2 ? nome : '',
        cpf: cpfValido(cpfLido) ? cpfLido : '',
        cpfLido,
        nascimento: nascimentoIso(l.dataNascimento) ?? '',
        observacoes: String(l.observacoes ?? '').trim(),
    }
}

// ---------------------------------------------------------------------------
// Documento da empresa (Cartão CNPJ ou Contrato Social), adesão PJ pelo app
// (dono, 26/11/2026). Só o CNPJ e a razão social: endereço e sócios vêm da
// consulta pública do CNPJ, mais confiável que a leitura.

const TIPOS_EMPRESA = ['CARTAO_CNPJ', 'CONTRATO_SOCIAL', 'OUTRO']

const ESQUEMA_EMPRESA = {
    type: 'object',
    properties: {
        legivel: { type: 'boolean' },
        observacoes: texto,
        tipoDocumento: { type: 'string', enum: [...TIPOS_EMPRESA, ''] },
        cnpj: texto,
        razaoSocial: texto,
    },
    required: ['legivel', 'observacoes', 'tipoDocumento', 'cnpj', 'razaoSocial'],
    additionalProperties: false,
}

const INSTRUCOES_EMPRESA = `Você lê documentos de empresas brasileiras (Cartão CNPJ / comprovante de inscrição da Receita, ou Contrato Social e suas alterações), em foto ou PDF, e transcreve dois campos para o JSON pedido.

Regras:
- Transcreva só o que está impresso. Campo que não aparece ou que você não consegue ler com segurança fica como "". Não deduza dígitos borrados ou cortados.
- cnpj: o CNPJ da própria empresa, 14 dígitos, como impresso. No contrato social de constituição o CNPJ costuma NÃO aparecer: nesse caso deixe "". Não use o CNPJ de outra empresa citada (sócia, contador, junta comercial).
- razaoSocial: o nome empresarial (razão social) da empresa, não o nome fantasia nem o nome de um sócio.
- tipoDocumento: "CARTAO_CNPJ" para o comprovante de inscrição do CNPJ; "CONTRATO_SOCIAL" para contrato social ou alteração contratual; "OUTRO" para qualquer outro documento.
- legivel: false se o arquivo não for um documento de empresa ou estiver ilegível demais. Use observacoes para avisar, em uma frase, sobre partes que não deu para ler.`

/** CNPJ com os dois dígitos verificadores certos. */
export function cnpjValido(valor: unknown): boolean {
    const d = soDigitos(valor)
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
    const dv = (base: string) => {
        let soma = 0
        let peso = base.length - 7
        for (const ch of base) {
            soma += Number(ch) * peso--
            if (peso < 2) peso = 9
        }
        const r = soma % 11
        return r < 2 ? 0 : 11 - r
    }
    const d1 = dv(d.slice(0, 12))
    const d2 = dv(d.slice(0, 12) + d1)
    return d.endsWith(`${d1}${d2}`)
}

export interface EmpresaLida {
    tipoDocumento: string
    cnpj: string
    cnpjLido: string
    razaoSocial: string
    observacoes: string
}

// deno-lint-ignore no-explicit-any
export function normalizarEmpresa(lido: any): EmpresaLida {
    const l = lido && typeof lido === 'object' ? lido : {}
    const cnpjLido = soDigitos(l.cnpj)
    const tipo = String(l.tipoDocumento ?? '').toUpperCase()
    return {
        tipoDocumento: TIPOS_EMPRESA.includes(tipo) ? tipo : 'OUTRO',
        cnpj: cnpjValido(cnpjLido) ? cnpjLido : '',
        cnpjLido,
        razaoSocial: String(l.razaoSocial ?? '').replace(/\s+/g, ' ').trim(),
        observacoes: String(l.observacoes ?? '').trim(),
    }
}

type Cfg = { apiKey: string; modelo: string }
type Falha = { ok: false; status: number; erro: string }

/** Uma chamada ao OpenRouter com esquema JSON estrito; devolve o JSON lido. */
async function transcrever(base64: string, mime: string, cfg: Cfg, o: { nome: string; esquema: unknown; instrucoes: string; pedido: string }):
    // deno-lint-ignore no-explicit-any
    Promise<{ ok: true; dados: any; modelo: string } | Falha> {
    const ehPdf = mime === TIPO_PDF_DOCUMENTO
    if (!TIPOS_ARQUIVO_DOCUMENTO.includes(mime)) return { ok: false, status: 400, erro: `Tipo de arquivo não suportado: ${mime}.` }
    if (base64.length > 7_000_000) return { ok: false, status: 400, erro: 'Arquivo grande demais. Envie uma foto menor.' }
    let resposta: Response
    try {
        resposta = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'B2W Energia - leitura de documento' },
            body: JSON.stringify({
                model: cfg.modelo,
                max_tokens: 1000,
                response_format: { type: 'json_schema', json_schema: { name: o.nome, strict: true, schema: o.esquema } },
                provider: { require_parameters: true },
                ...(ehPdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] } : {}),
                messages: [
                    { role: 'system', content: o.instrucoes },
                    { role: 'user', content: [
                        ehPdf
                            ? { type: 'file', file: { filename: 'documento.pdf', file_data: `data:${TIPO_PDF_DOCUMENTO};base64,${base64}` } }
                            : { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
                        { type: 'text', text: o.pedido },
                    ] },
                ],
            }),
        })
    } catch (err) {
        console.error('leitura-documento: falha de rede', err)
        return { ok: false, status: 502, erro: 'Falha ao ler o documento. Tente de novo.' }
    }
    const corpo = await resposta.json().catch(() => null)
    if (!resposta.ok || !corpo || corpo.error) {
        console.error('leitura-documento: OpenRouter', resposta.status, JSON.stringify(corpo?.error ?? corpo))
        return { ok: false, status: 502, erro: 'Falha ao ler o documento. Tente de novo.' }
    }
    const escolha = corpo.choices?.[0]
    if (escolha?.finish_reason === 'length') return { ok: false, status: 502, erro: 'Não foi possível ler o documento.' }
    let dados
    try {
        dados = JSON.parse(String(escolha?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } catch {
        return { ok: false, status: 502, erro: 'Leitura do documento veio em formato inesperado.' }
    }
    if (!dados.legivel) {
        return { ok: false, status: 422, erro: dados.observacoes || 'Documento ilegível. Tire outra foto com boa luz, o documento inteiro e sem reflexo.' }
    }
    return { ok: true, dados, modelo: corpo.model }
}

/** Cartão CNPJ ou Contrato Social: CNPJ (validado) e razão social. */
export async function lerDocumentoEmpresa(base64: string, mime: string, cfg: Cfg):
    Promise<{ ok: true; dados: EmpresaLida; modelo: string } | Falha> {
    const r = await transcrever(base64, mime, cfg, {
        nome: 'documento_empresa', esquema: ESQUEMA_EMPRESA, instrucoes: INSTRUCOES_EMPRESA,
        pedido: 'Transcreva o CNPJ e a razão social desta empresa.',
    })
    return r.ok ? { ok: true, dados: normalizarEmpresa(r.dados), modelo: r.modelo } : r
}

/**
 * Chama o OpenRouter e devolve o documento lido. Status de erro: 400 entrada,
 * 422 ilegível, 502 falha na leitura.
 */
export async function lerDocumento(base64: string, mime: string, cfg: Cfg):
    Promise<{ ok: true; dados: DocumentoLido; modelo: string } | Falha> {
    const r = await transcrever(base64, mime, cfg, {
        nome: 'documento_identificacao', esquema: ESQUEMA, instrucoes: INSTRUCOES,
        pedido: 'Transcreva nome, CPF e data de nascimento deste documento.',
    })
    return r.ok ? { ok: true, dados: normalizarDocumento(r.dados), modelo: r.modelo } : r
}
