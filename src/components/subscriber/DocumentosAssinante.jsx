import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { chaveDocumento, situacaoDocumentos } from '../../lib/onboarding';
import { anexarDocumentoAssinante } from '../../lib/documentosAssinante';
import PainelDocumentos from './PainelDocumentos';

/**
 * Documentos do assinante no modal do CRM: carrega o que já chegou e envia
 * novos arquivos pelo time interno. A tela em si é `PainelDocumentos`.
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
        const k = chaveDocumento(item);
        setErrosEnvio(prev => ({ ...prev, [k]: null }));

        setEnviando(k);
        try {
            await anexarDocumentoAssinante(supabase, {
                subscriberId,
                tipo: item.tipo,
                consumerUnitId: item.consumer_unit_id,
                file,
            });

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

    return (
        <PainelDocumentos
            itens={situacaoDocumentos({ cpf_cnpj: cpfCnpj, ucs, docs })}
            docs={docs}
            temUcs={ucs.length > 0}
            podeEnviar={podeEnviar}
            enviando={enviando}
            errosEnvio={errosEnvio}
            openErro={openErro}
            fallbackLinks={fallbackLinks}
            onEscolherArquivo={enviar}
            onAbrir={abrir}
        />
    );
}
