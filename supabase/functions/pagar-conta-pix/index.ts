import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import { requireAdmin } from "../_shared/auth.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { codigoDeBarras, lerPixEmv, txidBateComCodigoDeBarras } from "../_shared/pix-emv.ts"

/**
 * Paga a conta de energia da concessionária pelo QR Code "PAGUE COM PIX"
 * impresso na própria conta.
 *
 * Por que existe ao lado de pay-asaas-bill: a Asaas só paga conta de serviço
 * VENCIDA por boleto em dia útil até as 22h. Pix liquida a qualquer hora.
 *
 * Corpo: { invoiceId, payload, modo: 'conferir' | 'pagar' }
 *   - conferir: decodifica na Asaas e devolve recebedor e valor, sem pagar.
 *   - pagar: refaz TODAS as conferências (não confia no 'conferir' anterior)
 *     e paga.
 *
 * O payload vem do navegador, que lê o QR do PDF. Por isso ele não é
 * confiável por si: o valor vem do banco (`valor_concessionaria`), o
 * recebedor tem de estar na lista abaixo, e o txid tem de casar com o código
 * de barras da fatura. Um QR trocado ou adulterado cai numa dessas travas.
 */

// Recebedores aceitos, por concessionária. Constante no código, e não tabela,
// de propósito: quem conseguir escrever no banco não consegue com isso
// redirecionar pagamento para outra conta. Concessionária nova entra aqui,
// por deploy revisado.
const RECEBEDORES: { concessionaria: RegExp; cnpj: string; nome: string }[] = [
    { concessionaria: /cosern/i, cnpj: '08324196000181', nome: 'Neoenergia Cosern' },
]

const TOLERANCIA = 0.02

function hojeEmBrasilia(agora: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(agora)
}

function descreverErrosAsaas(errors: unknown, status: number): string {
    if (!Array.isArray(errors) || errors.length === 0) return `Erro ${status}`
    return errors.map((e) => e?.description ?? e?.code ?? 'erro sem descricao').join(' | ')
}

/**
 * O CNPJ do recebedor bate com o esperado? A Asaas pode devolver o documento
 * mascarado (ex.: "08.324.***\/0001-**"); compara-se dígito a dígito o que
 * vier visível, exigindo a raiz inteira (8 primeiros) visível e igual.
 */
function cnpjConfere(recebido: string | null | undefined, esperado: string): boolean {
    const r = String(recebido ?? '').replace(/[^\d*]/g, '')
    if (r.length !== 14) return false
    for (let i = 0; i < 14; i++) {
        if (r[i] === '*') {
            if (i < 8) return false
            continue
        }
        if (r[i] !== esperado[i]) return false
    }
    return true
}

const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function resposta(corpo: unknown, status = 200) {
    return new Response(JSON.stringify(corpo), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
}

class Recusa extends Error {}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Portão ANTES de ler o corpo.
    const auth = await requireAdmin(req, supabase)
    if (!auth.ok) return resposta({ success: false, error: auth.error }, auth.status)

    let invoiceId: string | undefined
    let travou = false

    try {
        const corpo = await req.json()
        invoiceId = corpo?.invoiceId
        const modo = corpo?.modo === 'pagar' ? 'pagar' : 'conferir'
        if (!invoiceId) throw new Recusa('Fatura não informada.')

        // 1. A fatura, do banco.
        const { data: inv, error: invErr } = await supabase
            .from('invoices')
            .select('id, valor_concessionaria, linha_digitavel, energy_bill_status, concessionaria, vencimento_concessionaria, pix_concessionaria_status, pix_concessionaria_transacao_id, consumer_units ( numero_uc, titular_conta, concessionaria )')
            .eq('id', invoiceId)
            .single()
        if (invErr || !inv) throw new Recusa('Fatura não encontrada.')

        if (inv.energy_bill_status === 'pago') throw new Recusa('Esta conta já está marcada como paga.')
        if (inv.pix_concessionaria_transacao_id || inv.pix_concessionaria_status === 'enviando') {
            throw new Recusa('Já existe um pagamento Pix registrado ou em andamento para esta conta. Confira o extrato da Asaas antes de tentar de novo.')
        }

        const valorConta = Number(inv.valor_concessionaria) || 0
        if (valorConta <= 0) throw new Recusa('Conta sem valor apurado. Confira a fatura antes de pagar.')

        const nomeConc = inv.consumer_units?.concessionaria || inv.concessionaria || ''
        const recebedorEsperado = RECEBEDORES.find((r) => r.concessionaria.test(nomeConc))
        if (!recebedorEsperado) {
            throw new Recusa(`Pagamento por Pix ainda não habilitado para a concessionária "${nomeConc || 'não informada'}".`)
        }

        // 2. O código Pix: formato, CRC, valor e vínculo com a conta.
        const lido = lerPixEmv(corpo?.payload)
        if (!lido.ok) throw new Recusa(lido.erro)
        const pix = lido.pix

        if (pix.valor == null) throw new Recusa('O QR Code não traz valor fixo. Pague pelo boleto.')
        if (Math.abs(pix.valor - valorConta) > TOLERANCIA) {
            throw new Recusa(`O QR Code cobra ${dinheiro(pix.valor)}, mas a conta registrada é ${dinheiro(valorConta)}. Confira a conta antes de pagar.`)
        }

        const barra = codigoDeBarras(inv.linha_digitavel)
        if (barra && barra[0] === '8') {
            const valorBarras = parseInt(barra.substr(4, 11), 10) / 100
            if (Math.abs(valorBarras - valorConta) > TOLERANCIA) {
                throw new Recusa(`O código de barras cobra ${dinheiro(valorBarras)}, mas a conta registrada é ${dinheiro(valorConta)}.`)
            }
        }

        if (txidBateComCodigoDeBarras(pix.txid, inv.linha_digitavel) === false) {
            throw new Recusa('O QR Code não pertence a esta conta: o identificador dele não confere com o código de barras da fatura.')
        }

        // 3. Asaas.
        const { data: cfg, error: cfgErr } = await supabase
            .from('integrations_config')
            .select('api_key, endpoint_url, sandbox_api_key, sandbox_endpoint_url, environment')
            .eq('service_name', 'financial_api')
            .single()
        if (cfgErr || !cfg) throw new Recusa('Integração Asaas não configurada no painel.')
        const sandbox = cfg.environment === 'sandbox'
        const asaasKey = sandbox ? cfg.sandbox_api_key : cfg.api_key
        const asaasUrl = sandbox ? cfg.sandbox_endpoint_url : cfg.endpoint_url
        if (!asaasKey || !asaasUrl) throw new Recusa(`Configurações de ${sandbox ? 'Sandbox' : 'Produção'} incompletas.`)

        const chamarAsaas = async (caminho: string, body: unknown) => {
            const r = await fetch(`${asaasUrl}${caminho}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'access_token': asaasKey },
                body: JSON.stringify(body),
            })
            const txt = await r.text()
            let data: any = {}
            try { data = txt ? JSON.parse(txt) : {} } catch {
                return { ok: false, status: r.status, data: null, erro: `Resposta inválida da Asaas (${r.status}).` }
            }
            if (!r.ok || data.errors) {
                return { ok: false, status: r.status, data, erro: descreverErrosAsaas(data.errors, r.status) }
            }
            return { ok: true, status: r.status, data, erro: null }
        }

        const dec = await chamarAsaas('/pix/qrCodes/decode', {
            payload: pix.payload,
            expectedPaymentDate: hojeEmBrasilia(),
        })
        if (!dec.ok) throw new Recusa(`A Asaas não conseguiu ler o QR Code: ${dec.erro}`)
        const d = dec.data

        console.log('pagar-conta-pix decode', JSON.stringify({
            invoiceId, type: d.type, value: d.value, totalValue: d.totalValue,
            receiver: d.receiver ? { name: d.receiver.name, cpfCnpj: d.receiver.cpfCnpj, ispbName: d.receiver.ispbName } : null,
            canBePaid: d.canBePaid,
        }))

        if (d.canBePaid === false) {
            throw new Recusa(`A Asaas informa que este QR Code não pode ser pago: ${d.cannotBePaidReason || 'motivo não informado'}.`)
        }
        if (!cnpjConfere(d.receiver?.cpfCnpj, recebedorEsperado.cnpj)) {
            throw new Recusa(`O recebedor do QR Code (${d.receiver?.name || '?'}, ${d.receiver?.cpfCnpj || 'sem CNPJ'}) não é a ${recebedorEsperado.nome}. Pagamento bloqueado.`)
        }
        const totalAsaas = Number(d.totalValue ?? d.value)
        if (!Number.isFinite(totalAsaas) || Math.abs(totalAsaas - pix.valor) > TOLERANCIA) {
            throw new Recusa(`A Asaas calcula ${Number.isFinite(totalAsaas) ? dinheiro(totalAsaas) : 'valor desconhecido'} para este QR Code, diferente dos ${dinheiro(pix.valor)} da conta. Pague pelo boleto ou confira a conta.`)
        }

        const resumo = {
            recebedor: d.receiver?.name || pix.nomeRecebedor,
            cnpj: d.receiver?.cpfCnpj || null,
            instituicao: d.receiver?.ispbName || null,
            valor: pix.valor,
            uc: inv.consumer_units?.numero_uc || null,
            vencimento: inv.vencimento_concessionaria,
            ambiente: sandbox ? 'sandbox' : 'producao',
        }

        if (modo === 'conferir') return resposta({ success: true, modo, resumo })

        // 4. Trava: só uma chamada passa daqui por fatura.
        const { data: trava, error: travaErr } = await supabase
            .from('invoices')
            .update({ pix_concessionaria_status: 'enviando', pix_concessionaria: pix.payload })
            .eq('id', invoiceId)
            .is('pix_concessionaria_transacao_id', null)
            .or('pix_concessionaria_status.is.null,pix_concessionaria_status.eq.falhou')
            .select('id')
        if (travaErr) throw new Error(`Falha ao travar a fatura: ${travaErr.message}`)
        if (!trava || trava.length === 0) {
            throw new Recusa('Outro pagamento desta conta acabou de começar. Atualize a tela.')
        }
        travou = true

        let descricao = `Conta energia UC ${resumo.uc ?? ''}`.trim()
        if (descricao.length > 50) descricao = descricao.slice(0, 50)

        let pago
        try {
            pago = await chamarAsaas('/pix/qrCodes/pay', {
                qrCode: { payload: pix.payload },
                value: pix.valor,
                description: descricao,
            })
        } catch (e) {
            // Sem resposta, não se sabe se a Asaas pagou. A trava fica em
            // 'enviando' de propósito: liberar abriria porta a pagar duas vezes.
            travou = false
            throw new Error(`Sem resposta da Asaas (${(e as Error).message}). O pagamento pode ter sido feito: confira o extrato antes de tentar de novo.`)
        }

        if (!pago.ok) {
            // A Asaas recusou com erro explícito: nada foi debitado.
            await supabase.from('invoices').update({ pix_concessionaria_status: 'falhou' }).eq('id', invoiceId)
            travou = false
            throw new Recusa(`A Asaas recusou o pagamento: ${pago.erro}`)
        }

        const t = pago.data
        await supabase.from('invoices').update({
            pix_concessionaria_status: t.status || 'REQUESTED',
            pix_concessionaria_transacao_id: t.id || null,
            pix_concessionaria_pago_em: new Date().toISOString(),
            pix_concessionaria_pago_por: auth.userId,
        }).eq('id', invoiceId)
        travou = false

        return resposta({
            success: true,
            modo,
            resumo,
            transacao: {
                id: t.id,
                status: t.status,
                value: t.value,
                endToEndIdentifier: t.endToEndIdentifier ?? null,
                transactionReceiptUrl: t.transactionReceiptUrl ?? null,
                refusalReason: t.refusalReason ?? null,
            },
        })
    } catch (error) {
        // Erro inesperado depois de travar e antes de chamar a Asaas: nada foi
        // pago, pode liberar.
        if (travou && invoiceId) {
            await supabase.from('invoices').update({ pix_concessionaria_status: 'falhou' }).eq('id', invoiceId)
        }
        const msg = (error as Error).message
        if (!(error instanceof Recusa)) console.error('pagar-conta-pix', msg)
        return resposta({ success: false, error: msg })
    }
})
