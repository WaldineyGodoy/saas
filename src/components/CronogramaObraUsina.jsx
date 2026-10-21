import { useState } from 'react';
import { HardHat, Pause, Play } from 'lucide-react';
import {
    textoItem, resumoCronograma, diasAte, formatarData, hojeISO,
    iniciarCronograma, alterarInicio, suspenderCronograma, retomarCronograma,
    previsaoParaGravar, diasSuspensoAtual, diasSuspensosTotal
} from '../lib/cronogramaObra';

// Cronograma da obra na aba Planta do modal da usina. Edita
// usinas.cronograma_obra (salvo junto com a usina) e mostra o resumo nos moldes
// de b2winvest.com.br/usinas-disponiveis/.

const COR = {
    concluido: { cor: '#166534', fundo: '#dcfce7', borda: '#86efac' },
    andamento: { cor: '#92400e', fundo: '#fef3c7', borda: '#fcd34d' },
    previsto: { cor: '#475569', fundo: '#f1f5f9', borda: '#e2e8f0' },
    atrasado: { cor: '#991b1b', fundo: '#fee2e2', borda: '#fca5a5' }
};

const corDoItem = (item) => {
    if (item.status !== 'previsto') return COR[item.status];
    const dias = diasAte(item.previsto_para);
    return dias !== null && dias < 0 ? COR.atrasado : COR.previsto;
};

const corDoSelo = (r) => {
    if (r.concluida) return COR.concluido;
    if (r.iniciada) return COR.andamento;
    return r.selo.startsWith('ATRASADO') ? COR.atrasado : COR.previsto;
};

const campo = {
    padding: '0.35rem 0.5rem', border: '1px solid #e2e8f0', borderRadius: '8px',
    fontSize: '0.8rem', background: 'white', outline: 'none'
};

const botao = (cor, fundo) => ({
    display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.9rem',
    borderRadius: '8px', border: `1px solid ${cor}`, background: fundo, color: cor,
    fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap'
});

export default function CronogramaObraUsina({ value, onChange }) {
    const cronograma = value || {};
    const resumo = resumoCronograma(cronograma);
    const [dataInicio, setDataInicio] = useState(hojeISO());
    const iniciado = !!cronograma.inicio;
    const suspensa = resumo.suspensa;

    // Grava sobre o item GRAVADO (nunca sobre a previsão efetiva da tela, que
    // já soma a suspensão em curso; gravá-la empurraria o prazo duas vezes).
    const atualizarItem = (itemId, patch) => {
        const gravado = cronograma.itens?.[itemId] || {};
        const novo = { ...gravado, ...patch };
        if ('previsto_para' in patch) novo.previsto_para = previsaoParaGravar(cronograma, patch.previsto_para);
        // Ao concluir sem data, assume hoje.
        if (patch.status === 'concluido' && !novo.concluido_em) novo.concluido_em = hojeISO();
        onChange({
            ...cronograma,
            itens: { ...(cronograma.itens || {}), [itemId]: novo }
        });
    };

    const inicio = resumo.inicioGeracao;
    const textoInicio = inicio.status === 'concluido'
        ? (inicio.concluido_em ? `Gerando desde ${formatarData(inicio.concluido_em)}` : 'Geração iniciada')
        : inicio.previsto_para
            ? `Início de geração previsto para ${formatarData(inicio.previsto_para)}`
            : 'Início de geração sem previsão';

    return (
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div style={{ padding: '0.75rem', background: 'white', borderRadius: '10px', color: '#b45309', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <HardHat size={24} />
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Cronograma da Obra</h4>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>{textoInicio}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e293b' }}>{resumo.geral}%</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>executado</div>
                </div>
                {iniciado && (
                    suspensa ? (
                        <button type="button" onClick={() => onChange(retomarCronograma(cronograma))} style={botao('#166534', '#dcfce7')}
                            title="Retoma a contagem: as previsões pendentes andam os dias em que a obra ficou suspensa">
                            <Play size={14} /> Retomar
                        </button>
                    ) : (
                        <button type="button" onClick={() => onChange(suspenderCronograma(cronograma))} style={botao('#b45309', '#fff7ed')}
                            title="Suspende a contagem dos prazos até retomar">
                            <Pause size={14} /> Suspender
                        </button>
                    )
                )}
            </div>

            {/* Início da obra e suspensão */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#475569' }}>
                {iniciado ? (
                    <>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            Início da obra
                            <input
                                type="date"
                                value={cronograma.inicio}
                                onChange={e => e.target.value && onChange(alterarInicio(cronograma, e.target.value))}
                                style={campo}
                                title="Mudar o início desloca as previsões pendentes pela mesma diferença"
                            />
                        </label>
                        {suspensa && (
                            <span style={{ fontWeight: 700, color: '#991b1b', background: '#fee2e2', border: '1px solid #fca5a5', padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                                Suspensa desde {formatarData(cronograma.suspensao.desde)} ({diasSuspensoAtual(cronograma)} dias) · prazos congelados
                            </span>
                        )}
                        {diasSuspensosTotal(cronograma) > 0 && !suspensa && (
                            <span style={{ color: '#64748b' }}>Prazos já estendidos em {diasSuspensosTotal(cronograma)} dias por suspensão.</span>
                        )}
                    </>
                ) : (
                    <>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            Início da obra
                            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} style={campo} />
                        </label>
                        <button type="button" disabled={!dataInicio} onClick={() => onChange(iniciarCronograma(cronograma, dataInicio))} style={botao('#1d4ed8', '#eff6ff')}>
                            Iniciar cronograma
                        </button>
                        <span style={{ color: '#64748b' }}>Preenche as previsões pelos prazos padrão (30 a 240 dias do início).</span>
                    </>
                )}
            </div>

            {/* Status das macroetapas */}
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em' }}>STATUS DAS MACROETAPAS</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: resumo.atual ? '#b45309' : '#166534' }}>{resumo.cabecalho}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                    {resumo.etapas.map((r, i) => {
                        const atual = resumo.atual?.etapa.id === r.etapa.id;
                        return (
                            <div key={r.etapa.id}>
                                <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                                    <div style={{ width: `${r.progresso}%`, height: '100%', background: r.concluida ? '#22c55e' : '#f59e0b', transition: 'width 0.3s ease' }} />
                                </div>
                                <div style={{ fontSize: '0.75rem', textAlign: 'center', marginTop: '0.3rem', fontWeight: atual ? 800 : 500, color: atual ? '#b45309' : '#64748b' }}>
                                    {i + 1}. {r.etapa.curto}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Macroetapas e itens */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: '1rem' }}>
                {resumo.etapas.map((r, i) => {
                    const selo = corDoSelo(r);
                    return (
                        <div key={r.etapa.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                                <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>{i + 1} · {r.etapa.titulo}</span>
                                <span style={{ fontSize: '0.7rem', fontWeight: 800, padding: '0.2rem 0.6rem', borderRadius: '999px', color: selo.cor, background: selo.fundo, border: `1px solid ${selo.borda}`, whiteSpace: 'nowrap' }}>{r.selo}</span>
                            </div>
                            {r.itens.map(({ def, item }) => {
                                const cor = corDoItem(item);
                                const concluido = item.status === 'concluido';
                                return (
                                    <div key={def.id} style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #f8fafc', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ fontSize: '0.85rem', color: '#334155' }}>{def.label}</span>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: '999px', color: cor.cor, background: cor.fundo, border: `1px solid ${cor.borda}`, whiteSpace: 'nowrap' }}>
                                                {textoItem(def, item)}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <select
                                                aria-label={`Situação de ${def.label}`}
                                                value={item.status}
                                                onChange={e => atualizarItem(def.id, { status: e.target.value })}
                                                style={campo}
                                            >
                                                <option value="previsto">Previsto</option>
                                                <option value="andamento">Em andamento</option>
                                                <option value="concluido">Concluído</option>
                                            </select>
                                            {item.status === 'andamento' && (
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: '#64748b' }}>
                                                    <input
                                                        type="number" min="0" max="100" step="5"
                                                        aria-label={`Percentual de ${def.label}`}
                                                        value={item.pct}
                                                        onChange={e => atualizarItem(def.id, { pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                                                        style={{ ...campo, width: '4.5rem' }}
                                                    />
                                                    %
                                                </label>
                                            )}
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: '#64748b' }}>
                                                {concluido ? 'Concluído em' : 'Previsão'}
                                                <input
                                                    type="date"
                                                    value={concluido ? item.concluido_em : item.previsto_para}
                                                    onChange={e => atualizarItem(def.id, concluido ? { concluido_em: e.target.value } : { previsto_para: e.target.value })}
                                                    style={campo}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
            <small style={{ color: '#64748b', fontSize: '0.75rem' }}>
                O cronograma é gravado ao salvar a usina. "N dias" é contado a partir de hoje até a previsão de cada item.
            </small>
        </div>
    );
}

