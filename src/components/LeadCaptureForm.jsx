import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import { useUI } from '../contexts/UIContext';
// import InputMask from 'react-input-mask';

export default function LeadCaptureForm() {
    const [searchParams] = useSearchParams();
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(false);
    const [showResult, setShowResult] = useState(false);
    const [savedLeader, setSavedLead] = useState(null);

    // URL Params
    const originatorId = searchParams.get('id');
    const originatorName = searchParams.get('originador');

    const [form, setForm] = useState({
        name: '',
        email: '',
        phone: '',
        cep: '',
        concessionaria: '',
        consumo: 500, // Default value for slider
        uf: '',
        city: '',
        neighborhood: '',
        street: '',
        number: ''
    });

    const [offerData, setOfferData] = useState(null);

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

                if (addr.ibge) {
                    const offer = await fetchOfferData(addr.ibge);
                    if (offer) {
                        setOfferData(offer);
                        // Assuming the column name is 'Concessionaria' in the DB response
                        setForm(prev => ({ ...prev, concessionaria: offer.Concessionaria || '' }));
                    } else {
                        // Fallback or clear if no offer found
                        setOfferData(null);
                        setForm(prev => ({ ...prev, concessionaria: '' }));
                    }
                }
            } catch (error) {
                console.error('Error fetching CEP:', error);
                // Silent fail or toast? Using alert for now as per UIContext if critical, but for form field logic maybe just log
            } finally {
                setLoading(false);
            }
        }
    };

    const calculateDiscount = () => {
        if (!offerData) return 0;
        // Formula: (Consumo * Tarifa) * Desconto%
        // DB Columns: "Tarifa Concessionaria" and "Desconto Assinante"
        // Note: Check if values are numbers or strings in DB.

        const tarifa = Number(offerData['Tarifa Concessionaria']) || 0;
        const descontoPerc = Number(offerData['Desconto Assinante']) || 0;

        // Example: 500 * 0.99 = 495. 495 * 0.20 = 99.
        // Assuming 'Desconto Assinante' is e.g. 0.20 (20%) or 20 (20%)? 
        // Usually stored as percentage decimal or whole number. I will assume percentage decimal (0.2) based on typical, 
        // OR checks if > 1 to divide by 100. Let's make it robust.

        let multiplier = descontoPerc;
        if (multiplier > 1) multiplier = multiplier / 100;

        const totalCost = form.consumo * tarifa;
        const discountValue = totalCost * multiplier;

        return discountValue;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const calculatedDiscount = calculateDiscount();

            const payload = {
                name: form.name,
                email: form.email,
                phone: form.phone,
                cep: form.cep,
                concessionaria: form.concessionaria,
                consumo_kwh: form.consumo,
                calculated_discount: calculatedDiscount,
                // Additional address info
                rua: form.street,
                numero: form.number,
                bairro: form.neighborhood,
                cidade: form.city,
                uf: form.uf,
                // Flattening offer data for record if needed? 
                tarifa_concessionaria: Number(offerData?.['Tarifa Concessionaria']) || 0,
                desconto_assinante: Number(offerData?.['Desconto Assinante']) || 0,
                status: 'simulacao', // Default status
                originator_id: originatorId ? originatorId : null // Capture ID from URL
            };

            const { data, error } = await supabase.from('leads').insert(payload).select().single();

            if (error) throw error;

            setSavedLead(data);
            setShowResult(true);

        } catch (error) {
            console.error('Error saving lead:', error);
            showAlert('Erro ao processar simulação. Tente novamente.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const currencySubtle = (val) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // Slider Background Logic for visual fill (optional simple CSS range)
    // Custom colors reference
    const colors = {
        primary: '#003366',
        accent: '#FF6600',
        success: '#16a34a',
        inputBg: '#f8fafc',
        border: '#e2e8f0' // slate-200 equivalent
    };

    // Styles object to mimic Tailwind classes since Tailwind is not configured in this project
    const styles = {
        wrapper: {
            backgroundColor: 'white',
            borderRadius: '24px', // rounded-3xl approx
            border: '1px solid #f1f5f9', // slate-100
            padding: '2rem', // p-8
            boxShadow: '0 32px 64px -16px rgba(0, 51, 102, 0.12)',
            maxWidth: '42rem', // max-w-2xl
            margin: '0 auto',
            fontFamily: 'Inter, sans-serif'
        },
        header: {
            fontSize: '1.5rem', // text-2xl
            fontWeight: 'bold',
            textAlign: 'center',
            marginBottom: '2rem',
            color: colors.primary
        },
        formSpace: {
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem' // space-y-6
        },
        grid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1.5rem'
        },
        label: {
            display: 'block',
            fontSize: '0.75rem', // text-xs
            fontWeight: 'bold',
            textTransform: 'uppercase',
            color: '#6b7280', // gray-500
            marginBottom: '0.25rem'
        },
        input: {
            width: '100%',
            padding: '0.75rem 1rem', // px-4 py-3
            borderRadius: '0.75rem', // rounded-xl
            border: '1px solid #e2e8f0', // slate-200
            backgroundColor: '#f8fafc', // slate-50
            outline: 'none',
            transition: 'all 0.2s',
            fontSize: '1rem'
        },
        inputReadOnly: {
            width: '100%',
            padding: '0.75rem 1rem',
            borderRadius: '0.75rem',
            border: '1px solid #e2e8f0',
            backgroundColor: '#f3f4f6', // gray-100
            color: '#4b5563', // gray-600
            cursor: 'not-allowed'
        },
        button: {
            width: '100%',
            padding: '1rem',
            marginTop: '1.5rem',
            borderRadius: '0.75rem', // rounded-xl
            fontWeight: '800',
            color: 'white',
            textTransform: 'uppercase',
            fontSize: '1.125rem', // text-lg
            letterSpacing: '0.025em', // tracking-wide
            border: 'none',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1,
            backgroundColor: colors.accent,
            boxShadow: '0 4px 14px 0 rgba(255, 102, 0, 0.39)',
            transition: 'opacity 0.2s'
        },
        rangeContainer: {
            paddingTop: '1rem'
        },
        rangeLabelRow: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.5rem'
        },
        rangeInput: {
            width: '100%',
            height: '0.5rem',
            backgroundColor: '#e5e7eb', // gray-200
            borderRadius: '0.5rem',
            appearance: 'none',
            cursor: 'pointer',
            accentColor: colors.accent
        },
        rangeTicks: {
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.75rem',
            color: '#9ca3af',
            marginTop: '0.25rem'
        }
    };

    const discountValue = calculateDiscount();

    return (
        <>
            {/* Wrapper Implementation */}
            <div style={styles.wrapper}>

                <h2 style={styles.header}>
                    Saiba o valor do seu desconto
                </h2>

                <form onSubmit={handleSubmit} style={styles.formSpace}>

                    <div style={styles.grid}>
                        {/* CEP */}
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
                                placeholder="00000-000"
                                required
                            />
                        </div>
                    </div>

                    {/* Name */}
                    <div>
                        <label style={styles.label}>Nome Completo</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            style={styles.input}
                            placeholder="Como devemos te chamar?"
                            required
                        />
                    </div>

                    <div style={styles.grid}>
                        {/* Email */}
                        <div>
                            <label style={styles.label}>E-mail</label>
                            <input
                                type="email"
                                value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })}
                                style={styles.input}
                                placeholder="exemplo@email.com"
                                required
                            />
                        </div>
                        {/* Phone */}
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
                                placeholder="(00) 00000-0000"
                                required
                            />
                        </div>
                    </div>

                    {/* Slider */}
                    <div style={styles.rangeContainer}>
                        <div style={styles.rangeLabelRow}>
                            <label style={styles.label}>Média de Gasto Mensal (kWh)</label>
                            <span style={{ fontSize: '1.25rem', fontWeight: 'bold', color: colors.accent }}>
                                {form.consumo} kWh
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="10000"
                            step="50"
                            value={form.consumo}
                            onChange={e => setForm({ ...form, consumo: Number(e.target.value) })}
                            style={styles.rangeInput}
                        />
                        <div style={styles.rangeTicks}>
                            <span>0 kWh</span>
                            <span>10.000+ kWh</span>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading}
                        style={styles.button}
                    >
                        {loading ? 'Calculando...' : 'Ver o Desconto'}
                    </button>

                </form>
            </div>

            {/* Modal Result */}
            {showResult && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '1rem', backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)'
                }}>
                    <div style={{
                        backgroundColor: 'white', borderRadius: '24px', padding: '2rem',
                        maxWidth: '28rem', width: '100%', position: 'relative',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                    }}>
                        {/* Close Button */}
                        <button
                            onClick={() => setShowResult(false)}
                            style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '0.25rem' }}
                        >
                            <svg style={{ width: '24px', height: '24px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', textAlign: 'center', marginBottom: '0.5rem', color: '#dc2626' }}>
                            Seu desconto
                        </h3>

                        <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                            Agora é só prosseguir com o cadastro para garantir o seu desconto
                        </p>

                        <div style={{ border: '1px dashed #d1d5db', borderRadius: '0.75rem', padding: '1.5rem', position: 'relative', backgroundColor: '#f9fafb' }}>
                            <div style={{
                                position: 'absolute', top: '-0.75rem', left: '1rem',
                                backgroundColor: '#3b82f6', color: 'white', fontSize: '0.75rem',
                                fontWeight: 'bold', padding: '0.25rem 0.75rem', borderRadius: '9999px'
                            }}>
                                Garantir desconto
                            </div>

                            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <div>
                                    <p style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#4f46e5' }}>Nome do cliente</p>
                                    <p style={{ fontSize: '1.125rem', fontWeight: '600', color: '#1f2937' }}>{form.name}</p>
                                </div>

                                <div>
                                    <p style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#16a34a' }}>Concessionária</p>
                                    <p style={{ fontSize: '1.125rem', fontWeight: '600', color: '#1f2937' }}>{form.concessionaria}</p>
                                </div>

                                <div>
                                    <p style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#FF6600' }}>Valor do Desconto</p>
                                    <p style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#FF6600' }}>
                                        {currencySubtle(savedLeader?.calculated_discount || discountValue)}
                                        <span style={{ fontSize: '0.875rem', color: '#6b7280', fontWeight: 'normal', marginLeft: '0.25rem' }}>/mês</span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => window.location.href = 'https://crm.b2wenergia.com.br/cadastro'}
                            style={{
                                width: '100%', padding: '0.75rem', marginTop: '1.5rem',
                                borderRadius: '0.75rem', fontWeight: 'bold', color: 'white',
                                textTransform: 'uppercase', border: 'none', cursor: 'pointer',
                                backgroundColor: colors.accent,
                                boxShadow: '0 4px 14px 0 rgba(255, 102, 0, 0.39)'
                            }}
                        >
                            Garantir Desconto
                        </button>

                    </div>
                </div>
            )}
        </>
    );
}
