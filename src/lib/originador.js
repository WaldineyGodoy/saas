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
 * A normalização do nome não é cosmética: há cadastro com espaço sobrando no
 * fim ("Bennaya Almeida "), que viraria um `%20` pendurado no parâmetro, e
 * cadastro com espaço duplo no meio ("José Claudio Gonçalo  Silva"), que
 * viraria `%20%20` na saudação da landing.
 */
export const normalizarNome = (nome) => (nome || '').trim().replace(/\s+/g, ' ');

export const buildConviteUrl = (originator) => {
    const nome = encodeURIComponent(normalizarNome(originator?.name));
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

/**
 * Vocabulário único de chave PIX.
 *
 * Havia duas listas divergentes: o cadastro público gravava `phone`/`random`
 * e o modal do CRM só conhecia `telefone`/`aleatoria`. Duas consequências,
 * as duas silenciosas:
 *   1. o `<select>` do modal ficava em branco ao abrir um originador vindo
 *      do cadastro público, e o admin salvava por cima com outro tipo;
 *   2. `transfer-asaas-pix` mapeia ALEATORIA→EVP e TELEFONE→PHONE; `random`
 *      escapava desse mapa e ia para a Asaas como "RANDOM", que não é um
 *      `pixAddressKeyType` válido — a comissão simplesmente não paga.
 *
 * Os valores aqui são os que o mapa da Asaas entende. `cnpj` existe porque
 * a coluna é `cpf_cnpj` e há parceiro PJ.
 */
export const PIX_KEY_TYPES = [
    { value: 'cpf', label: 'CPF' },
    { value: 'cnpj', label: 'CNPJ' },
    { value: 'email', label: 'E-mail' },
    { value: 'telefone', label: 'Telefone' },
    { value: 'aleatoria', label: 'Aleatória' },
];

/** Traduz os valores legados para o vocabulário acima, para que registro
 *  antigo não apareça com o select em branco. */
export const normalizarPixKeyType = (tipo) => {
    const equivalentes = { phone: 'telefone', celular: 'telefone', random: 'aleatoria', evp: 'aleatoria' };
    const t = (tipo || 'cpf').toLowerCase();
    return equivalentes[t] || t;
};

/**
 * Endereço canônico, em português — o mesmo vocabulário que
 * `fetchAddressByCep` devolve e que o modal do CRM já usava.
 *
 * O cadastro público gravava em inglês (`street`, `neighborhood`, `city`,
 * `number`, `complement`) e o modal lia em português. O modal então exibia
 * o endereço em branco e, ao salvar, gravava as chaves em português vazias
 * por cima — apagando o endereço de quem se cadastrou pelo site. Isso já
 * aconteceu em produção; por isso a leitura aceita os dois vocabulários.
 */
export const normalizarEndereco = (address) => {
    const a = address || {};
    return {
        cep: a.cep || '',
        rua: a.rua ?? a.street ?? '',
        numero: a.numero ?? a.number ?? '',
        complemento: a.complemento ?? a.complement ?? '',
        bairro: a.bairro ?? a.neighborhood ?? '',
        cidade: a.cidade ?? a.city ?? '',
        uf: a.uf || '',
    };
};
