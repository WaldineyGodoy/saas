import { ATRIBUTO_PAGINA } from '../lib/contratoBase';

/**
 * Folha A4 usada pelos dois contratos (adesão e gestão).
 *
 * Saiu de dentro do ContratoAdesao quando o contrato do fornecedor
 * apareceu: dois componentes com a mesma moldura e margens ligeiramente
 * diferentes produzem PDFs que não parecem sair da mesma empresa.
 *
 * `minHeight` em vez de `height`: uma folha que cresce é capturada
 * inteira pelo gerarPdfBase64, que ajusta a altura da página do PDF.
 * Com altura fixa, o excedente sumia do documento assinado.
 */
export const FolhaContrato = ({ children, contrato, branding }) => {
    const attrs = { [ATRIBUTO_PAGINA]: true, 'data-contract': contrato };

    return (
        <div
            {...attrs}
            style={{
                width: '210mm',
                minHeight: '297mm',
                background: 'white',
                padding: '20mm',
                border: `4mm solid ${branding?.primary_color || '#003366'}`,
                boxSizing: 'border-box',
                color: '#1e293b',
                fontFamily: 'serif',
                position: 'relative',
                marginBottom: '10mm',
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10mm' }}>
                {branding?.logo_url ? (
                    <img src={branding.logo_url} style={{ height: '25mm', objectFit: 'contain' }} alt="Logo" />
                ) : (
                    <div style={{ height: '25mm', display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: '28px', color: branding?.primary_color || '#003366' }}>
                        {branding?.company_name || 'B2W ENERGIA'}
                    </div>
                )}
            </div>

            <div style={{ flex: 1 }}>{children}</div>

            <div style={{
                marginTop: '10mm', paddingTop: '4mm',
                fontSize: '9px', color: '#94a3b8', borderTop: '1px solid #e2e8f0',
                display: 'flex', justifyContent: 'space-between'
            }}>
                <span>Documento gerado eletronicamente via CRM B2W Energia</span>
                <span>Associação de Usinas B2W Energia</span>
            </div>
        </div>
    );
};
