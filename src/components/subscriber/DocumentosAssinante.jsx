import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const ROTULO = { identidade: 'Identidade (CNH/RG)', conta_energia: 'Conta de energia', contrato_social: 'Contrato social' };

export default function DocumentosAssinante({ subscriberId }) {
    const [docs, setDocs] = useState([]);
    const [erro, setErro] = useState('');
    const [openErro, setOpenErro] = useState('');
    const [fallbackLinks, setFallbackLinks] = useState({});
    useEffect(() => {
        if (!subscriberId) return;
        supabase.from('subscriber_documents')
            .select('id, tipo, storage_path, mime, tamanho, criado_em, consumer_units(numero_uc)')
            .eq('subscriber_id', subscriberId).order('criado_em')
            .then(({ data, error }) => error ? setErro(error.message) : setDocs(data || []));
    }, [subscriberId]);
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
    if (erro) return <p style={{ color: '#b91c1c' }}>{erro}</p>;
    if (!docs.length) return <p style={{ color: '#64748b' }}>Nenhum documento enviado.</p>;
    return (
        <div>
            {openErro && <p style={{ color: '#b91c1c', marginBottom: '0.75rem' }}>{openErro}</p>}
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
        </div>
    );
}
