import { useMemo, useState } from 'react';
import { Building2, Search, CheckSquare, Square, AlertCircle } from 'lucide-react';

/**
 * Em quais distribuidoras o plano pode ser contratado (planos_distribuidoras).
 * É o que o app usa para oferecer planos na inclusão de UC nova: plano sem
 * distribuidora marcada não aparece para ninguém.
 */
export default function DistribuidorasDoPlano({ opcoes, selecionadas, onChange }) {
    const [busca, setBusca] = useState('');

    const filtradas = useMemo(() => {
        const q = busca.trim().toLowerCase();
        return opcoes.filter(nome => !q || nome.toLowerCase().includes(q));
    }, [opcoes, busca]);

    const alternar = (nome) => onChange(
        selecionadas.includes(nome) ? selecionadas.filter(n => n !== nome) : [...selecionadas, nome].sort()
    );

    const selecionarVisiveis = () => {
        const uniao = new Set([...selecionadas, ...filtradas]);
        onChange([...uniao].sort());
    };

    const limparSelecao = () => onChange([]);

    return (
        <div style={{
            background: '#ffffff',
            padding: '1.25rem 1.5rem',
            borderRadius: '14px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Building2 size={17} color="#2563eb" />
                        <h4 style={{ margin: 0, fontSize: '0.96rem', color: '#0f172a', fontWeight: 700 }}>
                            Disponibilidade nas Distribuidoras
                        </h4>
                        <span style={{
                            padding: '0.12rem 0.55rem',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                            background: selecionadas.length > 0 ? '#dbeafe' : '#fef3c7',
                            color: selecionadas.length > 0 ? '#1e40af' : '#92400e'
                        }}>
                            {selecionadas.length} {selecionadas.length === 1 ? 'selecionada' : 'selecionadas'}
                        </span>
                    </div>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>
                        O app só oferece este plano para UCs das distribuidoras marcadas abaixo.
                        {selecionadas.length === 0 && (
                            <strong style={{ color: '#b45309', marginLeft: '0.35rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <AlertCircle size={13} style={{ verticalAlign: 'middle' }} /> Sem nenhuma marcada, o plano não aparece no app.
                            </strong>
                        )}
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    {filtradas.length > 0 && (
                        <button
                            type="button"
                            onClick={selecionarVisiveis}
                            style={{
                                padding: '0.32rem 0.65rem',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1',
                                background: '#f8fafc',
                                color: '#334155',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem'
                            }}
                        >
                            <CheckSquare size={13} /> Marcar visíveis
                        </button>
                    )}
                    {selecionadas.length > 0 && (
                        <button
                            type="button"
                            onClick={limparSelecao}
                            style={{
                                padding: '0.32rem 0.65rem',
                                borderRadius: '8px',
                                border: '1px solid #e2e8f0',
                                background: '#ffffff',
                                color: '#64748b',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem'
                            }}
                        >
                            <Square size={13} /> Limpar
                        </button>
                    )}
                </div>
            </div>

            {selecionadas.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
                    {selecionadas.map(nome => (
                        <button
                            key={nome}
                            type="button"
                            onClick={() => alternar(nome)}
                            title="Remover distribuidora"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                padding: '0.26rem 0.65rem',
                                borderRadius: '999px',
                                border: '1px solid #bfdbfe',
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                cursor: 'pointer'
                            }}
                        >
                            <span>{nome}</span>
                            <span aria-hidden style={{ fontWeight: 800, fontSize: '0.85rem', lineHeight: 1 }}>×</span>
                        </button>
                    ))}
                </div>
            )}

            <div style={{ position: 'relative', marginBottom: '0.55rem' }}>
                <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input
                    type="text"
                    className="crm-input"
                    placeholder="Buscar distribuidora..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    style={{
                        width: '100%',
                        height: '38px',
                        padding: '0 0.9rem 0 2.2rem',
                        borderRadius: '10px',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        fontSize: '0.84rem',
                        color: '#0f172a',
                        boxSizing: 'border-box'
                    }}
                />
            </div>

            <div style={{
                maxHeight: '156px',
                overflowY: 'auto',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                background: '#f8fafc',
                padding: '0.5rem 0.75rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
                gap: '0.25rem 0.75rem'
            }}>
                {filtradas.map(nome => {
                    const checked = selecionadas.includes(nome);
                    return (
                        <label
                            key={nome}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.45rem',
                                fontSize: '0.82rem',
                                fontWeight: checked ? 700 : 500,
                                color: checked ? '#1e40af' : '#334155',
                                padding: '0.22rem 0.35rem',
                                borderRadius: '6px',
                                background: checked ? '#eff6ff' : 'transparent',
                                cursor: 'pointer'
                            }}
                        >
                            <input type="checkbox" checked={checked} onChange={() => alternar(nome)} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome}</span>
                        </label>
                    );
                })}
                {filtradas.length === 0 && (
                    <span style={{ fontSize: '0.82rem', color: '#94a3b8', padding: '0.25rem 0' }}>
                        Nenhuma distribuidora encontrada.
                    </span>
                )}
            </div>
        </div>
    );
}
