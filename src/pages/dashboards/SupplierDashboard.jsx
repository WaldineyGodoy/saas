import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

export default function SupplierDashboard() {
    const { user } = useAuth();
    const [usinas, setUsinas] = useState([]);

    useEffect(() => {
        async function fetchUsinas() {
            const { data: suppData } = await supabase.from('suppliers').select('id').eq('profile_id', user.id).single();
            if (suppData) {
                const { data } = await supabase.from('usinas').select('*').eq('supplier_id', suppData.id);
                setUsinas(data || []);
            }
        }
        fetchUsinas();
    }, [user]);

    return (
        <div>
            <h2>Painel do Fornecedor</h2>
            <div style={{ padding: '1.5rem', background: 'white', borderRadius: '8px', marginBottom: '2rem' }}>
                <h3>Minhas Usinas</h3>
                <p style={{ fontSize: '1.2rem', color: '#666' }}>{usinas.length} Usinas cadastradas</p>
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
                {usinas.map(usina => (
                    <div key={usina.id} style={{ padding: '1rem', background: 'white', borderLeft: '4px solid var(--color-orange)', borderRadius: '4px' }}>
                        <h4>{usina.name}</h4>
                        <p>Status: <strong>{usina.status}</strong></p>
                        <p>Potência: {usina.potencia_kwp} KWp</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
