import { dividirEmPaginas, montarTextoContrato } from '../lib/contrato';

/**
 * Renderiza as 4 páginas do contrato fora da tela, prontas para o
 * html2canvas de `gerarPdfContratoBase64`. O texto e a rotina de PDF
 * moram em src/lib/contrato.js — usados igualmente pelo CRM e pela
 * página pública de adesão.
 */

const Pagina = ({ children, id, branding }) => (
    <div
        id={id}
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
            position: 'absolute', bottom: '10mm', left: '20mm', right: '20mm',
            fontSize: '9px', color: '#94a3b8', borderTop: '1px solid #e2e8f0',
            paddingTop: '4mm', display: 'flex', justifyContent: 'space-between'
        }}>
            <span>Documento gerado eletronicamente via CRM B2W Energia</span>
            <span>Associação de Usinas B2W Energia</span>
        </div>
    </div>
);

const corpo = { whiteSpace: 'pre-wrap', fontSize: '11pt', lineHeight: '1.5', textAlign: 'justify' };
const titulo = { fontSize: '20px', textAlign: 'center', marginBottom: '10mm', fontWeight: 'bold', textTransform: 'uppercase', color: '#003366' };

/**
 * Renderiza as 4 páginas fora da tela, prontas para o html2canvas.
 * Precisa estar montado no DOM antes de chamar `gerarPdfContratoBase64`.
 */
export default function ContratoAdesao({ subscriber, consumerUnits = [], branding, texto }) {
    // A distribuidora citada nas cláusulas 1, 7 e 13 vem da primeira UC.
    const conteudo = texto || montarTextoContrato(subscriber, consumerUnits[0]?.concessionaria);
    const [parte1, parte2, parte3] = dividirEmPaginas(conteudo);

    return (
        <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '210mm', zIndex: -1 }}>
            <Pagina id="contract-page-1" branding={branding}>
                <h1 style={titulo}>TERMO DE INGRESSO E ADESÃO À ASSOCIAÇÃO DE GERAÇÃO COMPARTILHADA</h1>
                <div style={corpo}>{parte1}</div>
            </Pagina>

            <Pagina id="contract-page-2" branding={branding}>
                <div style={corpo}>{parte2}</div>
            </Pagina>

            <Pagina id="contract-page-3" branding={branding}>
                <div style={corpo}>{parte3}</div>
            </Pagina>

            <Pagina id="contract-page-4" branding={branding}>
                <h1 style={{ ...titulo, marginBottom: '12mm' }}>PROCURAÇÃO PARA LIBERAÇÃO DE ACESSO</h1>

                <div style={{ fontSize: '11pt', lineHeight: '1.5', textAlign: 'justify' }}>
                    <p>
                        <strong>OUTORGANTE:</strong> {subscriber?.name}, inscrito no CPF/CNPJ sob o nº {subscriber?.cpf_cnpj},
                        residente e domiciliado à {subscriber?.rua}, nº {subscriber?.numero}
                        {subscriber?.complemento ? ` - ${subscriber.complemento}` : ''}, {subscriber?.bairro},
                        {' '}{subscriber?.cidade}/{subscriber?.uf}, CEP {subscriber?.cep}, doravante denominado "ASSOCIADO".
                    </p>
                    <p style={{ marginTop: '8mm' }}>
                        <strong>OUTORGADO:</strong> {branding?.company_name || 'ASSOCIAÇÃO DE USINAS B2W ENERGIA'}, inscrito no
                        CNPJ sob nº 64.561.352/0001-07, com sede na Praça Apolinario Barbosa, 86 – Centro, Caraí/MG,
                        CEP 39800-000, doravante denominada "ASSOCIAÇÃO".
                    </p>
                    <p style={{ marginTop: '10mm' }}>
                        <strong>PODERES:</strong> Pelo presente instrumento, o OUTORGANTE nomeia o OUTORGADO seu procurador
                        para o fim especial de representá-lo junto à concessionária{' '}
                        <strong>{consumerUnits[0]?.concessionaria || 'local'}</strong>, podendo solicitar acesso a dados de
                        consumo, histórico de faturamento e realizar o cadastro da Unidade Consumidora no Sistema de
                        Compensação de Energia Elétrica (Geração Distribuída).
                    </p>

                    <div style={{ marginTop: '12mm', padding: '6mm', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                        <p style={{ fontWeight: 'bold', marginBottom: '5mm', fontSize: '12px', color: '#475569', textTransform: 'uppercase' }}>
                            UNIDADES CONSUMIDORAS VINCULADAS:
                        </p>
                        <table style={{ width: '100%', fontSize: '10pt', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                                    <th style={{ textAlign: 'left', padding: '3mm 0' }}>Nº Unidade (UC)</th>
                                    <th style={{ textAlign: 'left', padding: '3mm 0' }}>Concessionária</th>
                                    <th style={{ textAlign: 'left', padding: '3mm 0' }}>Localidade</th>
                                </tr>
                            </thead>
                            <tbody>
                                {consumerUnits.map((uc, idx) => (
                                    <tr key={uc.id || `${uc.numero_uc}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '4mm 0', fontWeight: 'bold' }}>{uc.numero_uc}</td>
                                        <td style={{ padding: '4mm 0' }}>{uc.concessionaria}</td>
                                        <td style={{ padding: '4mm 0' }}>
                                            {uc.cidade || uc.address?.cidade}/{uc.uf || uc.address?.uf}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div style={{ marginTop: '25mm', textAlign: 'center', fontStyle: 'italic', color: '#94a3b8', fontSize: '10px' }}>
                    <p>Documento gerado eletronicamente para fins de assinatura digital na plataforma Autentique.</p>
                </div>
            </Pagina>
        </div>
    );
}
