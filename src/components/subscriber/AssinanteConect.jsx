import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Users, Copy, Check, Download, RefreshCw, MessageCircle, Link2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
    buildLinkConect,
    podeIndicar,
    textoCompartilhar,
    urlWhatsappCompartilhar,
    nomeArquivoQr,
} from '../../lib/assinanteConect';
import { ehPapelInterno } from '../../lib/papeis';

/**
 * Seção "Assinante Conect" do modal do assinante.
 *
 * No Plano de Recompensas o assinante indica como o embaixador: quem ele
 * traz entra na árvore por `consumer_units.indicado_por_uc_id` e ele recebe
 * 2% do nível 1 como abatimento na própria fatura. Esta seção é onde o link
 * e o QR Code aparecem para ser passados adiante.
 *
 * O QR é gerado no navegador, e não por serviço de terceiro: o link carrega
 * o id do assinante, e mandar isso para um gerador externo seria entregar a
 * carteira de clientes de graça.
 */

const ROTULO_STATUS = {
    ativacao: 'Em ativação',
    contrato_assinado: 'Contrato assinado',
    ativo: 'Ativo',
    ativo_inadimplente: 'Ativo (inadimplente)',
    transferido: 'Transferido',
    cancelado: 'Cancelado',
    cancelado_inadimplente: 'Cancelado (inadimplente)',
};

const CAIXA = {
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '1rem 1.25rem',
    background: '#f8fafc',
};

export default function AssinanteConect({ subscriber, profile }) {
    const [shortUrl, setShortUrl] = useState(subscriber?.short_url || null);
    const [qr, setQr] = useState('');
    const [copiado, setCopiado] = useState(false);
    const [gerando, setGerando] = useState(false);
    const [erro, setErro] = useState('');
    const [indicados, setIndicados] = useState([]);
    const [leadsIndicados, setLeadsIndicados] = useState(0);
    const [indicadoPor, setIndicadoPor] = useState(null);

    const interno = ehPapelInterno(profile?.role);
    const elegivel = podeIndicar(subscriber);

    // `shortUrl` é estado próprio porque o gatilho do banco pode gravá-lo
    // depois que o modal abriu, e o botão "Gerar link" atualiza aqui sem
    // exigir que a lista de assinantes seja recarregada.
    useEffect(() => { setShortUrl(subscriber?.short_url || null); }, [subscriber?.short_url]);

    const link = useMemo(
        () => buildLinkConect({ ...(subscriber || {}), short_url: shortUrl }),
        [subscriber, shortUrl]
    );

    useEffect(() => {
        if (!link || !elegivel) { setQr(''); return; }
        let vivo = true;
        QRCode.toDataURL(link, {
            width: 224,
            margin: 1,
            errorCorrectionLevel: 'M',
            color: { dark: '#003366ff', light: '#ffffffff' },
        })
            .then((url) => { if (vivo) setQr(url); })
            .catch((e) => { if (vivo) setErro(e?.message || 'Não foi possível gerar o QR Code.'); });
        return () => { vivo = false; };
    }, [link, elegivel]);

    const carregarRede = useCallback(async () => {
        if (!subscriber?.id) return;
        const [{ data: subs, error: erroSubs }, { count }, { data: pai }] = await Promise.all([
            supabase.from('subscribers')
                .select('id, name, cidade, uf, status, created_at')
                .eq('indicador_assinante_id', subscriber.id)
                .order('created_at', { ascending: false }),
            supabase.from('leads')
                .select('id', { count: 'exact', head: true })
                .eq('indicador_assinante_id', subscriber.id),
            supabase.from('subscribers')
                .select('id, name')
                .eq('id', subscriber.indicador_assinante_id || '00000000-0000-0000-0000-000000000000')
                .maybeSingle(),
        ]);
        if (erroSubs) setErro(erroSubs.message);
        setIndicados(subs || []);
        setLeadsIndicados(count || 0);
        setIndicadoPor(pai || null);
    }, [subscriber?.id, subscriber?.indicador_assinante_id]);

    useEffect(() => { carregarRede(); }, [carregarRede]);

    const copiar = async () => {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
        } catch {
            // Clipboard bloqueado (http, permissão negada): em vez de mentir
            // que copiou, seleciona o campo para o usuário copiar na mão.
            const campo = document.getElementById('conect-link-campo');
            if (campo) { campo.focus(); campo.select(); }
            setErro('Não foi possível copiar automaticamente. O link está selecionado: use Ctrl+C.');
        }
    };

    const gerarLinkCurto = async () => {
        setGerando(true);
        setErro('');
        try {
            const { data, error } = await supabase.functions.invoke('assinante-short-url', {
                body: { subscriber_id: subscriber.id },
            });
            if (error) throw error;
            const resultado = data?.resultados?.[0];
            if (resultado?.short_url) {
                setShortUrl(resultado.short_url);
            } else {
                // A URL longa continua valendo, então isto é aviso, não erro fatal.
                setErro(resultado?.erro || data?.error || 'O encurtador não respondeu. O link longo continua funcionando.');
            }
        } catch (e) {
            setErro(e?.message || 'Falha ao gerar o link curto.');
        } finally {
            setGerando(false);
        }
    };

    if (!subscriber?.id) {
        return (
            <div style={CAIXA}>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                    Salve os dados cadastrais primeiro: o link de indicação carrega o código do assinante.
                </p>
            </div>
        );
    }

    return (
        <div style={{ ...CAIXA, background: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
                <Users size={20} color="#003366" />
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#003366' }}>Assinante Conect</h4>
            </div>
            <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '0.85rem' }}>
                Link e QR Code de indicação. Quem assinar por aqui entra na rede deste assinante, e a recompensa
                vira abatimento na fatura dele.
            </p>

            {!elegivel ? (
                <div style={{ ...CAIXA, background: '#fff7ed', borderColor: '#fed7aa' }}>
                    <p style={{ margin: 0, color: '#9a3412', fontSize: '0.9rem' }}>
                        O link nasce quando o contrato é assinado. Situação atual:{' '}
                        <strong>{ROTULO_STATUS[subscriber.status] || subscriber.status || 'sem status'}</strong>.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '1.5rem', alignItems: 'start' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#475569', marginBottom: '0.35rem' }}>
                            Link de indicação
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <input
                                id="conect-link-campo"
                                readOnly
                                value={link}
                                onFocus={(e) => e.target.select()}
                                style={{
                                    flex: 1, minWidth: 0, padding: '0.6rem 0.75rem', borderRadius: '8px',
                                    border: '1px solid #cbd5e1', fontSize: '0.85rem', color: '#0f172a', background: '#f8fafc',
                                }}
                            />
                            <button
                                type="button"
                                onClick={copiar}
                                title="Copiar link"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 0.9rem',
                                    borderRadius: '8px', border: '1px solid #003366', background: copiado ? '#ecfdf5' : 'white',
                                    color: '#003366', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap',
                                }}
                            >
                                {copiado ? <Check size={16} color="#059669" /> : <Copy size={16} />}
                                {copiado ? 'Copiado' : 'Copiar'}
                            </button>
                        </div>

                        {!shortUrl && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                                <span style={{ fontSize: '0.8rem', color: '#92400e' }}>
                                    Link curto ainda não gerado — o endereço acima já funciona.
                                </span>
                                {interno && (
                                    <button
                                        type="button"
                                        onClick={gerarLinkCurto}
                                        disabled={gerando}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.7rem',
                                            borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white',
                                            color: '#334155', cursor: gerando ? 'wait' : 'pointer', fontSize: '0.8rem',
                                        }}
                                    >
                                        <RefreshCw size={14} />
                                        {gerando ? 'Gerando...' : 'Gerar link curto'}
                                    </button>
                                )}
                            </div>
                        )}

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <a
                                href={urlWhatsappCompartilhar(textoCompartilhar(subscriber, link))}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 0.9rem',
                                    borderRadius: '8px', background: '#25D366', color: 'white', textDecoration: 'none',
                                    fontSize: '0.85rem', fontWeight: 600,
                                }}
                            >
                                <MessageCircle size={16} /> Compartilhar no WhatsApp
                            </a>
                            {qr && (
                                <a
                                    href={qr}
                                    download={nomeArquivoQr(subscriber)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 0.9rem',
                                        borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white',
                                        color: '#334155', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600,
                                    }}
                                >
                                    <Download size={16} /> Baixar QR Code
                                </a>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#003366' }}>{indicados.length}</div>
                                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>assinantes indicados</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f766e' }}>{leadsIndicados}</div>
                                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>leads pelo link</div>
                            </div>
                        </div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                        {qr ? (
                            <img
                                src={qr}
                                alt={`QR Code de indicação de ${subscriber.name || 'assinante'}`}
                                width={224}
                                height={224}
                                style={{ borderRadius: '10px', border: '1px solid #e2e8f0', display: 'block' }}
                            />
                        ) : (
                            <div style={{
                                width: 224, height: 224, borderRadius: '10px', border: '1px dashed #cbd5e1',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8',
                                fontSize: '0.8rem',
                            }}>
                                Gerando QR Code...
                            </div>
                        )}
                        <span style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                            Aponte a câmera para assinar pelo link dele
                        </span>
                    </div>
                </div>
            )}

            {indicadoPor && (
                <p style={{ margin: '1rem 0 0', fontSize: '0.85rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Link2 size={15} color="#64748b" /> Indicado por <strong>{indicadoPor.name}</strong>
                </p>
            )}

            {indicados.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                        Rede deste assinante
                    </div>
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                        {indicados.map((ind, i) => (
                            <div
                                key={ind.id}
                                style={{
                                    display: 'flex', justifyContent: 'space-between', gap: '1rem',
                                    padding: '0.5rem 0.75rem', fontSize: '0.85rem',
                                    background: i % 2 ? '#f8fafc' : 'white',
                                }}
                            >
                                <span style={{ color: '#0f172a' }}>
                                    {ind.name}
                                    {ind.cidade ? <span style={{ color: '#94a3b8' }}> · {ind.cidade}{ind.uf ? `/${ind.uf}` : ''}</span> : null}
                                </span>
                                <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>
                                    {ROTULO_STATUS[ind.status] || ind.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {erro && (
                <p style={{ margin: '0.75rem 0 0', color: '#b91c1c', fontSize: '0.85rem' }}>{erro}</p>
            )}
        </div>
    );
}
