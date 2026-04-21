import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
    ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, 
    Tooltip, Legend, Area, Line 
} from 'recharts';
import { Sun, Target, Activity, Zap } from 'lucide-react';

export default function IrradianceChart({ ibgeCode, potenciaKwp, usinaId, selectedUCs, onCalculate }) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (ibgeCode && potenciaKwp > 0) {
            fetchPerformanceData();
        } else {
            setData([]);
            setLoading(false);
        }
    }, [ibgeCode, potenciaKwp, usinaId, selectedUCs]);

    const fetchPerformanceData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Irradiance (Forecast)
            const { data: irrData, error: irrError } = await supabase
                .from('irradiancia')
                .select('*')
                .eq('"cod.ibge"', ibgeCode)
                .single();

            if (irrError) throw irrError;

            // 2. Fetch Actual Generation (if usinaId exists)
            let actualGenData = [];
            if (usinaId) {
                const { data: genData } = await supabase
                    .from('generation_production')
                    .select('mes_referencia, geracao_real')
                    .eq('usina_id', usinaId)
                    .gte('mes_referencia', `${new Date().getFullYear()}-01-01`)
                    .lte('mes_referencia', `${new Date().getFullYear()}-12-01`);
                actualGenData = genData || [];
            }

            // 3. Fetch Consumption (if selectedUCs exist)
            let consumptionData = [];
            if (selectedUCs?.length > 0) {
                const { data: consData } = await supabase
                    .from('invoices')
                    .select('mes_referencia, consumo_compensado')
                    .in('uc_id', selectedUCs.map(uc => uc.id))
                    .gte('mes_referencia', `${new Date().getFullYear()}-01-01`)
                    .lte('mes_referencia', `${new Date().getFullYear()}-12-01`);
                
                // Group by month
                const grouped = (consData || []).reduce((acc, curr) => {
                    const month = curr.mes_referencia;
                    acc[month] = (acc[month] || 0) + (Number(curr.consumo_compensado) || 0);
                    return acc;
                }, {});
                consumptionData = Object.entries(grouped).map(([mes, valor]) => ({ mes, valor }));
            }

            // 4. Calculate Commitment (Constant)
            const totalCommitment = selectedUCs?.reduce((acc, curr) => acc + (Number(curr.franquia) || 0), 0) || 0;

            if (irrData) {
                const months = [
                    { name: 'Jan', key: 'jan.khw', ref: `${new Date().getFullYear()}-01-01` },
                    { name: 'Fev', key: 'fev.khw', ref: `${new Date().getFullYear()}-02-01` },
                    { name: 'Mar', key: 'mar.kwh', ref: `${new Date().getFullYear()}-03-01` },
                    { name: 'Abr', key: 'abr.kwh', ref: `${new Date().getFullYear()}-04-01` },
                    { name: 'Mai', key: 'mai.kwh', ref: `${new Date().getFullYear()}-05-01` },
                    { name: 'Jun', key: 'jun.kwh', ref: `${new Date().getFullYear()}-06-01` },
                    { name: 'Jul', key: 'jul.kwh', ref: `${new Date().getFullYear()}-07-01` },
                    { name: 'Ago', key: 'ago.kwh', ref: `${new Date().getFullYear()}-08-01` },
                    { name: 'Set', key: 'set.kwh', ref: `${new Date().getFullYear()}-09-01` },
                    { name: 'Out', key: 'out.kwh', ref: `${new Date().getFullYear()}-10-01` },
                    { name: 'Nov', key: 'nov.kwh', ref: `${new Date().getFullYear()}-11-01` },
                    { name: 'Dez', key: 'dez.khw', ref: `${new Date().getFullYear()}-12-01` }
                ];

                const chartData = months.map(m => {
                    const factor = Number(irrData[m.key]) || 0;
                    const estimativa = Math.round(factor * potenciaKwp);
                    
                    const actual = actualGenData.find(g => g.mes_referencia === m.ref);
                    const cons = consumptionData.find(c => c.mes === m.ref);

                    return {
                        name: m.name,
                        estimativa: estimativa,
                        geracaoReal: actual ? Number(actual.geracao_real) : null,
                        consumo: cons ? Math.round(cons.valor) : null,
                        comprometimento: totalCommitment > 0 ? totalCommitment : null
                    };
                });

                setData(chartData);

                if (onCalculate) {
                    const avgEstimativa = Math.round(chartData.reduce((acc, curr) => acc + curr.estimativa, 0) / 12);
                    onCalculate(avgEstimativa, chartData);
                }
            }
        } catch (error) {
            console.error('Error fetching performance data:', error);
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

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{ 
                    background: 'rgba(255, 255, 255, 0.98)', 
                    backdropFilter: 'blur(8px)',
                    padding: '12px 16px', 
                    border: '1px solid #e2e8f0', 
                    borderRadius: '16px', 
                    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
                    minWidth: '180px'
                }}>
                    <p style={{ margin: '0 0 8px 0', fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>{label}</p>
                    {payload.map((entry, index) => (
                        <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: entry.color }} />
                                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{entry.name}:</span>
                            </div>
                            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                                {entry.value?.toLocaleString('pt-BR')} <small style={{ fontSize: '0.6rem' }}>kWh</small>
                            </span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{ 
            background: 'white', 
            padding: '2rem', 
            borderRadius: '24px', 
            border: '1px solid #e2e8f0', 
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
            marginTop: '2rem'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2.5rem' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <div style={{ padding: '0.6rem', background: '#fff7ed', borderRadius: '12px', color: '#FF6600' }}>
                            <Activity size={20} />
                        </div>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>
                            Performance e Balanço Energético
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}>Acompanhamento de Geração, Consumo e Comprometimento.</p>
                </div>
            </div>

            <div style={{ height: '350px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorGen" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#FF6600" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="#FF6600" stopOpacity={0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#7f8c8d', fontSize: 12 }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#7f8c8d', fontSize: 12 }} />
                        
                        <Tooltip content={<CustomTooltip />} />
                        <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 700 }} />

                        {/* 1. Geração Estimada (Fundo/Area) */}
                        <Area 
                            type="monotone" 
                            dataKey="estimativa" 
                            name="Geração Prevista" 
                            stroke="#FF6600" 
                            fillOpacity={1} 
                            fill="url(#colorGen)" 
                            strokeWidth={1} 
                            strokeDasharray="5 5"
                        />

                        {/* 2. Comprometimento (Linha Step Pontilhada) */}
                        <Line 
                            type="step" 
                            dataKey="comprometimento" 
                            name="Comprometimento" 
                            stroke="#dc2626" 
                            strokeWidth={2} 
                            strokeDasharray="5 5" 
                            dot={false} 
                            animationDuration={1500} 
                        />
                        
                        {/* 3. Consumo / Energia Compensada (Linha Azul) */}
                        <Line 
                            type="monotone" 
                            dataKey="consumo" 
                            name="Energia Compensada" 
                            stroke="#003366" 
                            strokeWidth={3} 
                            dot={{ r: 4, fill: '#003366', strokeWidth: 0 }} 
                            activeDot={{ r: 6 }}
                            animationDuration={1500} 
                        />

                        {/* 4. Geração Real (Linha Laranja Sólida) */}
                        <Line 
                            type="monotone" 
                            dataKey="geracaoReal" 
                            name="Geração Real" 
                            stroke="#FF6600" 
                            strokeWidth={4} 
                            dot={{ r: 5, fill: '#FF6600', strokeWidth: 0 }} 
                            activeDot={{ r: 8 }}
                            animationDuration={1500} 
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Comprometimento Atual</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '10px', height: '10px', background: '#dc2626', borderRadius: '50%' }} />
                        <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                            {data[0]?.comprometimento?.toLocaleString('pt-BR') || 0} <small style={{ fontSize: '0.8rem', color: '#64748b' }}>kWh</small>
                        </span>
                    </div>
                </div>
                <div style={{ padding: '1rem', background: '#fff7ed', borderRadius: '16px', border: '1px solid #ffedd5' }}>
                    <div style={{ fontSize: '0.7rem', color: '#9a3412', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Dica Operacional</div>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#c2410c', lineHeight: 1.4 }}>
                        Mantenha a <b>Geração Real</b> sempre acima do <b>Comprometimento</b> para garantir o payback dos investidores.
                    </p>
                </div>
            </div>
        </div>
    );
}
