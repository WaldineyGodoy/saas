import { corpoContrato, identificadorDocumento, semTituloRepetido, tituloContrato } from '../lib/contratoBase';
import { dividirEmPaginasOriginador, TITULO_ORIGINADOR } from '../lib/contratoOriginador';
import { FolhaContrato } from './FolhaContrato';

/**
 * Renderiza fora da tela o Contrato de Originação, para o html2canvas de
 * `gerarPdfContratoOriginadorBase64`.
 *
 * Marcado com `data-contract="originador"` porque o modal do originador
 * pode estar montado ao mesmo tempo que outro contrato, e um seletor
 * genérico misturaria as folhas dos dois no mesmo PDF.
 */
export default function ContratoOriginador({ texto, branding }) {
    if (!texto) return null;

    const paginas = dividirEmPaginasOriginador(semTituloRepetido(texto, TITULO_ORIGINADOR));
    const identificador = identificadorDocumento(texto);

    return (
        <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '210mm', zIndex: -1 }}>
            {paginas.map((parte, i) => (
                <FolhaContrato
                    key={i}
                    contrato="originador"
                    branding={branding}
                    titulo={TITULO_ORIGINADOR}
                    pagina={i + 1}
                    total={paginas.length}
                    identificador={identificador}
                >
                    {i === 0 && <h1 style={tituloContrato}>{TITULO_ORIGINADOR}</h1>}
                    <div style={corpoContrato}>{parte}</div>
                </FolhaContrato>
            ))}
        </div>
    );
}
