import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, FileText, Upload } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { caminhoDocumento, situacaoDocumentos, validarArquivo } from '../../lib/onboarding';

const ROTULO = { identidade: 'Identidade (CNH/RG)', conta_energia: 'Conta de energia', contrato_social: 'Contrato social' };

/** Chave de um documento obrigatório: o tipo, mais a UC quando é conta de energia. */
const chave = (d) => `${d.tipo}:${d.consumer_unit_id || ''}`;

/**
 * Documentos do assinante no modal do CRM: o que é obrigatório, o que já
 * chegou, e o envio pelo time interno.
 *
 * O arquivo sobe direto para o Storage com a sessão de quem está logado
 * (política `documentos_assinante_interno_escrita`, migração 20261023a) e só
 * depois a linha é gravada em `subscriber_documents`. Nessa ordem de
 * propósito: linha sem arquivo aparece como "recebido" e engana; arquivo sem
 * linha só fica órfão no bucket, e o assinante continua "pendente" até alguém
 * tentar de novo.
 *
 * O envio público (`/contrato`) segue por URL assinada e não passa por aqui.
 */
export default function DocumentosAssinante({ subscriberId, cpfCnpj, ucs = [], podeEnviar = false }) {
    const [docs, setDocs] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState('');
    const [openErro, setOpenErro] = useState('');
    const [fallbackLinks, setFallbackLinks] = useState({});
    const [enviando, setEnviando] = useState(null);
    const [errosEnvio, setErrosEnvio] = useState({});

    const carregar = useCallback(async () => {
        if (!subscriberId) return;
        const { data, error } = await supabase.from('subscriber_documents')
            .select('id, tipo, consumer_unit_id, storage_path, mime, tamanho, criado_em, consumer_units(numero_uc)')
            .eq('subscriber_id', subscriberId).order('criado_em');
        if (error) setErro(error.message);
        else { setErro(''); setDocs(data || []); }
        setCarregando(false);
    }, [subscriberId]);

    useEffect(() => { carregar(); }, [carregar]);

    const abrir = async (doc) => {
        setOpenErro('');
        // Abre a janela de forma sincrona (dentro do handler de clique) para nao ser bloqueada
        // por bloqueadores de pop-up; o destino e definido depois que a URL assinada chega.
        const w = window.open('', '_blank');
        if (w) w.opener = null;
        try {
            const { data, error } = await supabase.storage.from('documentos-assinante').createSignedUrl(doc.storage_path, 300);
            if (error) {
                if (w) w.close();
                setOpenErro(error.message);
                return;
            }
            if (w) {
                w.location.href = data.signedUrl;
            } else {
                // Pop-up bloqueado: oferece um link visivel em vez da janela.
                setFallbackLinks(prev => ({ ...prev, [doc.id]: data.signedUrl }));
            }
        } catch (e) {
            if (w) w.close();
            setOpenErro(e?.message || String(e));
        }
    };

    const enviar = async (item, file) => {
        const k = chave(item);
        setErrosEnvio(prev => ({ ...prev, [k]: null }));

        const invalido = validarArquivo(file);
        if (invalido) {
            setErrosEnvio(prev => ({ ...prev, [k]: invalido }));
            return;
        }

        setEnviando(k);
        try {
            const path = caminhoDocumento(subscriberId, item.tipo, crypto.randomUUID(), file.type);
            const { error: erroUpload } = await supabase.storage
                .from('documentos-assinante')
                .upload(path, file, { contentType: file.type, upsert: false });
            if (erroUpload) throw erroUpload;

            const { error: erroLinha } = await supabase.from('subscriber_documents').insert({
                subscriber_id: subscriberId,
                consumer_unit_id: item.consumer_unit_id,
                tipo: item.tipo,
                storage_path: path,
                mime: file.type,
                tamanho: file.size,
            });
            if (erroLinha) throw erroLinha;

            await carregar();
        } catch (e) {
            console.error('Falha no envio do documento:', e);
            setErrosEnvio(prev => ({ ...prev, [k]: e?.message || 'Falha ao enviar o documento.' }));
        } finally {
            setEnviando(null);
        }
    };

    if (erro) return <p style={{ color: '#b91c1c' }}>{erro}</p>;
    if (carregando) return <p style={{ color: '#64748b' }}>Carregando documentos...</p>;

    const itens = situacaoDocumentos({ cpf_cnpj: cpfCnpj, ucs, docs });
    const pendentes = itens.filter(i => !i.enviado).length;

    return (
        <div>
            {/* Obrigatorios: o que falta para o contrato poder sair. */}
            <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '1.25rem' }}>
                {itens.map(item => {
                    const k = chave(item);
                    const ocupado = enviando === k;
                    return (
                        <div
                            key={k}
                            style={{
                                padding: '0.7rem 0.9rem', borderRadius: '10px', border: '1px solid',
                                borderColor: item.enviado ? '#bbf7d0' : '#e2e8f0',
                                background: item.enviado ? '#f0fdf4' : '#f8fafc',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                                    {item.enviado
                                        ? <CheckCircle size={20} color="#16a34a" style={{ flexShrink: 0 }} />
                                        : <FileText size={20} color="#94a3b8" style={{ flexShrink: 0 }} />}
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>{item.rotulo}</div>
                                        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                            {item.enviado
                                                ? `Recebido${item.quantidade > 1 ? ` (${item.quantidade} arquivos)` : ''}`
                                                : 'Pendente'}
                                        </div>
                                    </div>
                                </div>
                                {podeEnviar && (
                                    <label
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.8rem',
                                            borderRadius: '8px', border: '1px solid #8b5cf6', background: 'white', color: '#7c3aed',
                                            fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap',
                                            cursor: enviando ? 'wait' : 'pointer', opacity: enviando && !ocupado ? 0.6 : 1,
                                        }}
                                    >
                                        <Upload size={15} />
                                        {ocupado ? 'Enviando...' : (item.enviado ? 'Enviar outro arquivo' : 'Escolher arquivo')}
                                        <input
                                            type="file"
                                            accept="application/pdf,image/jpeg,image/png"
                                            style={{ display: 'none' }}
                                            disabled={!!enviando}
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                // Limpa para permitir escolher o mesmo arquivo de novo.
                                                e.target.value = '';
                                                if (file) enviar(item, file);
                                            }}
                                        />
                                    </label>
                                )}
                            </div>
                            {errosEnvio[k] && <p style={{ margin: '0.5rem 0 0', color: '#b91c1c', fontSize: '0.82rem' }}>{errosEnvio[k]}</p>}
                        </div>
                    );
                })}
            </div>

            {ucs.length === 0 && (
                <p style={{ margin: '0 0 1rem', color: '#92400e', fontSize: '0.82rem' }}>
                    Cadastre as unidades consumidoras na aba <strong>Unidades Consumidoras</strong> para anexar a conta de energia de cada uma.
                </p>
            )}
            {!podeEnviar && pendentes > 0 && (
                <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '0.82rem' }}>
                    Só administradores anexam documentos. Faltam {pendentes}.
                </p>
            )}
            {podeEnviar && (
                <p style={{ margin: '0 0 1rem', color: '#94a3b8', fontSize: '0.78rem' }}>PDF, JPG ou PNG, até 10 MB.</p>
            )}

            {openErro && <p style={{ color: '#b91c1c', marginBottom: '0.75rem' }}>{openErro}</p>}

            {docs.length === 0 ? (
                <p style={{ color: '#64748b', margin: 0 }}>Nenhum documento enviado.</p>
            ) : (
                <table style={{ width: '100%', fontSize: '0.9rem' }}>
                    <thead><tr><th align="left">Documento</th><th align="left">UC</th><th align="left">Enviado em</th><th /></tr></thead>
                    <tbody>{docs.map(d => (
                        <tr key={d.id}>
                            <td>{ROTULO[d.tipo] || d.tipo}</td>
                            <td>{d.consumer_units?.numero_uc || '—'}</td>
                            <td>{new Date(d.criado_em).toLocaleString('pt-BR')}</td>
                            <td>
                                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => abrir(d)}>Abrir</button>
                                {fallbackLinks[d.id] && (
                                    <a
                                        href={fallbackLinks[d.id]}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ marginLeft: '0.5rem' }}
                                    >
                                        Abrir documento
                                    </a>
                                )}
                            </td>
                        </tr>))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
