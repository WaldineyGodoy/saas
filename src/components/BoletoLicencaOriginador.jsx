import { useEffect, useState } from 'react';
import { Receipt, ExternalLink, Copy, Ban } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { dataBr } from '../lib/licencaOriginador';
import { situacaoBoleto, ROTULO_STATUS_BOLETO } from '../lib/boletoLicenca';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const COR = {
    pendente: { bg: '#fef3c7', fg: '#92400e' },
    vencido: { bg: '#fee2e2', fg: '#991b1b' },
    pago: { bg: '#dcfce7', fg: '#166534' },
    cancelado: { bg: '#f1f5f9', fg: '#64748b' }
};

const erroDaFuncao = async (data, error) => {
    let msg = data?.error;
    const ctx = error?.context;
    if (!msg && ctx?.json) {
        try { msg = (await ctx.json())?.error; } catch { /* corpo não-JSON */ }
    }
    return msg || error?.message || 'Erro desconhecido.';
};

/**
 * Boleto da licença no Asaas (dono, 14/11/2026). Usa o que está SALVO no
 * originador: com alteração de cargo, plano ou voucher ainda não salva, pede
 * para salvar antes. A baixa vem sozinha pelo webhook do Asaas.
 */
export default function BoletoLicencaOriginador({ originator, alterado }) {
    const [lista, setLista] = useState([]);
    const [versao, setVersao] = useState(0);
    const [ocupado, setOcupado] = useState(false);
    const [erro, setErro] = useState(null);
    const [aviso, setAviso] = useState(null);

    useEffect(() => {
        if (!originator?.id) return undefined;
        let cancelado = false;
        supabase.from('originador_licenca_cobrancas').select('*')
            .eq('originator_id', originator.id).order('created_at', { ascending: false }).limit(5)
            .then(({ data }) => { if (!cancelado) setLista(data || []); });
        return () => { cancelado = true; };
    }, [originator?.id, versao]);

    if (!originator?.id) return null;

    const sit = situacaoBoleto({ originator, cobrancas: lista });
    const aberto = lista.find(c => c.status === 'pendente' || c.status === 'vencido');

    const chamar = async (corpo) => {
        setErro(null); setAviso(null); setOcupado(true);
        try {
            const { data, error } = await supabase.functions.invoke('licenca-originador-cobranca', { body: corpo });
            if (error || !data?.success) throw new Error(await erroDaFuncao(data, error));
            setVersao(v => v + 1);
            return data;
        } catch (e) {
            setErro(e.message);
            return null;
        } finally {
            setOcupado(false);
        }
    };

    const gerar = async () => {
        const r = await chamar({ acao: 'gerar', originator_id: originator.id });
        if (r) setAviso(r.existente ? 'Já havia um boleto em aberto; mantido o mesmo.' : 'Boleto gerado no Asaas.');
    };

    const cancelar = async () => {
        if (!aberto || !confirm('Cancelar este boleto no Asaas?')) return;
        const r = await chamar({ acao: 'cancelar', cobranca_id: aberto.id });
        if (r) setAviso('Boleto cancelado.');
    };

    const copiar = (t) => navigator.clipboard?.writeText(t).then(() => setAviso('Linha digitável copiada.')).catch(() => {});

    const miudo = { margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 };
    const botao = (cor) => ({ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 0.9rem', borderRadius: '10px', border: 'none', background: cor, color: 'white', fontWeight: 700, fontSize: '0.82rem', cursor: ocupado ? 'wait' : 'pointer' });

    return (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
                <Receipt size={15} /> Boleto da licença
            </div>

            {aberto && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.84rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                        <strong>{reais(aberto.valor)}</strong>
                        <span style={{ color: '#475569' }}>vence {dataBr(aberto.vencimento)}</span>
                        <span style={{ color: '#475569' }}>{aberto.tipo === 'renovacao' ? 'renovação' : 'adesão'}</span>
                        <span style={{ background: COR[aberto.status].bg, color: COR[aberto.status].fg, borderRadius: '999px', padding: '0.1rem 0.6rem', fontSize: '0.74rem', fontWeight: 700 }}>
                            {ROTULO_STATUS_BOLETO[aberto.status]}
                        </span>
                    </div>
                    {aberto.linha_digitavel && (
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <code style={{ fontSize: '0.74rem', background: '#f8fafc', padding: '0.3rem 0.5rem', borderRadius: '6px', wordBreak: 'break-all' }}>{aberto.linha_digitavel}</code>
                            <button type="button" onClick={() => copiar(aberto.linha_digitavel)} title="Copiar" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#0f766e' }}><Copy size={15} /></button>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {(aberto.boleto_url || aberto.fatura_url) && (
                            <a href={aberto.boleto_url || aberto.fatura_url} target="_blank" rel="noreferrer" style={{ ...botao('#0284c7'), textDecoration: 'none' }}>
                                <ExternalLink size={14} /> Abrir boleto
                            </a>
                        )}
                        <button type="button" onClick={cancelar} disabled={ocupado} style={botao('#b91c1c')}>
                            <Ban size={14} /> Cancelar boleto
                        </button>
                    </div>
                    {(Number(aberto.valor) !== Number(originator.licenca_valor) || aberto.cargo !== originator.cargo) && (
                        <p style={{ ...miudo, color: '#b91c1c' }}>O cargo ou o valor da licença mudou depois deste boleto. Cancele e gere outro.</p>
                    )}
                </div>
            )}

            {!aberto && (
                <>
                    <p style={miudo}>{sit.texto}</p>
                    {sit.podeGerar && (
                        <button type="button" onClick={gerar} disabled={ocupado || alterado} style={{ ...botao(alterado ? '#94a3b8' : '#0f766e'), alignSelf: 'flex-start' }}>
                            <Receipt size={14} /> {ocupado ? 'Gerando...' : `Gerar boleto de ${reais(originator.licenca_valor)}`}
                        </button>
                    )}
                    {sit.podeGerar && alterado && <p style={{ ...miudo, color: '#92400e' }}>Salve as alterações de cargo, plano ou voucher antes de gerar o boleto.</p>}
                </>
            )}

            {lista.filter(c => c.status === 'pago').slice(0, 1).map(c => (
                <p key={c.id} style={miudo}>Último pagamento: {reais(c.valor)} em {dataBr(c.pago_em)}{c.licenca_ate ? ` — licença até ${dataBr(c.licenca_ate)}` : ''}.</p>
            ))}
            {erro && <p style={{ ...miudo, color: '#b91c1c' }}>{erro}</p>}
            {aviso && <p style={{ ...miudo, color: '#166534' }}>{aviso}</p>}
        </div>
    );
}
