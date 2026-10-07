import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/auth.ts'

/**
 * Convite para o app B2W Energia, enviado por WhatsApp.
 *
 * POST { tipo: 'subscriber' | 'supplier', id }   (so admin/super_admin)
 *   200 { ok, criado, email }
 *   400 entrada | 401/403 portao | 404 cadastro | 409 conflito | 502 WhatsApp
 *
 * 1. Acha o login do cadastro: o user_id ja gravado ou, sem ele, o login com o
 *    mesmo e-mail. Sem nenhum, cria um com o e-mail ja confirmado (quem
 *    garante que o e-mail e da pessoa e o proprio cadastro do CRM). O gatilho
 *    handle_new_user grava o vinculo user_id.
 * 2. Login ja existente e NAO confirmado com este e-mail: recusa. Esse login
 *    pode ter sido criado por outra pessoa, que sabe a senha dele; confirmar
 *    daria a ela os dados deste cadastro.
 * 3. Gera um link de recuperacao e monta a URL da tela de senha do CRM com o
 *    token_hash. A tela so consome o token quando a pessoa clica em salvar,
 *    entao a pre-visualizacao de links do WhatsApp nao queima o convite.
 * 4. Envia pelo send-whatsapp e registra no crm_history.
 */

const CRM_URL = (Deno.env.get('CRM_URL') ?? 'https://crm.b2wenergia.com.br').replace(/\/+$/, '')

const TABELA = { subscriber: 'subscribers', supplier: 'suppliers' } as const
type Tipo = keyof typeof TABELA

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status
})

const primeiroNome = (nome: string | null) => String(nome || '').trim().split(/\s+/)[0] || ''

export const textoConvite = (nome: string | null, email: string, link: string) =>
    `Olá, ${primeiroNome(nome)}! ⚡\n\n` +
    `Seu acesso ao app da B2W Energia está pronto. Toque no link abaixo para criar a sua senha:\n${link}\n\n` +
    `Depois, entre no app com o e-mail *${email}* e a senha que você criou.\n\n` +
    `Se o link expirar, é só responder esta mensagem que enviamos outro.`

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const admin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const portao = await requireAdmin(req, admin)
    if (!portao.ok) return json({ error: portao.error }, portao.status)

    try {
        const { tipo, id } = await req.json().catch(() => ({}))
        if (!(tipo in TABELA) || typeof id !== 'string' || !id) {
            return json({ error: 'Informe tipo (subscriber ou supplier) e id.' }, 400)
        }
        const tabela = TABELA[tipo as Tipo]

        const { data: cad, error: cadErr } = await admin
            .from(tabela).select('id, name, email, phone, user_id').eq('id', id).maybeSingle()
        if (cadErr) throw cadErr
        if (!cad) return json({ error: 'Cadastro não encontrado.' }, 404)

        const email = String(cad.email || '').trim().toLowerCase()
        if (!email) return json({ error: 'O cadastro não tem e-mail.' }, 400)
        if (!cad.phone) return json({ error: 'O cadastro não tem telefone para o WhatsApp.' }, 400)

        // 1-2. Login do cadastro
        let userId: string | null = cad.user_id ?? null
        let criado = false

        if (!userId) {
            const { data: existente } = await admin.rpc('fn_auth_user_id_por_email', { p_email: email })
            if (existente) {
                const { data: u } = await admin.auth.admin.getUserById(existente as string)
                if (!u?.user?.email_confirmed_at) {
                    return json({ error: 'Já existe um login não confirmado com este e-mail. Resolva no painel do Supabase antes de convidar.' }, 409)
                }
                userId = existente as string
            } else {
                const { data: novo, error: criaErr } = await admin.auth.admin.createUser({
                    email,
                    email_confirm: true,
                    user_metadata: { name: cad.name, phone: cad.phone }
                })
                if (criaErr) throw criaErr
                userId = novo.user?.id ?? null
                criado = true
            }

            // O gatilho ja vincula; isto cobre e-mail com espacos/maiusculas
            // diferentes no cadastro. So grava se continuar vazio.
            if (userId) {
                await admin.from(tabela).update({ user_id: userId }).eq('id', id).is('user_id', null)
            }
        }
        if (!userId) throw new Error('login nao resolvido')

        const { data: login } = await admin.auth.admin.getUserById(userId)
        const emailLogin = login?.user?.email
        if (!emailLogin) throw new Error('login sem e-mail')

        // 3. Link de senha
        const { data: gerado, error: linkErr } = await admin.auth.admin.generateLink({
            type: 'recovery',
            email: emailLogin,
        })
        if (linkErr) throw linkErr
        const tokenHash = gerado?.properties?.hashed_token
        if (!tokenHash) throw new Error('generateLink sem hashed_token')

        const q = new URLSearchParams({ reset: 'true', type: 'recovery', token_hash: tokenHash, app: '1' })
        const link = `${CRM_URL}/login?${q.toString()}`

        // 4. WhatsApp
        const { data: env, error: envErr } = await admin.functions.invoke('send-whatsapp', {
            body: { phone: String(cad.phone).replace(/\D/g, ''), text: textoConvite(cad.name, emailLogin, link) }
        })
        const enviado = !envErr && !env?.error

        await admin.from('crm_history').insert({
            entity_type: tipo,
            entity_id: id,
            content: enviado
                ? 'Convite para o app enviado por WhatsApp.'
                : 'Convite para o app NÃO enviado: falha no WhatsApp.',
            metadata: { user_id: userId, login_criado: criado, enviado_por: portao.userId, whatsapp: enviado }
        })

        if (!enviado) {
            console.error('convidar-app: WhatsApp', envErr ?? env?.error)
            return json({ error: 'Não conseguimos enviar pelo WhatsApp.', criado }, 502)
        }

        return json({ ok: true, criado, email: emailLogin })
    } catch (e) {
        console.error('convidar-app:', (e as Error)?.message ?? e)
        return json({ error: 'Não foi possível enviar o convite agora.' }, 500)
    }
})
