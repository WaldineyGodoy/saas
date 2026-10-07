import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.0"

/**
 * Papéis autorizados a mover dinheiro.
 *
 * Deliberadamente mais estrito que `public.check_user_is_admin` do banco, que
 * também aceita 'manager'. Nenhum usuário tem papel 'manager' hoje; conceder a
 * um papel inexistente é abrir porta para um cadastro futuro que ninguém vai
 * revisar.
 */
const ADMIN_ROLES = ['admin', 'super_admin']

export type AuthResult =
    | { ok: true; userId: string; role: string }
    | { ok: false; status: 401 | 403; error: string }

async function resolveUser(req: Request, supabase: SupabaseClient) {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
        return { user: null, failure: { ok: false as const, status: 401 as const, error: 'Autenticação obrigatória.' } }
    }

    const token = authHeader.replace('Bearer ', '').trim()
    const { data: { user }, error } = await supabase.auth.getUser(token)

    // A chave anon cai exatamente aqui: é um JWT assinado, mas não tem usuário.
    if (error || !user) {
        return { user: null, failure: { ok: false as const, status: 401 as const, error: 'Sessão inválida ou expirada.' } }
    }

    return { user, failure: null }
}

/**
 * Portão de identidade das funções financeiras.
 *
 * Precisa existir DENTRO da função, não só como `verify_jwt = true` no
 * config.toml: a chave `anon` do projeto é um JWT válido e assinado, viaja no
 * bundle público do front, e passa pelo gateway do Supabase sem obstáculo.
 * `verify_jwt` prova que o chamador tem *uma* chave do projeto — que é pública.
 * Só `auth.getUser(token)` prova que existe um usuário logado por trás.
 *
 * O client passado precisa ser o de SERVICE_ROLE, para que a leitura de
 * `profiles` não esbarre no RLS.
 */
export async function requireAdmin(req: Request, supabase: SupabaseClient): Promise<AuthResult> {
    const { user, failure } = await resolveUser(req, supabase)
    if (failure) return failure

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user!.id)
        .single()

    if (!profile || !ADMIN_ROLES.includes(profile.role)) {
        return { ok: false, status: 403, error: 'Sem permissão para operações financeiras.' }
    }

    return { ok: true, userId: user!.id, role: profile.role }
}

/**
 * Portão para endpoints que um usuário comum precisa chamar (ex.: recarga do
 * próprio saldo). Exige sessão real, não exige papel administrativo.
 *
 * Quem usa isto tem obrigação extra: derivar do `userId` retornado tudo o que
 * identifica o dono da operação. Aceitar um `user_id` do corpo depois de ter
 * autenticado o chamador é pior que não autenticar, porque parece seguro.
 */
export async function requireUser(req: Request, supabase: SupabaseClient): Promise<AuthResult> {
    const { user, failure } = await resolveUser(req, supabase)
    if (failure) return failure

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user!.id)
        .single()

    return { ok: true, userId: user!.id, role: profile?.role ?? 'unknown' }
}

/** Mesmos papeis de public.fn_papel_interno: a equipe que opera o CRM. */
const PAPEIS_INTERNOS = ['super_admin', 'admin', 'manager', 'coordinator']

/**
 * Portao para funcoes que so a equipe (CRM) ou outra Edge Function chamam.
 *
 * Outra Edge Function chega com a chave de servidor no Authorization (o
 * supabase-js de service_role manda ela como Bearer). Usuario logado precisa
 * de papel interno: assinante, fornecedor e originador nao passam.
 */
export async function requireInternoOuServidor(req: Request, supabase: SupabaseClient): Promise<AuthResult> {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    const chaveServidor = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (token && chaveServidor && token === chaveServidor) {
        return { ok: true, userId: 'service_role', role: 'service_role' }
    }

    const { user, failure } = await resolveUser(req, supabase)
    if (failure) return failure

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user!.id)
        .single()

    if (!profile || !PAPEIS_INTERNOS.includes(profile.role)) {
        return { ok: false, status: 403, error: 'Sem permissão para gerar documentos de assinatura.' }
    }

    return { ok: true, userId: user!.id, role: profile.role }
}
