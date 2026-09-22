import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { documentosObrigatorios, lerErroFuncao, validarArquivo } from '../../../lib/onboarding';
import { CheckCircle, FileText, Upload, ArrowRight } from 'lucide-react';

/** Chave de um documento: o tipo, mais a UC quando é conta de energia. */
const chave = (d) => `${d.tipo}:${d.consumer_unit_id || ''}`;

/**
 * Passo 2 da adesão: envio dos documentos obrigatórios.
 *
 * O arquivo sobe direto para o Storage por URL assinada — a Edge Function
 * `onboarding-documentos` só emite a URL (depois de conferir o token) e
 * registra o que chegou. Quem decide o que falta é o servidor: a lista
 * `faltantes` que ele devolve substitui a local a cada envio.
 */
export default function PassoDocumentos({ token, estado, onCompleto }) {
    const [faltantes, setFaltantes] = useState(estado?.faltantes || []);
    const [enviando, setEnviando] = useState(null);
    const [erros, setErros] = useState({});

    // O estado é recarregado de fora (ex.: o finalizar devolveu 409).
    useEffect(() => { setFaltantes(estado?.faltantes || []); }, [estado]);

    const itens = documentosObrigatorios({
        cpf_cnpj: estado?.subscriber?.cpf_cnpj,
        ucs: estado?.ucs || []
    });
    const pendentes = new Set(faltantes.map(chave));

    const enviar = async (item, file) => {
        const k = chave(item);
        setErros(prev => ({ ...prev, [k]: null }));

        const invalido = validarArquivo(file);
        if (invalido) {
            setErros(prev => ({ ...prev, [k]: invalido }));
            return;
        }

        setEnviando(k);
        try {
            const { data: u, error: e1 } = await supabase.functions.invoke('onboarding-documentos',
                { body: { acao: 'url', token, tipo: item.tipo, consumer_unit_id: item.consumer_unit_id, mime: file.type, tamanho: file.size } });
            if (e1) throw new Error((await lerErroFuncao(e1)).mensagem);
            if (u?.error) throw new Error(u.error);

            const { error: e2 } = await supabase.storage.from('documentos-assinante')
                .uploadToSignedUrl(u.path, u.token_upload, file, { contentType: file.type });
            if (e2) throw new Error('Não foi possível enviar o arquivo. Tente de novo.');

            const { data: r, error: e3 } = await supabase.functions.invoke('onboarding-documentos',
                { body: { acao: 'registrar', token, tipo: item.tipo, consumer_unit_id: item.consumer_unit_id, path: u.path, mime: file.type, tamanho: file.size } });
            if (e3) throw new Error((await lerErroFuncao(e3)).mensagem);
            if (r?.error) throw new Error(r.error);

            const novos = r?.faltantes || [];
            setFaltantes(novos);
            if (novos.length === 0) onCompleto();
        } catch (e) {
            console.error('Falha no envio do documento:', e);
            setErros(prev => ({ ...prev, [k]: e.message || 'Falha ao enviar o documento.' }));
        } finally {
            setEnviando(null);
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 md:p-10">
            <h2 className="text-2xl font-bold mb-2 flex items-center gap-2" style={{ color: '#003366' }}>
                <div className="w-1 h-8 bg-[#FF6600] rounded-full"></div>
                Documentos
            </h2>
            <p className="text-slate-500 mb-8">
                Envie uma foto legível ou PDF de cada documento (PDF, JPG ou PNG, até 10 MB).
            </p>

            <div className="space-y-4">
                {itens.map(item => {
                    const k = chave(item);
                    const enviado = !pendentes.has(k);
                    const ocupado = enviando === k;
                    return (
                        <div key={k} className={`p-4 rounded-xl border ${enviado ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    {enviado
                                        ? <CheckCircle size={22} className="text-green-600 shrink-0" />
                                        : <FileText size={22} className="text-slate-400 shrink-0" />}
                                    <div className="min-w-0">
                                        <p className="font-bold text-slate-800">{item.rotulo}</p>
                                        <p className="text-sm text-slate-500">{enviado ? 'Recebido' : 'Pendente'}</p>
                                    </div>
                                </div>
                                <label
                                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold border transition-colors ${ocupado || enviando ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-orange-50'} border-[#FF6600] text-[#FF6600] bg-white`}
                                >
                                    <Upload size={18} />
                                    {ocupado ? 'Enviando...' : (enviado ? 'Trocar arquivo' : 'Escolher arquivo')}
                                    <input
                                        type="file"
                                        accept="application/pdf,image/jpeg,image/png"
                                        className="hidden"
                                        disabled={!!enviando}
                                        onChange={e => {
                                            const file = e.target.files?.[0];
                                            // Limpa para permitir escolher o mesmo arquivo de novo.
                                            e.target.value = '';
                                            if (file) enviar(item, file);
                                        }}
                                    />
                                </label>
                            </div>
                            {erros[k] && <p className="text-sm text-red-600 mt-2">{erros[k]}</p>}
                        </div>
                    );
                })}
            </div>

            <button
                onClick={onCompleto}
                disabled={faltantes.length > 0 || !!enviando}
                className="w-full mt-8 py-4 text-lg font-bold text-white uppercase tracking-wider rounded-xl shadow-xl flex justify-center items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#FF6600' }}
            >
                Continuar <ArrowRight size={22} />
            </button>
            {faltantes.length > 0 && (
                <p className="text-center text-sm text-slate-500 mt-3">
                    Falta{faltantes.length > 1 ? 'm' : ''} {faltantes.length} documento{faltantes.length > 1 ? 's' : ''} para continuar.
                </p>
            )}
        </div>
    );
}
