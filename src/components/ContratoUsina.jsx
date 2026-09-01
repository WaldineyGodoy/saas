import { corpoContrato, identificadorDocumento, tituloContrato } from '../lib/contratoBase';
import { dividirEmPaginasUsina } from '../lib/contratosUsina';
import { FolhaContrato } from './FolhaContrato';

/**
 * Renderiza fora da tela qualquer um dos três contratos por usina —
 * compra e venda, arrendamento e O&M — para o html2canvas de
 * `gerarPdfContratoUsinaBase64`.
 *
 * Marcado com `data-contract="usina"` para que o gerador capture só estas
 * folhas: o modal da usina, o do fornecedor e o do assinante podem estar
 * montados ao mesmo tempo, e um seletor genérico misturaria contratos
 * diferentes no mesmo PDF.
 *
 * Um componente para os três, e não três componentes: o que muda entre
 * eles é o texto e o título, e três moldes separados divergiriam de
 * layout com o tempo — foi o que já aconteceu antes entre adesão e gestão.
 */
export default function ContratoUsina({ texto, titulo, branding }) {
    if (!texto) return null;

    const paginas = dividirEmPaginasUsina(texto);
    const identificador = identificadorDocumento(texto);

    return (
        <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '210mm', zIndex: -1 }}>
            {paginas.map((parte, i) => (
                <FolhaContrato
                    key={i}
                    contrato="usina"
                    branding={branding}
                    titulo={titulo}
                    pagina={i + 1}
                    total={paginas.length}
                    identificador={identificador}
                >
                    {i === 0 && <h1 style={tituloContrato}>{titulo}</h1>}
                    <div style={corpoContrato}>{parte}</div>
                </FolhaContrato>
            ))}
        </div>
    );
}
