/**
 * Eletropostos perto de quem está no app (pedido do dono, 11/10/2026: raio
 * de 30 km). As coordenadas do eletroposto ficam em endereco.lat/lng, que o
 * CRM preenche ao salvar (geocodificação Mapbox no EletropostoModal).
 */
export const RAIO_PROXIMO_KM = 30;

export type Ponto = { lat: number; lng: number };

/** Distância em linha reta (haversine), em km. */
export function distanciaKm(a: Ponto, b: Ponto) {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Coordenadas guardadas no endereço do eletroposto, se houver. */
export function pontoDoEndereco(endereco: Record<string, unknown> | null | undefined): Ponto | null {
  const lat = Number(endereco?.lat);
  const lng = Number(endereco?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Os que ficam a até `raioKm` de `aqui`, do mais perto ao mais longe. */
export function proximos<T extends { endereco: Record<string, unknown> | null }>(itens: T[], aqui: Ponto, raioKm = RAIO_PROXIMO_KM) {
  return itens
    .map((item) => {
      const p = pontoDoEndereco(item.endereco);
      return { item, km: p ? distanciaKm(aqui, p) : Infinity };
    })
    .filter((x) => x.km <= raioKm)
    .sort((a, b) => a.km - b.km);
}
