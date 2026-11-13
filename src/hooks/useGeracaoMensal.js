import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { carregarGeracaoMensal } from '../lib/capacidade';

/**
 * Geração estimada mensal da usina ({"01":kwh,...}) pela RPC
 * fn_geracao_estimada_mensal. Enquanto a RPC não existir no banco (ou sem usina),
 * devolve null e a regra de capacidade usa a geração plana.
 */
export function useGeracaoMensal(usinaId) {
    const [estado, setEstado] = useState({ id: null, dados: null });
    useEffect(() => {
        if (!usinaId) return undefined;
        let vivo = true;
        carregarGeracaoMensal(supabase, usinaId).then((dados) => {
            if (vivo) setEstado({ id: usinaId, dados });
        });
        return () => { vivo = false; };
    }, [usinaId]);
    return estado.id === usinaId ? estado.dados : null;
}

export default useGeracaoMensal;
