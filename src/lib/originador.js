/**
 * Fonte única do link de indicação do originador.
 *
 * Existiam três construções paralelas dessa mesma string — OriginatorList,
 * OriginatorModal e OriginatorDashboard — e as três divergiam:
 *   - a lista apontava para `/clientes`, rota que não existe (404) e ainda
 *     por cima não mandava o nome;
 *   - o modal montava `/convite` sem a barra final;
 *   - só o dashboard montava a URL correta.
 *
 * Quem consome o link é a landing estática `/convite/` na Hostinger, que
 * embute o iframe de `crm.b2wenergia.com.br/simulacao` repassando os dois
 * parâmetros. Lá dentro o LeadCaptureForm usa:
 *   `id`   → vira leads.originator_id (validado como UUID antes de gravar)
 *   `name` → só a saudação ("Fulana reservou um presente para você")
 * Sem `id` o lead nasce sem atribuição e a comissão do originador se perde.
 */

/** A landing é servida como diretório: sem a barra final o acesso depende
 *  de um 301 do servidor, que é uma ida e volta a mais e um ponto de falha
 *  que não precisa existir. */
const LANDING_CONVITE = 'https://b2wenergia.com.br/convite/';

/**
 * Link de convite longo e canônico — é exatamente esta string que vai para
 * o YOURLS quando o link encurtado ainda não existe.
 *
 * Espelha `montarLinkConvite` da Edge Function `originador-short-url`: são
 * runtimes diferentes (browser e Deno), então a duplicação é inevitável —
 * mas as duas precisam produzir byte a byte a mesma URL, senão o mesmo
 * originador ganha dois links distintos conforme quem gerou.
 *
 * O `.trim()` no nome não é cosmético: há originador cadastrado com espaço
 * sobrando no fim ("Bennaya Almeida "), que sem isso vira um `%20` pendurado
 * no parâmetro.
 */
export const buildConviteUrl = (originator) => {
    const nome = encodeURIComponent((originator?.name || '').trim());
    return `${LANDING_CONVITE}?name=${nome}&id=${originator?.id}`;
};

/**
 * Link que se mostra e se copia. Prefere o encurtado quando existe: é o que
 * o originador divulga, e é ele que contabiliza os cliques no YOURLS.
 *
 * `short_url` é gerado pelo gatilho `trg_originador_short_url` no INSERT, de
 * forma assíncrona (pg_net). Entre o cadastro e a volta do YOURLS a coluna
 * fica nula por alguns instantes — daí o fallback para a URL longa, que é
 * plenamente funcional e não deixa a tela sem link nesse intervalo.
 */
export const buildReferralUrl = (originator) => {
    if (originator?.short_url) return originator.short_url;
    return buildConviteUrl(originator);
};
