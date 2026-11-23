import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Download, ExternalLink, Link as LinkIcon } from 'lucide-react';
import { buildReferralUrl } from '../lib/originador';

/** Nome do arquivo do QR: só letras e números (acento já virou "?" no Windows). */
const nomeArquivoQr = (originator) => {
    const slug = String(originator?.name || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return `qrcode-parceiro-${slug || String(originator?.id || '').slice(0, 8)}.png`;
};

/**
 * Link de indicação do originador com QR Code (23/11/2026). O link é o curto
 * (YOURLS) quando existe; senão, o convite longo. O QR aponta para o mesmo
 * link, para quem escanear cair na página de convite com o nome do parceiro.
 */
export default function LinkIndicacaoOriginador({ originator }) {
    const link = originator ? buildReferralUrl(originator) : '';
    const [qr, setQr] = useState('');
    const [erro, setErro] = useState('');
    const [copiado, setCopiado] = useState(false);

    useEffect(() => {
        if (!link) return undefined;
        let vivo = true;
        QRCode.toDataURL(link, { width: 320, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#003366ff', light: '#ffffffff' } })
            .then((url) => { if (vivo) { setQr(url); setErro(''); } })
            .catch((e) => { if (vivo) setErro(e?.message || 'Não foi possível gerar o QR Code.'); });
        return () => { vivo = false; };
    }, [link]);

    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(link);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
        } catch {
            const campo = document.getElementById('originador-link-campo');
            if (campo) { campo.focus(); campo.select(); }
            setErro('Não foi possível copiar automaticamente. O link está selecionado: use Ctrl+C.');
        }
    };

    const titulo = (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LinkIcon size={18} color="#003366" />
            <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>Link de indicação</strong>
        </div>
    );

    if (!originator) {
        return (
            <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '20px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {titulo}
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Salve o originador para gerar o link e o QR Code de indicação.</p>
            </div>
        );
    }

    const botao = { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 0.95rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer', textDecoration: 'none' };

    return (
        <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '20px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {titulo}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
                <div style={{ width: '152px', height: '152px', flexShrink: 0, background: 'white', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'grid', placeItems: 'center', padding: '8px', boxSizing: 'border-box' }}>
                    {qr
                        ? <img src={qr} alt={`QR Code do link de indicação de ${originator.name}`} width={136} height={136} style={{ display: 'block' }} />
                        : <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Gerando…</span>}
                </div>
                <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>
                        Quem se cadastrar por este link ou pelo QR Code fica vinculado a {originator.name?.split(' ')[0] || 'este parceiro'}.
                    </p>
                    <input
                        id="originador-link-campo"
                        readOnly
                        value={link}
                        onFocus={(e) => e.target.select()}
                        aria-label="Link de indicação"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: '10px', background: 'white', fontSize: '0.88rem', color: '#0f172a', fontWeight: 600 }}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <button type="button" onClick={copiar} style={{ ...botao, border: 'none', background: '#003366', color: 'white' }}>
                            {copiado ? <Check size={15} /> : <Copy size={15} />} {copiado ? 'Copiado' : 'Copiar link'}
                        </button>
                        {qr && (
                            <a href={qr} download={nomeArquivoQr(originator)} style={{ ...botao, border: '1px solid #cbd5e1', background: 'white', color: '#334155' }}>
                                <Download size={15} /> Baixar QR Code
                            </a>
                        )}
                        <a href={link} target="_blank" rel="noreferrer" style={{ ...botao, border: '1px solid #cbd5e1', background: 'white', color: '#334155' }}>
                            <ExternalLink size={15} /> Abrir
                        </a>
                    </div>
                    {!originator.short_url && (
                        <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748b' }}>O link curto ainda não foi gerado; este é o convite completo e funciona igual.</p>
                    )}
                    {erro && <p style={{ margin: 0, fontSize: '0.78rem', color: '#b91c1c' }}>{erro}</p>}
                </div>
            </div>
        </div>
    );
}
