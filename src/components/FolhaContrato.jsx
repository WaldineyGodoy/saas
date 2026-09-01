import { ATRIBUTO_PAGINA } from '../lib/contratoBase';

/**
 * Folha A4 usada por todos os contratos gerados no CRM.
 *
 * Saiu de dentro do ContratoAdesao quando o contrato do fornecedor
 * apareceu: dois componentes com a mesma moldura e margens ligeiramente
 * diferentes produzem PDFs que não parecem sair da mesma empresa.
 *
 * `minHeight` em vez de `height`: uma folha que cresce é capturada
 * inteira pelo gerarPdfBase64, que ajusta a altura da página do PDF.
 * Com altura fixa, o excedente sumia do documento assinado.
 *
 * Cabeçalho e rodapé completos (título corrido, código do documento e
 * "Página X de Y") não são enfeite: contrato sem numeração é o que
 * permite trocar ou remover folha sem deixar rastro, e o código repetido
 * amarra todas as folhas à mesma versão do texto.
 */
export const FolhaContrato = ({ children, contrato, branding, titulo, pagina, total, identificador }) => {
    const attrs = { [ATRIBUTO_PAGINA]: true, 'data-contract': contrato };
    const cor = branding?.primary_color || '#003366';

    return (
        <div
            {...attrs}
            style={{
                width: '210mm',
                minHeight: '297mm',
                background: 'white',
                padding: '20mm',
                border: `4mm solid ${cor}`,
                boxSizing: 'border-box',
                color: '#1e293b',
                fontFamily: 'serif',
                position: 'relative',
                marginBottom: '10mm',
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '8mm' }}>
                {branding?.logo_url ? (
                    <img src={branding.logo_url} style={{ height: '25mm', objectFit: 'contain' }} alt="Logo" />
                ) : (
                    <div style={{ height: '25mm', display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: '28px', color: cor }}>
                        {branding?.company_name || 'B2W ENERGIA'}
                    </div>
                )}

                {/* Título corrido só a partir da segunda folha: na primeira o
                    próprio corpo já abre com o título em destaque. */}
                {titulo && pagina > 1 && (
                    <div style={{
                        marginTop: '4mm', fontSize: '9px', letterSpacing: '0.12em',
                        textTransform: 'uppercase', color: cor, fontWeight: 700, textAlign: 'center'
                    }}>
                        {titulo}
                    </div>
                )}

                <div style={{ marginTop: '4mm', width: '100%', borderBottom: `0.5mm solid ${cor}`, opacity: 0.25 }} />
            </div>

            <div style={{ flex: 1 }}>{children}</div>

            <div style={{
                marginTop: '10mm', paddingTop: '3mm',
                fontSize: '8px', color: '#94a3b8', borderTop: '1px solid #e2e8f0',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4mm'
            }}>
                <span style={{ flex: 1 }}>Documento gerado eletronicamente via CRM B2W Energia</span>
                {identificador && (
                    <span style={{ fontFamily: 'monospace', letterSpacing: '0.04em' }}>Ref. {identificador}</span>
                )}
                {total > 0 && (
                    <span style={{ flex: 1, textAlign: 'right', fontWeight: 700, color: '#64748b' }}>
                        Página {pagina} de {total}
                    </span>
                )}
            </div>
        </div>
    );
};
