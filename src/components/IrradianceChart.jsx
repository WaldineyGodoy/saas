import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function IrradianceChart({ ibgeCode, potenciaKwp, onCalculate }) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (ibgeCode && potenciaKwp > 0) {
            fetchIrradiance();
        } else {
            setData([]);
        }
    }, [ibgeCode, potenciaKwp]);

    const fetchIrradiance = async () => {
        setLoading(true);
        setError(null);
        try {
            // Need to quote "cod.ibge" because of the dot
            const { data: result, error } = await supabase
                .from('irradiancia')
                .select('*')
                .eq('"cod.ibge"', ibgeCode)
                .single();

            if (error) throw error;
            if (!result) throw new Error('Dados de irradiância não encontrados para este local.');

            // Map and calculate. Note the typos in database columns: khw vs kwh
            // DB Columns from introspection: jan.khw, fev.khw, mar.kwh, abr.kwh, mai.kwh, jun.kwh... dez.khw
            const months = [
                { name: 'Jan', key: 'jan.khw' },
                { name: 'Fev', key: 'fev.khw' },
                { name: 'Mar', key: 'mar.kwh' },
                { name: 'Abr', key: 'abr.kwh' },
                { name: 'Mai', key: 'mai.kwh' },
                { name: 'Jun', key: 'jun.kwh' },
                { name: 'Jul', key: 'jul.kwh' },
                { name: 'Ago', key: 'ago.kwh' },
                { name: 'Set', key: 'set.kwh' },
                { name: 'Out', key: 'out.kwh' },
                { name: 'Nov', key: 'nov.kwh' },
                { name: 'Dez', key: 'dez.khw' },
            ];

            const chartData = months.map(m => {
                const factor = Number(result[m.key]);
                // Estimativa = Potencia (kWp) * Irradiacao (kWh/kWp/mes)
                const generation = factor ? (potenciaKwp * factor) : 0;
                return {
                    name: m.name,
                    geracao: Math.round(generation), // Round to integer for cleaner chart
                    factor // Keep factor for tooltip if needed
                };
            });

            setData(chartData);

        } catch (err) {
            console.error('Irradiance error:', err);
            // Don't alert here to avoid spamming, just show message in UI
            setError('Dados de irradiância não disponíveis.');
        } finally {
            setLoading(false);
        }
    };

    const totalYearly = data.reduce((acc, curr) => acc + curr.geracao, 0);
    const averageMonthly = data.length > 0 ? totalYearly / 12 : 0;

    useEffect(() => {
        if (!loading && onCalculate && averageMonthly > 0) {
            onCalculate(Math.round(averageMonthly));
        }
    }, [averageMonthly, onCalculate, loading]);

    if (!ibgeCode || !potenciaKwp) return null;
    if (loading) return <div style={{ padding: '1rem', textAlign: 'center', color: '#666' }}>Calculando estimativa de geração...</div>;
    // if (error) return <div style={{ padding: '1rem', textAlign: 'center', color: '#ef4444', fontSize: '0.9rem' }}>{error}</div>;

    return (
        <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 'bold', color: '#0369a1', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                <span>Estimativa de Geração Mensal</span>
                <span style={{ fontSize: '0.9rem', color: '#64748b' }}>Média Mensal: <strong>{averageMonthly.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kWh</strong></span>
            </h4>

            <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                    <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                        <Tooltip
                            cursor={{ fill: '#f1f5f9' }}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
                            formatter={(value) => [`${value.toLocaleString('pt-BR')} kWh`, 'Geração']}
                        />
                        <Bar dataKey="geracao" radius={[4, 4, 0, 0]}>
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill="var(--color-orange)" />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center' }}>
                * Estimativa baseada na média histórica de irradiância solar da região (IBGE: {ibgeCode}).
            </p>
        </div>
    );
}
