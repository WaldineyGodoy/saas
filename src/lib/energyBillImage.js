import { supabase } from './supabase';
import { completarLeitura } from './energyBillParser';

const LADO_MAXIMO = 2000; // px; acima disso a leitura não melhora e o envio fica lento

// Reduz a foto do celular (muitas vezes 4000px+ e vários MB) para JPEG.
const reduzirFoto = (arquivo) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
        const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir a imagem.')); };
    img.src = url;
});

// Lê a foto de uma conta física. Devolve o mesmo formato de parseEnergyBill.
// ucsDoCadastro: numero_uc e/ou numero_uc_anterior da UC esperada (string ou array).
export const parseEnergyBillImage = async (arquivo, ucsDoCadastro = null) => {
    const dataUrl = await reduzirFoto(arquivo);
    const { data, error } = await supabase.functions.invoke('parse-invoice-image', {
        body: { imageBase64: dataUrl, mediaType: 'image/jpeg' },
    });

    // functions.invoke devolve o erro em `error`, não lança; a mensagem útil vem no corpo.
    if (error || !data?.ok) {
        let mensagem = data?.error;
        if (!mensagem && error?.context?.json) {
            try { mensagem = (await error.context.json()).error; } catch { /* corpo não-JSON */ }
        }
        throw new Error(mensagem || 'Falha ao ler a foto da conta.');
    }

    return completarLeitura(data.dados, ucsDoCadastro);
};
