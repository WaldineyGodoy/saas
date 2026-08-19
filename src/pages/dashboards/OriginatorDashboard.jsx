import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { shortenLink } from '../../lib/api';
import { buildConviteUrl } from '../../lib/originador';

export default function OriginatorDashboard() {
    // `useState`/`useEffect` não estavam importados e `profile` era usado sem
    // nunca chamar `useAuth()`: a tela lançava ReferenceError e não abria.
    const { user, profile } = useAuth();

    const [leads, setLeads] = useState([]);
    const [commissions, setCommissions] = useState([]);
    const [originator, setOriginator] = useState(null);
    const [shortLink, setShortLink] = useState('');

    const longLink = originator ? buildConviteUrl(originator) : '';
    const displayLink = shortLink || longLink;

    useEffect(() => {
        async function fetchData() {
            if (!user?.id) return;

            // `originators_v2` não tem coluna `user_id` — a chave é o próprio
            // `id`, igual ao id do usuário de auth (é assim que o
            // OriginatorSignupForm grava). O filtro antigo por `user_id`
            // devolvia erro e deixava o painel permanentemente vazio.
            const { data: origData } = await supabase.from('originators_v2')
                .select('id, name, pix_key, pix_key_type, short_url')
                .eq('id', user.id)
                .maybeSingle();

            if (origData) {
                setOriginator(origData);

                // O que se encurta é sempre a URL longa — `buildReferralUrl`
                // devolveria o próprio `short_url` quando já existe.
                const refUrl = buildConviteUrl(origData);

                // Handle Short Link
                if (origData.short_url) {
                    setShortLink(origData.short_url);
                } else {
                    // Try to generate short link on the fly if missing
                    try {
                        const res = await shortenLink(refUrl, `ref-${origData.id.substring(0, 5)}`, `Link Embaixador - ${origData.name}`);
                        if (res.success && res.shortUrl) {
                            setShortLink(res.shortUrl);
                            // Persist to DB
                            await supabase.from('originators_v2').update({ short_url: res.shortUrl }).eq('id', origData.id);
                        }
                    } catch (e) {
                        console.error('Failed to shorten link:', e);
                    }
                }

                // Fetch Leads
                const { data: leadsData } = await supabase.from('leads').select('*').eq('originator_id', origData.id);
                setLeads(leadsData || []);

                // O extrato vem do RAZÃO, conta 2.1.2 ("Comissões a Pagar").
                //
                // Antes esta consulta ia na tabela `commissions` filtrando por
                // `originator_id` — coluna que não existe lá (a tabela é
                // chaveada por `profile_id`). O erro era engolido pelo
                // `if (!error)` e o extrato ficava vazio para sempre.
                //
                // E `commissions` é alimentada por `generate_monthly_commissions`,
                // que lê `profiles.commission_split` — não é a fonte. Quem
                // calcula e lança de verdade é o gatilho `handle_invoice_paid_ledger`,
                // a cada fatura paga, usando `originators_v2.split_commission`.
                const { data: extratoData, error: extratoError } = await supabase
                    .from('ledger_entries')
                    .select('id, amount, description, created_at, reference_id, ledger_accounts!inner(code)')
                    .eq('ledger_accounts.code', '2.1.2')
                    .eq('reference_type', 'originator')
                    .eq('reference_id', origData.id)
                    .order('created_at', { ascending: false });

                if (extratoError) console.error('Erro ao carregar extrato:', extratoError);
                setCommissions(extratoData || []);
            }
        }
        if (user) fetchData();
    }, [user]);

    const copyLink = () => {
        navigator.clipboard.writeText(displayLink);
        alert('Link copiado!');
    };

    // O botão "Pagar" que existia aqui foi removido, e não apenas desligado.
    //
    // Ele lia `commission.originator_id`, `.total_value` e `.reference_month`
    // e gravava `status`/`payment_id`/`payment_date` — nenhum desses campos
    // existe. Operava sobre a tabela `commissions`, que está vazia e é
    // alimentada por uma fonte que não é a oficial.
    //
    // Reativar o repasse exige decidir antes como a baixa é registrada: o
    // lançamento em 2.1.2 é a OBRIGAÇÃO (crédito); o pagamento precisa da
    // contrapartida debitando 2.1.2 contra a conta de banco, senão o razão
    // passa a dever eternamente o que já foi pago. Essa contrapartida é
    // decisão contábil e move dinheiro de verdade — não se inventa aqui.

    const totalComissao = commissions.reduce((soma, e) => soma + Math.abs(Number(e.amount) || 0), 0);

    return (
        <div>
            <h2>Painel do Originador</h2>

            <div className="card" style={{ marginBottom: '2rem' }}>
                <h3 style={{ color: 'var(--color-text-dark)', fontSize: '1.1rem' }}>Seu Link de Indicação</h3>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                    <input
                        value={displayLink}
                        readOnly
                        className="input"
                        style={{ background: 'var(--color-bg-light)', color: 'var(--color-text-medium)' }}
                    />
                    <button onClick={copyLink} className="btn btn-accent">Copiar</button>
                    {shortLink && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', alignSelf: 'center' }}>
                            ✨ Link encurtado ativo
                        </span>
                    )}
                </div>
            </div>

            <h3 style={{ marginBottom: '1rem' }}>Meus Leads</h3>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>Status</th>
                                <th>Data</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leads.map(lead => (
                                <tr key={lead.id}>
                                    <td>{lead.name}</td>
                                    <td>
                                        <span className="badge badge-neutral">{lead.status}</span>
                                    </td>
                                    <td>{new Date(lead.created_at).toLocaleDateString()}</td>
                                </tr>
                            ))}
                            {leads.length === 0 && (
                                <tr>
                                    <td colSpan="3" style={{ textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhum lead encontrado.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '2rem', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>Extrato de Comissões</h3>
                {commissions.length > 0 && (
                    <span style={{ fontWeight: 'bold', color: 'var(--color-success)' }}>
                        Total acumulado: {totalComissao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                )}
            </div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Lançamento</th>
                                <th style={{ textAlign: 'right' }}>Valor (R$)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {commissions.length === 0 ? (
                                <tr>
                                    <td colSpan="3" style={{ textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhuma comissão registrada.</td>
                                </tr>
                            ) : (
                                commissions.map(c => (
                                    <tr key={c.id}>
                                        <td>{new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
                                        <td>{c.description}</td>
                                        <td style={{ fontWeight: 'bold', color: 'var(--color-success)', textAlign: 'right' }}>
                                            {/* O razão grava a obrigação como crédito (valor negativo);
                                                para o parceiro o que importa é o quanto ele tem a receber. */}
                                            {Math.abs(Number(c.amount) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div >
    );
}
