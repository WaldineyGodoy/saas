// Ocupação da usina mês a mês (regra em src/lib/capacidade.js): geração estimada
// do mês × franquia ocupada no mês (perfil de 12 meses da UC, ou 12 × franquia).
// Os meses em excedente (overbook) ficam em vermelho; o pior mês e o mês corrente
// vêm destacados. Overbook é alerta para apurar o consumo real, não erro.

const kwh = (v) => `${Math.round(v || 0).toLocaleString('pt-BR')} kWh`;
const pctTxt = (p) => (p === null || p === undefined ? '-' : `${p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

const corDaLinha = (l) => {
    if (l.overbook) return { barra: '#ef4444', texto: '#991b1b' };
    if ((l.pct ?? 0) >= 85) return { barra: '#f97316', texto: '#9a3412' };
    return { barra: '#22c55e', texto: '#166534' };
};

function textoMes(l, prefixo) {
    if (!l) return null;
    return l.overbook
        ? `${prefixo} ${l.rotulo}: excedente ${kwh(l.excedente)} (${pctTxt(l.pct)})`
        : `${prefixo} ${l.rotulo}: disponível ${kwh(l.disponivel)} (${pctTxt(l.pct)})`;
}

function Barras({ linhas, corrente, pior, altura, mostrarRotulos }) {
    const ref = Math.max(1, ...linhas.map((l) => Math.max(l.geracao || 0, l.consumoUG + l.ocupado)));
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: mostrarRotulos ? '0.35rem' : '2px', alignItems: 'end' }}>
            {linhas.map((l) => {
                const total = l.consumoUG + l.ocupado;
                const cor = corDaLinha(l);
                const ehCorrente = corrente?.mes === l.mes;
                const ehPior = pior?.mes === l.mes && pior.overbook;
                const titulo = `${l.rotulo}: geração ${kwh(l.geracao)} · ocupado ${kwh(total)}`
                    + (l.consumoUG > 0 ? ` (UG ${kwh(l.consumoUG)})` : '')
                    + (l.overbook ? ` · excedente ${kwh(l.excedente)}` : ` · disponível ${kwh(l.disponivel)}`);
                return (
                    <div key={l.mes} title={titulo} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                        {mostrarRotulos && (
                            <span style={{ fontSize: '0.6rem', fontWeight: 700, color: l.overbook ? '#991b1b' : 'transparent', whiteSpace: 'nowrap', marginBottom: '0.15rem' }}>
                                {l.overbook ? `+${Math.round(l.excedente).toLocaleString('pt-BR')}` : '.'}
                            </span>
                        )}
                        <div style={{
                            position: 'relative', width: '100%', height: `${altura}px`, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                            outline: ehCorrente && mostrarRotulos ? '2px solid #3b82f6' : 'none', outlineOffset: '2px', borderRadius: '4px'
                        }}>
                            {/* geração do mês (fundo) */}
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${((l.geracao || 0) / ref) * 100}%`, background: '#e2e8f0', borderRadius: '3px' }} />
                            {/* franquia ocupada no mês */}
                            <div style={{ position: 'relative', width: mostrarRotulos ? '55%' : '70%', height: `${(total / ref) * 100}%`, background: cor.barra, borderRadius: '3px', opacity: ehPior || !mostrarRotulos ? 1 : 0.85 }} />
                        </div>
                        {mostrarRotulos && (
                            <span style={{ fontSize: '0.65rem', marginTop: '0.25rem', fontWeight: ehCorrente || ehPior ? 800 : 600, color: ehCorrente ? '#1d4ed8' : (l.overbook ? '#991b1b' : '#64748b') }}>
                                {l.rotulo}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * @param {{ resumo: ReturnType<import('../lib/capacidade').resumoCapacidadeMensal>, compacto?: boolean }} props
 */
export default function OcupacaoMensalUsina({ resumo, compacto = false }) {
    if (!resumo || !resumo.linhas?.some((l) => l.geracao !== null)) return null;
    const { linhas, pior, corrente, mesesEmExcedente, temOverbook, ucsComPerfil, geracaoSazonal } = resumo;

    if (compacto) {
        return (
            <div style={{ marginTop: '0.4rem' }} title="Geração estimada (cinza) × franquia ocupada no mês (barra)">
                <Barras linhas={linhas} corrente={corrente} pior={pior} altura={22} mostrarRotulos={false} />
                <div style={{ fontSize: '0.62rem', marginTop: '0.25rem', color: temOverbook ? '#991b1b' : '#166534', fontWeight: 600 }}>
                    {temOverbook
                        ? `Overbook em ${mesesEmExcedente.length} ${mesesEmExcedente.length === 1 ? 'mês' : 'meses'} · pior ${pior.rotulo} +${kwh(pior.excedente)}`
                        : `Cabe nos 12 meses · mais apertado ${pior?.rotulo} (${pctTxt(pior?.pct)})`}
                </div>
            </div>
        );
    }

    const linhaPior = textoMes(pior, pior?.overbook ? 'Pior mês' : 'Mês mais apertado');
    const linhaCorrente = textoMes(corrente, 'Mês atual');

    return (
        <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '20px', border: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b' }}>Ocupação mês a mês</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: temOverbook ? '#991b1b' : '#166534' }}>
                    {temOverbook ? `Overbook em ${mesesEmExcedente.join(', ')}` : 'Sem overbook em nenhum mês'}
                </span>
            </div>

            <Barras linhas={linhas} corrente={corrente} pior={pior} altura={90} mostrarRotulos />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.75rem', fontSize: '0.78rem', fontWeight: 700 }}>
                {linhaPior && <span style={{ color: pior.overbook ? '#991b1b' : '#334155' }}>{linhaPior}</span>}
                {linhaCorrente && corrente.mes !== pior?.mes && <span style={{ color: corrente.overbook ? '#991b1b' : '#1d4ed8' }}>{linhaCorrente}</span>}
                {linhaCorrente && corrente.mes === pior?.mes && <span style={{ color: '#1d4ed8' }}>O mês atual é o pior mês.</span>}
            </div>

            <details style={{ marginTop: '0.6rem' }}>
                <summary style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, cursor: 'pointer' }}>Ver tabela</summary>
                <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                        <thead>
                            <tr style={{ color: '#64748b', textAlign: 'right' }}>
                                <th style={{ textAlign: 'left', padding: '0.25rem 0.4rem' }}>Mês</th>
                                <th style={{ padding: '0.25rem 0.4rem' }}>Geração</th>
                                <th style={{ padding: '0.25rem 0.4rem' }}>Consumo UG</th>
                                <th style={{ padding: '0.25rem 0.4rem' }}>Franquias</th>
                                <th style={{ padding: '0.25rem 0.4rem' }}>Saldo</th>
                                <th style={{ padding: '0.25rem 0.4rem' }}>%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.map((l) => (
                                <tr key={l.mes} style={{ borderTop: '1px solid #e2e8f0', textAlign: 'right', background: l.overbook ? '#fef2f2' : undefined, fontWeight: corrente?.mes === l.mes ? 800 : 500 }}>
                                    <td style={{ textAlign: 'left', padding: '0.25rem 0.4rem' }}>{l.rotulo}{corrente?.mes === l.mes ? ' (atual)' : ''}</td>
                                    <td style={{ padding: '0.25rem 0.4rem' }}>{kwh(l.geracao)}</td>
                                    <td style={{ padding: '0.25rem 0.4rem' }}>{kwh(l.consumoUG)}</td>
                                    <td style={{ padding: '0.25rem 0.4rem' }}>{kwh(l.ocupado)}</td>
                                    <td style={{ padding: '0.25rem 0.4rem', color: l.overbook ? '#991b1b' : '#166534' }}>{l.overbook ? `−${kwh(l.excedente)}` : kwh(l.disponivel)}</td>
                                    <td style={{ padding: '0.25rem 0.4rem' }}>{pctTxt(l.pct)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>

            <div style={{ marginTop: '0.6rem', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>
                Geração: {geracaoSazonal ? 'distribuída pela irradiância da cidade' : 'a mesma em todos os meses (sem perfil sazonal)'}.
                {' '}Franquia: {ucsComPerfil > 0 ? `perfil de 12 meses em ${ucsComPerfil} UC(s); as demais contam a franquia em todos os meses` : 'franquia cadastrada em todos os meses (nenhuma UC com histórico)'}.
                {temOverbook && ' Overbook é alerta: apure o consumo compensado antes de remanejar UCs.'}
            </div>
        </div>
    );
}
