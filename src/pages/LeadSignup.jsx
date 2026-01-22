import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCpfCnpjData, fetchAddressByCep } from '../lib/api';
import { supabase } from '../lib/supabase';

export default function LeadSignup() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1); // 1: Personal Data, 2: Address/UC

    const [formData, setFormData] = useState({
        cpf: '',
        nome: '',
        email: '',
        password: '',
        telefone: '',
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        numero_uc: ''
    });

    const handleCpfBlur = async () => {
        if (formData.cpf.replace(/\D/g, '').length === 11) {
            setLoading(true);
            try {
                const data = await fetchCpfCnpjData(formData.cpf);
                setFormData(prev => ({ ...prev, nome: data.nome }));
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleCepBlur = async () => {
        if (formData.cep.length >= 8) {
            setLoading(true);
            try {
                const addr = await fetchAddressByCep(formData.cep);
                setFormData(prev => ({
                    ...prev,
                    rua: addr.rua,
                    bairro: addr.bairro,
                    cidade: addr.cidade,
                    uf: addr.uf
                }));
            } catch (error) {
                alert('CEP não encontrado');
            } finally {
                setLoading(false);
            }
        }
    };

    const handleSubmitProfile = async (e) => {
        e.preventDefault();
        setStep(2);
    };

    const handleFinalSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            // 1. Create Auth User
            // We pass all profile data as metadata so the Trigger can populate the profiles table.
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: formData.email,
                password: formData.password,
                options: {
                    data: {
                        name: formData.nome,
                        role: 'subscriber',
                        cpf_cnpj: formData.cpf,
                        phone: formData.telefone,
                        address: {
                            rua: formData.rua,
                            numero: formData.numero,
                            complemento: formData.complemento,
                            bairro: formData.bairro,
                            cidade: formData.cidade,
                            uf: formData.uf,
                            cep: formData.cep
                        }
                    }
                }
            });

            if (authError) throw authError;

            // 2. Ensure Profile Exists (Manual Upsert to guarantee FK satisfaction)
            // Even if the trigger runs, this upsert ensures the data is there and correct before we proceed.
            const userId = authData.user.id;

            const { error: profileError } = await supabase.from('profiles').upsert({
                id: userId,
                name: formData.nome,
                cpf_cnpj: formData.cpf,
                email: formData.email,
                phone: formData.telefone,
                role: 'subscriber',
                address: {
                    rua: formData.rua,
                    numero: formData.numero,
                    complemento: formData.complemento,
                    bairro: formData.bairro,
                    cidade: formData.cidade,
                    uf: formData.uf,
                    cep: formData.cep
                }
            });

            if (profileError) {
                console.error('Erro ao criar/atualizar perfil:', profileError);
                // We don't throw here immediately to see if subscriber creation might still work if it was a race condition,
                // but usually this error implies deeper issues.
                // However, if the trigger created it, upsert shouldn't fail unless permissions are wrong.
            }

            // 3. Create Subscriber
            const { data: subData, error: subError } = await supabase.from('subscribers').insert({
                profile_id: userId,
                name: formData.nome,
                cpf_cnpj: formData.cpf,
                email: formData.email,
                phone: formData.telefone,
                status: 'ativacao'
            }).select().single();

            if (subError) throw subError;

            // 4. Create Consumer Unit (UC)
            await supabase.from('consumer_units').insert({
                subscriber_id: subData.id,
                numero_uc: formData.numero_uc,
                status: 'ativacao',
                address: {
                    rua: formData.rua,
                    cep: formData.cep
                    // ... others
                }
            });

            alert('Cadastro realizado com sucesso! Entre com o seu email e senha e faça login.');
            navigate('/login');

        } catch (error) {
            alert('Erro ao cadastrar: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ minHeight: '100vh', padding: '2rem', backgroundColor: 'var(--color-bg-light)' }}>
            <div style={{ maxWidth: '600px', margin: '0 auto', background: 'white', padding: '2rem', borderRadius: '8px' }}>
                <h1 style={{ textAlign: 'center', marginBottom: '1rem' }}>Assine Agora</h1>

                {step === 1 && (
                    <form onSubmit={handleSubmitProfile}>
                        <div style={{ display: 'grid', gap: '1rem' }}>
                            <div>
                                <label>CPF/CNPJ</label>
                                <input
                                    value={formData.cpf}
                                    onChange={e => setFormData({ ...formData, cpf: e.target.value })}
                                    onBlur={handleCpfBlur}
                                    style={{ width: '100%', padding: '0.5rem' }}
                                    required
                                />
                            </div>
                            <div>
                                <label>Nome Completo</label>
                                <input
                                    value={formData.nome}
                                    onChange={e => setFormData({ ...formData, nome: e.target.value })}
                                    style={{ width: '100%', padding: '0.5rem' }}
                                    required
                                />
                            </div>
                            <div>
                                <label>Email</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    style={{ width: '100%', padding: '0.5rem' }}
                                    required
                                />
                            </div>
                            <div>
                                <label>Senha</label>
                                <input
                                    type="password"
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    style={{ width: '100%', padding: '0.5rem' }}
                                    required
                                    minLength={6}
                                />
                            </div>
                            <div>
                                <label>Telefone</label>
                                <input
                                    value={formData.telefone}
                                    onChange={e => setFormData({ ...formData, telefone: e.target.value })}
                                    style={{ width: '100%', padding: '0.5rem' }}
                                    required
                                />
                            </div>
                            <button
                                type="submit"
                                style={{ width: '100%', padding: '1rem', backgroundColor: 'var(--color-blue)', color: 'white' }}
                            >
                                Próximo
                            </button>
                        </div>
                    </form>
                )}

                {step === 2 && (
                    <form onSubmit={handleFinalSubmit}>
                        <div style={{ display: 'grid', gap: '1rem' }}>
                            <div>
                                <label>CEP da Unidade Consumidora</label>
                                <input
                                    value={formData.cep}
                                    onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                    onBlur={handleCepBlur}
                                    style={{ width: '100%', padding: '0.5rem' }}
                                    required
                                />
                            </div>
                            <div>
                                <label>Rua</label>
                                <input value={formData.rua} onChange={e => setFormData({ ...formData, rua: e.target.value })} style={{ width: '100%', padding: '0.5rem' }} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <input placeholder="Número" value={formData.numero} onChange={e => setFormData({ ...formData, numero: e.target.value })} style={{ width: '100%', padding: '0.5rem' }} />
                                <input placeholder="Complemento" value={formData.complemento} onChange={e => setFormData({ ...formData, complemento: e.target.value })} style={{ width: '100%', padding: '0.5rem' }} />
                            </div>

                            <div>
                                <label>Número da Instalação (UC)</label>
                                <input
                                    value={formData.numero_uc}
                                    onChange={e => setFormData({ ...formData, numero_uc: e.target.value })}
                                    placeholder="Código na conta de luz"
                                    style={{ width: '100%', padding: '0.5rem' }}
                                    required
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                style={{ width: '100%', padding: '1rem', success: true, backgroundColor: 'var(--color-orange)', color: 'white', fontWeight: 'bold' }}
                            >
                                {loading ? 'Processando...' : 'Finalizar Cadastro'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
