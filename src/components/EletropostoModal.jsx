import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep } from '../lib/api';
import { useUI } from '../contexts/UIContext';
import {
    STATUS_ELETROPOSTO,
    TIPOS_RECARGA,
    somaPercentuais,
    validarFornecedores,
    paraPayloadFornecedores,
    montarPayloadEletroposto,
    mensagemErroEletroposto,
    casaBusca,
} from '../lib/eletropostos';

const ABAS = [
    { id: 'dados', label: 'Dados' },
    { id: 'uc', label: 'UC e Usina' },
    { id: 'fornecedores', label: 'Fornecedores' },
    { id: 'tecnico', label: 'Técnico' },
];

const estadoInicial = (e) => ({
    nome: e?.nome || '',
    status: e?.status || 'pre_operacao',
    plano_id: e?.plano_id || '',
    originator_id: e?.originator_id || '',
    tarifa_investidor_kwh: e?.tarifa_investidor_kwh ?? '',
    consumer_unit_id: e?.consumer_unit_id || '',
    cep: e?.endereco?.cep || '',
    rua: e?.endereco?.rua || '',
    numero: e?.endereco?.numero || '',
    bairro: e?.endereco?.bairro || '',
    cidade: e?.endereco?.cidade || '',
    uf: e?.endereco?.uf || '',
    ibge: e?.endereco?.ibge || '',
    qtd_carregadores: e?.qtd_carregadores ?? '',
    potencia_kw: e?.potencia_kw ?? '',
    tipo_recarga: e?.tipo_recarga || '',
    fabricante: e?.fabricante || '',
    modelo: e?.modelo || '',
    observacoes: e?.observacoes || '',
});

const fornecedoresIniciais = (e) =>
    (e?.fornecedores || []).map(f => ({
        supplier_id: f.supplier_id,
        percentual: String(Number(f.percentual)),
        ativo: f.ativo !== false,
    }));

// Quem so le (fornecedor) nao enxerga todas as opcoes pela RLS: o valor atual
// do eletroposto entra na lista para o select nao ficar em branco.
const comAtual = (lista, atual) =>
    atual && !lista.some(i => i.id === atual.id) ? [atual, ...lista] : lista;

const corDaSoma = (soma) => (soma === 100 ? '#166534' : soma > 100 ? '#991b1b' : '#9a3412');

export default function EletropostoModal({ eletroposto, somenteLeitura = false, onClose, onSave, onDelete }) {
    const { showAlert, showConfirm } = useUI();
    const [aba, setAba] = useState('dados');
    const [form, setForm] = useState(() => estadoInicial(eletroposto));
    const [fornecedores, setFornecedores] = useState(() => fornecedoresIniciais(eletroposto));
    // Guarda o id depois do primeiro INSERT: se a RPC dos fornecedores falhar,
    // salvar de novo atualiza em vez de duplicar o eletroposto.
    const [idSalvo, setIdSalvo] = useState(eletroposto?.id || null);
    const [salvando, setSalvando] = useState(false);
    const [erroCarga, setErroCarga] = useState(null);
    const [buscaUc, setBuscaUc] = useState('');
    const [opcoes, setOpcoes] = useState({ planos: [], originadores: [], suppliers: [], ucs: [], ucsOcupadas: new Set() });

    useEffect(() => {
        let vivo = true;
        (async () => {
            const [planos, originadores, suppliers, ucs, ocupadas] = await Promise.all([
                supabase.from('planos_assinatura_energia').select('id, nome, ativo')
                    .eq('recorrente_config->>categoria_plano', 'eletroposto').order('nome'),
                supabase.from('originators_v2').select('id, name').order('name'),
                supabase.from('suppliers').select('id, name, status').order('name'),
                supabase.from('consumer_units')
                    .select('id, numero_uc, status, subscriber:subscriber_id (name), usina:usina_id (id, name, status)')
                    .order('numero_uc'),
                supabase.from('eletropostos').select('id, consumer_unit_id').not('consumer_unit_id', 'is', null),
            ]);
            if (!vivo) return;
            const erro = [planos, originadores, suppliers, ucs, ocupadas].find(r => r.error)?.error;
            setErroCarga(erro ? erro.message : null);
            setOpcoes({
                planos: planos.data || [],
                originadores: originadores.data || [],
                suppliers: suppliers.data || [],
                ucs: ucs.data || [],
                ucsOcupadas: new Set((ocupadas.data || [])
                    .filter(o => o.id !== eletroposto?.id)
                    .map(o => o.consumer_unit_id)),
            });
        })();
        return () => { vivo = false; };
    }, [eletroposto?.id]);

    const campo = (nome) => ({
        value: form[nome],
        onChange: (ev) => setForm(f => ({ ...f, [nome]: ev.target.value })),
    });

    const planos = comAtual(opcoes.planos, eletroposto?.plano || null);
    const originadores = comAtual(opcoes.originadores, eletroposto?.originator || null);
    const suppliers = useMemo(() => {
        const dosSocios = (eletroposto?.fornecedores || []).map(f => f.supplier).filter(Boolean);
        return dosSocios.reduce((acc, s) => comAtual(acc, s), opcoes.suppliers);
    }, [opcoes.suppliers, eletroposto?.fornecedores]);

    const ucSelecionada = useMemo(() => {
        if (!form.consumer_unit_id) return null;
        return opcoes.ucs.find(u => u.id === form.consumer_unit_id)
            || (eletroposto?.consumer_unit?.id === form.consumer_unit_id ? eletroposto.consumer_unit : null);
    }, [form.consumer_unit_id, opcoes.ucs, eletroposto?.consumer_unit]);

    const ucsDisponiveis = useMemo(() => {
        return opcoes.ucs
            .filter(u => !opcoes.ucsOcupadas.has(u.id) && u.id !== form.consumer_unit_id)
            .filter(u => casaBusca(buscaUc, [u.numero_uc, u.subscriber?.name]))
            .slice(0, 50);
    }, [buscaUc, opcoes.ucs, opcoes.ucsOcupadas, form.consumer_unit_id]);

    const soma = somaPercentuais(fornecedores);

    const buscarCep = async () => {
        if (form.cep.replace(/\D/g, '').length !== 8) return;
        try {
            const end = await fetchAddressByCep(form.cep);
            setForm(f => ({
                ...f,
                cep: end.cep || f.cep,
                rua: end.rua || f.rua,
                bairro: end.bairro || f.bairro,
                cidade: end.cidade || f.cidade,
                uf: end.uf || f.uf,
                ibge: end.ibge || f.ibge,
            }));
        } catch (e) {
            showAlert(e.message, 'warning');
        }
    };

    const alterarFornecedor = (i, mudanca) =>
        setFornecedores(lista => lista.map((f, j) => (j === i ? { ...f, ...mudanca } : f)));

    const handleSubmit = async (ev) => {
        ev.preventDefault();
        if (somenteLeitura) return;

        if (!form.nome.trim()) {
            setAba('dados');
            showAlert('Informe o nome do eletroposto.', 'warning');
            return;
        }
        const erroFornecedores = validarFornecedores(fornecedores);
        if (erroFornecedores) {
            setAba('fornecedores');
            showAlert(erroFornecedores, 'warning');
            return;
        }

        setSalvando(true);
        try {
            const payload = montarPayloadEletroposto(form);
            const { data, error } = idSalvo
                ? await supabase.from('eletropostos').update(payload).eq('id', idSalvo).select('id').single()
                : await supabase.from('eletropostos').insert(payload).select('id').single();
            if (error) throw new Error(mensagemErroEletroposto(error));
            setIdSalvo(data.id);

            const { error: erroRpc } = await supabase.rpc('fn_salvar_fornecedores_eletroposto', {
                p_eletroposto_id: data.id,
                p_fornecedores: paraPayloadFornecedores(fornecedores),
            });
            if (erroRpc) throw new Error('O eletroposto foi salvo, mas os fornecedores não: ' + mensagemErroEletroposto(erroRpc));

            if (fornecedores.length > 0 && soma !== 100) {
                showAlert(`Salvo. A soma dos fornecedores está em ${soma}%, não em 100%.`, 'warning');
            }
            onSave();
        } catch (e) {
            showAlert(e.message, 'error');
        } finally {
            setSalvando(false);
        }
    };

    const handleExcluir = async () => {
        if (!idSalvo) return;
        const ok = await showConfirm(
            `Excluir o eletroposto "${form.nome}"? Os fornecedores ligados a ele também saem. A UC não é alterada.`,
            'Excluir eletroposto', 'Excluir', 'Cancelar'
        );
        if (!ok) return;
        const { data, error } = await supabase.from('eletropostos').delete().eq('id', idSalvo).select('id');
        if (error || !data?.length) {
            showAlert('Não foi possível excluir: ' + (error?.message || 'sem permissão.'), 'error');
            return;
        }
        onDelete(idSalvo);
    };

    const estiloAba = (id) => ({
        padding: '0.6rem 1rem', border: 'none', cursor: 'pointer', fontWeight: 600,
        background: 'transparent', color: aba === id ? 'var(--color-blue)' : '#64748b',
        borderBottom: aba === id ? '2px solid var(--color-blue)' : '2px solid transparent',
    });
    const grade = (colunas) => ({ display: 'grid', gridTemplateColumns: colunas, gap: '1rem' });

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '900px' }}>
                <div className="modal-header">
                    <h3>{idSalvo ? form.nome || 'Eletroposto' : 'Novo Eletroposto'}</h3>
                    <button type="button" onClick={onClose} className="modal-close">&times;</button>
                </div>

                {erroCarga && (
                    <p style={{ color: '#991b1b', background: '#fee2e2', padding: '0.5rem 0.8rem', borderRadius: '6px' }}>
                        Erro ao carregar as opções: {erroCarga}
                    </p>
                )}

                <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--color-border)', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                    {ABAS.map(a => (
                        <button key={a.id} type="button" style={estiloAba(a.id)} onClick={() => setAba(a.id)}>
                            {a.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSubmit}>
                    <fieldset disabled={somenteLeitura || salvando} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                        {aba === 'dados' && (
                            <>
                                <div className="form-group">
                                    <label className="label">Nome</label>
                                    <input className="input" {...campo('nome')} />
                                </div>
                                <div style={grade('1fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">Status</label>
                                        <select className="input" {...campo('status')}>
                                            {STATUS_ELETROPOSTO.map(s => <option key={s.status} value={s.status}>{s.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Plano de eletroposto</label>
                                        <select className="input" {...campo('plano_id')}>
                                            <option value="">Sem plano</option>
                                            {planos.map(p => <option key={p.id} value={p.id}>{p.nome}{p.ativo === false ? ' (inativo)' : ''}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Originador (hierarquia do split)</label>
                                        <select className="input" {...campo('originator_id')}>
                                            <option value="">Sem originador</option>
                                            {originadores.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Tarifa do investidor (R$/kWh, piso)</label>
                                        <input className="input" type="number" min="0" step="0.0001" {...campo('tarifa_investidor_kwh')} />
                                    </div>
                                </div>
                                <div style={grade('1fr 2fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">CEP</label>
                                        <input className="input" {...campo('cep')} onBlur={buscarCep} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Rua</label>
                                        <input className="input" {...campo('rua')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Número</label>
                                        <input className="input" {...campo('numero')} />
                                    </div>
                                </div>
                                <div style={grade('2fr 2fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">Bairro</label>
                                        <input className="input" {...campo('bairro')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Cidade</label>
                                        <input className="input" {...campo('cidade')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">UF</label>
                                        <input className="input" maxLength={2} {...campo('uf')} />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="label">Observações</label>
                                    <textarea className="input" rows={3} {...campo('observacoes')} />
                                </div>
                            </>
                        )}

                        {aba === 'uc' && (
                            <>
                                <div className="form-group">
                                    <label className="label">UC que fornece a energia</label>
                                    <input
                                        className="input"
                                        placeholder="Buscar por número da UC ou assinante..."
                                        value={buscaUc}
                                        onChange={ev => setBuscaUc(ev.target.value)}
                                        style={{ marginBottom: '0.5rem' }}
                                    />
                                    <select className="input" {...campo('consumer_unit_id')}>
                                        <option value="">Sem UC</option>
                                        {ucSelecionada && (
                                            <option value={ucSelecionada.id}>
                                                {ucSelecionada.numero_uc}{ucSelecionada.subscriber?.name ? ` — ${ucSelecionada.subscriber.name}` : ''}
                                            </option>
                                        )}
                                        {ucsDisponiveis.map(u => (
                                            <option key={u.id} value={u.id}>
                                                {u.numero_uc}{u.subscriber?.name ? ` — ${u.subscriber.name}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <small style={{ color: 'var(--color-text-light)' }}>
                                        Só aparecem UCs que não estão ligadas a outro eletroposto (até 50 por busca).
                                    </small>
                                </div>

                                <div className="card" style={{ background: 'var(--color-bg-light)', padding: '1rem' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>Usina (vem da UC)</div>
                                    {!ucSelecionada ? (
                                        <div>Escolha uma UC.</div>
                                    ) : ucSelecionada.usina ? (
                                        <div style={{ fontWeight: 'bold' }}>
                                            {ucSelecionada.usina.name}
                                            <span style={{ fontWeight: 'normal', color: '#64748b' }}> · {String(ucSelecionada.usina.status || '').replace('_', ' ')}</span>
                                        </div>
                                    ) : (
                                        <div style={{ color: '#9a3412' }}>UC sem usina vinculada.</div>
                                    )}
                                    {ucSelecionada && (
                                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.3rem' }}>
                                            Status da UC: {String(ucSelecionada.status || '-').replace('_', ' ')}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {aba === 'fornecedores' && (
                            <>
                                {fornecedores.length === 0 && (
                                    <p style={{ color: 'var(--color-text-light)' }}>Nenhum fornecedor ligado a este eletroposto.</p>
                                )}
                                {fornecedores.map((f, i) => (
                                    <div key={i} style={{ ...grade('3fr 1fr auto auto'), alignItems: 'end', marginBottom: '0.75rem' }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="label">Fornecedor</label>
                                            <select className="input" value={f.supplier_id} onChange={ev => alterarFornecedor(i, { supplier_id: ev.target.value })}>
                                                <option value="">Escolha...</option>
                                                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="label">%</label>
                                            <input className="input" type="number" min="0.01" max="100" step="0.01"
                                                value={f.percentual} onChange={ev => alterarFornecedor(i, { percentual: ev.target.value })} />
                                        </div>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', paddingBottom: '0.6rem' }}>
                                            <input type="checkbox" checked={f.ativo !== false} onChange={ev => alterarFornecedor(i, { ativo: ev.target.checked })} />
                                            Ativo
                                        </label>
                                        {!somenteLeitura && (
                                            <button type="button" className="btn btn-secondary" style={{ marginBottom: '0.2rem' }}
                                                onClick={() => setFornecedores(lista => lista.filter((_, j) => j !== i))}>
                                                Remover
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {!somenteLeitura && (
                                    <button type="button" className="btn btn-secondary"
                                        onClick={() => setFornecedores(lista => [...lista, { supplier_id: '', percentual: '', ativo: true }])}>
                                        + Adicionar fornecedor
                                    </button>
                                )}
                                <div style={{ marginTop: '1rem', fontWeight: 'bold', color: corDaSoma(soma) }}>
                                    Total dos ativos: {soma}%
                                    {soma !== 100 && fornecedores.length > 0 && (
                                        <span style={{ fontWeight: 'normal' }}>
                                            {soma > 100 ? ' — passa de 100%, não é possível salvar.' : ' — ainda não fecha 100%.'}
                                        </span>
                                    )}
                                </div>
                            </>
                        )}

                        {aba === 'tecnico' && (
                            <>
                                <div style={grade('1fr 1fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">Qtd. de carregadores</label>
                                        <input className="input" type="number" min="0" step="1" {...campo('qtd_carregadores')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Potência por carregador (kW)</label>
                                        <input className="input" type="number" min="0" step="0.1" {...campo('potencia_kw')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Tipo de recarga</label>
                                        <select className="input" {...campo('tipo_recarga')}>
                                            <option value="">Não informado</option>
                                            {TIPOS_RECARGA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={grade('1fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">Fabricante</label>
                                        <input className="input" {...campo('fabricante')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Modelo</label>
                                        <input className="input" {...campo('modelo')} />
                                    </div>
                                </div>
                            </>
                        )}
                    </fieldset>

                    <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                        <div>
                            {idSalvo && !somenteLeitura && (
                                <button type="button" className="btn btn-secondary" style={{ color: '#991b1b' }} onClick={handleExcluir}>
                                    Excluir
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                {somenteLeitura ? 'Fechar' : 'Cancelar'}
                            </button>
                            {!somenteLeitura && (
                                <button type="submit" className="btn btn-primary" disabled={salvando}>
                                    {salvando ? 'Salvando...' : 'Salvar'}
                                </button>
                            )}
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
