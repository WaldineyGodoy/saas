
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone, cleanDigits } from '../lib/validators';
import { ArrowRight, CheckCircle, Zap, TrendingDown, ShieldCheck } from 'lucide-react';

export default function ReferralLanding() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const originatorId = searchParams.get('id');

    // Steps: 'simulation' -> 'signup'
    const [step, setStep] = useState('simulation');
    const [loading, setLoading] = useState(false);

    // Simulation Result
    const [savings, setSavings] = useState(null);
    const [offer, setOffer] = useState(null);
    const [leadId, setLeadId] = useState(null);

    // Form Data - Shared State
    const [formData, setFormData] = useState({
        // Simulation
        cep: '',
        nome: '',
        email: '',
        telefone: '',
        consumo: '',

        // Address (fetched)
        rua: '',
        numero: '',
        bairro: '',
        cidade: '',
        uf: '',

        // Signup
        cpf_cnpj: '',
        numero_uc: ''
    });

    // --- STEP 1: SIMULATION ---

    const handleCepBlur = async () => {
        if (formData.cep.length >= 8) {
            try {
                setLoading(true);
                const addr = await fetchAddressByCep(formData.cep);
                setFormData(prev => ({
                    ...prev,
                    rua: addr.rua || '',
                    bairro: addr.bairro || '',
                    cidade: addr.cidade || '',
                    uf: addr.uf || ''
                }));

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

    const handleSimulationSubmit = async (e) => {
        e.preventDefault();

        if (!validatePhone(formData.telefone)) {
            alert('Telefone inválido! Digite o DDD + 9 dígitos.');
            return;
        }

        setLoading(true);

        try {
            // 1. Calculate Savings
            const tarifa = offer ? (offer['Tarifa Concessionaria'] || 0.85) : 0.85;
            const desconto = offer ? (offer['Desconto Assinante'] || 0.10) : 0.10;
            const contaAtual = parseFloat(formData.consumo) * tarifa;
            const economiaMensal = contaAtual * desconto;

            setSavings({ contaAtual, economiaMensal, anual: economiaMensal * 12 });

            // 2. Save Lead
            const { data, error } = await supabase.from('leads').insert({
                name: formData.nome,
                email: formData.email,
                phone: formData.telefone,
                address: {
                    cep: formData.cep,
                    rua: formData.rua,
                    cidade: formData.cidade,
                    uf: formData.uf
                },
                consumo_kwh: parseFloat(formData.consumo),
                concessionaria: offer?.Concessionaria,
                tarifa_concessionaria: tarifa,
                desconto_assinante: desconto,
                originator_id: originatorId,
                status: 'indicado' // Start as 'indicado'
            }).select().single();

            if (error) throw error;
            setLeadId(data.id);
            setStep('signup'); // Move to Step 2

        } catch (error) {
            alert('Erro na simulação: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    // --- STEP 2: SIGNUP ---

    const handleSignupSubmit = async (e) => {
        e.preventDefault();

        if (!validateDocument(formData.cpf_cnpj)) {
            alert('CPF/CNPJ inválido!');
            return;
        }
        if (!validatePhone(formData.telefone)) {
            alert('Telefone inválido!');
            return;
        }

        setLoading(true);

        try {
            // 1. Create Profile/Auth (Skipped for now, user is just a 'Subscriber' record)
            // Ideally we create a Supabase Auth user here, but for now let's just create the Subscriber record.

            // 2. Create Subscriber
            const { data: subscriber, error: subError } = await supabase.from('subscribers').insert({
                name: formData.nome,
                cpf_cnpj: formData.cpf_cnpj,
                email: formData.email,
                phone: formData.telefone,
                status: 'ativacao',
                originator_id: originatorId
                // password? trigger handles auth creation?
            }).select().single();

            if (subError) throw subError;

            // 3. Create Consumer Unit
            const { error: ucError } = await supabase.from('consumer_units').insert({
                subscriber_id: subscriber.id,
                numero_uc: formData.numero_uc,
                concessionaria: offer?.Concessionaria,
                status: 'ativacao',
                address: {
                    cep: formData.cep,
                    rua: formData.rua,
                    numero: formData.numero,
                    bairro: formData.bairro,
                    cidade: formData.cidade,
                    uf: formData.uf
                },
                titular_conta: formData.nome
            });

            if (ucError) throw ucError;

            // 4. Update Lead Status
            if (leadId) {
                await supabase.from('leads').update({ status: 'convertido' }).eq('id', leadId);
            }

            alert('Cadastro realizado com sucesso! Em breve entraremos em contato.');
            navigate('/login'); // Or success page

        } catch (error) {
            alert('Erro ao finalizar cadastro: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ minHeight: '100vh', padding: '2rem', backgroundColor: '#f3f4f6', display: 'flex', justifyContent: 'center' }}>
            <div style={{ maxWidth: '600px', width: '100%', background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>

                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <h1 style={{ color: 'var(--color-blue)', marginBottom: '0.5rem' }}>B2W Energia</h1>
                    <p style={{ color: '#666' }}>Economize na sua conta de luz sem investimento.</p>
                </div>

                {step === 'simulation' ? (
                    <form onSubmit={handleSimulationSubmit}>
                        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: '#333' }}>Simule sua Economia</h2>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>CEP</label>
                            <input
                                value={formData.cep}
                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                onBlur={handleCepBlur}
                                placeholder="00000-000"
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        {formData.cidade && (
                            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#ecfdf5', borderRadius: '4px', color: '#065f46', fontSize: '0.9rem' }}>
                                📍 {formData.cidade} - {formData.uf}
                                {offer && <span style={{ display: 'block', fontWeight: 'bold' }}>⚡ {offer.Concessionaria}</span>}
                            </div>
                        )}

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Nome Completo</label>
                            <input
                                value={formData.nome}
                                onChange={e => setFormData({ ...formData, nome: e.target.value })}
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Email</label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Telefone</label>
                            <input
                                value={formData.telefone}
                                onChange={e => setFormData({ ...formData, telefone: maskPhone(e.target.value) })}
                                placeholder="(00) 00000-0000"
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Média de Consumo (kWh)</label>
                            <input
                                type="number"
                                value={formData.consumo}
                                onChange={e => setFormData({ ...formData, consumo: e.target.value })}
                                placeholder="Ex: 500"
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            style={{ width: '100%', padding: '1rem', background: 'var(--color-orange)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                            {loading ? 'Calculando...' : 'VER MINHA ECONOMIA'}
                        </button>
                    </form>

                ) : (

                    <form onSubmit={handleSignupSubmit}>
                        {savings && (
                            <div style={{ textAlign: 'center', marginBottom: '2rem', padding: '1.5rem', background: '#ecfdf5', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
                                <div style={{ fontSize: '0.9rem', color: '#065f46' }}>Economia Anual Estimada</div>
                                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#059669' }}>R$ {savings.anual.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                            </div>
                        )}

                        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: '#333' }}>Finalizar Cadastro</h2>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>CPF / CNPJ</label>
                            <input
                                value={formData.cpf_cnpj}
                                onChange={e => setFormData({ ...formData, cpf_cnpj: maskCpfCnpj(e.target.value) })}
                                placeholder="000.000.000-00"
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Confirme seu Nome</label>
                            <input
                                value={formData.nome}
                                onChange={e => setFormData({ ...formData, nome: e.target.value })}
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Confirme seu Email</label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Confirme seu Telefone</label>
                            <input
                                value={formData.telefone}
                                onChange={e => setFormData({ ...formData, telefone: maskPhone(e.target.value) })}
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Rua</label>
                                <input value={formData.rua} disabled style={{ width: '100%', padding: '0.75rem', background: '#f9f9f9', border: '1px solid #eee' }} />
                            </div>
                            <div style={{ width: '100px' }}>
                                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Número</label>
                                <input
                                    value={formData.numero}
                                    onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                    required
                                />
                            </div>
                        </div>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>Número da UC (Instalação)</label>
                            <input
                                value={formData.numero_uc}
                                onChange={e => setFormData({ ...formData, numero_uc: e.target.value })}
                                placeholder="Encontrado na sua conta de luz"
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            style={{ width: '100%', padding: '1rem', background: 'var(--color-blue)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                            {loading ? 'Finalizando...' : 'FINALIZAR ASSINATURA'}
                        </button>
                    </form>

                )}
            </div>
        </div>
    );
}
