import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep } from '../lib/api';
import { useUI } from '../contexts/UIContext';

export default function OriginatorSignupForm() {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1); // 1: SignUp, 2: Profile, 3: Success
    const [userId, setUserId] = useState(null);

    const [form, setForm] = useState({
        name: '',
        email: '',
        phone: '',
        password: '',
        cep: '',
        uf: '',
        city: '',
        neighborhood: '',
        street: '',
        number: '',
        complement: '', // Added complement
        profession: '',
        cpf: '',
        pix_key: '',
        pix_key_type: 'cpf'
    });

    const [showPassword, setShowPassword] = useState(false);

    // ... (Icons)
    const EyeIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
    );
    const EyeOffIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
    );

    const handleCepBlur = async () => {
        const rawCep = form.cep.replace(/\D/g, '');
        if (rawCep.length === 8) {
            setLoading(true);
            try {
                const addr = await fetchAddressByCep(rawCep);
                setForm(prev => ({
                    ...prev,
                    street: addr.rua,
                    neighborhood: addr.bairro,
                    city: addr.cidade,
                    uf: addr.uf
                }));
            } catch (error) {
                console.error('Error fetching CEP:', error);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleSignUp = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { data, error } = await supabase.auth.signUp({
                email: form.email,
                password: form.password,
                options: {
                    data: {
                        name: form.name,
                        phone: form.phone
                    }
                }
            });

            if (error) throw error;

            if (data?.user) {
                setUserId(data.user.id);
                setStep(2);
            }

        } catch (error) {
            console.error('Error signing up:', error);
            showAlert(error.message || 'Erro ao realizar cadastro.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleProfileSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const payload = {
                id: userId,
                name: form.name,
                email: form.email,
                phone: form.phone,
                cpf_cnpj: form.cpf,
                pix_key: form.pix_key,
                pix_key_type: form.pix_key_type,
                profession: form.profession,
                address: {
                    cep: form.cep,
                    street: form.street,
                    number: form.number,
                    neighborhood: form.neighborhood,
                    city: form.city,
                    uf: form.uf,
                    complement: form.complement // Include complement
                }
            };

            const { error } = await supabase.from('originators_v2').insert(payload);

            if (error) throw error;

            setStep(3);

        } catch (error) {
            console.error('Error saving profile:', error);
            showAlert(error.message || 'Erro ao salvar perfil.', 'error');
        } finally {
            setLoading(false);
        }
    };



    // Styling (Copied and adapted from LeadCaptureForm for consistency)
    const colors = {
        primary: '#003366',
        accent: '#FF6600',
        inputBg: '#f8fafc',
    };

    const styles = {
        wrapper: {
            backgroundColor: 'white',
            borderRadius: '24px',
            border: '1px solid #f1f5f9',
            padding: '2rem',
            boxShadow: '0 32px 64px -16px rgba(0, 51, 102, 0.12)',
            maxWidth: '42rem',
            margin: '0 auto',
            fontFamily: 'Inter, sans-serif'
        },
        header: {
            fontSize: '1.5rem',
            fontWeight: 'bold',
            textAlign: 'center',
            marginBottom: '2rem',
            color: colors.primary
        },
        formSpace: {
            display: 'flex', flexDirection: 'column', gap: '1.5rem'
        },
        grid: {
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem'
        },
        label: {
            display: 'block', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase',
            color: '#6b7280', marginBottom: '0.25rem'
        },
        input: {
            width: '100%', padding: '0.75rem 1rem', borderRadius: '0.75rem',
            border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', outline: 'none',
            transition: 'all 0.2s', fontSize: '1rem'
        },
        button: {
            width: '100%', padding: '1rem', marginTop: '1.5rem', borderRadius: '0.75rem',
            fontWeight: '800', color: 'white', textTransform: 'uppercase', fontSize: '1.125rem',
            letterSpacing: '0.025em', border: 'none', cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1, backgroundColor: colors.accent,
            boxShadow: '0 4px 14px 0 rgba(255, 102, 0, 0.39)', transition: 'opacity 0.2s'
        }
    };

    // Step 1: Sign Up Form
    if (step === 1) {
        return (
            <div style={styles.wrapper}>
                <h2 style={styles.header}>Seja um Parceiro B2W</h2>
                <form onSubmit={handleSignUp} style={styles.formSpace}>
                    <div>
                        <label style={styles.label}>Nome Completo</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            style={styles.input}
                            required
                        />
                    </div>
                    <div style={styles.grid}>
                        <div>
                            <label style={styles.label}>E-mail</label>
                            <input
                                type="email"
                                value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })}
                                style={styles.input}
                                required
                            />
                        </div>
                        <div>
                            <label style={styles.label}>WhatsApp</label>
                            <input
                                type="tel"
                                maxLength="15"
                                value={form.phone}
                                onChange={e => {
                                    let v = e.target.value.replace(/\D/g, '');
                                    v = v.replace(/^(\d{2})(\d)/g, '($1) $2');
                                    v = v.replace(/(\d)(\d{4})$/, '$1-$2');
                                    setForm({ ...form, phone: v });
                                }}
                                style={styles.input}
                                required
                            />
                        </div>
                    </div>
                    <div style={{ position: 'relative' }}>
                        <label style={styles.label}>Senha</label>
                        <input
                            type={showPassword ? "text" : "password"}
                            value={form.password}
                            onChange={e => setForm({ ...form, password: e.target.value })}
                            style={{ ...styles.input, paddingRight: '2.5rem' }}
                            required
                            minLength={6}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            style={{
                                position: 'absolute',
                                right: '0.75rem',
                                top: '1.75rem', // Adjusted for label height
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#6b7280',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                        >
                            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                    </div>
                    <button type="submit" disabled={loading} style={styles.button}>
                        {loading ? 'Cadastrando...' : 'Quero ser Parceiro'}
                    </button>
                </form>
            </div>
        );
    }

    // Step 2 & 3: Modal (Profile or Success)
    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
            <div style={{
                backgroundColor: 'white', borderRadius: '24px', padding: '2rem',
                maxWidth: '32rem', width: '100%', position: 'relative',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                maxHeight: '90vh', overflowY: 'auto'
            }}>
                {step === 2 && (
                    <form onSubmit={handleProfileSubmit} style={styles.formSpace}>
                        <h3 style={{ ...styles.header, marginBottom: '1rem', fontSize: '1.25rem' }}>Complete seu Perfil</h3>

                        <div style={styles.grid}>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={styles.label}>CEP</label>
                                <input
                                    type="text"
                                    maxLength="9"
                                    value={form.cep}
                                    onChange={e => {
                                        let v = e.target.value.replace(/\D/g, '');
                                        if (v.length > 5) v = v.replace(/^(\d{5})(\d)/, '$1-$2');
                                        setForm({ ...form, cep: v });
                                    }}
                                    onBlur={handleCepBlur}
                                    style={styles.input}
                                    required
                                />
                            </div>
                        </div>

                        <div style={styles.grid}>
                            {/* Address Fields (Auto-filled) */}
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={styles.label}>Rua</label>
                                <input value={form.street} style={styles.input} readOnly />
                            </div>

                            <div>
                                <label style={styles.label}>Bairro</label>
                                <input value={form.neighborhood} style={styles.input} readOnly />
                            </div>

                            <div>
                                <label style={styles.label}>Cidade / UF</label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input value={form.city} style={{ ...styles.input, flex: 2 }} readOnly />
                                    <input value={form.uf} style={{ ...styles.input, flex: 1 }} readOnly />
                                </div>
                            </div>

                            <div>
                                <label style={styles.label}>Número</label>
                                <input
                                    value={form.number}
                                    onChange={e => setForm({ ...form, number: e.target.value })}
                                    style={styles.input}
                                    required
                                />
                            </div>
                            <div>
                                <label style={styles.label}>Complemento</label>
                                <input
                                    value={form.complement}
                                    onChange={e => setForm({ ...form, complement: e.target.value })}
                                    style={styles.input}
                                    placeholder="Ap 101, Bloco B"
                                />
                            </div>
                        </div>

                        <div>
                            <label style={styles.label}>Profissão</label>
                            <input
                                type="text"
                                value={form.profession}
                                onChange={e => setForm({ ...form, profession: e.target.value })}
                                style={styles.input}
                                required
                                placeholder="Corretor de Seguros, Consorcios e Contador"
                            />
                        </div>

                        <div style={styles.grid}>
                            <div>
                                <label style={styles.label}>CPF (Chave PIX)</label>
                                <input
                                    type="text"
                                    value={form.cpf}
                                    onChange={e => {
                                        // Simple mask for CPF
                                        let v = e.target.value.replace(/\D/g, '');
                                        if (v.length > 11) v = v.substring(0, 11);
                                        v = v.replace(/(\d{3})(\d)/, '$1.$2');
                                        v = v.replace(/(\d{3})(\d)/, '$1.$2');
                                        v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');

                                        // Update PIX only if type is CPF
                                        setForm(prev => ({
                                            ...prev,
                                            cpf: v,
                                            pix_key: prev.pix_key_type === 'cpf' ? v : prev.pix_key
                                        }));
                                    }}
                                    style={styles.input}
                                    required
                                    placeholder="000.000.000-00"
                                />
                            </div>
                            <div>
                                <label style={styles.label}>Tipo Chave PIX</label>
                                <select
                                    value={form.pix_key_type}
                                    onChange={e => {
                                        const newType = e.target.value;
                                        setForm(prev => ({
                                            ...prev,
                                            pix_key_type: newType,
                                            pix_key: newType === 'cpf' ? prev.cpf : '' // Clear if not CPF
                                        }));
                                    }}
                                    style={styles.input}
                                >
                                    <option value="cpf">CPF</option>
                                    <option value="email">E-mail</option>
                                    <option value="phone">Telefone</option>
                                    <option value="random">Aleatória</option>
                                </select>
                            </div>
                        </div>

                        {form.pix_key_type !== 'cpf' && (
                            <div>
                                <label style={styles.label}>Chave PIX</label>
                                <input
                                    value={form.pix_key}
                                    onChange={e => setForm({ ...form, pix_key: e.target.value })}
                                    style={styles.input}
                                    required
                                />
                            </div>
                        )}

                        <button type="submit" disabled={loading} style={styles.button}>
                            {loading ? 'Salvando...' : 'Finalizar Cadastro'}
                        </button>
                    </form>
                )}

                {step === 3 && (
                    <div style={{ textAlign: 'center' }}>
                        <svg style={{ width: '64px', height: '64px', color: '#16a34a', margin: '0 auto 1rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 style={{ ...styles.header, marginBottom: '0.5rem' }}>Cadastro Realizado!</h3>
                        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
                            Verifique seu e-mail para confirmar sua conta.
                        </p>
                        <button
                            onClick={() => window.location.href = 'https://app.b2wenergia.com.br/login'}
                            style={styles.button}
                        >
                            Ir para Login
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
