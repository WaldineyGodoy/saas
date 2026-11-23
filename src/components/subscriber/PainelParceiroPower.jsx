import React from 'react';
import { Handshake, BadgeCheck, Loader2, Copy } from 'lucide-react';

const ROTULO_CARGO = { lider: 'Líder', ppe: 'PPE', ppp: 'PPP', ppf: 'PPF' };

/**
 * Parte visual do "Tornar Parceiro Power" no rodapé do cadastro do assinante.
 *
 * Separada do contêiner (que fala com o Supabase) para poder ser renderizada em
 * teste. O defeito que mais importa aqui é a tela oferecer o botão a quem JÁ é
 * parceiro: cadastro duplicado, com dois links e dois recebedores de comissão.
 *
 * estado.tipo: 'carregando' | 'parceiro' | 'pode' | 'faltam'
 */
export default function PainelParceiroPower({ estado, ocupado = false, onClick, onCopiar }) {
    const tipo = estado?.tipo;

    if (tipo === 'parceiro') {
        const cargo = ROTULO_CARGO[estado.parceiro?.cargo] || null;
        const link = estado.parceiro?.short_url;
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem',
                    background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: '10px',
                    fontWeight: 700, fontSize: '0.82rem'
                }}>
                    <BadgeCheck size={16} /> Parceiro Power{cargo ? ` · ${cargo}` : ''}
                </span>
                {link && (
                    <button
                        type="button"
                        onClick={onCopiar}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.8rem',
                            background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '10px',
                            fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer'
                        }}
                    >
                        <Copy size={14} /> Copiar link
                    </button>
                )}
            </div>
        );
    }

    if (tipo === 'pode' || tipo === 'faltam') {
        const bloqueado = tipo === 'faltam';
        const desabilitado = bloqueado || ocupado;
        const motivo = bloqueado ? `Falta: ${(estado.faltando || []).join(', ')}` : null;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                <button
                    type="button"
                    onClick={onClick}
                    disabled={desabilitado}
                    title={motivo || 'Cadastrar este assinante também como Parceiro Power (originador)'}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center',
                        padding: '0.62rem 1.1rem', background: desabilitado ? '#f1f5f9' : '#eff6ff',
                        color: desabilitado ? '#94a3b8' : '#1d4ed8', border: `1px solid ${desabilitado ? '#e2e8f0' : '#bfdbfe'}`,
                        borderRadius: '10px', fontWeight: 700, fontSize: '0.84rem',
                        cursor: ocupado ? 'wait' : (bloqueado ? 'not-allowed' : 'pointer')
                    }}
                >
                    {ocupado ? <Loader2 size={16} className="spin-animation" /> : <Handshake size={16} />}
                    {ocupado ? 'Cadastrando...' : 'Tornar Parceiro Power'}
                </button>
                {motivo && <span style={{ fontSize: '0.72rem', color: '#92400e' }}>{motivo}</span>}
            </div>
        );
    }

    return null;
}
