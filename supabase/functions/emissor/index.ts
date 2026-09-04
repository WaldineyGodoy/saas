import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import { corsHeaders } from "../_shared/cors.ts"
import { requireAdmin } from "../_shared/auth.ts"

/**
 * Emissor — emissão autônoma da cobrança, agora acionada pelo pg_cron.
 *
 * Porte do `scraper/emissor.js`. A lógica é a mesma; o que muda é quem chama.
 *
 * ---------------------------------------------------------------- por que saiu
 *
 * O robô vivia no GitHub Actions. Em 04/09/2026 o `schedule` do repositório
 * parou de disparar — nenhum workflow, nenhum agendamento, por dias — enquanto
 * os gatilhos de push seguiam funcionando. Ninguém percebeu até faltarem
 * R$ 19.776,25 em boletos que deveriam ter saído.
 *
 * Pendurar a única etapa do pipeline que cria dinheiro num agendador que some
 * sem avisar, fora do nosso alcance para diagnosticar, é frágil demais. O
 * pg_cron mora no mesmo banco que já é fonte de verdade do resto: se ele parar,
 * a mesma conexão que emite é a que investiga.
 *
 * ------------------------------------------------------------------- o portão
 *
 * Duas portas, e nenhuma delas é anônima:
 *
 *   1. `x-emissor-token` — o token do cron. Nasce dentro do banco
 *      (gen_random_bytes), mora no Vault e é lido dos dois lados. Nem pessoa
 *      nem agente jamais vê o valor.
 *   2. sessão de administrador — para alguém disparar pela tela.
 *
 * A criação da cobrança continua passando por `create-asaas-charge` com o JWT
 * do robô. Chamar por dentro com service_role seria mais curto e anularia o
 * `requireAdmin` que existe justamente para isso não acontecer.
 */

const LIMITE_PADRAO = 10
const TETO_PADRAO = 50000

const moeda = (v: number) =>
    Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const mesBR = (iso: string) => {
    if (!iso) return '—'
    const [a, m] = String(iso).slice(0, 10).split('-')
    return `${m}/${a}`
}

/**
 * Confere o token do cron.
 *
 * Quem compara é o BANCO. A primeira versão lia o segredo do Vault para
 * comparar aqui — não funcionava, porque o PostgREST não expõe o schema
 * `vault`, e estava errada de qualquer forma: para conferir um segredo não é
 * preciso transportá-lo. Assim o valor nunca sai do banco, nem para esta
 * função, nem para um log.
 */
async function tokenConfere(supabase: any, token: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('fn_validar_token_emissor', { p_token: token })
    if (error) return false
    return data === true
}

/**
 * Login do robô. Idêntico ao do emissor.js e pelo mesmo motivo: o access_token
 * que volta pertence ao usuário, e é ele que o requireAdmin resolve em
 * `profiles`. A chave usada no createClient é só credencial de gateway.
 */
async function autenticarRobo(supabase: any): Promise<string> {
    const email = Deno.env.get('ROBO_EMAIL')
    const senha = Deno.env.get('ROBO_SENHA')
    const anon = Deno.env.get('SUPABASE_ANON_KEY')

    if (!email || !senha) {
        throw new Error(
            'ROBO_EMAIL/ROBO_SENHA não configurados nos secrets da função. ' +
            'O emissor precisa de identidade própria — service_role no Authorization anularia o portão.'
        )
    }

    const cliente = createClient(Deno.env.get('SUPABASE_URL') ?? '', anon ?? '')
    const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha })
    if (error) throw new Error(`Login do robô falhou: ${error.message}`)

    const { data: perfil } = await supabase
        .from('profiles').select('role').eq('id', data.user!.id).single()

    if (!perfil || !['admin', 'super_admin'].includes(perfil.role)) {
        throw new Error(
            `Usuário ${email} tem papel "${perfil?.role ?? 'nenhum'}". ` +
            'A emissão exige admin — ajuste o papel em profiles, não o portão.'
        )
    }

    return data.session!.access_token
}

/**
 * Última checagem antes de criar dinheiro. A fila foi lida no começo; entre ela
 * e aqui alguém pode ter emitido pela tela. Reler é barato, cobrança duplicada
 * não.
 */
async function reconferir(supabase: any, item: any): Promise<number> {
    const { data: faturas, error } = await supabase
        .from('invoices')
        .select('id, valor_a_pagar, asaas_payment_id, consolidated_invoice_id, mes_referencia')
        .in('id', item.invoice_ids)

    if (error) throw new Error(`releitura falhou: ${error.message}`)
    if (!faturas || faturas.length !== item.invoice_ids.length) {
        throw new Error('a fila tem faturas que sumiram do banco')
    }

    const jaCobrada = faturas.find((f: any) => f.asaas_payment_id || f.consolidated_invoice_id)
    if (jaCobrada) {
        throw new Error(`fatura ${jaCobrada.id} ganhou cobrança depois da fila — alguém emitiu pela tela`)
    }

    const soma = faturas.reduce((a: number, f: any) => a + Number(f.valor_a_pagar || 0), 0)
    if (Math.abs(soma - Number(item.total)) > 0.02) {
        throw new Error(`soma mudou: fila dizia ${moeda(item.total)}, banco diz ${moeda(soma)}`)
    }

    const foraDoCiclo = faturas.find(
        (f: any) => String(f.mes_referencia).slice(0, 7) !== String(item.ciclo).slice(0, 7)
    )
    if (foraDoCiclo) throw new Error(`fatura ${foraDoCiclo.id} é de outro ciclo`)

    return soma
}

/** Aviso passa e fica registrado; erro barra o ciclo. */
async function auditar(supabase: any, item: any): Promise<string[]> {
    const avisos: string[] = []
    for (const id of item.invoice_ids) {
        const { data, error } = await supabase.rpc('fn_auditar_fatura', { p_invoice_id: id })
        if (error) throw new Error(`auditoria falhou: ${error.message}`)
        for (const achado of data || []) {
            if (achado.severidade === 'erro') throw new Error(`auditoria barrou: ${achado.mensagem}`)
            avisos.push(achado.mensagem)
        }
    }
    return avisos
}

/**
 * Um ciclo por assinante por execução, o mais antigo primeiro. Assinante com
 * três meses em aberto não recebe três boletos na mesma manhã.
 */
function escolherUmCicloPorAssinante(fila: any[]) {
    const porAssinante = new Map<string, any>()
    for (const item of fila) {
        if (item.impedimento) continue
        if (!item.invoice_ids || item.invoice_ids.length === 0) continue
        const atual = porAssinante.get(item.subscriber_id)
        if (!atual || String(item.ciclo) < String(atual.ciclo)) porAssinante.set(item.subscriber_id, item)
    }
    return [...porAssinante.values()].sort((a, b) => String(a.ciclo).localeCompare(String(b.ciclo)))
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ---- portão -----------------------------------------------------------
    const tokenRecebido = req.headers.get('x-emissor-token')
    let origem = 'cron'
    let autorizado = false

    if (tokenRecebido) {
        autorizado = await tokenConfere(supabase, tokenRecebido)
        if (!autorizado) {
            return new Response(JSON.stringify({ error: 'Token do emissor inválido.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 })
        }
    } else {
        const auth = await requireAdmin(req, supabase)
        if (!auth.ok) {
            return new Response(JSON.stringify({ error: auth.error }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: auth.status })
        }
        autorizado = true
        origem = 'manual'
    }

    // ---- parâmetros -------------------------------------------------------
    let corpo: any = {}
    try { corpo = await req.json() } catch (_) { corpo = {} }
    const aplicar = corpo.aplicar === true
    const limite = Number(corpo.limite) || LIMITE_PADRAO
    const teto = Number(corpo.teto) || TETO_PADRAO

    // ---- registro, aberto ANTES de qualquer coisa que possa falhar ---------
    const { data: exec } = await supabase
        .from('robo_execucoes')
        .insert({ robo: 'emissor', aplicou: aplicar, detalhe: { origem: `pg_cron:${origem}` } })
        .select('id').single()
    const execId = exec?.id ?? null

    const fechar = (campos: any) =>
        execId ? supabase.rpc('fn_fechar_execucao_robo', {
            p_id: execId,
            p_processados: campos.processados ?? 0,
            p_sucesso: campos.sucesso ?? 0,
            p_falha: campos.falha ?? 0,
            p_bloqueados: campos.bloqueados ?? 0,
            p_erro: campos.erro ?? null,
            p_detalhe: campos.detalhe ?? null,
        }) : Promise.resolve()

    const linhas: string[] = []

    try {
        const { data: fila, error } = await supabase.rpc('fn_fila_emissao_faturas', { p_limite: 200 })
        if (error) throw new Error(`fila falhou: ${error.message}`)

        const bloqueados = (fila || []).filter((i: any) => i.impedimento)
        for (const b of bloqueados) {
            linhas.push(`[bloqueado] ${b.subscriber_name} · ${mesBR(b.ciclo)} — ${b.impedimento}`)
        }

        const candidatos = escolherUmCicloPorAssinante(fila || []).slice(0, limite)

        if (!candidatos.length) {
            linhas.push('Nada a emitir.')
            await fechar({ bloqueados: bloqueados.length, detalhe: { origem, motivo: 'fila sem ciclo pronto' } })
            return new Response(JSON.stringify({ ok: true, aplicar, emitidos: 0, log: linhas }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const token = await autenticarRobo(supabase)

        let emitidos = 0
        let falhas = 0

        for (const item of candidatos) {
            const rotulo = `${item.subscriber_name} · ${mesBR(item.ciclo)}${item.retroativo ? ' (RETROATIVO)' : ''}` +
                ` · ${item.prontas} UC · ${moeda(item.total)}`

            if (Number(item.total) > teto) {
                linhas.push(`[barrado] ${rotulo} — acima do teto de ${moeda(teto)}`)
                falhas++
                continue
            }

            try {
                const soma = await reconferir(supabase, item)
                const avisos = await auditar(supabase, item)

                if (!aplicar) {
                    linhas.push(`[simulado] ${rotulo} · venc ${item.vencimento_sugerido}`)
                    for (const a of avisos) linhas.push(`           aviso: ${a}`)
                    emitidos++
                    continue
                }

                const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/create-asaas-charge`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        subscriber_id: item.subscriber_id,
                        invoice_ids: item.invoice_ids,
                        dueDate: item.vencimento_sugerido,
                    }),
                })
                const texto = await resp.text()
                let dados: any = {}
                try { dados = JSON.parse(texto) } catch (_) { dados = { raw: texto } }
                if (!resp.ok || dados.error) throw new Error(dados.error || dados.raw || `HTTP ${resp.status}`)

                linhas.push(`[emitido] ${rotulo} — ${moeda(soma)} · ${dados.payment_id || dados.id || 'ok'}`)
                for (const a of avisos) linhas.push(`          aviso: ${a}`)
                emitidos++
            } catch (e) {
                linhas.push(`[falhou] ${rotulo} — ${(e as Error).message}`)
                falhas++
            }
        }

        await fechar({
            processados: emitidos + falhas,
            sucesso: emitidos,
            falha: falhas,
            bloqueados: bloqueados.length,
            detalhe: {
                origem,
                ciclos: candidatos.map((i: any) => ({
                    assinante: i.subscriber_name,
                    ciclo: String(i.ciclo).slice(0, 7),
                    total: Number(i.total),
                })),
            },
        })

        return new Response(JSON.stringify({ ok: true, aplicar, emitidos, falhas, log: linhas }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } catch (e) {
        const msg = (e as Error).message
        await fechar({ erro: msg.slice(0, 1000), detalhe: { origem, log: linhas } })
        return new Response(JSON.stringify({ error: msg, log: linhas }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
    }
})
