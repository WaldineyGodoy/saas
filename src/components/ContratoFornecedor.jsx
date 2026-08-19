import { dividirEmPaginasFornecedor, montarTextoContratoFornecedor } from '../lib/contratoFornecedor';
import { corpoContrato, tituloContrato } from '../lib/contratoBase';
import { FolhaContrato } from './FolhaContrato';

/**
 * Renderiza o Contrato de Administração e Gestão fora da tela, pronto
 * para o html2canvas de `gerarPdfContratoFornecedorBase64`.
 *
 * Marcado com `data-contract="fornecedor"` para que o gerador de PDF
 * capture só estas folhas: o SupplierModal e o SubscriberModal podem
 * estar montados ao mesmo tempo, e um seletor genérico misturaria o
 * contrato do fornecedor com o termo de um assinante no mesmo PDF.
 */
export default function ContratoFornecedor({ supplier, usinas = [], branding, texto, opts = {} }) {
    const conteudo = texto || montarTextoContratoFornecedor(supplier, usinas, opts);
    const paginas = dividirEmPaginasFornecedor(conteudo);

    return (
        <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '210mm', zIndex: -1 }}>
            {paginas.map((parte, i) => (
                <FolhaContrato key={i} contrato="fornecedor" branding={branding}>
                    {i === 0 && (
                        <h1 style={tituloContrato}>Contrato de Administração e Gestão de Créditos Energéticos</h1>
                    )}
                    <div style={corpoContrato}>{parte}</div>
                </FolhaContrato>
            ))}
        </div>
    );
}
