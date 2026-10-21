import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { responder, tokenConfere, type Concessionaria, type Identificacao, type Simulacao } from './logica.ts'

/**
 * b2w-mcp — servidor MCP (Streamable HTTP, resposta em JSON) cadastrado no
 * DeskcommCRM como servidor externo. Ferramentas so de leitura:
 * b2w_concessionaria, b2w_identificar_contato e b2w_simular_assinatura (logica.ts).
 *
 * Autenticacao: Authorization: Bearer <B2W_MCP_TOKEN> (Secrets da funcao; a
 * mesma chave cadastrada no Deskcomm). Publicada com verify_jwt = false porque
 * o Bearer e o nosso, nao um JWT do Supabase.
 *
 * O banco entra por RPCs restritas a service_role
 * (migrations 20261020c_bel_recepcao.sql e 20261021a_base_agente_assinatura.sql).
 */

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
    // Sem stream de servidor (GET) nem sessao (DELETE): o transporte aceita 405.
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })

    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
    if (!tokenConfere(bearer, Deno.env.get('B2W_MCP_TOKEN'))) return json(401, { error: 'unauthorized' })

    let corpo: any
    try {
        corpo = await req.json()
    } catch {
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const deps = {
        async concessionaria(cidade: string, uf: string): Promise<Concessionaria> {
            const { data, error } = await supabase.rpc('b2w_mcp_concessionaria', { p_cidade: cidade, p_uf: uf })
            if (error) throw error
            return data as Concessionaria
        },
        async identificar(telefone: string): Promise<Identificacao> {
            const { data, error } = await supabase.rpc('b2w_mcp_identificar', { p_telefone: telefone })
            if (error) throw error
            return data as Identificacao
        },
        async simular(cidade: string, uf: string, consumoKwh: number | null, valorReais: number | null,
                      telefone: string | null): Promise<Simulacao> {
            const { data, error } = await supabase.rpc('b2w_mcp_simular_assinatura', {
                p_cidade: cidade, p_uf: uf, p_consumo_kwh: consumoKwh, p_valor_reais: valorReais, p_telefone: telefone,
            })
            if (error) throw error
            return data as Simulacao
        },
    }
    const ctx = { telefone: req.headers.get('x-deskcomm-contato-telefone') }

    if (Array.isArray(corpo)) {
        const respostas = (await Promise.all(corpo.map((p) => responder(p, ctx, deps)))).filter((r) => r !== null)
        return respostas.length ? json(200, respostas) : new Response(null, { status: 202 })
    }
    const resposta = await responder(corpo, ctx, deps)
    return resposta === null ? new Response(null, { status: 202 }) : json(200, resposta)
})
