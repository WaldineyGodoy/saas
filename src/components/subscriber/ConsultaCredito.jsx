import React, { useState } from 'react';
import { ShieldCheck, Search, Loader2, FileText, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

const corRisco = (risco = '') => {
    const r = risco.toLowerCase();
    if (r.includes('baix')) return '#16a34a';
    if (r.includes('alto') || r.includes('muito')) return '#dc2626';
    return '#d97706';
};

// Soma ocorrências dos blocos de restrição devolvidos pela Boa Vista.
const BLOCOS_RESTRICAO = [
    ['pend_financeiras', 'Pendências financeiras'],
    ['protestos', 'Protestos'],
    ['ch_sem_fundos_varejo', 'Cheques sem fundos (varejo)'],
    ['ch_sem_fundos_bacen', 'Cheques sem fundos (BACEN)'],
    ['falencias_acoes_recuperacoes', 'Falências / recuperações'],
    ['acoes_civeis', 'Ações cíveis'],
];

export default function ConsultaCredito({ cpfCnpj, podeConsultar }) {
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState('');
    const [resultado, setResultado] = useState(null);

    const digitos = soDigitos(cpfCnpj);
    const ehCpf = digitos.length === 11;

    const consultar = async () => {
        if (!window.confirm('Esta consulta de score (Boa Vista) é cobrada: R$ 3,98. Deseja continuar?')) return;
        setLoading(true);
        setErro('');
        setResultado(null);
        try {
            const { data, error } = await supabase.functions.invoke('apibrasil-score', { body: { cpf: digitos } });
            if (error) {
                let msg = error.message;
                try { msg = (await error.context.json()).error || msg; } catch (_) { /* mantém msg */ }
                throw new Error(msg);
            }
            if (data?.error) throw new Error(data.error);
            setResultado(data);
        } catch (e) {
            setErro(e.message || 'Falha ao consultar.');
        } finally {
            setLoading(false);
        }
    };

    const cred = resultado?.data?.credcadastral;
    const score = cred?.scores?.ocorrencias?.[0];
    const restricoes = cred
        ? BLOCOS_RESTRICAO.map(([k, rotulo]) => [rotulo, Number(cred[k]?.quantidade_ocorrencia || 0)]).filter(([, n]) => n > 0)
        : [];

    return (
        <div style={{ marginTop: '1.25rem', paddingTop: '1.15rem', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <div>
                    <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                        <ShieldCheck size={18} color="#7c3aed" /> Consulta de Crédito (Score Boa Vista)
                    </h4>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                        Score e restrições do CPF via API Brasil. Cada consulta é cobrada.
                    </p>
                </div>
                {podeConsultar && (
                    <button
                        type="button"
                        onClick={consultar}
                        disabled={loading || !ehCpf}
                        title={!ehCpf ? 'Disponível apenas para assinantes pessoa física (CPF)' : 'Consultar score'}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.55rem 1rem', borderRadius: '8px', border: 'none',
                            background: loading || !ehCpf ? '#cbd5e1' : '#7c3aed', color: '#fff',
                            fontWeight: 600, fontSize: '0.85rem', cursor: loading || !ehCpf ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                        {loading ? 'Consultando...' : 'Consultar'}
                    </button>
                )}
            </div>

            {!ehCpf && (
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                    Informe um CPF válido no cadastro para consultar (CNPJ não é suportado por esta consulta).
                </p>
            )}

            {erro && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.65rem 0.85rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.85rem' }}>
                    <AlertTriangle size={16} /> {erro}
                </div>
            )}

            {resultado && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem', background: '#f8fafc' }}>
                    {resultado.homolog && (
                        <p style={{ margin: '0 0 0.6rem', fontSize: '0.75rem', color: '#d97706', fontWeight: 600 }}>Resultado de homologação (dados fictícios)</p>
                    )}
                    {score ? (
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Score</div>
                                <div style={{ fontSize: '2rem', fontWeight: 800, color: corRisco(score.risco), lineHeight: 1.1 }}>{score.score}</div>
                            </div>
                            <Info rotulo="Classe" valor={score.classif_abc} />
                            <Info rotulo="Risco" valor={score.risco} cor={corRisco(score.risco)} />
                            <Info rotulo="Prob. inadimplência" valor={score.probabilidade_inadimplencia} />
                        </div>
                    ) : (
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Sem score retornado.</p>
                    )}

                    <div style={{ marginTop: '0.85rem', fontSize: '0.83rem' }}>
                        {restricoes.length === 0 ? (
                            <span style={{ color: '#16a34a', fontWeight: 600 }}>Nenhuma restrição encontrada nos blocos consultados.</span>
                        ) : (
                            <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#b91c1c' }}>
                                {restricoes.map(([r, n]) => <li key={r}>{r}: {n}</li>)}
                            </ul>
                        )}
                    </div>

                    {resultado.data?.pdf && (
                        <a href={resultado.data.pdf} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.85rem', color: '#6d28d9', fontWeight: 600, fontSize: '0.83rem' }}>
                            <FileText size={15} /> Abrir relatório em PDF
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}

function Info({ rotulo, valor, cor }) {
    return (
        <div>
            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{rotulo}</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: cor || '#0f172a' }}>{valor || '—'}</div>
        </div>
    );
}
