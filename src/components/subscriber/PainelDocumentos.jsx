import React from 'react';
import { CheckCircle, FileText, Upload } from 'lucide-react';
import { chaveDocumento } from '../../lib/onboarding';

const ROTULO = { identidade: 'Identidade (CNH/RG)', conta_energia: 'Conta de energia', contrato_social: 'Contrato social' };

/**
 * Parte visual dos documentos do assinante no modal do CRM.
 *
 * Separada do envio (`DocumentosAssinante`) para poder ser renderizada sem
 * Supabase: o defeito que motivou isto foi justamente tela sem botão de
 * upload, e isso só se trava com teste se a tela não depender da rede.
 */
export default function PainelDocumentos({
    itens,
    docs = [],
    temUcs = false,
    podeEnviar = false,
    enviando = null,
    errosEnvio = {},
    openErro = '',
    fallbackLinks = {},
    onEscolherArquivo,
    onAbrir,
}) {
    const pendentes = itens.filter(i => !i.enviado).length;

    return (
        <div>
            {/* Obrigatorios: o que falta para o contrato poder sair. */}
            <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '1.25rem' }}>
                {itens.map(item => {
                    const k = chaveDocumento(item);
                    const ocupado = enviando === k;
                    return (
                        <div
                            key={k}
                            style={{
                                padding: '0.7rem 0.9rem', borderRadius: '10px', border: '1px solid',
                                borderColor: item.enviado ? '#bbf7d0' : '#e2e8f0',
                                background: item.enviado ? '#f0fdf4' : '#f8fafc',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                                    {item.enviado
                                        ? <CheckCircle size={20} color="#16a34a" style={{ flexShrink: 0 }} />
                                        : <FileText size={20} color="#94a3b8" style={{ flexShrink: 0 }} />}
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>{item.rotulo}</div>
                                        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                            {item.enviado
                                                ? `Recebido${item.quantidade > 1 ? ` (${item.quantidade} arquivos)` : ''}`
                                                : 'Pendente'}
                                        </div>
                                    </div>
                                </div>
                                {podeEnviar && (
                                    <label
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.8rem',
                                            borderRadius: '8px', border: '1px solid #8b5cf6', background: 'white', color: '#7c3aed',
                                            fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap',
                                            cursor: enviando ? 'wait' : 'pointer', opacity: enviando && !ocupado ? 0.6 : 1,
                                        }}
                                    >
                                        <Upload size={15} />
                                        {ocupado ? 'Enviando...' : (item.enviado ? 'Enviar outro arquivo' : 'Escolher arquivo')}
                                        <input
                                            type="file"
                                            accept="application/pdf,image/jpeg,image/png"
                                            style={{ display: 'none' }}
                                            disabled={!!enviando}
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                // Limpa para permitir escolher o mesmo arquivo de novo.
                                                e.target.value = '';
                                                if (file) onEscolherArquivo(item, file);
                                            }}
                                        />
                                    </label>
                                )}
                            </div>
                            {errosEnvio[k] && <p style={{ margin: '0.5rem 0 0', color: '#b91c1c', fontSize: '0.82rem' }}>{errosEnvio[k]}</p>}
                        </div>
                    );
                })}
            </div>

            {!temUcs && (
                <p style={{ margin: '0 0 1rem', color: '#92400e', fontSize: '0.82rem' }}>
                    Cadastre as unidades consumidoras na aba <strong>Unidades Consumidoras</strong> para anexar a conta de energia de cada uma.
                </p>
            )}
            {!podeEnviar && pendentes > 0 && (
                <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '0.82rem' }}>
                    Só administradores anexam documentos. Faltam {pendentes}.
                </p>
            )}
            {podeEnviar && (
                <p style={{ margin: '0 0 1rem', color: '#94a3b8', fontSize: '0.78rem' }}>PDF, JPG ou PNG, até 10 MB.</p>
            )}

            {openErro && <p style={{ color: '#b91c1c', marginBottom: '0.75rem' }}>{openErro}</p>}

            {docs.length === 0 ? (
                <p style={{ color: '#64748b', margin: 0 }}>Nenhum documento enviado.</p>
            ) : (
                <table style={{ width: '100%', fontSize: '0.9rem' }}>
                    <thead><tr><th align="left">Documento</th><th align="left">UC</th><th align="left">Enviado em</th><th /></tr></thead>
                    <tbody>{docs.map(d => (
                        <tr key={d.id}>
                            <td>{ROTULO[d.tipo] || d.tipo}</td>
                            <td>{d.consumer_units?.numero_uc || '—'}</td>
                            <td>{new Date(d.criado_em).toLocaleString('pt-BR')}</td>
                            <td>
                                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onAbrir(d)}>Abrir</button>
                                {fallbackLinks[d.id] && (
                                    <a
                                        href={fallbackLinks[d.id]}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ marginLeft: '0.5rem' }}
                                    >
                                        Abrir documento
                                    </a>
                                )}
                            </td>
                        </tr>))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
