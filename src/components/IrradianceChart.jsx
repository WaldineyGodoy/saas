import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
    ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, 
    Tooltip, Legend, Area, Line 
} from 'recharts';
import { Sun, Target } from 'lucide-react';

export default function IrradianceChart({ ibgeCode, potenciaKwp, onCalculate }) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (ibgeCode && potenciaKwp > 0) {
            fetchIrradiance();
        } else {
            setData([]);
            setLoading(false);
        }
    }, [ibgeCode, potenciaKwp]);

    const fetchIrradiance = async () => {
        setLoading(true);
        try {
            // A tabela de irradiância usa "cod.ibge" com aspas por causa do ponto
            const { data: irrData, error } = await supabase
                .from('irradiancia')
                .select('*')
                .eq('"cod.ibge"', ibgeCode)
                .single();

            if (error) throw error;

            if (irrData) {
                // Mapeamento das colunas (considerando as variações khw vs kwh no banco)
                const months = [
                    { name: 'Jan', key: 'jan.khw' }, { name: 'Fev', key: 'fev.khw' },
                    { name: 'Mar', key: 'mar.kwh' }, { name: 'Abr', key: 'abr.kwh' },
                    { name: 'Mai', key: 'mai.kwh' }, { name: 'Jun', key: 'jun.kwh' },
                    { name: 'Jul', key: 'jul.kwh' }, { name: 'Ago', key: 'ago.kwh' },
                    { name: 'Set', key: 'set.kwh' }, { name: 'Out', key: 'out.kwh' },
                    { name: 'Nov', key: 'nov.kwh' }, { name: 'Dez', key: 'dez.khw' }
                ];

                const chartData = months.map(m => ({
                    name: m.name,
                    geracao: Math.round((Number(irrData[m.key]) || 0) * potenciaKwp)
                }));

                // Adicionamos a média como uma constante para a linha "Step"
                const avg = Math.round(chartData.reduce((acc, curr) => acc + curr.geracao, 0) / 12);
                const finalData = chartData.map(d => ({ ...d, media: avg }));

                setData(finalData);

                if (onCalculate) {
                    onCalculate(avg, finalData);
                }
            }
        } catch (error) {
            console.error('Error fetching irradiance:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!ibgeCode || !potenciaKwp) return null;

    if (loading) {
        return (
            <div style={{ height: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '16px' }}>
                <div className="spinner-border text-primary" role="status"></div>
            </div>
        );
    }

    if (data.length === 0) return null;

    return (
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Sun size={20} style={{ color: '#FF6600' }} />
                    Estimativa de Geração Técnica (kWh)
                </h4>
            </div>

            <div style={{ height: '300px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorGen" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#FF6600" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#FF6600" stopOpacity={0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#7f8c8d', fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#7f8c8d', fontSize: 12 }} />
                        
                        <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                            formatter={(value) => [`${value.toLocaleString()} kWh`]}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 700 }} />

                        {/* Camada de Área com Gradiente Premium */}
                        <Area 
                            type="monotone" 
                            dataKey="geracao" 
                            name="Geração Estimada" 
                            stroke="#FF6600" 
                            fillOpacity={1} 
                            fill="url(#colorGen)" 
                            strokeWidth={3} 
                            animationDuration={1500} 
                        />
                        
                        {/* Linha Step para a Meta/Média (Dica de Ouro) */}
                        <Line 
                            type="step" 
                            dataKey="media" 
                            name="Média Anual (Meta)" 
                            stroke="#dc2626" 
                            strokeWidth={2} 
                            strokeDasharray="5 5" 
                            dot={false} 
                            animationDuration={1500} 
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div style={{ marginTop: '1.5rem', padding: '0.75rem', background: '#fff7ed', borderRadius: '12px', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <Target size={16} style={{ color: '#FF6600' }} />
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#9a3412', fontWeight: 600 }}>
                    A linha pontilhada indica a média mensal esperada de {data[0]?.media.toLocaleString()} kWh.
                </p>
            </div>
        </div>
    );
}
