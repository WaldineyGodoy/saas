import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { rotuloVisita } from '../lib/leadVisitas';

/**
 * Visitas e indicações do lead (20261006b). Cada simulação enviada no site
 * ou no app é uma visita, com o link pelo qual a pessoa veio. O lead fica
 * com o último link; aqui aparece o caminho inteiro, para ninguém discutir
 * de quem é a indicação. Na adesão vale a visita que concluiu o contrato.
 */
export default function LeadVisitas({ leadId }) {
    const [visitas, setVisitas] = useState(null);
    const [erro, setErro] = useState(null);

    useEffect(() => {
        if (!leadId) return;
        let vivo = true;
        supabase
            .from('lead_visitas')
            .select('id, criado_em, meio, aplicada, motivo, indicador:indicador_assinante_id (name), originador:originator_id (name)')
            .eq('lead_id', leadId)
            .order('criado_em', { ascending: false })
            .then(({ data, error }) => {
                if (!vivo) return;
                if (error) setErro(error.message);
                else setVisitas(data || []);
            });
        return () => { vivo = false; };
    }, [leadId]);

    if (!leadId) return null;
    if (erro) return <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>Não foi possível carregar as visitas: {erro}</p>;
    if (!visitas) return <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Carregando visitas…</p>;
    if (visitas.length === 0) {
        return <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Lead criado antes do registro de visitas (06/10/2026) ou cadastrado pela equipe.</p>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
                {visitas.length} visita(s). O lead fica com o último link; na adesão vale o link da visita que concluiu o contrato.
            </p>
            {visitas.map((v) => {
                const r = rotuloVisita(v);
                return (
                    <div key={v.id} style={{
                        display: 'flex', justifyContent: 'space-between', gap: '1rem',
                        padding: '0.6rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: 8,
                        background: v.aplicada ? 'white' : '#fffbeb',
                    }}>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>{r.titulo}</div>
                            {r.detalhe && <div style={{ fontSize: '0.8rem', color: '#92400e' }}>{r.detalhe}</div>}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                            {new Date(v.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
