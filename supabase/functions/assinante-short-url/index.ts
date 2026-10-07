import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

/**
 * Gera e grava o link de indicação encurtado do Assinante Conect.
 *
 * Gêmea de `originador-short-url`, para o outro lado da rede: no Plano de
 * Recompensas o assinante também indica e recebe 2% do nível 1 como
 * abatimento na própria fatura. Quem chama é o gatilho
 * `trg_assinante_short_url`, quando o contrato passa a assinado.
 *
 * Chamadas aceitas:
 *   { "subscriber_id": "<uuid>" }  → um assinante
 *   { "all_missing": true }        → todos os elegíveis sem short_url
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** A raiz é a landing da adesão. A barra final importa: sem ela o acesso
 *  depende de um 301 do servidor. O `Calculator` da raiz repassa a query
 *  inteira ao iframe de `crm/simulacao`, e é de lá que `indicador` chega
 *  ao lead. */
const LANDING_RAIZ = 'https://b2wenergia.com.br/';

/** Só assinante com contrato assinado indica. Espelha STATUS_PODE_INDICAR
 *  de `src/lib/assinanteConect.js` e a lista do gatilho. */
const STATUS_PODE_INDICAR = ['contrato_assinado', 'ativo', 'ativo_inadimplente'];

/** Espelho de `primeiroNome` em src/lib/assinanteConect.js. Só o primeiro
 *  nome vai no link: a saudação da landing fica melhor e o nome completo de
 *  um cliente não precisa circular em link público de WhatsApp. */
const primeiroNome = (nome?: string | null) =>
    (nome || '').trim().replace(/\s+/g, ' ').split(' ')[0] || '';

/**
 * Monta o link de indicação longo — é esta string que vai para o YOURLS.
 *
 * Precisa produzir byte a byte a mesma URL que `buildConviteAssinanteUrl`
 * do front, senão o mesmo assinante ganha dois links diferentes conforme
 * quem gerou (o gatilho do banco ou a tela).
 */
export const montarLinkIndicacao = (s: { id: string; name?: string | null }) =>
    `${LANDING_RAIZ}?indicador=${s.id}&name=${encodeURIComponent(primeiroNome(s.name))}`;

/**
 * Palavra-chave legível para o YOURLS: primeiro nome + `c` + 4 chars do id.
 *
 * O `c` (de Conect) separa o espaço de nomes do link do embaixador: sem ele,
 * um assinante e um embaixador com o mesmo primeiro nome e o mesmo prefixo
 * de id disputariam a mesma keyword — e o YOURLS entregaria o link de um
 * para o outro, mandando a comissão para a pessoa errada.
 */
export const montarKeyword = (s: { id: string; name?: string | null }) => {
    const nome = primeiroNome(s.name)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    const sufixo = s.id.slice(0, 4);
    return nome ? `${nome}-c${sufixo}` : `conect-${s.id.slice(0, 8)}`;
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
        const { subscriber_id, all_missing } = await req.json().catch(() => ({}));

        let query = supabaseAdmin.from('subscribers').select('id, name, status, short_url');

        if (subscriber_id) {
            query = query.eq('id', subscriber_id);
        } else if (all_missing) {
            query = query.is('short_url', null).in('status', STATUS_PODE_INDICAR);
        } else {
            throw new Error('Informe subscriber_id ou all_missing.');
        }

        const { data: assinantes, error } = await query;
        if (error) throw error;

        const resultados: unknown[] = [];

        for (const s of assinantes || []) {
            // Idempotente: quem já tem link não é reencurtado, senão cada
            // chamada criaria uma keyword nova para o mesmo destino.
            if (s.short_url) {
                resultados.push({ id: s.id, name: s.name, short_url: s.short_url, acao: 'ja_tinha' });
                continue;
            }

            // O gatilho já filtra, mas a função também é chamada à mão: link
            // para quem não assinou pendura rede em contrato inexistente.
            if (!STATUS_PODE_INDICAR.includes(s.status)) {
                resultados.push({ id: s.id, name: s.name, status: s.status, acao: 'nao_elegivel' });
                continue;
            }

            const linkLongo = montarLinkIndicacao(s);

            try {
                const { data: curto, error: erroCurto } = await supabaseAdmin.functions.invoke(
                    'yourls-shorten',
                    {
                        body: {
                            url: linkLongo,
                            keyword: montarKeyword(s),
                            title: `Indicacao Conect - ${(s.name || '').trim()}`
                        }
                    }
                );

                if (erroCurto) throw erroCurto;
                if (!curto?.success || !curto.shortUrl) {
                    throw new Error(curto?.error || 'YOURLS nao devolveu shortUrl.');
                }

                const { error: erroUpdate } = await supabaseAdmin
                    .from('subscribers')
                    .update({ short_url: curto.shortUrl })
                    .eq('id', s.id);

                if (erroUpdate) throw erroUpdate;

                resultados.push({ id: s.id, name: s.name, short_url: curto.shortUrl, acao: 'criado' });
            } catch (e) {
                // Um assinante que falha não pode derrubar o lote. E o front
                // cai na URL longa enquanto o curto não existir, então a
                // indicação continua funcionando.
                resultados.push({ id: s.id, name: s.name, erro: (e as Error).message, acao: 'falhou' });
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
        console.error('assinante-short-url:', error);
        return new Response(JSON.stringify({ error: (error as Error).message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });
    }
})
