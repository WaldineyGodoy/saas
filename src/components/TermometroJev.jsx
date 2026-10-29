import { Thermometer } from 'lucide-react';

// Termômetro do Jev: a Edge Function jev-temperatura grava em
// leads.qualificacao.jev a temperatura (5 faixas), a probabilidade de fechar em
// 30 dias e o próximo passo sugerido, lendo a conversa do WhatsApp no Deskcomm.
const FAIXAS = {
    gelado: { label: 'Gelado', color: '#1d4ed8', bg: '#dbeafe' },
    frio: { label: 'Frio', color: '#0e7490', bg: '#cffafe' },
    morno: { label: 'Morno', color: '#a16207', bg: '#fef9c3' },
    quente: { label: 'Quente', color: '#c2410c', bg: '#ffedd5' },
    fechando: { label: 'Fechando', color: '#b91c1c', bg: '#fee2e2' },
};
const ORDEM = ['gelado', 'frio', 'morno', 'quente', 'fechando'];

const PROXIMO_PASSO = {
    qualificar: 'Qualificar: faltam dados básicos (consumo, local, objetivo)',
    enviar_simulacao: 'Enviar simulação ou proposta',
    tirar_duvida: 'Responder uma dúvida ou objeção',
    agendar_reuniao: 'Agendar reunião ou apresentação com o consultor',
    enviar_contrato: 'Enviar o contrato',
    passar_para_humano: 'Passar para atendimento humano',
    aguardar: 'Aguardar: a bola está com o cliente',
};

const pct = (n) => `${Math.round(Number(n) * 100)}%`;

export function jevDoLead(lead) {
    const jev = lead?.qualificacao?.jev;
    return jev && FAIXAS[jev.temperatura] ? jev : null;
}

export function SeloJev({ lead }) {
    const jev = jevDoLead(lead);
    if (!jev) return null;
    const f = FAIXAS[jev.temperatura];
    const prob = jev.probabilidade_fechamento_30d;
    const titulo = `Termômetro do Jev: ${f.label}` +
        (prob != null ? ` · ${pct(prob)} de chance de fechar em 30 dias` : '');
    return (
        <span title={titulo} style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0,
            fontSize: '0.65rem', fontWeight: 700, color: f.color, background: f.bg,
            padding: '0.1rem 0.4rem', borderRadius: '9999px', whiteSpace: 'nowrap'
        }}>
            <Thermometer size={11} aria-hidden />
            {f.label}{prob != null ? ` · ${pct(prob)}` : ''}
        </span>
    );
}

export function PainelJev({ lead }) {
    const jev = jevDoLead(lead);
    if (!jev) return null;
    const f = FAIXAS[jev.temperatura];
    const nivel = ORDEM.indexOf(jev.temperatura);
    const prob = jev.probabilidade_fechamento_30d;
    const quando = jev.avaliado_em ? new Date(jev.avaliado_em).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }) : null;

    return (
        <div style={{ border: `1px solid ${f.bg}`, background: '#ffffff', borderRadius: '10px', padding: '0.9rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>
                    <Thermometer size={18} style={{ color: f.color }} /> Termômetro do Jev
                </span>
                {quando && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>avaliado em {quando}</span>}
            </div>

            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.4rem' }} aria-hidden>
                {ORDEM.map((faixa, i) => (
                    <div key={faixa} style={{
                        flex: 1, height: '8px', borderRadius: '4px',
                        background: i <= nivel ? FAIXAS[faixa].color : '#e2e8f0'
                    }} />
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
                {ORDEM.map(faixa => (
                    <span key={faixa} style={faixa === jev.temperatura ? { color: f.color, fontWeight: 700 } : undefined}>
                        {FAIXAS[faixa].label}
                    </span>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
                <div>
                    <div style={{ color: '#64748b', fontWeight: 600, marginBottom: '0.15rem' }}>Chance de fechar em 30 dias</div>
                    <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '1.1rem' }}>{prob != null ? pct(prob) : '—'}</div>
                </div>
                <div>
                    <div style={{ color: '#64748b', fontWeight: 600, marginBottom: '0.15rem' }}>Próximo passo sugerido</div>
                    <div style={{ color: '#0f172a' }}>{PROXIMO_PASSO[jev.proximo_passo] || jev.proximo_passo || '—'}</div>
                </div>
            </div>
            <div style={{ marginTop: '0.6rem', fontSize: '0.72rem', color: '#94a3b8' }}>
                Leitura automática da conversa do WhatsApp{jev.mensagens_lidas ? ` (${jev.mensagens_lidas} mensagens)` : ''}. É uma estimativa, não uma garantia.
            </div>
        </div>
    );
}
