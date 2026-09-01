import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import { Wrench, Save } from 'lucide-react';

/**
 * Serviços — valores de política da casa, não parâmetro por usina.
 *
 * O valor do O&M por módulo é o mesmo para toda a carteira; cadastrar em
 * cada usina seria repetir a mesma informação e deixá-las divergirem com
 * o tempo. Aqui é a fonte, e o contrato de cada usina herda daqui.
 */

const card = {
    background: 'white',
    padding: '1.5rem',
    borderRadius: '16px',
    border: '1px solid #f1f5f9',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
    marginBottom: '1.5rem'
};

const rotulo = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' };
const campo = { width: '100%', padding: '0.65rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' };
const grade = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem' };

const CAMPOS_OM = [
    { key: 'valorModulo', label: 'Valor por módulo (R$/mês)', tipo: 'texto' },
    { key: 'valorInversor', label: 'Valor por inversor (R$/mês)', tipo: 'texto' },
    { key: 'prazoMeses', label: 'Prazo inicial (meses)', tipo: 'texto' },
    { key: 'prazoApuracaoHoras', label: 'Início da apuração (horas úteis)', tipo: 'texto' },
    { key: 'prazoDiagnosticoDias', label: 'Diagnóstico e plano de ação (dias úteis)', tipo: 'texto' }
];

const PERIODICIDADES = ['mensal', 'bimestral', 'trimestral', 'semestral', 'anual'];

export default function ServicesSettings() {
    const { showAlert } = useUI();
    const [servico, setServico] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            // maybeSingle e não single: linha ausente é situação prevista
            // (RLS sem sessão, base nova), e merece a mensagem tranquila do
            // final deste componente em vez de "Cannot coerce the result to
            // a single JSON object" na cara de quem abriu Configurações.
            const { data, error } = await supabase
                .from('service_defaults')
                .select('*')
                .eq('codigo', 'om')
                .maybeSingle();
            if (error) throw error;
            setServico(data);
        } catch (e) {
            console.error('Erro ao carregar serviços:', e);
            showAlert('Erro ao carregar serviços: ' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [showAlert]);

    useEffect(() => { carregar(); }, [carregar]);

    const setValor = (chave, valor) =>
        setServico(prev => ({ ...prev, valores: { ...prev.valores, [chave]: valor } }));

    const salvar = async () => {
        setSaving(true);
        try {
            // Números vão como número: o gerador do contrato formata em
            // pt-BR na hora de imprimir, e string aqui obrigaria a
            // reinterpretar o formato a cada leitura.
            const valores = { ...servico.valores };
            for (const { key } of CAMPOS_OM) {
                const bruto = String(valores[key] ?? '').replace(',', '.');
                const n = Number(bruto);
                valores[key] = bruto === '' || !Number.isFinite(n) ? 0 : n;
            }

            const { error } = await supabase
                .from('service_defaults')
                .update({ valores, updated_at: new Date().toISOString() })
                .eq('id', servico.id);

            if (error) throw error;
            showAlert('Valores de serviço salvos.', 'success');
            carregar();
        } catch (e) {
            showAlert('Erro ao salvar: ' + e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <p style={{ color: '#94a3b8' }}>Carregando…</p>;
    if (!servico) return <p style={{ color: '#94a3b8' }}>Nenhum serviço cadastrado.</p>;

    const v = servico.valores || {};

    return (
        <div>
            <div style={card}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                    <Wrench size={20} color="#3b82f6" /> Serviços
                </h3>
                <p style={{ margin: '0.4rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                    Valores padrão usados nos contratos de serviço. Cada usina herda daqui e pode sobrepor no seu próprio contrato.
                </p>
            </div>

            <div style={card}>
                <h4 style={{ margin: '0 0 1rem 0', color: '#1e293b', fontSize: '0.95rem' }}>{servico.nome}</h4>

                <div style={grade}>
                    {CAMPOS_OM.map(c => (
                        <div key={c.key}>
                            <label style={rotulo}>{c.label}</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                style={campo}
                                value={v[c.key] ?? ''}
                                onChange={e => setValor(c.key, e.target.value.replace(/[^\d.,]/g, ''))}
                            />
                        </div>
                    ))}

                    <div>
                        <label style={rotulo}>Manutenção preventiva</label>
                        <select style={campo} value={v.periodicidadePreventiva || 'trimestral'} onChange={e => setValor('periodicidadePreventiva', e.target.value)}>
                            {PERIODICIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={rotulo}>Limpeza dos módulos</label>
                        <select style={campo} value={v.periodicidadeLimpeza || 'semestral'} onChange={e => setValor('periodicidadeLimpeza', e.target.value)}>
                            {PERIODICIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={rotulo}>Índice de reajuste</label>
                        <select style={campo} value={v.indiceReajuste || 'IPCA'} onChange={e => setValor('indiceReajuste', e.target.value)}>
                            <option value="IPCA">IPCA</option>
                            <option value="IGPM">IGPM</option>
                        </select>
                    </div>
                </div>

                <div style={{ marginTop: '1.25rem', padding: '0.9rem 1rem', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', fontSize: '0.84rem', color: '#0369a1' }}>
                    O valor mensal de cada usina é apurado como
                    <strong> (valor por módulo × nº de módulos) + (valor por inversor × nº de inversores)</strong>,
                    com os números vindos do cadastro técnico da usina.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                    <button
                        type="button"
                        disabled={saving}
                        onClick={salvar}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.4rem', background: saving ? '#94a3b8' : '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
                    >
                        <Save size={16} /> {saving ? 'Salvando…' : 'Salvar valores'}
                    </button>
                </div>
            </div>
        </div>
    );
}
