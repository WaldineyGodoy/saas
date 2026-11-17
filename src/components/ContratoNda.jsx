import { corpoContrato, identificadorDocumento, semTituloRepetido, tituloContrato } from '../lib/contratoBase';
import { dividirEmPaginasNda, TITULO_NDA } from '../lib/contratoNda';
import { FolhaContrato } from './FolhaContrato';

/**
 * Folhas do NDA fora da tela, para o html2canvas de `gerarPdfNdaBase64`.
 *
 * `data-contract="nda"` isola as folhas: o modal do lead pode montar outro
 * contrato ao mesmo tempo, e um seletor genérico juntaria os dois no PDF.
 */
export default function ContratoNda({ texto, branding }) {
    if (!texto) return null;

    const paginas = dividirEmPaginasNda(semTituloRepetido(texto, TITULO_NDA));
    const identificador = identificadorDocumento(texto);

    return (
        <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '210mm', zIndex: -1 }}>
            {paginas.map((parte, i) => (
                <FolhaContrato
                    key={i}
                    contrato="nda"
                    branding={branding}
                    titulo={TITULO_NDA}
                    pagina={i + 1}
                    total={paginas.length}
                    identificador={identificador}
                >
                    {i === 0 && <h1 style={tituloContrato}>{TITULO_NDA}</h1>}
                    <div style={corpoContrato}>{parte}</div>
                </FolhaContrato>
            ))}
        </div>
    );
}
