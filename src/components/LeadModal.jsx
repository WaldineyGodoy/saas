import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { fetchAddressByCep, fetchOfferData, sendWhatsapp } from '../lib/api';
import { maskPhone, validatePhone } from '../lib/validators';

export default function LeadModal({ lead, onClose, onSave, onDelete, onConvert }) {
    const { profile } = useAuth();
    const [originators, setOriginators] = useState([]);

    // Status Options: Simulação, Indicado, Em negociação, Negocio Perdido, Ativo, Pago
    const statusOptions = [
        { value: 'simulacao', label: 'Simulação' },
        { value: 'indicado', label: 'Indicado' },
        { value: 'em_negociacao', label: 'Em Negociação' },
        { value: 'negocio_perdido', label: 'Negócio Perdido' },
        { value: 'ativo', label: 'Ativo' },
        { value: 'pago', label: 'Pago' },
        { value: 'convertido', label: 'Convertido (Legado)' } // Mantendo caso exista
    ];

    const [formData, setFormData] = useState({
        name: '',
        status: 'simulacao',
        phone: '',
        email: '',
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        concessionaria: '',
        tarifa_concessionaria: '',
        consumo_kwh: '',
        desconto_assinante: '',
        originator_id: ''
    });

    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);

    useEffect(() => {
        fetchOriginators();
        if (lead) {
            setFormData({
                name: lead.name,
                status: lead.status || 'simulacao',
                phone: lead.phone || '',
                email: lead.email || '',
                cep: lead.cep || '',
                rua: lead.rua || '',
                numero: lead.numero || '',
                complemento: lead.complemento || '',
                bairro: lead.bairro || '',
                cidade: lead.cidade || '',
                uf: lead.uf || '',
                concessionaria: lead.concessionaria || '',
                tarifa_concessionaria: lead.tarifa_concessionaria || '',
                consumo_kwh: lead.consumo_kwh || '',
                desconto_assinante: lead.desconto_assinante || '',
                originator_id: lead.originator_id || ''
            });
        } else {
            if (profile?.role === 'originator') {
                setFormData(prev => ({ ...prev, originator_id: profile.id }));
            }
        }
    }, [lead, profile]);

    const fetchOriginators = async () => {
        // Fetch from the actual Originators table, not profiles
        const { data } = await supabase
            .from('originators_v2')
            .select('id, name')
            .order('name');
        setOriginators(data || []);
    };

    const handleCepBlur = async () => {
        const rawCep = formData.cep.replace(/\D/g, '');
        if (rawCep.length === 8) {
            setSearchingCep(true);
            try {
                const addr = await fetchAddressByCep(rawCep);

                // Get Offer Info if available
                let offer = {};
                if (addr.ibge) {
                    try {
                        const offerData = await fetchOfferData(addr.ibge);
                        if (offerData) offer = offerData;
                    } catch (e) {
                        console.error('Erro na oferta', e);
                    }
                }

                setFormData(prev => ({
                    ...prev,
                    rua: addr.rua || '',
                    bairro: addr.bairro || '',
                    cidade: addr.cidade || '',
                    uf: addr.uf || '',
                    concessionaria: offer?.Concessionaria || prev.concessionaria || '',
                    tarifa_concessionaria: offer?.['Tarifa Concessionaria'] || prev.tarifa_concessionaria || '',
                    tarifa_concessionaria: offer?.['Tarifa Concessionaria'] || prev.tarifa_concessionaria || '',
                    desconto_assinante: (() => {
                        let val = offer?.['Desconto Assinante'] || prev.desconto_assinante || '';
                        if (val && !isNaN(val) && Number(val) > 0 && Number(val) < 1) {
                            return Number(val) * 100;
                        }
                        return val;
                    })()
                }));
            } catch (error) {
                console.error('Erro ao buscar CEP:', error);
                alert('Erro ao buscar CEP. Verifique se digitou corretamente.');
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (formData.phone && !validatePhone(formData.phone)) {
            alert('Telefone inválido!');
            return;
        }

        setLoading(true);

        try {
            const dataToSave = { ...formData };
            // Ensure numbers are numbers and null if empty/invalid
            dataToSave.tarifa_concessionaria = dataToSave.tarifa_concessionaria ? Number(dataToSave.tarifa_concessionaria) : null;
            dataToSave.consumo_kwh = dataToSave.consumo_kwh ? Number(dataToSave.consumo_kwh) : null;
            dataToSave.desconto_assinante = dataToSave.desconto_assinante ? Number(dataToSave.desconto_assinante) : null;
            if (dataToSave.originator_id === '') dataToSave.originator_id = null;

            let result;
            if (lead?.id) {
                result = await supabase
                    .from('leads')
                    .update(dataToSave)
                    .eq('id', lead.id)
                    .select()
                    .single();
            } else {
                result = await supabase
                    .from('leads')
                    .insert(dataToSave)
                    .select()
                    .single();
            }

            if (result.error) throw result.error;

            // [NEW] Notification Logic (On Activation)
            if (dataToSave.status === 'ativo' && (!lead || lead.status !== 'ativo')) {
                const originatorId = dataToSave.originator_id;
                if (originatorId) {
                    try {
                        const { data: originator } = await supabase
                            .from('originators_v2')
                            .select('phone, split_commission, name')
                            .eq('id', originatorId)
                            .maybeSingle();

                        if (originator && originator.phone) {
                            // Calculate values
                            const kwh = Number(dataToSave.consumo_kwh) || 0;
                            const tarifa = Number(dataToSave.tarifa_concessionaria) || 0.85;
                            let discountRate = Number(dataToSave.desconto_assinante) || 15;

                            // Handle decimal inputs (e.g. 0.15 vs 15)
                            if (discountRate < 1 && discountRate > 0) {
                                discountRate = discountRate * 100;
                            }

                            const totalSemDesconto = kwh * tarifa;
                            const economia = totalSemDesconto * (discountRate / 100);
                            const baseCalculo = totalSemDesconto - economia;

                            const comissaoPercent = Number(originator.split_commission) || 0;
                            const comissaoValor = baseCalculo * (comissaoPercent / 100);

                            const formattedValue = comissaoValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                            const leadName = dataToSave.name || 'O Lead';

                            const msg = `${leadName}, aceitou o convite e está proximo de concluir o cadastro, em breve vc receberá o seu cashback ${formattedValue}`;

                            await sendWhatsapp(originator.phone, msg);
                            console.log("Notificação de ativação enviada para:", originator.name);
                        }
                    } catch (notificationError) {
                        console.error("Erro ao enviar notificação de ativação:", notificationError);
                        // Do not fail the save if notification fails
                    }
                }
            }

            onSave(result.data);
            onClose();
        } catch (error) {
            alert('Erro ao salvar lead: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!lead?.id) return;
        if (!confirm('Tem certeza que deseja excluir este lead? Esta ação não pode ser desfeita.')) return;

        setLoading(true);
        try {
            const { error } = await supabase
                .from('leads')
                .delete()
                .eq('id', lead.id);

            if (error) throw error;

            if (onDelete) onDelete(lead.id); // Notify parent
            onClose();
        } catch (error) {
            alert('Erro ao excluir lead: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
                <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
                    {lead ? 'Editar Lead' : 'Novo Lead'}
                </h3>

                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

                    {/* --- Dados do Lead --- */}
                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Dados do Lead</div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Status</label>
                        <select
                            value={formData.status}
                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            {statusOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Originador</label>
                        <select
                            value={formData.originator_id}
                            onChange={e => setFormData({ ...formData, originator_id: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            <option value="">Selecione...</option>
                            {originators.map(o => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Nome Completo</label>
                        <input
                            required
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Telefone</label>
                        <input
                            placeholder="55 xx xxxxx xxxx"
                            value={formData.phone}
                            onChange={e => setFormData({ ...formData, phone: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Email</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    {/* --- Endereço --- */}
                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem', color: 'var(--color-blue)' }}>Endereço e Instalação</div>

                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>CEP (Busca)</label>
                            <input
                                placeholder="00000-000"
                                value={formData.cep}
                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                onBlur={handleCepBlur}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: searchingCep ? '#f0f9ff' : 'white' }}
                            />
                        </div>
                        <div style={{ flex: 2 }}>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Cidade/UF</label>
                            <input
                                value={`${formData.cidade} - ${formData.uf} `}
                                disabled
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#f9fafb' }}
                            />
                        </div>
                    </div>

                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Rua</label>
                        <input
                            value={formData.rua}
                            onChange={e => setFormData({ ...formData, rua: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Número</label>
                        <input
                            value={formData.numero}
                            onChange={e => setFormData({ ...formData, numero: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Complemento</label>
                        <input
                            value={formData.complemento}
                            onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Bairro</label>
                        <input
                            value={formData.bairro}
                            onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    {/* --- Dados de Energia --- */}
                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem', color: 'var(--color-blue)' }}>Dados de Energia e Oferta</div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Consumo Médio (kWh)</label>
                        <input
                            type="number"
                            value={formData.consumo_kwh}
                            onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Concessionária</label>
                        <input
                            value={formData.concessionaria}
                            onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                            placeholder="Busca automática..."
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#f8fdfce' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Tarifa (R$)</label>
                        <input
                            type="number" step="0.0001"
                            value={formData.tarifa_concessionaria}
                            onChange={e => setFormData({ ...formData, tarifa_concessionaria: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Desconto Oferta (%)</label>
                        <input
                            type="number" step="0.01"
                            value={formData.desconto_assinante}
                            onChange={e => setFormData({ ...formData, desconto_assinante: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: 'green', fontWeight: 'bold' }}>Economia Mensal Estimada (R$)</label>
                        <input
                            value={(() => {
                                const kwh = Number(formData.consumo_kwh) || 0;
                                const tarifa = Number(formData.tarifa_concessionaria) || 0;
                                const desconto = Number(formData.desconto_assinante) || 0; // percentage
                                if (kwh && tarifa && desconto) {
                                    const totalSemDesconto = kwh * tarifa;
                                    const economia = totalSemDesconto * (desconto / 100);
                                    return !isNaN(economia) ? economia.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00';
                                }
                                return 'R$ 0,00';
                            })()}
                            disabled
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#e6fffa', color: '#047857', fontWeight: 'bold' }}
                        />
                    </div>

                    <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
                        <div>
                            {lead && onDelete && (
                                <button type="button" onClick={handleDelete} style={{ padding: '0.5rem 1rem', background: '#fee2e2', color: '#dc2626', borderRadius: '4px', border: '1px solid #fecaca' }}>
                                    Excluir
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            {lead && lead.status !== 'convertido' && onConvert && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onConvert(lead);
                                        onClose();
                                    }}
                                    style={{ padding: '0.5rem 1rem', background: 'white', color: 'green', border: '1px solid green', borderRadius: '4px' }}
                                >
                                    Converter em Assinante
                                </button>
                            )}
                            <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', background: '#ccc', borderRadius: '4px' }}>Cancelar</button>
                            <button type="submit" disabled={loading} style={{ padding: '0.5rem 1rem', background: 'var(--color-blue)', color: 'white', borderRadius: '4px' }}>
                                {loading ? 'Salvando...' : 'Salvar Lead'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
