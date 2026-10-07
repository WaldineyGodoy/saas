import { useMemo, useState } from 'react';

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

    return (
        <div style={{ background: '#ffffff', padding: '1.4rem 1.5rem', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            <h4 style={{ margin: '0 0 0.3rem 0', fontSize: '1rem', color: '#0f172a', fontWeight: 800 }}>Disponível nas distribuidoras</h4>
            <p style={{ margin: '0 0 0.9rem 0', fontSize: '0.8rem', color: '#64748b' }}>
                O app só oferece este plano para UC destas distribuidoras.
                {selecionadas.length === 0 && <b style={{ color: '#b45309' }}> Sem nenhuma marcada, o plano não aparece no app.</b>}
            </p>

            {selecionadas.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
                    {selecionadas.map(nome => (
                        <button
                            key={nome}
                            type="button"
                            onClick={() => alternar(nome)}
                            title="Remover"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.65rem', borderRadius: '999px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                        >
                            {nome} <span aria-hidden>×</span>
                        </button>
                    ))}
                </div>
            )}

            <input
                type="text"
                className="crm-input"
                placeholder="Buscar distribuidora..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
                style={{ width: '100%', height: '40px', padding: '0 0.9rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.86rem', boxSizing: 'border-box', marginBottom: '0.5rem' }}
            />
            <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.4rem 0.6rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.15rem 0.75rem' }}>
                {filtradas.map(nome => (
                    <label key={nome} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.84rem', color: '#334155', padding: '0.2rem 0', cursor: 'pointer' }}>
                        <input type="checkbox" checked={selecionadas.includes(nome)} onChange={() => alternar(nome)} />
                        {nome}
                    </label>
                ))}
                {filtradas.length === 0 && <span style={{ fontSize: '0.84rem', color: '#94a3b8' }}>Nenhuma distribuidora encontrada.</span>}
            </div>
        </div>
    );
}
