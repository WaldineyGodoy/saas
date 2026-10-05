import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'
import { ASSINATURA_Y_PCT, montarPdf } from '../_shared/pdf-aditivo.ts'
import {
    TITULO_ADITIVO, TITULO_PROCURACAO, nomeArquivoAditivo, paragrafosProcuracao, paragrafosTermoAditivo,
} from '../_shared/termo-aditivo.ts'

/**
 * Termo aditivo de inclusao de UC, pedido pelo assinante no app.
 *
 * POST { conta, plano_id }   (sessao do assinante)
 *   200 { ok: true, lead_id, link, reaproveitado }
 *   400 entrada | 401 sessao | 403 sem contrato | 409 UC ja cadastrada | 502 Autentique
 *
 * 1. assinante = subscribers.user_id do login (mesma regra de fn_app_subscriber_id).
 * 2. plano ativo e ligado a distribuidora da UC (planos_distribuidoras).
 * 3. UC ja cadastrada em cadastro ativo -> 409 (nao diz de quem).
 * 4. pedido = app_solicitar_nova_uc com a sessao do assinante (recusa UC dele
 *    e nao duplica pedido) + plano_id.
 * 5. ja existe termo pendente com o mesmo plano -> devolve o mesmo link.
 * 6. PDF no servidor (pdf-lib): nao ha CRM no meio para gerar no navegador.
 * 7. Autentique via create-autentique-document com a chave de servidor;
 *    signatario sem e-mail -> link publico, aberto dentro do app.
 * 8. signatures.document_type = 'aditivo_uc'; o autentique-webhook cria a UC
 *    quando assinado (fn_criar_uc_do_aditivo).
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
})

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const auth = await requireUser(req, admin)
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

    let conta: Record<string, any>, planoId: string
    try {
        const body = await req.json()
        conta = body.conta
        planoId = String(body.plano_id || '')
    } catch {
        return json({ ok: false, error: 'Corpo JSON inválido.' }, 400)
    }
    if (!conta || typeof conta !== 'object' || !String(conta.numeroUc || '').trim()) {
        return json({ ok: false, error: 'Leitura da conta sem número da UC.' }, 400)
    }
    if (!/^[0-9a-f-]{36}$/i.test(planoId)) return json({ ok: false, error: 'Escolha um plano.' }, 400)
    const concessionaria = String(conta.concessionaria || 'Neoenergia Cosern')

    // 1. Assinante do login
    const { data: sub } = await admin.from('subscribers')
        .select('id, name, cpf_cnpj, representante_nome, representante_cpf, rua, numero, complemento, bairro, cidade, uf, cep')
        .eq('user_id', auth.userId).order('created_at').limit(1).maybeSingle()
    if (!sub) return json({ ok: false, error: 'Este login ainda não está vinculado a um contrato de assinatura.' }, 403)

    // 2. Plano disponivel para a distribuidora
    const { data: plano } = await admin.from('planos_assinatura_energia')
        .select('id, nome, desconto_assinante, ativo, planos_distribuidoras!inner(concessionaria)')
        .eq('id', planoId).eq('ativo', true)
        .ilike('planos_distribuidoras.concessionaria', concessionaria)
        .maybeSingle()
    if (!plano) return json({ ok: false, error: 'Este plano não está disponível para a distribuidora da UC.' }, 400)

    // 3. UC em outro cadastro ativo
    const { data: jaCadastrada } = await admin.rpc('fn_uc_ja_cadastrada', { p_numero: conta.numeroUc })
    if (jaCadastrada) {
        return json({ ok: false, error: 'Esta UC já está cadastrada na B2W. Fale com o suporte para incluí-la na sua assinatura.' }, 409)
    }

    // 4. Pedido (lead) com a sessao do proprio assinante
    const doUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: req.headers.get('Authorization')! } },
    })
    const { data: pedido, error: pedidoErr } = await doUsuario.rpc('app_solicitar_nova_uc', { p_conta: conta })
    if (pedidoErr || !pedido?.lead_id) {
        return json({ ok: false, error: pedidoErr?.message || 'Não foi possível registrar o pedido.' }, pedidoErr?.code === '23505' ? 409 : 400)
    }
    const leadId: string = pedido.lead_id

    // 5. Termo pendente reaproveitado (mesmo plano) ou cancelado (plano trocado)
    const { data: pendentes } = await admin.from('signatures')
        .select('id, autentique_url, metadata')
        .eq('signer_type', 'lead').eq('signer_id', leadId).eq('document_type', 'aditivo_uc').eq('status', 'pending')
    const { data: lead } = await admin.from('leads').select('plano_id').eq('id', leadId).single()
    const mesmoPlano = lead?.plano_id === plano.id
    const reaproveitavel = mesmoPlano ? (pendentes || []).find((s) => s.autentique_url && !String(s.autentique_url).includes('/documentos/')) : null
    if (reaproveitavel) return json({ ok: true, lead_id: leadId, link: reaproveitavel.autentique_url, reaproveitado: true })
    if ((pendentes || []).length) {
        await admin.from('signatures').update({ status: 'canceled' }).in('id', pendentes!.map((s) => s.id))
    }
    await admin.from('leads').update({ plano_id: plano.id, status: 'contrato_enviado', updated_at: new Date().toISOString() }).eq('id', leadId)

    // 6. PDF
    const uc = { numeroUc: String(conta.numeroUc), titular: conta.titular, concessionaria, endereco: conta.endereco }
    const pdf = await montarPdf(
        TITULO_ADITIVO, paragrafosTermoAditivo({ assinante: sub, uc, plano }),
        TITULO_PROCURACAO, paragrafosProcuracao({ assinante: sub, uc }),
        String(sub.name || ''),
    )

    // 7. Autentique
    const { data: aut, error: autErr } = await admin.functions.invoke('create-autentique-document', {
        body: {
            documentName: nomeArquivoAditivo(sub, uc.numeroUc),
            fileBase64: pdf.base64,
            signers: [{
                name: sub.name,
                action: 'SIGN',
                positions: [
                    { x: 50, y: ASSINATURA_Y_PCT, z: pdf.paginasTermo },
                    { x: 50, y: ASSINATURA_Y_PCT, z: pdf.paginaProcuracao },
                ],
            }],
            signerId: leadId,
            signerType: 'lead',
        },
    })
    if (autErr || aut?.error || !aut?.documentId) {
        console.error('aditivo-nova-uc: Autentique', autErr ?? aut?.error)
        return json({ ok: false, error: 'Não foi possível gerar o termo agora. Tente de novo em instantes.' }, 502)
    }

    // 8. Tipo do documento (o webhook usa) e link
    await admin.from('signatures').update({ document_type: 'aditivo_uc' }).eq('autentique_doc_id', aut.documentId)
    if (!aut.signingLinkFound) {
        // Sem link publico nao ha o que abrir no app; a linha fica cancelada.
        await admin.from('signatures').update({ status: 'canceled' }).eq('autentique_doc_id', aut.documentId)
        console.error('aditivo-nova-uc: Autentique sem link de assinatura', aut.documentId)
        return json({ ok: false, error: 'Não foi possível gerar o link de assinatura. Tente de novo em instantes.' }, 502)
    }

    await admin.from('crm_history').insert({
        entity_type: 'lead', entity_id: leadId,
        content: `Termo aditivo da UC ${uc.numeroUc} gerado pelo app (plano ${plano.nome}). Aguardando assinatura.`,
        metadata: { origem: 'aditivo-nova-uc', autentique_doc_id: aut.documentId, subscriber_id: sub.id },
    })

    return json({ ok: true, lead_id: leadId, link: aut.url, reaproveitado: false })
})
