import { dividirEmPaginas, montarTextoContrato } from '../lib/contrato';
import { corpoContrato, tituloContrato } from '../lib/contratoBase';
import { FolhaContrato } from './FolhaContrato';

/**
 * Renderiza o termo de adesão fora da tela, pronto para o html2canvas de
 * `gerarPdfContratoBase64`. O texto e a rotina de PDF moram em
 * src/lib/contrato.js — usados igualmente pelo CRM e pela página pública
 * de adesão.
 *
 * O número de folhas deixou de ser fixo em quatro: o termo consolidado
 * tem 22 cláusulas e um anexo, e uma lista fixa de IDs significava
 * cláusula ficando de fora do PDF sem ninguém perceber.
 */
export default function ContratoAdesao({ subscriber, consumerUnits = [], branding, texto, opts = {} }) {
    // A distribuidora citada nas cláusulas 1, 9 e 17 vem da primeira UC,
    // assim como o desconto e o dia de vencimento que a Cláusula 6 e a 7.2
    // precisam nomear.
    const uc = consumerUnits[0];
    const conteudo = texto || montarTextoContrato(subscriber, uc?.concessionaria, {
        desconto: opts.desconto ?? uc?.desconto_assinante,
        diaVencimento: opts.diaVencimento ?? uc?.dia_vencimento ?? subscriber?.consolidated_due_day
    });

    const paginas = dividirEmPaginas(conteudo);

    return (
        <div style={{ position: 'absolute', left: '-9999px', top: 0, width: '210mm', zIndex: -1 }}>
            {paginas.map((parte, i) => (
                <FolhaContrato key={i} contrato="adesao" branding={branding}>
                    {i === 0 && (
                        <h1 style={tituloContrato}>TERMO DE INGRESSO E ADESÃO À ASSOCIAÇÃO DE GERAÇÃO COMPARTILHADA</h1>
                    )}
                    <div style={corpoContrato}>{parte}</div>
                </FolhaContrato>
            ))}

            <FolhaContrato contrato="adesao" branding={branding}>
                <h1 style={{ ...tituloContrato, marginBottom: '12mm' }}>PROCURAÇÃO PARA LIBERAÇÃO DE ACESSO</h1>

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
                        <strong>{uc?.concessionaria || 'local'}</strong>, podendo solicitar acesso a dados de
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
                                {consumerUnits.map((u, idx) => (
                                    <tr key={u.id || `${u.numero_uc}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '4mm 0', fontWeight: 'bold' }}>{u.numero_uc}</td>
                                        <td style={{ padding: '4mm 0' }}>{u.concessionaria}</td>
                                        <td style={{ padding: '4mm 0' }}>
                                            {u.cidade || u.address?.cidade}/{u.uf || u.address?.uf}
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
            </FolhaContrato>
        </div>
    );
}
