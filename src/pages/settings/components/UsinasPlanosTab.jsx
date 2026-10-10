import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, RefreshCw, SunMedium, Link2, Unlink } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { planoAceitaUsina } from '../../../lib/planoUsina';

/**
 * Aba Usinas de Planos e Serviços: qual plano de usina cada usina usa.
 *
 * usinas.plano_usina_id aponta para o plano de usina, de onde saem a gestão
 * B2W, o originador da usina e o plano de recompensas do split
 * (handle_invoice_paid_ledger): sem plano a fatura paga não lança gestão B2W
 * nem recompensas e o fornecedor fica com o caixa inteiro. Por isso toda troca
 * pede confirmação dizendo o efeito no razão.
 */
export default function UsinasPlanosTab({ planosUsina, showAlert, onVinculosMudaram }) {
    const [usinas, setUsinas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [salvando, setSalvando] = useState(false);
    const [busca, setBusca] = useState('');
    const [filtroPlano, setFiltroPlano] = useState('todos'); // 'todos' | 'sem' | <plano id>
    const [selecionadas, setSelecionadas] = useState(() => new Set());
    const [planoLote, setPlanoLote] = useState('');

    const fetchUsinas = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('usinas')
                .select('id, name, status, concessionaria, plano_usina_id, supplier:supplier_id (name)')
                .order('name');
            if (error) throw error;
            setUsinas(data || []);
        } catch (err) {
            console.error('Erro ao buscar usinas:', err);
            showAlert('Erro ao carregar usinas: ' + (err.message || 'Erro de conexão'), 'error');
        } finally {
            setLoading(false);
        }
    }, [showAlert]);

    useEffect(() => { fetchUsinas(); }, [fetchUsinas]);

    const planoPorId = useMemo(
        () => Object.fromEntries(planosUsina.map(p => [p.id, p])),
        [planosUsina]
    );

    const contagem = useMemo(() => {
        const c = { sem: 0 };
        usinas.forEach(u => {
            const k = u.plano_usina_id || 'sem';
            c[k] = (c[k] || 0) + 1;
        });
        return c;
    }, [usinas]);

    const filtradas = usinas.filter(u => {
        const termo = busca.toLowerCase();
        const casaBusca = !termo
            || u.name?.toLowerCase().includes(termo)
            || u.supplier?.name?.toLowerCase().includes(termo);
        const casaPlano = filtroPlano === 'todos'
            || (filtroPlano === 'sem' ? !u.plano_usina_id : u.plano_usina_id === filtroPlano);
        return casaBusca && casaPlano;
    });

    const nomePlano = (id) => (id ? (planoPorId[id]?.nome || 'Plano removido') : 'Sem plano');

    const confirmarTroca = (qtd, planoId) => {
        const alvo = qtd === 1 ? 'desta usina' : `destas ${qtd} usinas`;
        const msg = planoId
            ? `Vincular ao plano "${nomePlano(planoId)}"?\n\nA partir de agora, toda fatura paga das UCs ${alvo} lança gestão B2W, recompensas e repasse pelo plano. Faturas já lançadas não mudam.`
            : `Desvincular do plano?\n\nAs próximas faturas pagas das UCs ${alvo} deixam de lançar gestão B2W e recompensas: o fornecedor fica com o caixa inteiro.`;
        return window.confirm(msg);
    };

    const aplicar = async (ids, planoId) => {
        const mudam = ids.filter(id => (usinas.find(u => u.id === id)?.plano_usina_id || '') !== (planoId || ''));
        if (mudam.length === 0) {
            showAlert('Nada a mudar: as usinas já estão nesse plano.', 'info');
            return;
        }
        if (!confirmarTroca(mudam.length, planoId)) return;

        setSalvando(true);
        try {
            const { error } = await supabase
                .from('usinas')
                .update({ plano_usina_id: planoId || null })
                .in('id', mudam);
            if (error) throw error;
            setUsinas(prev => prev.map(u => (mudam.includes(u.id) ? { ...u, plano_usina_id: planoId || null } : u)));
            setSelecionadas(new Set());
            onVinculosMudaram?.();
            showAlert(
                planoId
                    ? `${mudam.length} usina(s) vinculada(s) ao plano "${nomePlano(planoId)}".`
                    : `${mudam.length} usina(s) desvinculada(s).`,
                'success'
            );
        } catch (err) {
            console.error('Erro ao vincular usinas:', err);
            showAlert('Erro ao salvar vínculo: ' + err.message, 'error');
        } finally {
            setSalvando(false);
        }
    };

    const alternar = (id) => setSelecionadas(prev => {
        const s = new Set(prev);
        if (s.has(id)) s.delete(id); else s.add(id);
        return s;
    });

    const todasMarcadas = filtradas.length > 0 && filtradas.every(u => selecionadas.has(u.id));
    const alternarTodas = () => setSelecionadas(todasMarcadas ? new Set() : new Set(filtradas.map(u => u.id)));

    const chip = (chave, rotulo, qtd) => (
        <button
            key={chave}
            onClick={() => setFiltroPlano(chave)}
            style={{
                padding: '0.4rem 0.8rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                border: filtroPlano === chave ? '1px solid #0284c7' : '1px solid #e2e8f0',
                background: filtroPlano === chave ? '#e0f2fe' : 'white',
                color: chave === 'sem' && qtd > 0 ? '#b45309' : '#0f172a'
            }}
        >
            {rotulo} · {qtd}
        </button>
    );

    const opcoesPlano = (
        <>
            <option value="">Sem plano de usina</option>
            {planosUsina.map(p => (
                <option key={p.id} value={p.id} disabled={!planoAceitaUsina(p)}>
                    {p.nome}
                    {p.status === 'somente_contratos' ? ' (somente contratos)' : !p.plano_assinatura_id ? ' (sem plano de recompensas)' : ''}
                </option>
            ))}
        </>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Barra do topo */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem',
                background: 'white', padding: '1rem 1.25rem', borderRadius: '14px', border: '1px solid #e2e8f0'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '240px' }}>
                    <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
                        <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                        <input
                            type="text"
                            placeholder="Buscar usina ou fornecedor..."
                            value={busca}
                            onChange={e => setBusca(e.target.value)}
                            style={{
                                width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.2rem', borderRadius: '8px',
                                border: '1px solid #cbd5e1', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box'
                            }}
                        />
                    </div>
                    <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {usinas.length - contagem.sem} de {usinas.length} usinas com plano
                    </span>
                </div>
                <button
                    onClick={fetchUsinas}
                    title="Atualizar lista"
                    style={{ padding: '0.6rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', cursor: 'pointer', display: 'flex' }}
                >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Filtro por plano */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {chip('todos', 'Todas', usinas.length)}
                {chip('sem', 'Sem plano', contagem.sem)}
                {planosUsina.map(p => chip(p.id, p.nome, contagem[p.id] || 0))}
            </div>

            {contagem.sem > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '0.85rem 1.1rem', fontSize: '0.82rem', color: '#92400e' }}>
                    Usina sem plano de usina: a gestão B2W sai do plano escolhido em cada UC, e UC sem plano não lança gestão nem recompensas — o fornecedor fica com o caixa inteiro.
                </div>
            )}

            {/* Ação em lote */}
            {selecionadas.size > 0 && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '0.75rem 1.1rem'
                }}>
                    <span style={{ fontWeight: 700, color: '#1e40af', fontSize: '0.85rem' }}>
                        {selecionadas.size} selecionada(s)
                    </span>
                    <select
                        value={planoLote}
                        onChange={e => setPlanoLote(e.target.value)}
                        style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', border: '1px solid #bfdbfe', fontSize: '0.84rem', background: 'white' }}
                    >
                        {opcoesPlano}
                    </select>
                    <button
                        disabled={salvando}
                        onClick={() => aplicar([...selecionadas], planoLote)}
                        style={{
                            padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: '#0284c7', color: 'white',
                            fontWeight: 700, fontSize: '0.84rem', cursor: salvando ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: '0.4rem'
                        }}
                    >
                        {planoLote ? <Link2 size={15} /> : <Unlink size={15} />}
                        {planoLote ? 'Vincular' : 'Desvincular'}
                    </button>
                    <button
                        onClick={() => setSelecionadas(new Set())}
                        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.82rem' }}
                    >
                        Limpar seleção
                    </button>
                </div>
            )}

            {/* Tabela */}
            <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                {loading && usinas.length === 0 ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                        <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 0.75rem auto', color: '#0284c7' }} />
                        <p style={{ margin: 0, fontSize: '0.9rem' }}>Carregando usinas...</p>
                    </div>
                ) : filtradas.length === 0 ? (
                    <div style={{ padding: '3rem 2rem', textAlign: 'center', color: '#64748b' }}>
                        <SunMedium size={28} style={{ margin: '0 auto 0.75rem auto', color: '#d97706' }} />
                        <p style={{ margin: 0, fontSize: '0.9rem' }}>Nenhuma usina corresponde ao filtro.</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    <th style={{ padding: '0.85rem 1rem', width: '36px' }}>
                                        <input type="checkbox" checked={todasMarcadas} onChange={alternarTodas} />
                                    </th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Usina</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Fornecedor</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Plano de Recompensas</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtradas.map(u => (
                                    <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9', background: selecionadas.has(u.id) ? '#f8fbff' : 'white' }}>
                                        <td style={{ padding: '0.8rem 1rem' }}>
                                            <input type="checkbox" checked={selecionadas.has(u.id)} onChange={() => alternar(u.id)} />
                                        </td>
                                        <td style={{ padding: '0.8rem 1rem' }}>
                                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{u.name || '(sem nome)'}</div>
                                            <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{u.concessionaria || '—'}</div>
                                        </td>
                                        <td style={{ padding: '0.8rem 1rem', color: '#334155' }}>{u.supplier?.name || '—'}</td>
                                        <td style={{ padding: '0.8rem 1rem', color: '#334155' }}>{u.status || '—'}</td>
                                        <td style={{ padding: '0.8rem 1rem' }}>
                                            <select
                                                disabled={salvando}
                                                value={u.plano_usina_id || ''}
                                                onChange={e => aplicar([u.id], e.target.value)}
                                                style={{
                                                    padding: '0.45rem 0.6rem', borderRadius: '8px', fontSize: '0.84rem', fontWeight: 600,
                                                    border: u.plano_usina_id ? '1px solid #bfdbfe' : '1px solid #fde68a',
                                                    background: u.plano_usina_id ? '#eff6ff' : '#fffbeb',
                                                    color: u.plano_usina_id ? '#1e40af' : '#92400e'
                                                }}
                                            >
                                                {opcoesPlano}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
