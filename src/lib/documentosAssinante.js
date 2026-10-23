import { caminhoDocumento, validarArquivo } from './onboarding';

const BUCKET = 'documentos-assinante';

/**
 * Anexa um documento a um assinante: sobe o arquivo para o Storage e grava a
 * linha em `subscriber_documents`.
 *
 * Uma só função para os dois lugares que anexam pelo CRM — a aba Documentos do
 * assinante e o cadastro de UC nova pela conta lida — para não haver dois
 * caminhos com regras que divergem.
 *
 * A ordem é de propósito: o arquivo primeiro, a linha depois. Linha sem
 * arquivo aparece como "recebido" e engana; arquivo sem linha só fica órfão no
 * bucket, e o documento continua pendente até alguém tentar de novo.
 *
 * Quem pode gravar é decidido pelo banco (`documentos_assinante_interno_escrita`
 * e `subscriber_documents_interno`: admin, super_admin, manager). O erro dele
 * sobe como está, para a tela mostrar o motivo real.
 *
 * Devolve o caminho gravado; lança em qualquer falha.
 */
export async function anexarDocumentoAssinante(supabase, { subscriberId, tipo, consumerUnitId = null, file }) {
    if (!subscriberId) throw new Error('Não há assinante para anexar o documento.');

    const invalido = validarArquivo(file);
    if (invalido) throw new Error(invalido);

    const path = caminhoDocumento(subscriberId, tipo, crypto.randomUUID(), file.type);

    const { error: erroUpload } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
    if (erroUpload) throw erroUpload;

    const { error: erroLinha } = await supabase.from('subscriber_documents').insert({
        subscriber_id: subscriberId,
        consumer_unit_id: consumerUnitId,
        tipo,
        storage_path: path,
        mime: file.type,
        tamanho: file.size,
    });
    if (erroLinha) throw erroLinha;

    return path;
}
