import React from 'react';
import { BellRing, Plus, Minus } from 'lucide-react';
import { cleanDigits, maskPhone, validatePhone } from '../lib/validators';
import { TIPOS_ALERTA, normalizarSn, ehSnDatalogger } from '../lib/alertasUsina';

// Bloco "Alertas" da aba Técnico do modal da usina. Edita, salvos junto com a
// usina:
//   - usinas.inversores_sn: SN dos INVERSORES (deviceSn da API), que liga o
//     dado do fabricante a esta usina. Um inversor só pode estar numa usina;
//   - usinas.alertas_tipos: quais alertas fn_monitor_avaliar_alertas dispara;
//   - usinas.alertas_whatsapp: quem recebe (só dígitos com DDD; o
//     send-whatsapp põe o 55 na frente).
// `statusInversores` (SN -> último dado do robô) vem do modal; null = carregando.
const campo = {
    flex: 1, minWidth: 0, padding: '0.6rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px',
    fontSize: '0.9rem', background: 'white', outline: 'none'
};

const botaoIcone = (cor, fundo) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px',
    flexShrink: 0, borderRadius: '8px', border: `1px solid ${cor}`, background: fundo, color: cor, cursor: 'pointer'
});

const subtitulo = { fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' };

function situacaoInversor(sn, status) {
    if (!sn) return null;
    if (ehSnDatalogger(sn)) {
        return { erro: true, texto: 'Este é o SN do datalogger. Informe o do inversor (etiqueta do equipamento ou Elekeeper → Devices → Inverter).' };
    }
    if (status === null) return { texto: 'Consultando…' };
    const d = status?.[sn];
    if (!d) {
        return { aviso: true, texto: 'Ainda não visto na SAJ: confirme se o proprietário autorizou o acesso ao desenvolvedor B2W.' };
    }
    const visto = d.visto_em ? new Date(d.visto_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    return { ok: true, online: d.online, texto: `${d.modelo || 'Inversor'} · ${d.plant_nome || ''} · ${d.online ? 'online' : 'offline'}${visto ? ` (lido ${visto})` : ''}` };
}

export default function AlertasWhatsappUsina({
    marca, apiConectada, inversores: valorInversores, statusInversores, onChangeInversores,
    numeros: valor, tipos, onChangeNumeros, onChangeTipos
}) {
    // sempre ao menos uma linha, para o campo aparecer vazio pronto para digitar
    const numeros = valor?.length ? valor : [''];
    const inversores = valorInversores?.length ? valorInversores : [''];
    const marcados = tipos || [];

    const alterarSn = (i, texto) => onChangeInversores(inversores.map((s, j) => (j === i ? normalizarSn(texto) : s)));
    const adicionarSn = () => onChangeInversores([...inversores, '']);
    const removerSn = (i) => onChangeInversores(inversores.filter((_, j) => j !== i));

    const alterar = (i, texto) => onChangeNumeros(numeros.map((n, j) => (j === i ? cleanDigits(texto).slice(0, 11) : n)));
    const adicionar = () => onChangeNumeros([...numeros, '']);
    const remover = (i) => onChangeNumeros(numeros.filter((_, j) => j !== i));
    const alternar = (id) => onChangeTipos(marcados.includes(id) ? marcados.filter(t => t !== id) : [...marcados, id]);

    const cabecalho = (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: apiConectada ? '#b45309' : '#94a3b8', fontWeight: 700, marginBottom: '1rem' }}>
            <div style={{ padding: '0.5rem', background: apiConectada ? '#fffbeb' : '#f1f5f9', borderRadius: '8px' }}>
                <BellRing size={20} />
            </div>
            <span>Alertas</span>
        </div>
    );

    // Sem API da marca não chega dado do inversor: alerta configurado aqui nunca dispararia.
    if (!apiConectada) {
        return (
            <div style={{ marginTop: '1.5rem', border: '1px dashed #e2e8f0', borderRadius: '16px', padding: '1.5rem', background: '#f8fafc' }}>
                {cabecalho}
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
                    {marca
                        ? <>Indisponível: a marca <strong>{marca}</strong> não tem API de monitoramento conectada.</>
                        : 'Indisponível: informe o fabricante do inversor no quadro acima.'}
                </p>
            </div>
        );
    }

    return (
        <div style={{ marginTop: '1.5rem', border: '1px solid #f1f5f9', borderRadius: '16px', padding: '1.5rem', background: '#fff' }}>
            {cabecalho}

            <div style={{ marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9' }}>
                <div style={subtitulo}>Inversores da usina (SN)</div>
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.75rem', color: '#64748b' }}>
                    É pelo SN do inversor que o alerta chega a esta usina e a nenhuma outra. Não use o SN do datalogger.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '640px' }}>
                    {inversores.map((sn, i) => {
                        const s = situacaoInversor(sn, statusInversores);
                        return (
                            <div key={i}>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        placeholder="Ex.: C6V6753J2512E00528"
                                        value={sn}
                                        onChange={e => alterarSn(i, e.target.value)}
                                        style={{ ...campo, fontFamily: 'ui-monospace, monospace', borderColor: s?.erro ? '#fca5a5' : '#e2e8f0' }}
                                        aria-label={`SN do inversor ${i + 1}`}
                                    />
                                    {(inversores.length > 1 || sn) && (
                                        <button type="button" onClick={() => removerSn(i)} title="Remover inversor"
                                            style={botaoIcone('#b91c1c', '#fef2f2')}>
                                            <Minus size={16} />
                                        </button>
                                    )}
                                </div>
                                {s && (
                                    <span style={{
                                        fontSize: '0.75rem',
                                        color: s.erro ? '#b91c1c' : s.aviso ? '#b45309' : s.ok ? (s.online ? '#166534' : '#475569') : '#64748b'
                                    }}>
                                        {s.texto}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                    <button type="button" onClick={adicionarSn}
                        style={{ ...botaoIcone('#1d4ed8', '#eff6ff'), width: 'auto', padding: '0 0.9rem', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 700, alignSelf: 'flex-start' }}>
                        <Plus size={16} /> Adicionar inversor
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
                <div>
                    <div style={subtitulo}>Avisar quando</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {TIPOS_ALERTA.map(t => (
                            <label key={t.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', cursor: 'pointer' }}>
                                <input type="checkbox" checked={marcados.includes(t.id)} onChange={() => alternar(t.id)}
                                    style={{ marginTop: '0.2rem', width: '16px', height: '16px', accentColor: '#b45309', flexShrink: 0 }} />
                                <span>
                                    <span style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#1e293b' }}>{t.titulo}</span>
                                    <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>{t.detalhe}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                <div>
                    <div style={subtitulo}>WhatsApp que recebe</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '420px' }}>
                        {numeros.map((numero, i) => {
                            const invalido = numero.length > 0 && !validatePhone(numero);
                            return (
                                <div key={i}>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <input
                                            type="tel"
                                            inputMode="tel"
                                            placeholder="(84) 99999-9999"
                                            value={maskPhone(numero)}
                                            onChange={e => alterar(i, e.target.value)}
                                            style={{ ...campo, borderColor: invalido ? '#fca5a5' : '#e2e8f0' }}
                                            aria-label={`WhatsApp para alertas ${i + 1}`}
                                        />
                                        {(numeros.length > 1 || numero) && (
                                            <button type="button" onClick={() => remover(i)} title="Remover número"
                                                style={botaoIcone('#b91c1c', '#fef2f2')}>
                                                <Minus size={16} />
                                            </button>
                                        )}
                                    </div>
                                    {invalido && (
                                        <span style={{ fontSize: '0.75rem', color: '#b91c1c' }}>
                                            Informe DDD + número de celular (11 dígitos).
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                        <button type="button" onClick={adicionar}
                            style={{ ...botaoIcone('#1d4ed8', '#eff6ff'), width: 'auto', padding: '0 0.9rem', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 700, alignSelf: 'flex-start' }}>
                            <Plus size={16} /> Adicionar
                        </button>
                    </div>
                    {marcados.length > 0 && !numeros.some(validatePhone) && (
                        <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: '#b45309' }}>
                            Sem número cadastrado, nenhum alerta desta usina é enviado.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
