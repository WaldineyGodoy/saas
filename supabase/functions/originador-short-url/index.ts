import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

/**
 * Gera e grava o link de indicação encurtado do originador.
 *
 * O link longo é montado a partir do nome e do id; o encurtamento vai
 * para o YOURLS pela função `yourls-shorten`, que já guarda a chave da
 * API do lado do servidor.
 *
 * Existe porque `short_url` só era gerado quando o próprio originador
 * abria o dashboard dele — e o dashboard estava quebrado. Resultado: os
 * 8 originadores cadastrados tinham `short_url` nulo, e cada tela do CRM
 * montava o link longo do seu jeito.
 *
 * Chamadas aceitas:
 *   { "originator_id": "<uuid>" }  → um originador
 *   { "all_missing": true }        → todos sem short_url (backfill)
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LANDING_CONVITE = 'https://b2wenergia.com.br/convite/';

/** Espelho de `normalizarNome` em src/lib/originador.js. Tira espaço das
 *  pontas e colapsa espaço repetido no meio: há cadastro com sobra no fim
 *  ("Bennaya Almeida ") e com espaço duplo no meio ("José Claudio Gonçalo
 *  Silva"), que virariam `%20` e `%20%20` na saudação da landing. */
const normalizarNome = (nome?: string | null) => (nome || '').trim().replace(/\s+/g, ' ');

/** Monta o link de indicação longo. A barra final importa: sem ela a
 *  landing depende de um redirect do servidor.
 *
 *  Precisa produzir byte a byte a mesma URL que `buildConviteUrl` do front
 *  — senão o mesmo originador ganha dois links diferentes conforme quem
 *  gerou (o gatilho do banco ou o dashboard). */
export const montarLinkConvite = (originator: { id: string; name?: string | null }) => {
    const nome = encodeURIComponent(normalizarNome(originator.name));
    return `${LANDING_CONVITE}?name=${nome}&id=${originator.id}`;
};

/** Palavra-chave legível para o YOURLS: primeiro nome + 4 chars do id.
 *  O sufixo evita colisão entre homônimos sem tornar o link ilegível. */
const montarKeyword = (originator: { id: string; name?: string | null }) => {
    const primeiroNome = (originator.name || '')
        .trim()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')   // tira acentos
        .toLowerCase()
        .split(/\s+/)[0]
        .replace(/[^a-z0-9]/g, '');

    const sufixo = originator.id.slice(0, 4);
    return primeiroNome ? `${primeiroNome}-${sufixo}` : `ref-${originator.id.slice(0, 8)}`;
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    try {
        const { originator_id, all_missing } = await req.json().catch(() => ({}));

        let query = supabaseAdmin.from('originators_v2').select('id, name, short_url');

        if (originator_id) {
            query = query.eq('id', originator_id);
        } else if (all_missing) {
            query = query.is('short_url', null);
        } else {
            throw new Error('Informe originator_id ou all_missing.');
        }

        const { data: originadores, error } = await query;
        if (error) throw error;

        const resultados: unknown[] = [];

        for (const o of originadores || []) {
            // Idempotente: quem já tem link não é reencurtado, senão cada
            // chamada criaria uma keyword nova para o mesmo destino.
            if (o.short_url) {
                resultados.push({ id: o.id, name: o.name, short_url: o.short_url, acao: 'ja_tinha' });
                continue;
            }

            const linkLongo = montarLinkConvite(o);

            try {
                const { data: curto, error: erroCurto } = await supabaseAdmin.functions.invoke(
                    'yourls-shorten',
                    {
                        body: {
                            url: linkLongo,
                            keyword: montarKeyword(o),
                            title: `Indicação - ${(o.name || '').trim()}`
                        }
                    }
                );

                if (erroCurto) throw erroCurto;
                if (!curto?.success || !curto.shortUrl) {
                    throw new Error(curto?.error || 'YOURLS não devolveu shortUrl.');
                }

                const { error: erroUpdate } = await supabaseAdmin
                    .from('originators_v2')
                    .update({ short_url: curto.shortUrl })
                    .eq('id', o.id);

                if (erroUpdate) throw erroUpdate;

                resultados.push({ id: o.id, name: o.name, short_url: curto.shortUrl, acao: 'criado' });
            } catch (e) {
                // Um originador que falha não pode derrubar o lote.
                resultados.push({ id: o.id, name: o.name, erro: (e as Error).message, acao: 'falhou' });
            }
        }

        return new Response(JSON.stringify({
            success: true,
            processados: resultados.length,
            criados: resultados.filter((r: any) => r.acao === 'criado').length,
            falhas: resultados.filter((r: any) => r.acao === 'falhou').length,
            resultados
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('originador-short-url:', error);
        return new Response(JSON.stringify({ error: (error as Error).message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });
    }
})
