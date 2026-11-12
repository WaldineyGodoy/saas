import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ocupaFranquia, resumoCapacidadeMensal } from '../../lib/capacidade';
import OcupacaoMensalUsina from '../../components/OcupacaoMensalUsina';
import { useGeracaoMensal } from '../../hooks/useGeracaoMensal';

// Lotacao mes a mes da usina (regra unica em src/lib/capacidade.js). As UCs vem
// pelo embed; enquanto o RLS de consumer_units nao deixar o fornecedor ler as UCs
// da propria usina, a lista volta vazia e o bloco simplesmente nao aparece.
function LotacaoMensal({ usina }) {
    const ucs = usina.consumer_units || [];
    const temFranquia = ucs.some(ocupaFranquia);
    const comGeracao = Number(usina.geracao_estimada_kwh) > 0;
    const geracaoMensal = useGeracaoMensal(temFranquia && comGeracao ? usina.id : null);
    if (!temFranquia || !comGeracao) return null;
    const resumo = resumoCapacidadeMensal(usina, ucs, geracaoMensal);
    return (
        <div style={{ marginTop: '0.75rem' }}>
            <OcupacaoMensalUsina resumo={resumo} />
        </div>
    );
}

export default function SupplierDashboard() {
    const { user } = useAuth();
    const [usinas, setUsinas] = useState([]);

    useEffect(() => {
        async function fetchUsinas() {
            // Vinculo pelo user_id (o profile_id nao e confiavel).
            const { data: suppData } = await supabase.from('suppliers').select('id').eq('user_id', user.id);
            if (suppData?.length) {
                const { data } = await supabase.from('usinas').select('*, consumer_units!consumer_units_usina_id_fkey (*)').in('supplier_id', suppData.map((s) => s.id));
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
                        <LotacaoMensal usina={usina} />
                    </div>
                ))}
            </div>
        </div>
    );
}
