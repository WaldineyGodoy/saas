import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Search, X, Check, Loader2 } from 'lucide-react';

/**
 * Busca com auto preenchimento sobre o catalogo `Modulos_e_Inversores`.
 *
 * O cadastro guardava marca como texto livre — "Saj" digitado a mao contra
 * "SAJ" do catalogo — e potencia como numero solto. Escolher aqui grava o id
 * do equipamento e devolve a linha inteira, para quem chama preencher os
 * campos derivados a partir do datasheet em vez de redigitar.
 */
export default function EquipamentoBusca({
    tipo,               // 'Modulo' | 'Inversor'
    valorId,            // uuid ja' selecionado, ou null
    onSelecionar,       // (linha | null) => void
    rotulo,
    placeholder,
    desabilitado = false
}) {
    const [termo, setTermo] = useState('');
    const [aberto, setAberto] = useState(false);
    const [itens, setItens] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [escolhido, setEscolhido] = useState(null);
    const caixa = useRef(null);

    const rotuloDe = (e) => e ? `${e.marca} · ${e.modelo}` : '';

    // Ao abrir a tela com uma usina ja' cadastrada, o campo precisa mostrar o
    // nome do equipamento, nao o uuid.
    useEffect(() => {
        let vivo = true;
        if (!valorId) { setEscolhido(null); return; }
        if (escolhido?.id === valorId) return;
        (async () => {
            const { data } = await supabase
                .from('Modulos_e_Inversores')
                .select('*')
                .eq('id', valorId)
                .maybeSingle();
            if (vivo && data) setEscolhido(data);
        })();
        return () => { vivo = false; };
    }, [valorId, escolhido?.id]);

    // Fechar ao clicar fora: a lista flutua sobre o formulario.
    useEffect(() => {
        const fora = (ev) => {
            if (caixa.current && !caixa.current.contains(ev.target)) setAberto(false);
        };
        document.addEventListener('mousedown', fora);
        return () => document.removeEventListener('mousedown', fora);
    }, []);

    const buscar = useCallback(async (q) => {
        setCarregando(true);
        try {
            let consulta = supabase
                .from('Modulos_e_Inversores')
                .select('*')
                .eq('tipo_equipamento', tipo)
                .order('marca')
                .order('modelo')
                .limit(30);
            // Cada palavra tem que aparecer: "risen 700" nao pode trazer todo Risen.
            const palavras = (q || '').trim().split(/\s+/).filter(Boolean);
            palavras.forEach(p => { consulta = consulta.ilike('busca', `%${p}%`); });
            const { data, error } = await consulta;
            if (error) throw error;
            setItens(data || []);
        } catch {
            setItens([]);
        } finally {
            setCarregando(false);
        }
    }, [tipo]);

    // Espera a digitacao parar antes de ir ao banco.
    useEffect(() => {
        if (!aberto) return;
        const t = setTimeout(() => buscar(termo), 220);
        return () => clearTimeout(t);
    }, [termo, aberto, buscar]);

    const escolher = (item) => {
        setEscolhido(item);
        setTermo('');
        setAberto(false);
        onSelecionar(item);
    };

    const limpar = () => {
        setEscolhido(null);
        setTermo('');
        onSelecionar(null);
    };

    const resumo = (e) => {
        const p = [];
        if (e.tipo_equipamento === 'Modulo') {
            if (e.pmax_w) p.push(`${Number(e.pmax_w)} W`);
            if (e.tecnologia_celula) p.push(e.tecnologia_celula);
            if (e.bifacialidade_pct) p.push(`φ ${Number(e.bifacialidade_pct)}%`);
            if (e.voc_v) p.push(`Voc ${Number(e.voc_v)} V`);
        } else {
            if (e.potencia_nominal_ca_kw) p.push(`${Number(e.potencia_nominal_ca_kw)} kW CA`);
            if (e.potencia_max_stc_kwp) p.push(`até ${Number(e.potencia_max_stc_kwp)} kWp CC`);
            if (e.num_mppt) p.push(`${e.num_mppt} MPPT`);
        }
        return p.join(' · ');
    };

    const estiloCampo = {
        width: '100%', padding: '0.8rem 1rem', border: '1px solid #e2e8f0',
        borderRadius: '10px', fontSize: '1rem', outline: 'none', background: 'white'
    };

    return (
        <div ref={caixa} style={{ position: 'relative' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: '#475569', fontWeight: 600 }}>
                {rotulo}
            </label>

            {escolhido ? (
                <div style={{
                    ...estiloCampo, display: 'flex', alignItems: 'center', gap: '0.75rem',
                    background: '#f8fafc', borderColor: '#cbd5e1'
                }}>
                    <Check size={16} style={{ color: '#16a34a', flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rotuloDe(escolhido)}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{resumo(escolhido)}</div>
                    </div>
                    {!desabilitado && (
                        <button type="button" onClick={limpar} title="Desvincular"
                            style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, flexShrink: 0 }}>
                            <X size={16} />
                        </button>
                    )}
                </div>
            ) : (
                <div style={{ position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                        value={termo}
                        disabled={desabilitado}
                        placeholder={placeholder || 'Buscar por marca ou modelo...'}
                        onChange={e => { setTermo(e.target.value); setAberto(true); }}
                        onFocus={() => setAberto(true)}
                        style={{ ...estiloCampo, paddingLeft: '2.4rem' }}
                    />
                    {carregando && (
                        <Loader2 size={15} className="animate-spin"
                            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    )}
                </div>
            )}

            {aberto && !escolhido && (
                <div style={{
                    position: 'absolute', zIndex: 60, top: '100%', left: 0, right: 0, marginTop: 4,
                    background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px',
                    boxShadow: '0 10px 30px -12px rgba(15,23,42,.3)', maxHeight: 260, overflowY: 'auto'
                }}>
                    {itens.length === 0 && !carregando && (
                        <div style={{ padding: '0.9rem 1rem', color: '#64748b', fontSize: '0.85rem' }}>
                            {termo
                                ? 'Nenhum equipamento com esse termo. Cadastre-o no catálogo antes de vincular.'
                                : 'Digite marca ou modelo.'}
                        </div>
                    )}
                    {itens.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => escolher(item)}
                            style={{
                                display: 'block', width: '100%', textAlign: 'left', border: 'none',
                                background: 'none', cursor: 'pointer', padding: '0.7rem 1rem',
                                borderBottom: '1px solid #f1f5f9'
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                            <div style={{ fontWeight: 600, fontSize: '0.92rem', color: '#0f172a' }}>{rotuloDe(item)}</div>
                            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{resumo(item)}</div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
