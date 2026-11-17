import { useEffect, useState } from 'react';
import { Plus, Trash2, Ticket, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { CARGOS_ORIGINADOR, ROTULO_CARGO } from '../../../lib/planoOriginador';
import { TIPOS_VOUCHER, validarVoucher, payloadVoucher, descreverVoucher, dataBr } from '../../../lib/licencaOriginador';

const VOUCHER_VAZIO = { codigo: '', tipo: 'percentual', valor: '', validade: '', limite_usos: '', cargos: [...CARGOS_ORIGINADOR], descricao: '' };

/**
 * Vouchers da licença deste Plano do Originador (dono, 13/11/2026). Cada
 * voucher isenta ou dá desconto na licença anual; no modal do originador a
 * equipe só digita o código. Gravados direto na tabela (só admin escreve).
 */
export default function VouchersPlanoOriginador({ planoId, showAlert }) {
    const [lista, setLista] = useState([]);
    const [usos, setUsos] = useState({});
    const [estado, setEstado] = useState('carregando'); // carregando | ok | erro
    const [novo, setNovo] = useState(VOUCHER_VAZIO);
    const [erros, setErros] = useState([]);
    const [salvando, setSalvando] = useState(false);

    const [versao, setVersao] = useState(0);
    const carregar = () => setVersao(v => v + 1);

    useEffect(() => {
        if (!planoId) return undefined;
        let cancelado = false;
        (async () => {
            const { data, error } = await supabase
                .from('originador_vouchers')
                .select('*')
                .eq('plano_originador_id', planoId)
                .order('created_at', { ascending: false });
            if (cancelado) return;
            if (error) {
                console.error('Erro ao carregar vouchers:', error);
                setEstado('erro');
                return;
            }
            const ids = (data || []).map(v => v.id);
            const conta = {};
            if (ids.length) {
                const { data: usados } = await supabase.from('originators_v2').select('licenca_voucher_id').in('licenca_voucher_id', ids);
                (usados || []).forEach(o => { conta[o.licenca_voucher_id] = (conta[o.licenca_voucher_id] || 0) + 1; });
            }
            if (cancelado) return;
            setLista(data || []);
            setUsos(conta);
            setEstado('ok');
        })();
        return () => { cancelado = true; };
    }, [planoId, versao]);

    const criar = async () => {
        const listaErros = validarVoucher(novo);
        if (!novo.cargos.length) listaErros.push('Marque pelo menos um cargo.');
        setErros(listaErros);
        if (listaErros.length) return;
        setSalvando(true);
        const { error } = await supabase.from('originador_vouchers').insert([payloadVoucher(novo, planoId)]);
        setSalvando(false);
        if (error) {
            const repetido = /duplicate|unique/i.test(error.message || '');
            showAlert?.(repetido ? 'Já existe um voucher com este código.' : 'Erro ao criar voucher: ' + error.message, 'error');
            return;
        }
        setNovo(VOUCHER_VAZIO);
        setErros([]);
        showAlert?.('Voucher criado.', 'success');
        carregar();
    };

    const alternarAtivo = async (v) => {
        const { error } = await supabase.from('originador_vouchers').update({ ativo: !v.ativo }).eq('id', v.id);
        if (error) return showAlert?.('Erro ao atualizar voucher: ' + error.message, 'error');
        carregar();
    };

    const excluir = async (v) => {
        if (usos[v.id]) {
            showAlert?.(`O voucher ${v.codigo} está em uso por ${usos[v.id]} parceiro(s). Desative em vez de excluir.`, 'error');
            return;
        }
        if (!confirm(`Excluir o voucher ${v.codigo}?`)) return;
        const { error } = await supabase.from('originador_vouchers').delete().eq('id', v.id);
        if (error) return showAlert?.('Erro ao excluir voucher: ' + error.message, 'error');
        carregar();
    };

    const rotulo = {
        display: 'block',
        fontSize: '0.72rem',
        fontWeight: 700,
        color: '#475569',
        marginBottom: '0.32rem',
        textTransform: 'uppercase',
        letterSpacing: '0.025em'
    };
    const campo = {
        width: '100%',
        padding: '0.52rem 0.7rem',
        borderRadius: '8px',
        fontSize: '0.84rem',
        boxSizing: 'border-box',
        border: '1px solid #cbd5e1',
        background: '#ffffff',
        color: '#0f172a',
        outline: 'none'
    };
    const ajuda = { margin: 0, fontSize: '0.76rem', color: '#64748b', lineHeight: 1.45 };

    if (!planoId) {
        return (
            <div style={{
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                background: '#f8fafc',
                border: '1px dashed #cbd5e1',
                fontSize: '0.8rem',
                color: '#64748b'
            }}>
                Salve o plano primeiro para habilitar o cadastro de vouchers de licença.
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            {estado === 'erro' && <p style={{ ...ajuda, color: '#b91c1c', fontWeight: 600 }}>Não foi possível carregar os vouchers deste plano.</p>}
            {estado === 'ok' && lista.length === 0 && (
                <div style={{ padding: '0.75rem 1rem', borderRadius: '10px', background: '#f8fafc', border: '1px dashed #cbd5e1', fontSize: '0.8rem', color: '#64748b' }}>
                    Nenhum voucher cadastrado neste plano.
                </div>
            )}
            {lista.length > 0 && (
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                <th style={{ padding: '0.6rem 0.85rem' }}>Código</th>
                                <th style={{ padding: '0.6rem 0.85rem' }}>Benefício</th>
                                <th style={{ padding: '0.6rem 0.85rem' }}>Cargos Elegíveis</th>
                                <th style={{ padding: '0.6rem 0.85rem' }}>Validade</th>
                                <th style={{ padding: '0.6rem 0.85rem' }}>Usos</th>
                                <th style={{ padding: '0.6rem 0.85rem' }}>Situação</th>
                                <th style={{ padding: '0.6rem 0.85rem', textAlign: 'right' }}>Ação</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lista.map(v => (
                                <tr key={v.id} style={{ borderBottom: '1px solid #f1f5f9', color: v.ativo ? '#0f172a' : '#94a3b8', background: '#ffffff' }}>
                                    <td style={{ padding: '0.65rem 0.85rem' }}>
                                        <span style={{
                                            fontWeight: 800,
                                            fontFamily: 'monospace',
                                            background: v.ativo ? '#f0fdfa' : '#f1f5f9',
                                            color: v.ativo ? '#0f766e' : '#64748b',
                                            border: `1px solid ${v.ativo ? '#99f6e4' : '#e2e8f0'}`,
                                            padding: '0.18rem 0.5rem',
                                            borderRadius: '6px',
                                            fontSize: '0.78rem'
                                        }}>
                                            {v.codigo}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{descreverVoucher(v)}</td>
                                    <td style={{ padding: '0.65rem 0.85rem', fontSize: '0.78rem', color: '#475569' }}>
                                        {v.cargos?.length ? v.cargos.map(c => ROTULO_CARGO[c] || c).join(', ') : 'Todos'}
                                    </td>
                                    <td style={{ padding: '0.65rem 0.85rem', fontVariantNumeric: 'tabular-nums' }}>
                                        {v.validade ? dataBr(v.validade) : 'Sem validade'}
                                    </td>
                                    <td style={{ padding: '0.65rem 0.85rem', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                        {usos[v.id] || 0}{v.limite_usos ? ` / ${v.limite_usos}` : ''}
                                    </td>
                                    <td style={{ padding: '0.65rem 0.85rem' }}>
                                        <button
                                            type="button"
                                            onClick={() => alternarAtivo(v)}
                                            style={{
                                                border: `1px solid ${v.ativo ? '#bbf7d0' : '#cbd5e1'}`,
                                                background: v.ativo ? '#f0fdf4' : '#f8fafc',
                                                borderRadius: '999px',
                                                padding: '0.2rem 0.6rem',
                                                cursor: 'pointer',
                                                fontSize: '0.72rem',
                                                fontWeight: 700,
                                                color: v.ativo ? '#15803d' : '#64748b',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '0.25rem'
                                            }}
                                        >
                                            {v.ativo ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                                            {v.ativo ? 'Ativo' : 'Inativo'}
                                        </button>
                                    </td>
                                    <td style={{ padding: '0.65rem 0.85rem', textAlign: 'right' }}>
                                        <button
                                            type="button"
                                            onClick={() => excluir(v)}
                                            title="Excluir voucher"
                                            style={{
                                                border: '1px solid #fecaca',
                                                background: '#fef2f2',
                                                borderRadius: '6px',
                                                padding: '0.32rem',
                                                cursor: 'pointer',
                                                color: '#dc2626',
                                                display: 'inline-flex'
                                            }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '0.95rem 1.1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>
                    <Ticket size={16} color="#0f766e" /> Cadastrar Novo Voucher de Licença
                </div>
                {erros.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.76rem', color: '#b91c1c', fontWeight: 600 }}>
                        {erros.map(e => <li key={e}>{e}</li>)}
                    </ul>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '0.65rem' }}>
                    <div>
                        <label style={rotulo}>Código</label>
                        <input
                            value={novo.codigo}
                            onChange={e => setNovo({ ...novo, codigo: e.target.value.toUpperCase() })}
                            placeholder="PRO50"
                            style={{ ...campo, fontFamily: 'monospace', fontWeight: 700 }}
                        />
                    </div>
                    <div>
                        <label style={rotulo}>Tipo de Benefício</label>
                        <select value={novo.tipo} onChange={e => setNovo({ ...novo, tipo: e.target.value })} style={campo}>
                            {TIPOS_VOUCHER.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                        </select>
                    </div>
                    {novo.tipo !== 'isencao' && (
                        <div>
                            <label style={rotulo}>{novo.tipo === 'percentual' ? 'Desconto (%)' : 'Desconto (R$)'}</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={novo.valor}
                                onChange={e => setNovo({ ...novo, valor: e.target.value })}
                                style={{ ...campo, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}
                            />
                        </div>
                    )}
                    <div>
                        <label style={rotulo}>Validade (opcional)</label>
                        <input
                            type="date"
                            value={novo.validade}
                            onChange={e => setNovo({ ...novo, validade: e.target.value })}
                            style={{ ...campo, fontVariantNumeric: 'tabular-nums' }}
                        />
                    </div>
                    <div>
                        <label style={rotulo}>Limite de usos</label>
                        <input
                            type="number"
                            min="1"
                            step="1"
                            value={novo.limite_usos}
                            onChange={e => setNovo({ ...novo, limite_usos: e.target.value })}
                            placeholder="Sem limite"
                            style={{ ...campo, fontVariantNumeric: 'tabular-nums' }}
                        />
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr auto', gap: '0.85rem', alignItems: 'end' }}>
                    <div>
                        <label style={rotulo}>Cargos Elegíveis</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.78rem', color: '#334155', paddingTop: '0.2rem' }}>
                            {CARGOS_ORIGINADOR.map(c => {
                                const checked = novo.cargos.includes(c);
                                return (
                                    <label
                                        key={c}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.3rem',
                                            cursor: 'pointer',
                                            padding: '0.25rem 0.55rem',
                                            borderRadius: '6px',
                                            background: checked ? '#f0fdfa' : '#ffffff',
                                            border: `1px solid ${checked ? '#99f6e4' : '#cbd5e1'}`,
                                            fontWeight: checked ? 700 : 500,
                                            color: checked ? '#0f766e' : '#475569'
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={e => setNovo({ ...novo, cargos: e.target.checked ? [...novo.cargos, c] : novo.cargos.filter(x => x !== c) })}
                                        />
                                        {ROTULO_CARGO[c]}
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                    <div>
                        <label style={rotulo}>Observação (opcional)</label>
                        <input
                            value={novo.descricao}
                            onChange={e => setNovo({ ...novo, descricao: e.target.value })}
                            placeholder="Ex.: campanha de lançamento"
                            style={campo}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={criar}
                        disabled={salvando}
                        style={{
                            height: '38px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            padding: '0 1rem',
                            borderRadius: '8px',
                            border: 'none',
                            background: '#0f766e',
                            color: 'white',
                            fontWeight: 700,
                            fontSize: '0.82rem',
                            cursor: salvando ? 'wait' : 'pointer',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        <Plus size={15} /> {salvando ? 'Criando...' : 'Criar voucher'}
                    </button>
                </div>
            </div>
        </div>
    );
}
