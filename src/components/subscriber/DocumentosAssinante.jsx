import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const ROTULO = { identidade: 'Identidade (CNH/RG)', conta_energia: 'Conta de energia', contrato_social: 'Contrato social' };

export default function DocumentosAssinante({ subscriberId }) {
    const [docs, setDocs] = useState([]);
    const [erro, setErro] = useState('');
    useEffect(() => {
        if (!subscriberId) return;
        supabase.from('subscriber_documents')
            .select('id, tipo, storage_path, mime, tamanho, criado_em, consumer_units(numero_uc)')
            .eq('subscriber_id', subscriberId).order('criado_em')
            .then(({ data, error }) => error ? setErro(error.message) : setDocs(data || []));
    }, [subscriberId]);
    const abrir = async (path) => {
        const { data, error } = await supabase.storage.from('documentos-assinante').createSignedUrl(path, 300);
        if (error) return setErro(error.message);
        window.open(data.signedUrl, '_blank', 'noopener');
    };
    if (erro) return <p style={{ color: '#b91c1c' }}>{erro}</p>;
    if (!docs.length) return <p style={{ color: '#64748b' }}>Nenhum documento enviado.</p>;
    return (
        <table style={{ width: '100%', fontSize: '0.9rem' }}>
            <thead><tr><th align="left">Documento</th><th align="left">UC</th><th align="left">Enviado em</th><th /></tr></thead>
            <tbody>{docs.map(d => (
                <tr key={d.id}>
                    <td>{ROTULO[d.tipo] || d.tipo}</td>
                    <td>{d.consumer_units?.numero_uc || '—'}</td>
                    <td>{new Date(d.criado_em).toLocaleString('pt-BR')}</td>
                    <td><button type="button" className="btn btn-sm btn-outline-primary" onClick={() => abrir(d.storage_path)}>Abrir</button></td>
                </tr>))}
            </tbody>
        </table>
    );
}
