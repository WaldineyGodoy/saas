import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            if (error.message.includes('Email not confirmed')) {
                alert('Email não confirmado, vc deve antes confirmar o email SupaBase Auth com o titulo Confirm Your Singup');
            } else {
                alert(error.message);
            }
        } else {
            navigate('/dashboard');
        }
        setLoading(false);
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--color-blue)' }}>
            <form onSubmit={handleLogin} className="card" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem' }}>
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <img
                        src="https://b2wenergia.com.br/wp-content/uploads/2025/12/Logo-B2W-Escuro.png"
                        alt="B2W Energia"
                        style={{ height: '60px', objectFit: 'contain', marginBottom: '1rem' }}
                        onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                    />
                    <h2 style={{ color: 'var(--color-blue)', display: 'none' }}>B2W Energia</h2>
                    <p style={{ color: 'var(--color-text-medium)' }}>Faça login para continuar</p>
                </div>

                <div className="form-group">
                    <label htmlFor="email" className="label">Email</label>
                    <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="input"
                        placeholder="seu@email.com"
                        required
                    />
                </div>
                <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label htmlFor="password" className="label">Senha</label>
                        <button
                            type="button"
                            onClick={async () => {
                                if (!email) {
                                    alert('Digite seu email para recuperar a senha.');
                                    return;
                                }
                                setLoading(true);
                                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                                    redirectTo: window.location.origin + '/dashboard?reset=true',
                                });
                                setLoading(false);
                                if (error) {
                                    alert('Erro ao enviar email: ' + error.message);
                                } else {
                                    alert('Email de recuperação enviado! Verifique sua caixa de entrada.');
                                }
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}
                        >
                            Esqueci minha senha
                        </button>
                    </div>
                    <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="input"
                        placeholder="••••••••"
                        required
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading}
                    className="btn btn-accent"
                    style={{ width: '100%', padding: '0.75rem', justifyContent: 'center', fontSize: '1rem', marginTop: '1rem' }}
                >
                    {loading ? 'Carregando...' : 'Entrar'}
                </button>

                <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                    <span style={{ color: 'var(--color-text-medium)', fontSize: '0.9rem' }}>Não tem uma conta? </span>
                    <button
                        type="button"
                        onClick={() => navigate('/cadastro-parceiro')}
                        style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer', padding: 0 }}
                    >
                        Criar conta
                    </button>
                </div>
            </form>
        </div>
    );
}
