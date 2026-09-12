import { useState } from 'react';
import { MapPin, Landmark } from 'lucide-react';
import ArrendamentoAreas from './ArrendamentoAreas';
import ArrendamentoPagamentos from './ArrendamentoPagamentos';

/**
 * Arrendamento — as áreas e o dinheiro no mesmo lugar.
 *
 * O cadastro das áreas morava em Configurações, onde vivem parâmetros que se
 * mexem uma vez por ano. Arrendamento não é isso: tem competência mensal,
 * vencimento e pagamento. Saiu de lá por decisão do dono em 12/09/2026.
 *
 * As duas abas não são redundantes. O pagamento de um repasse também acontece
 * dentro do modal da área, que é onde se está quando se quer olhar um contrato
 * específico. Esta aba de repasses existe para a pergunta oposta: o que devo
 * este mês, atravessando todas as áreas, sem abrir uma por uma.
 */

const ABAS = [
    { id: 'areas',    rotulo: 'Áreas arrendadas', icone: MapPin,   desc: 'Terrenos, contratos e quem recebe' },
    { id: 'repasses', rotulo: 'Repasses a pagar', icone: Landmark, desc: 'O que está em aberto, por competência' }
];

export default function Arrendamento() {
    const [aba, setAba] = useState('areas');

    return (
        <div style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                {ABAS.map(a => {
                    const Icone = a.icone;
                    const ativa = aba === a.id;
                    return (
                        <button
                            key={a.id}
                            type="button"
                            onClick={() => setAba(a.id)}
                            title={a.desc}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                padding: '0.7rem 1.2rem', borderRadius: '12px', cursor: 'pointer',
                                fontWeight: 700, fontSize: '0.88rem',
                                border: `1px solid ${ativa ? '#3b82f6' : '#e2e8f0'}`,
                                background: ativa ? '#3b82f6' : 'white',
                                color: ativa ? 'white' : '#475569'
                            }}
                        >
                            <Icone size={17} /> {a.rotulo}
                        </button>
                    );
                })}
            </div>

            {aba === 'areas' ? <ArrendamentoAreas /> : <ArrendamentoPagamentos />}
        </div>
    );
}
