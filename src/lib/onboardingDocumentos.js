import { supabase } from './supabase';
import { lerErroFuncao } from './onboarding';

/**
 * Envia um documento da adesão pública: URL assinada de upload, envio direto
 * ao Storage e registro (Edge Function onboarding-documentos). Devolve os
 * documentos que ainda faltam. Usado no passo Documentos e no anexo
 * automático da conta de luz lida na criação da UC.
 */
export async function enviarDocumentoOnboarding({ token, tipo, consumerUnitId = null, file }) {
    const base = { token, tipo, consumer_unit_id: consumerUnitId, mime: file.type, tamanho: file.size };

    const { data: u, error: e1 } = await supabase.functions.invoke('onboarding-documentos', { body: { ...base, acao: 'url' } });
    if (e1) throw new Error((await lerErroFuncao(e1)).mensagem);
    if (u?.error) throw new Error(u.error);

    const { error: e2 } = await supabase.storage.from('documentos-assinante')
        .uploadToSignedUrl(u.path, u.token_upload, file, { contentType: file.type });
    if (e2) throw new Error('Não foi possível enviar o arquivo. Tente de novo.');

    const { data: r, error: e3 } = await supabase.functions.invoke('onboarding-documentos', { body: { ...base, acao: 'registrar', path: u.path } });
    if (e3) throw new Error((await lerErroFuncao(e3)).mensagem);
    if (r?.error) throw new Error(r.error);
    return r?.faltantes || [];
}
