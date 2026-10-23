/**
 * Regras do assistente público de adesão (`/contrato`).
 *
 * As mesmas regras valem no servidor (RPC `fn_criar_assinante_publico`,
 * Edge Functions `onboarding-documentos` e `onboarding-finalizar`); aqui
 * elas só existem para o cliente errar antes de gastar uma chamada.
 */

export const VERSAO_TERMOS = '3.0';
export const DIAS_VENCIMENTO = [5, 10, 15, 20];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOuNulo = (v) => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null);

export function documentosObrigatorios({ cpf_cnpj, ucs }) {
    const pj = (cpf_cnpj || '').replace(/\D/g, '').length === 14;
    return [
        { tipo: 'identidade', consumer_unit_id: null, rotulo: pj ? 'CNH ou RG do representante legal' : 'CNH ou RG do titular' },
        ...(pj ? [{ tipo: 'contrato_social', consumer_unit_id: null, rotulo: 'Contrato social' }] : []),
        ...ucs.map(uc => ({ tipo: 'conta_energia', consumer_unit_id: uc.id, rotulo: `Conta de energia da UC ${uc.numero_uc}` })),
    ];
}

/** Mesmos limites de `supabase/functions/_shared/onboarding-regras.ts`. */
export const TIPOS_ARQUIVO = ['application/pdf', 'image/jpeg', 'image/png'];
export const LIMITE_BYTES = 10 * 1024 * 1024;

/** Mensagem em português para um arquivo recusado, ou null se ele serve. */
export function validarArquivo(file) {
    if (!file) return 'Selecione um arquivo.';
    if (!TIPOS_ARQUIVO.includes(file.type)) return 'Envie o documento em PDF, JPG ou PNG.';
    if (!(file.size > 0) || file.size > LIMITE_BYTES) return 'O arquivo deve ter até 10 MB.';
    return null;
}

/**
 * Lê o corpo de erro de `supabase.functions.invoke`.
 *
 * Em resposta não-2xx o supabase-js devolve só "Edge Function returned a
 * non-2xx status code"; a mensagem em português e o status estão na
 * `Response` guardada em `error.context`.
 */
export async function lerErroFuncao(error) {
    const status = error?.context?.status ?? null;
    let corpo = null;
    try {
        if (typeof error?.context?.json === 'function') corpo = await error.context.json();
    } catch {
        corpo = null;
    }
    return { status, corpo, mensagem: corpo?.error || error?.message || 'Falha inesperada.' };
}

const EXTENSOES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Extensão a partir do mime, e não do nome do arquivo: o nome é digitado
 *  por quem envia, o mime é o que o Storage confere contra o bucket. Mesmo
 *  mapa de `supabase/functions/_shared/onboarding-regras.ts`. */
export const extensaoDoMime = (mime) => EXTENSOES[mime];

/** `<assinante>/<tipo>/<id>.<ext>` — o mesmo caminho que o envio público
 *  grava, para o CRM e o assistente não produzirem dois formatos. */
export const caminhoDocumento = (subscriberId, tipo, id, mime) =>
    `${subscriberId}/${tipo}/${id}.${extensaoDoMime(mime)}`;

/**
 * O que a tela do CRM mostra para cada documento obrigatório: já chegou ou
 * não, e quantos arquivos existem (reenvio soma, não substitui — o histórico
 * de quem trocou o documento fica no Storage).
 *
 * A conta de energia só conta para a UC dela: a de uma UC não cobre a outra,
 * e é essa confusão que deixava o assinante "completo" com uma UC sem conta.
 */
export function situacaoDocumentos({ cpf_cnpj, ucs, docs }) {
    return documentosObrigatorios({ cpf_cnpj, ucs: ucs || [] }).map((item) => {
        const quantidade = (docs || []).filter(
            (d) => d.tipo === item.tipo && (d.consumer_unit_id || null) === item.consumer_unit_id
        ).length;
        return { ...item, quantidade, enviado: quantidade > 0 };
    });
}
