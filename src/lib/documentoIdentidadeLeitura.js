/**
 * Chamada de rede da leitura de documento de identificação. As regras de
 * preenchimento estão em `documentoIdentidade.js` (sem Supabase, testáveis).
 */
import { supabase } from './supabase';
import { reduzirFoto } from './energyBillImage';
import { lerErroFuncao } from './onboarding';

const lerComoBase64 = (arquivo) => new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(new Error('Não foi possível abrir o arquivo.'));
    leitor.readAsDataURL(arquivo);
});

/**
 * Envia a foto ou o PDF do documento para leitura e devolve
 * `{ tipoDocumento, nome, cpf, cpfLido, nascimento, observacoes }`.
 * Foto é reduzida antes (celular manda 4000px+ e vários MB).
 */
export async function lerDocumentoIdentidade(arquivo) {
    const ehPdf = arquivo.type === 'application/pdf';
    const imageBase64 = ehPdf ? await lerComoBase64(arquivo) : await reduzirFoto(arquivo);
    const { data, error } = await supabase.functions.invoke('ler-documento-identidade', {
        body: { imageBase64, mediaType: ehPdf ? 'application/pdf' : 'image/jpeg' },
    });
    // functions.invoke devolve o erro em `error`, nao lanca; a mensagem util vem no corpo.
    if (error || !data?.ok) {
        let mensagem = data?.error;
        if (!mensagem && error) mensagem = (await lerErroFuncao(error))?.mensagem;
        throw new Error(mensagem || 'Falha ao ler o documento.');
    }
    return data.dados;
}
