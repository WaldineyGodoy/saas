import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Loader2, RefreshCw, Upload, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { parseEnergyBill } from '../lib/energyBillParser';
import { parseEnergyBillImage } from '../lib/energyBillImage';
import { ORIGENS_HISTORICO, montarPerfil, medianaDoPerfil, perfilParaLista, perfilTemDados, ehErroBancoDesatualizado, gravarHistoricoConsumo } from '../lib/historicoConsumo';

const CORES_ORIGEM = {
    cadastro: { fundo: '#eff6ff', borda: '#bfdbfe', texto: '#1d4ed8', barra: '#3b82f6' },
    conta: { fundo: '#f0fdf4', borda: '#bbf7d0', texto: '#15803d', barra: '#22c55e' },
    mediana: { fundo: '#fffbeb', borda: '#fde68a', texto: '#b45309', barra: '#f59e0b' },
    franquia: { fundo: '#f1f5f9', borda: '#cbd5e1', texto: '#475569', barra: '#94a3b8' },
};

const fmtKwh = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)))
    ? '—'
    : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kWh`;

const fmtData = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};

const fmtRef = (ref) => {
    const m = /^(\d{4})-(\d{2})$/.exec(ref || '');
    return m ? `${m[2]}/${m[1]}` : '—';
};

function SeloOrigem({ origem }) {
    if (!origem) return <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>sem dado</span>;
    const c = CORES_ORIGEM[origem] || CORES_ORIGEM.franquia;
    return (
        <span style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: '999px', background: c.fundo, border: `1px solid ${c.borda}`, color: c.texto, whiteSpace: 'nowrap' }}>
            {ORIGENS_HISTORICO[origem] || origem}
        </span>
    );
}

function Cartao({ titulo, valor, nota }) {
    return (
        <div style={{ flex: '1 1 200px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.85rem 1rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{titulo}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', marginTop: '0.2rem' }}>{valor}</div>
            {nota && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>{nota}</div>}
        </div>
    );
}

/**
 * Seção "Histórico de consumo" do modal da UC (aba Faturas e Contas de
 * Energia). Mostra o perfil de 12 meses gravado no banco, a mediana atual e a
 * base do Start (congelada no cadastro). Sem perfil, permite importar o
 * histórico de uma conta de energia.
 */
export default function HistoricoConsumo({ ucId, numerosUc = [], podeImportar = false, recarregarEm = 0 }) {
    const { showAlert, showConfirm } = useUI();
    const inputRef = useRef(null);
    const [carregando, setCarregando] = useState(true);
    const [semBanco, setSemBanco] = useState(false);
    const [erro, setErro] = useState('');
    const [dados, setDados] = useState(null);
    const [importando, setImportando] = useState(false);

    const carregar = useCallback(async () => {
        if (!ucId) return;
        setCarregando(true);
        setErro('');
        try {
            const { data, error } = await supabase
                .from('consumer_units')
                .select('historico_consumo, consumo_mediano_kwh, start_base_kwh, start_base_em')
                .eq('id', ucId)
                .maybeSingle();
            if (error) {
                if (ehErroBancoDesatualizado(error)) { setSemBanco(true); return; }
                throw error;
            }
            setSemBanco(false);
            setDados(data || null);
        } catch (e) {
            console.error('Histórico de consumo da UC:', e);
            setErro(e.message || 'Falha ao carregar o histórico de consumo.');
        } finally {
            setCarregando(false);
        }
    }, [ucId]);

    useEffect(() => { carregar(); }, [carregar, recarregarEm]);

    const importarDaConta = async (e) => {
        const arquivo = e.target.files?.[0];
        e.target.value = '';
        if (!arquivo) return;
        const ehPdf = arquivo.type === 'application/pdf';
        if (!ehPdf && !arquivo.type.startsWith('image/')) {
            showAlert('Selecione o PDF ou uma foto da conta.', 'error');
            return;
        }
        const alvos = numerosUc.filter(Boolean);
        setImportando(true);
        try {
            const leitura = ehPdf ? await parseEnergyBill(arquivo, alvos) : await parseEnergyBillImage(arquivo, alvos);
            if (alvos.length && leitura.isUcMatch === false) {
                throw new Error(`Esta conta é da UC ${leitura.numeroUc || 'desconhecida'}, não desta.`);
            }
            const historico = Array.isArray(leitura.historico) ? leitura.historico : [];
            if (!historico.length) throw new Error('Não encontrei o histórico de consumo nesta conta.');

            const perfil = montarPerfil(historico, 'cadastro');
            const mediana = medianaDoPerfil(perfil);
            const ok = await showConfirm(
                `A conta traz ${historico.length} mês(es) de histórico, mediana de ${fmtKwh(mediana)}. Gravar como histórico de consumo desta UC? A base do Start fica fixada nessa mediana, se ainda não estiver.`,
                'Importar histórico de consumo',
                'Gravar histórico',
                'Cancelar'
            );
            if (!ok) return;

            const r = await gravarHistoricoConsumo(supabase, ucId, historico, 'cadastro');
            if (!r.ok) {
                if (r.semBanco) { setSemBanco(true); throw new Error('O banco ainda não tem o histórico de consumo. Tente de novo depois da atualização.'); }
                throw new Error(r.error?.message || 'Falha ao gravar o histórico.');
            }
            showAlert('Histórico de consumo gravado.', 'success');
            await carregar();
        } catch (err) {
            console.error('Importar histórico de consumo:', err);
            showAlert(err.message || 'Falha ao ler a conta.', 'error');
        } finally {
            setImportando(false);
        }
    };

    const perfil = dados?.historico_consumo;
    const temPerfil = perfilTemDados(perfil);
    const linhas = perfilParaLista(perfil);
    const maximo = Math.max(1, ...linhas.map(l => Number(l.kwh) || 0));
    const mediana = dados?.consumo_mediano_kwh ?? (temPerfil ? medianaDoPerfil(perfil) : null);

    return (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', borderBottom: '1.5px solid #f1f5f9', paddingBottom: '0.85rem', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <BarChart3 size={18} color="var(--color-blue)" /> Histórico de consumo
                </h4>
                {!semBanco && !carregando && (
                    <button type="button" onClick={carregar} title="Recarregar" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.6rem', border: '1px solid #cbd5e1', background: 'white', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                        <RefreshCw size={13} /> Recarregar
                    </button>
                )}
            </div>

            {carregando ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem', color: '#64748b' }}>
                    <Loader2 className="animate-spin" size={22} />
                </div>
            ) : semBanco ? (
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.85rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '0.8rem 1rem' }}>
                    <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>Aguardando atualização do banco: o histórico de consumo por mês ainda não está disponível neste ambiente.</span>
                </div>
            ) : erro ? (
                <div style={{ fontSize: '0.85rem', color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '0.8rem 1rem' }}>{erro}</div>
            ) : !temPerfil ? (
                <div style={{ textAlign: 'center', padding: '1.5rem 1rem', color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                    <Info size={32} color="#cbd5e1" />
                    <span style={{ fontSize: '0.875rem', maxWidth: 520, lineHeight: 1.5 }}>
                        Esta UC ainda não tem histórico de consumo. Ele é preenchido quando a conta de energia é enviada no cadastro
                        (os 12 meses do quadro &quot;consumo faturado&quot;) e cada conta nova atualiza o mês dela.
                    </span>
                    {podeImportar && (
                        <>
                            <input ref={inputRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={importarDaConta} />
                            <button
                                type="button"
                                disabled={importando}
                                onClick={() => inputRef.current?.click()}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', cursor: importando ? 'wait' : 'pointer' }}
                            >
                                {importando ? <RefreshCw size={15} className="animate-spin" /> : <Upload size={15} />}
                                {importando ? 'Lendo a conta...' : 'Importar de uma conta (PDF ou foto)'}
                            </button>
                        </>
                    )}
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <Cartao titulo="Consumo médio (mediana)" valor={fmtKwh(mediana)} nota="Recalculada a cada conta nova" />
                        <Cartao
                            titulo="Base do Start"
                            valor={fmtKwh(dados?.start_base_kwh)}
                            nota={dados?.start_base_kwh != null
                                ? (dados?.start_base_em ? `Fixada em ${fmtData(dados.start_base_em)}` : 'Fixada no cadastro')
                                : 'Ainda não fixada'}
                        />
                    </div>

                    {/* Gráfico de barras simples, um mês do calendário por coluna */}
                    <div role="img" aria-label="Consumo por mês do calendário" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.4rem', alignItems: 'end', height: 140, padding: '0 0.25rem' }}>
                        {linhas.map(l => {
                            const c = CORES_ORIGEM[l.origem] || CORES_ORIGEM.franquia;
                            const altura = l.kwh ? Math.max(4, Math.round((Number(l.kwh) / maximo) * 110)) : 0;
                            return (
                                <div key={l.mes} title={`${l.nome}${l.ref ? ` (${fmtRef(l.ref)})` : ''}: ${fmtKwh(l.kwh)}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: '0.25rem' }}>
                                    <div style={{ width: '100%', maxWidth: 28, height: altura, background: l.kwh ? c.barra : 'transparent', opacity: l.origem === 'mediana' || l.origem === 'franquia' ? 0.55 : 1, borderRadius: '4px 4px 0 0', border: l.kwh ? 'none' : '1px dashed #cbd5e1' }} />
                                    <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>{l.nome}</span>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                                    <th style={{ padding: '0.5rem', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Mês</th>
                                    <th style={{ padding: '0.5rem', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Referência</th>
                                    <th style={{ padding: '0.5rem', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'right' }}>kWh</th>
                                    <th style={{ padding: '0.5rem', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Origem</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhas.map(l => (
                                    <tr key={l.mes} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '0.5rem', fontWeight: 600, color: '#475569' }}>{l.nome}</td>
                                        <td style={{ padding: '0.5rem', color: '#64748b' }}>{fmtRef(l.ref)}</td>
                                        <td style={{ padding: '0.5rem', fontWeight: 700, color: '#0f172a', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtKwh(l.kwh)}</td>
                                        <td style={{ padding: '0.5rem' }}><SeloOrigem origem={l.origem} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5 }}>
                        Meses zerados ou ausentes recebem a mediana dos meses com consumo. A base do Start não muda depois de fixada;
                        o teto do Start do parceiro é o multiplicador do plano vezes essa base.
                    </p>
                </>
            )}
        </div>
    );
}
