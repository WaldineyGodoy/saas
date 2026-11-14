import { useEffect, useState } from 'react';
import { BadgeCheck, Ticket, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CARGOS_ORIGINADOR, ROTULO_CARGO } from '../lib/planoOriginador';
import {
    resumoLicenca,
    problemaVoucher,
    normalizarCodigo,
    descreverVoucher,
    dataBr,
    ROTULO_STATUS_LICENCA
} from '../lib/licencaOriginador';
import BoletoLicencaOriginador from './BoletoLicencaOriginador';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const COR_STATUS = {
    isenta: { bg: '#f1f5f9', fg: '#475569' },
    pendente: { bg: '#fef3c7', fg: '#92400e' },
    ativa: { bg: '#dcfce7', fg: '#166534' },
    vencida: { bg: '#fee2e2', fg: '#991b1b' }
};

/**
 * Cargo, Líder e licença anual do originador (dono, 13/11/2026).
 *
 * O preço vem do Plano do Originador (por cargo). Aqui a equipe escolhe o
 * cargo e o Líder, digita um voucher (isenção ou desconto) e informa a data
 * do pagamento à mão; o boleto do Asaas (14/11/2026) dá a baixa sozinho. O vencimento é
 * 1 ano depois do pagamento. Tudo vai no Salvar do modal; o banco recalcula
 * e confere o voucher por gatilho.
 *
 * Props: value { cargo, lider_id, licenca_paga_em, licenca_voucher_id },
 * onChange(parcial), plano (o plano do originador), originatorId.
 */
export default function LicencaOriginador({ value, onChange, plano, originatorId, cargoSalvo, originatorSalvo, labelStyle, inputStyle }) {
    const [lideres, setLideres] = useState([]);
    const [voucher, setVoucher] = useState(null);
    const [codigo, setCodigo] = useState('');
    const [erroVoucher, setErroVoucher] = useState(null);
    const [buscando, setBuscando] = useState(false);

    useEffect(() => {
        let cancelado = false;
        supabase.from('originators_v2').select('id, name').eq('cargo', 'lider').order('name')
            .then(({ data }) => { if (!cancelado) setLideres((data || []).filter(l => l.id !== originatorId)); });
        return () => { cancelado = true; };
    }, [originatorId]);

    // Voucher já aplicado: carrega para mostrar o desconto.
    useEffect(() => {
        let cancelado = false;
        if (!value.licenca_voucher_id) { setVoucher(null); return undefined; }
        if (voucher?.id === value.licenca_voucher_id) return undefined;
        supabase.from('originador_vouchers').select('*').eq('id', value.licenca_voucher_id).maybeSingle()
            .then(({ data }) => { if (!cancelado) setVoucher(data || null); });
        return () => { cancelado = true; };
    }, [value.licenca_voucher_id]); // eslint-disable-line react-hooks/exhaustive-deps

    const r = resumoLicenca({ plano, cargo: value.cargo, voucher, pagaEm: value.licenca_paga_em || null });
    const cor = COR_STATUS[r.status];

    const mudarCargo = (cargo) => {
        // Cargo novo, licença nova (o banco faz o mesmo ao salvar).
        const volta = cargo === cargoSalvo;
        onChange({ cargo, ...(volta ? {} : { licenca_paga_em: '', licenca_voucher_id: null }), ...(cargo === 'lider' ? { lider_id: null } : {}) });
        if (!volta) { setVoucher(null); setErroVoucher(null); }
    };

    const aplicarVoucher = async () => {
        const cod = normalizarCodigo(codigo);
        if (!cod) return;
        setErroVoucher(null);
        setBuscando(true);
        try {
            const { data, error } = await supabase.from('originador_vouchers').select('*')
                .ilike('codigo', cod.replace(/[\\%_]/g, '\\$&')).maybeSingle();
            if (error) throw error;
            let usos = 0;
            if (data?.limite_usos) {
                const { count } = await supabase.from('originators_v2').select('id', { count: 'exact', head: true })
                    .eq('licenca_voucher_id', data.id).neq('id', originatorId || '00000000-0000-0000-0000-000000000000');
                usos = count || 0;
            }
            const problema = problemaVoucher(data, { planoId: plano?.id, cargo: value.cargo, usos });
            if (problema) { setErroVoucher(problema); return; }
            setVoucher(data);
            setCodigo('');
            onChange({ licenca_voucher_id: data.id });
        } catch (err) {
            setErroVoucher('Não foi possível conferir o voucher: ' + err.message);
        } finally {
            setBuscando(false);
        }
    };

    const tirarVoucher = () => {
        setVoucher(null);
        onChange({ licenca_voucher_id: null });
    };

    const caixa = { background: 'white', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '0.85rem 1rem' };
    const miudo = { margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 };

    return (
        <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '20px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <BadgeCheck size={18} color="#0f766e" />
                <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>Cargo e licença</strong>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <div>
                    <label style={labelStyle}>Cargo</label>
                    <select value={value.cargo} onChange={e => mudarCargo(e.target.value)} style={inputStyle}>
                        {CARGOS_ORIGINADOR.map(c => <option key={c} value={c}>{ROTULO_CARGO[c]}</option>)}
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>Líder</label>
                    <select
                        value={value.lider_id || ''}
                        disabled={value.cargo === 'lider'}
                        onChange={e => onChange({ lider_id: e.target.value || null })}
                        style={{ ...inputStyle, background: value.cargo === 'lider' ? '#f1f5f9' : 'white' }}
                    >
                        <option value="">Sem Líder</option>
                        {lideres.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                </div>
            </div>
            {cargoSalvo && value.cargo !== cargoSalvo && (
                <p style={{ ...miudo, color: '#92400e' }}>Trocar o cargo recomeça a licença: o pagamento e o voucher do cargo anterior não valem para o novo.</p>
            )}

            <div style={caixa}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.6rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>Licença anual — {ROTULO_CARGO[value.cargo]}</span>
                    <span style={{ background: cor.bg, color: cor.fg, borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.76rem', fontWeight: 700 }}>
                        {ROTULO_STATUS_LICENCA[r.status]}
                    </span>
                </div>

                {r.status === 'isenta' && !(r.preco > 0) ? (
                    <p style={miudo}>O plano {plano?.nome ? `"${plano.nome}"` : 'deste originador'} não cobra licença deste cargo.</p>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', fontSize: '0.84rem', color: '#0f172a' }}>
                        <div>
                            <div style={miudo}>Preço no plano</div>
                            <strong>{reais(r.preco)}</strong>
                        </div>
                        <div>
                            <div style={miudo}>A pagar</div>
                            <strong>{reais(r.valor)}</strong>
                            {r.desconto > 0 && <div style={miudo}>− {reais(r.desconto)} do voucher</div>}
                        </div>
                        <div>
                            <label style={{ ...miudo, display: 'block' }}>Pago em</label>
                            <input
                                type="date"
                                value={value.licenca_paga_em || ''}
                                onChange={e => onChange({ licenca_paga_em: e.target.value })}
                                style={{ ...inputStyle, padding: '0.45rem 0.6rem', fontSize: '0.85rem' }}
                            />
                        </div>
                        <div>
                            <div style={miudo}>Expira em</div>
                            <strong>{r.vencimento ? dataBr(r.vencimento) : '—'}</strong>
                            {!r.vencimento && <div style={miudo}>1 ano após o pagamento</div>}
                        </div>
                    </div>
                )}

                {r.preco > 0 && !r.emDia && (
                    <p style={{ ...miudo, marginTop: '0.6rem', color: '#92400e' }}>
                        Enquanto a licença não estiver paga, este parceiro recebe como PPF — Free.
                    </p>
                )}
            </div>

            {originatorSalvo && (r.preco > 0 || Number(originatorSalvo.licenca_preco) > 0) && (
                <BoletoLicencaOriginador
                    originator={originatorSalvo}
                    alterado={value.cargo !== (originatorSalvo.cargo || 'ppf')
                        || (value.licenca_voucher_id || null) !== (originatorSalvo.licenca_voucher_id || null)
                        || (plano?.id && originatorSalvo.plano_originador_id && plano.id !== originatorSalvo.plano_originador_id)}
                />
            )}

            {r.preco > 0 && (
                <div style={caixa}>
                    <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Ticket size={14} /> Voucher</label>
                    {voucher ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{voucher.codigo}</span>
                            <span style={{ color: '#475569' }}>{descreverVoucher(voucher)}</span>
                            <button type="button" onClick={tirarVoucher} title="Tirar voucher" style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.78rem' }}>
                                <X size={14} /> Tirar
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                                value={codigo}
                                onChange={e => setCodigo(e.target.value.toUpperCase())}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); aplicarVoucher(); } }}
                                placeholder="Código do voucher"
                                style={{ ...inputStyle, fontFamily: 'monospace' }}
                            />
                            <button
                                type="button"
                                onClick={aplicarVoucher}
                                disabled={buscando || !codigo.trim()}
                                style={{ padding: '0 1rem', borderRadius: '12px', border: 'none', background: '#0f766e', color: 'white', fontWeight: 700, cursor: buscando ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
                            >
                                {buscando ? 'Conferindo...' : 'Aplicar'}
                            </button>
                        </div>
                    )}
                    {erroVoucher && <p style={{ ...miudo, marginTop: '0.4rem', color: '#b91c1c' }}>{erroVoucher}</p>}
                    <p style={{ ...miudo, marginTop: '0.4rem' }}>O voucher entra ao salvar. Isenção total ativa a licença na data em que for salva.</p>
                </div>
            )}
        </div>
    );
}
