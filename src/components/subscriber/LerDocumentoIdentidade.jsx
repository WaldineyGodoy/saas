import { useRef, useState } from 'react';
import { useUI } from '../../contexts/UIContext';
import { lerDocumentoIdentidade } from '../../lib/documentoIdentidadeLeitura';
import PainelLerDocumentoIdentidade from './PainelLerDocumentoIdentidade';

/**
 * Atalho da equipe no cadastro do assinante: lê a CNH/RG (foto ou PDF) e devolve
 * a leitura e o arquivo para o modal preencher o formulário. Não grava nada:
 * quem salva (e anexa o documento ao assinante) é o próprio modal, depois de
 * conferir. Mesmo desenho de `PreencherUcPelaConta`, na UC.
 *
 * `onLeitura(leitura, arquivo)` devolve os avisos a mostrar (ou lista vazia).
 */
export default function LerDocumentoIdentidade({ onLeitura, arquivoNome = '' }) {
    const { showAlert } = useUI();
    const inputRef = useRef(null);
    const [lendo, setLendo] = useState(false);
    const [avisos, setAvisos] = useState([]);

    const ler = async (e) => {
        const arquivo = e.target.files?.[0];
        e.target.value = '';
        if (!arquivo) return;
        if (arquivo.type !== 'application/pdf' && !arquivo.type.startsWith('image/')) {
            showAlert('Selecione o PDF ou uma foto do documento.', 'error');
            return;
        }
        setLendo(true);
        setAvisos([]);
        try {
            const leitura = await lerDocumentoIdentidade(arquivo);
            setAvisos((await onLeitura(leitura, arquivo)) || []);
        } catch (err) {
            console.error('Leitura do documento de identificação:', err);
            showAlert(err.message || 'Falha ao ler o documento.', 'error');
        } finally {
            setLendo(false);
        }
    };

    return (
        <PainelLerDocumentoIdentidade
            lendo={lendo}
            arquivoNome={arquivoNome}
            avisos={avisos}
            inputRef={inputRef}
            onEscolher={() => inputRef.current?.click()}
            onArquivo={ler}
        />
    );
}
