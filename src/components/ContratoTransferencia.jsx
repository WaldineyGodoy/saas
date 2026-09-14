import { corpoContrato, identificadorDocumento, tituloContrato } from '../lib/contratoBase';
import { dividirEmPaginasTransferencia, TITULO_TRANSFERENCIA } from '../lib/contratoTransferencia';
import { FolhaContrato } from './FolhaContrato';

/**
 * Folhas fora da tela do termo de transferência de titularidade, para o
 * html2canvas de `gerarPdfTransferenciaBase64`.
 *
 * Marcado com `data-contract="transferencia"`: o modal da UC abre o do
 * assinante por cima, e um seletor genérico misturaria o termo de adesão no
 * mesmo PDF.
 */
export default function ContratoTransferencia({ texto, branding }) {
    if (!texto) return null;

    const paginas = dividirEmPaginasTransferencia(texto);
    const identificador = identificadorDocumento(texto);

    return (
        <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '210mm', zIndex: -1 }}>
            {paginas.map((parte, i) => (
                <FolhaContrato
                    key={i}
                    contrato="transferencia"
                    branding={branding}
                    titulo={TITULO_TRANSFERENCIA}
                    pagina={i + 1}
                    total={paginas.length}
                    identificador={identificador}
                >
                    {i === 0 && <h1 style={tituloContrato}>{TITULO_TRANSFERENCIA}</h1>}
                    <div style={corpoContrato}>{parte}</div>
                </FolhaContrato>
            ))}
        </div>
    );
}
