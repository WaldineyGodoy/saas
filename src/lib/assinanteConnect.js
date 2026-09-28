/**
 * Fonte única do link de indicação do Assinante Connect.
 *
 * No Plano de Recompensas o assinante também indica: quem ele traz entra
 * como UC filha na árvore (`consumer_units.indicado_por_uc_id`) e ele passa
 * a receber 2% do nível 1 como abatimento na própria fatura. Sem link
 * atribuído não existe árvore, e sem árvore o motor de split não tem a
 * quem pagar — é o mesmo buraco que o `/convite/` do embaixador teve por
 * meses, e que custou comissão perdida.
 *
 * O módulo é puro de propósito: a mesma string é montada aqui (CRM) e na
 * Edge Function `assinante-short-url` (Deno), que encurta no YOURLS. Se as
 * duas divergirem em um byte, o mesmo assinante ganha dois links.
 */

/** A raiz é a landing da adesão. A barra final importa: sem ela o acesso
 *  depende de um 301 do servidor, uma ida e volta a mais que não precisa
 *  existir. O `Calculator` da raiz repassa a query inteira para o iframe
 *  de `crm/simulacao`, e é de lá que `indicador` chega ao lead. */
export const LANDING_RAIZ = 'https://b2wenergia.com.br/';

/**
 * Quem pode indicar: só assinante que já assinou o contrato.
 *
 * Antes disso ele nem é cliente — `ativacao` é o estado de quem preencheu
 * a adesão e ainda não assinou, e divulgar link nessa hora criaria rede
 * pendurada em contrato que pode nunca existir. `transferido` e os dois
 * `cancelado` saíram da base: a recompensa é abatimento em fatura, e eles
 * não têm mais fatura. `ativo_inadimplente` continua indicando — a dívida
 * dele se resolve na cobrança, não cortando a rede.
 */
export const STATUS_PODE_INDICAR = ['contrato_assinado', 'ativo', 'ativo_inadimplente'];

/** Só o primeiro nome vai no link, por dois motivos: a saudação da landing
 *  ("Maria reservou um presente para você") fica melhor, e o nome completo
 *  de um cliente não precisa circular em link público de WhatsApp. */
export const primeiroNome = (nome) => (nome || '').trim().replace(/\s+/g, ' ').split(' ')[0] || '';

/**
 * Link de indicação longo e canônico — é exatamente esta string que vai
 * para o YOURLS quando o encurtado ainda não existe.
 *
 * Sem `id` devolve vazio: link sem `indicador` leva o cliente para a raiz
 * e a indicação se perde em silêncio, o que é pior do que não ter link.
 */
export const buildConviteAssinanteUrl = (subscriber) => {
    if (!subscriber?.id) return '';
    const nome = encodeURIComponent(primeiroNome(subscriber.name));
    return `${LANDING_RAIZ}?indicador=${subscriber.id}&name=${nome}`;
};

/**
 * Link que se mostra, se copia e vira QR Code. Prefere o encurtado: é o que
 * o assinante divulga e é ele que conta cliques no YOURLS.
 *
 * `short_url` é gravado pelo gatilho `trg_assinante_short_url` quando o
 * status vira `contrato_assinado`, de forma assíncrona (pg_net). Entre a
 * assinatura e a volta do YOURLS a coluna fica nula por alguns instantes —
 * daí o fallback para a URL longa, que é plenamente funcional.
 */
export const buildLinkConnect = (subscriber) => {
    if (!subscriber?.id) return '';
    return subscriber.short_url || buildConviteAssinanteUrl(subscriber);
};

export const podeIndicar = (subscriber) => STATUS_PODE_INDICAR.includes(subscriber?.status);

/** Mensagem pronta para o assinante repassar. Sem link não há mensagem:
 *  texto convidando sem endereço é ruído. */
export const textoCompartilhar = (subscriber, link) => {
    if (!link) return '';
    const nome = primeiroNome(subscriber?.name);
    const abertura = nome ? `Oi! Aqui é ${nome}.` : 'Oi!';
    return `${abertura} Eu economizo na conta de luz com a B2W Energia, sem obra e sem instalar nada. `
        + `Faça sua simulação e assine pelo meu link: ${link}`;
};

export const urlWhatsappCompartilhar = (texto) => (texto ? `https://wa.me/?text=${encodeURIComponent(texto)}` : '');

/** Nome do arquivo que o navegador salva ao baixar o QR. Sem acento e sem
 *  espaço porque isso já chegou ao Windows como `qrcode-connect-inA?s.png`. */
export const nomeArquivoQr = (subscriber) => {
    const slug = primeiroNome(subscriber?.name)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    return `qrcode-connect-${slug || (subscriber?.id || '').slice(0, 8)}.png`;
};
