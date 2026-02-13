import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import { supabase } from '../lib/supabase';

export default function LeadSimulation() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const originatorId = searchParams.get('id');

    const [formData, setFormData] = useState({
        cep: '',
        nome: '',
        email: '',
        telefone: '',
        consumo: ''
    });

    const [address, setAddress] = useState(null);
    const [offer, setOffer] = useState(null);
    const [loading, setLoading] = useState(false);
    const [simulated, setSimulated] = useState(false);

    const handleCepBlur = async () => {
        if (formData.cep.length >= 8) {
            try {
                setLoading(true);
                const addr = await fetchAddressByCep(formData.cep);
                setAddress(addr);
                if (addr.ibge) {
                    const offerData = await fetchOfferData(addr.ibge);
                    setOffer(offerData);
                }
            } catch (error) {
                console.error(error);
                alert('Erro ao buscar CEP');
            } finally {
                setLoading(false);
            }
        }
    };

    const calculateSavings = () => {
        if (!offer || !formData.consumo) return null;
        const tarifa = offer['Tarifa Concessionaria'] || 0.85; // Fallback
        const desconto = offer['Desconto Assinante'] || 0.10; // 10% default
        const contaAtual = parseFloat(formData.consumo) * tarifa;
        const economiaMensal = contaAtual * desconto;
        return { contaAtual, economiaMensal, anual: economiaMensal * 12 };
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        // Calculate savings
        const savings = calculateSavings();

        // Save Lead
        const { data, error } = await supabase.from('leads').insert({
            name: formData.nome,
            email: formData.email,
            phone: formData.telefone,
            // Address fields flattened
            cep: formData.cep,
            rua: address?.rua,
            bairro: address?.bairro,
            cidade: address?.cidade,
            uf: address?.uf,

            consumo_kwh: parseFloat(formData.consumo),
            concessionaria: offer?.Concessionaria,
            tarifa_concessionaria: offer?.['Tarifa Concessionaria'],
            desconto_assinante: offer?.['Desconto Assinante'],
            originator_id: originatorId, // Link to originator if present
            status: 'simulacao'
        }).select().single();

        if (error) {
            alert('Erro ao salvar simulação: ' + error.message);
        } else {
            setSimulated(true);
            // Optional: Navigate to signup or show result
        }
        setLoading(false);
    };

    const savings = calculateSavings();

    return (
        <div style={{ minHeight: '100vh', padding: '2rem', backgroundColor: 'var(--color-bg-light)' }}>
            <div style={{ maxWidth: '600px', margin: '0 auto', background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                <h1 style={{ textAlign: 'center' }}>Simule sua Economia</h1>

                {!simulated ? (
                    <form onSubmit={handleSubmit}>
                        <div style={{ marginBottom: '1rem' }}>
                            <label>CEP</label>
                            <input
                                value={formData.cep}
                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                onBlur={handleCepBlur}
                                placeholder="00000-000"
                                style={{ width: '100%', padding: '0.5rem' }}
                                required
                            />
                        </div>

                        {address && (
                            <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f0f9ff', borderRadius: '4px' }}>
                                <p><strong>Cidade:</strong> {address.cidade} - {address.uf}</p>
                                {offer ? (
                                    <p style={{ color: 'green' }}>✅ Concessionária: {offer.Concessionaria}</p>
                                ) : (
                                    <p style={{ color: 'orange' }}>⚠️ Sem oferta automática para esta região</p>
                                )}
                            </div>
                        )}

                        <div style={{ marginBottom: '1rem' }}>
                            <label>Nome Completo</label>
                            <input
                                value={formData.nome}
                                onChange={e => setFormData({ ...formData, nome: e.target.value })}
                                style={{ width: '100%', padding: '0.5rem' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label>Email</label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                style={{ width: '100%', padding: '0.5rem' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label>Telefone</label>
                            <input
                                value={formData.telefone}
                                onChange={e => setFormData({ ...formData, telefone: e.target.value })}
                                placeholder="(00) 00000-0000"
                                style={{ width: '100%', padding: '0.5rem' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label>Consumo Médio (kWh)</label>
                            <input
                                type="number"
                                value={formData.consumo}
                                onChange={e => setFormData({ ...formData, consumo: e.target.value })}
                                style={{ width: '100%', padding: '0.5rem' }}
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            style={{ width: '100%', padding: '1rem', backgroundColor: 'var(--color-orange)', color: 'white', fontWeight: 'bold', fontSize: '1.1rem' }}
                        >
                            {loading ? 'Calculando...' : 'Simular Economia'}
                        </button>
                    </form>
                ) : (
                    <div style={{ textAlign: 'center' }}>
                        <h2 style={{ color: 'var(--color-orange)' }}>Resultado da Simulação</h2>
                        <div style={{ margin: '2rem 0', padding: '1rem', background: '#f0fdf4', borderRadius: '8px' }}>
                            <p>Sua conta atual: <strong>R$ {savings?.contaAtual.toFixed(2)}</strong></p>
                            <h3 style={{ color: 'green', fontSize: '1.5rem', margin: '1rem 0' }}>
                                Economia Anual Estimada: <br />R$ {savings?.anual.toFixed(2)}
                            </h3>
                        </div>
                        <button
                            onClick={() => {
                                const params = new URLSearchParams();
                                params.append('name', formData.nome);
                                params.append('email', formData.email);
                                params.append('phone', formData.telefone);
                                params.append('cep', formData.cep);
                                if (offer?.Concessionaria) params.append('concessionaria', offer.Concessionaria);
                                if (savings?.anual) params.append('savings_annual', savings.anual);
                                if (offer?.['Desconto Assinante']) {
                                    const discount = offer['Desconto Assinante'] > 1
                                        ? offer['Desconto Assinante']
                                        : offer['Desconto Assinante'] * 100;
                                    params.append('discount_percent', discount);
                                }
                                if (originatorId) params.append('originator_id', originatorId);

                                navigate(`/contrato?${params.toString()}`);
                            }}
                            style={{ width: '100%', padding: '1rem', backgroundColor: 'var(--color-blue)', color: 'white', fontWeight: 'bold' }}
                        >
                            Quero Assinar!
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
