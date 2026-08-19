import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep } from '../lib/api';
import { useUI } from '../contexts/UIContext';
import { maskCpfCnpj, validateDocument, validatePhone } from '../lib/validators';
import { buildConviteUrl, buildReferralUrl, normalizarNome, PIX_KEY_TYPES } from '../lib/originador';

export default function OriginatorSignupForm() {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1); // 1: SignUp, 2: Profile, 3: Success
    const [userId, setUserId] = useState(null);

    // Link de indicação mostrado no passo 3 — o parceiro sai daqui já com o
    // que divulgar, em vez de ter que descobrir o painel sozinho.
    const [referralUrl, setReferralUrl] = useState('');
    const [cepErro, setCepErro] = useState('');

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
        if (rawCep.length !== 8) return;

        setLoading(true);
        setCepErro('');
        try {
            const addr = await fetchAddressByCep(rawCep);
            setForm(prev => ({
                ...prev,
                street: addr.rua || '',
                neighborhood: addr.bairro || '',
                city: addr.cidade || '',
                uf: addr.uf || ''
            }));
        } catch (error) {
            // A falha aqui era silenciosa e os campos de endereço eram
            // readOnly: com o ViaCEP fora do ar, ou CEP novo que ele ainda
            // não conhece, o cadastro travava sem dizer por quê. Agora o
            // erro aparece e os campos liberam para digitação.
            console.error('Error fetching CEP:', error);
            setCepErro('Não foi possível buscar o CEP. Preencha o endereço manualmente.');
        } finally {
            setLoading(false);
        }
    };

    // Os campos vindos do CEP só ficam travados quando a busca deu certo.
    const enderecoTravado = !cepErro && !!form.street;

    // CPF/CNPJ alimentam a chave PIX sozinhos; os demais tipos o parceiro digita.
    const derivadaDoDocumento = form.pix_key_type === 'cpf' || form.pix_key_type === 'cnpj';

    const handleSignUp = async (e) => {
        e.preventDefault();

        // O WhatsApp é o canal que avisa o parceiro de cada lead que entra
        // pelo link dele (SubscriberSignup dispara por esse número). Número
        // curto aqui significa parceiro que nunca recebe aviso.
        if (!validatePhone(form.phone)) {
            showAlert('WhatsApp inválido. Digite DDD + 9 dígitos. Ex: (84) 99999-9999', 'error');
            return;
        }

        setLoading(true);

        try {
            const { data, error } = await supabase.auth.signUp({
                email: form.email,
                password: form.password,
                options: {
                    data: {
                        name: form.name,
                        phone: form.phone.replace(/\D/g, '')
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

        // O documento vira chave PIX e é por ele que a comissão é paga: um
        // dígito errado aqui só aparece meses depois, quando a transferência
        // volta. O modal do CRM já validava; o cadastro público, não.
        if (!validateDocument(form.cpf)) {
            showAlert('CPF ou CNPJ inválido. Confira o número digitado.', 'error');
            return;
        }

        if (!form.pix_key.trim()) {
            showAlert('Informe a chave PIX para o pagamento das comissões.', 'error');
            return;
        }

        setLoading(true);

        try {
            const payload = {
                id: userId,
                name: normalizarNome(form.name),
                email: form.email,
                phone: form.phone.replace(/\D/g, ''),
                cpf_cnpj: form.cpf,
                pix_key: form.pix_key.trim(),
                pix_key_type: form.pix_key_type,
                profession: form.profession,
                // Chaves em português: é o vocabulário que o `fetchAddressByCep`
                // devolve e o que o modal do CRM lê. Gravar em inglês fazia o
                // modal exibir endereço vazio e apagá-lo no primeiro save.
                address: {
                    cep: form.cep,
                    rua: form.street,
                    numero: form.number,
                    complemento: form.complement,
                    bairro: form.neighborhood,
                    cidade: form.city,
                    uf: form.uf
                }
            };

            const { error } = await supabase.from('originators_v2').insert(payload);

            if (error) throw error;

            // A URL longa já é montável aqui, sem depender de leitura no banco
            // — serve de imediato, mesmo se a sessão ainda não estiver ativa
            // por causa da confirmação de e-mail.
            setReferralUrl(buildConviteUrl(payload));
            setStep(3);

            // O `short_url` é gerado pelo gatilho via pg_net, logo após o
            // COMMIT. Damos um tempo e tentamos trocar pelo encurtado; se não
            // vier, o link longo continua valendo.
            setTimeout(async () => {
                const { data } = await supabase
                    .from('originators_v2')
                    .select('id, name, short_url')
                    .eq('id', payload.id)
                    .maybeSingle();
                if (data?.short_url) setReferralUrl(buildReferralUrl(data));
            }, 4000);

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
                                {cepErro && (
                                    <p style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.375rem' }}>
                                        {cepErro}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div style={styles.grid}>
                            {/* Address Fields (Auto-filled) */}
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={styles.label}>Rua</label>
                                <input
                                    value={form.street}
                                    onChange={e => setForm({ ...form, street: e.target.value })}
                                    style={styles.input}
                                    readOnly={enderecoTravado}
                                    required
                                />
                            </div>

                            <div>
                                <label style={styles.label}>Bairro</label>
                                <input
                                    value={form.neighborhood}
                                    onChange={e => setForm({ ...form, neighborhood: e.target.value })}
                                    style={styles.input}
                                    readOnly={enderecoTravado}
                                    required
                                />
                            </div>

                            <div>
                                <label style={styles.label}>Cidade / UF</label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                        value={form.city}
                                        onChange={e => setForm({ ...form, city: e.target.value })}
                                        style={{ ...styles.input, flex: 2 }}
                                        readOnly={enderecoTravado}
                                        required
                                    />
                                    <input
                                        value={form.uf}
                                        onChange={e => setForm({ ...form, uf: e.target.value.toUpperCase().slice(0, 2) })}
                                        style={{ ...styles.input, flex: 1 }}
                                        readOnly={enderecoTravado}
                                        required
                                    />
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
                                <label style={styles.label}>CPF / CNPJ</label>
                                <input
                                    type="text"
                                    value={form.cpf}
                                    onChange={e => {
                                        // A máscara antiga cortava em 11 dígitos, o que impedia
                                        // o cadastro de parceiro PJ — sendo que a coluna é
                                        // `cpf_cnpj` e o CRM já aceita CNPJ.
                                        const v = maskCpfCnpj(e.target.value);
                                        setForm(prev => ({
                                            ...prev,
                                            cpf: v,
                                            pix_key: (prev.pix_key_type === 'cpf' || prev.pix_key_type === 'cnpj')
                                                ? v
                                                : prev.pix_key
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
                                        // Preenche sozinho o que já temos; o resto o parceiro digita.
                                        const preenchido = {
                                            cpf: form.cpf,
                                            cnpj: form.cpf,
                                            email: form.email,
                                            telefone: form.phone,
                                        }[newType] ?? '';
                                        setForm(prev => ({ ...prev, pix_key_type: newType, pix_key: preenchido }));
                                    }}
                                    style={styles.input}
                                >
                                    {/* Vinha gravando `phone`/`random`, que o CRM não reconhecia e
                                        que a Asaas rejeita no repasse da comissão. */}
                                    {PIX_KEY_TYPES.map(t => (
                                        <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* A chave aparece sempre, inclusive quando derivada do documento:
                            é para onde a comissão vai, e o parceiro precisa conferir. */}
                        <div>
                            <label style={styles.label}>Chave PIX para receber as comissões</label>
                            <input
                                value={form.pix_key}
                                onChange={e => setForm({ ...form, pix_key: e.target.value })}
                                style={{
                                    ...styles.input,
                                    ...(derivadaDoDocumento ? { backgroundColor: '#eef2f7', color: '#475569' } : {})
                                }}
                                readOnly={derivadaDoDocumento}
                                required
                                placeholder={form.pix_key_type === 'aleatoria' ? 'Cole aqui a chave aleatória do seu banco' : ''}
                            />
                            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.375rem' }}>
                                {derivadaDoDocumento
                                    ? 'Usaremos seu documento como chave PIX.'
                                    : 'Confira com atenção: é nesta chave que as comissões serão depositadas.'}
                            </p>
                        </div>

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
                            Confirme sua conta pelo e-mail que enviamos. Seu link de indicação
                            já está ativo e pode ser divulgado desde agora.
                        </p>

                        {referralUrl && (
                            <div style={{
                                textAlign: 'left', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
                                borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.5rem'
                            }}>
                                <label style={styles.label}>Seu link de indicação</label>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input readOnly value={referralUrl} style={{ ...styles.input, flex: 1 }} />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigator.clipboard.writeText(referralUrl);
                                            showAlert('Link copiado!', 'success');
                                        }}
                                        style={{
                                            padding: '0.75rem 1rem', borderRadius: '0.75rem', border: 'none',
                                            backgroundColor: colors.primary, color: 'white', fontWeight: 700,
                                            cursor: 'pointer', whiteSpace: 'nowrap'
                                        }}
                                    >
                                        Copiar
                                    </button>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>
                                    Quem se cadastrar por este link fica vinculado a você, e a
                                    comissão correspondente entra no seu extrato.
                                </p>
                            </div>
                        )}

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
