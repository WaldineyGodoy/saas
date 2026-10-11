import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import type { Ponto } from './distancia';

/**
 * Localização aproximada de quem está no app, só para achar eletropostos
 * perto (30 km). Sem permissão ou sem sinal, devolve null e a tela segue
 * com a lista inteira. Não é guardada nem enviada a lugar nenhum.
 */
export function useLocalizacao() {
  const [estado, setEstado] = useState<{ ponto: Ponto | null; pronto: boolean }>({ ponto: null, pronto: false });

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { granted } = await Location.requestForegroundPermissionsAsync();
        if (!granted) throw new Error('sem permissão');
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        if (vivo) setEstado({ ponto: { lat: pos.coords.latitude, lng: pos.coords.longitude }, pronto: true });
      } catch {
        if (vivo) setEstado({ ponto: null, pronto: true });
      }
    })();
    return () => { vivo = false; };
  }, []);

  return estado;
}
