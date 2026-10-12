import { describe, expect, it } from 'vitest';
import { distanciaKm, pontoDoEndereco, proximos } from '../distancia';

const NATAL = { lat: -5.7945, lng: -35.211 };
const PARNAMIRIM = { lat: -5.9157, lng: -35.2628 }; // ~15 km
const MOSSORO = { lat: -5.1878, lng: -37.3442 }; // ~245 km

describe('distancia', () => {
  it('calcula a distancia em km', () => {
    expect(distanciaKm(NATAL, PARNAMIRIM)).toBeGreaterThan(12);
    expect(distanciaKm(NATAL, PARNAMIRIM)).toBeLessThan(18);
    expect(distanciaKm(NATAL, MOSSORO)).toBeGreaterThan(230);
  });

  it('le as coordenadas do endereco e ignora as invalidas', () => {
    expect(pontoDoEndereco({ lat: '-5.79', lng: '-35.21' })).toEqual({ lat: -5.79, lng: -35.21 });
    expect(pontoDoEndereco({ lat: 0, lng: 0 })).toBeNull();
    expect(pontoDoEndereco({ rua: 'sem coordenada' })).toBeNull();
    expect(pontoDoEndereco(null)).toBeNull();
  });

  it('filtra pelo raio de 30 km e ordena do mais perto', () => {
    const postos = [
      { id: 'mossoro', endereco: MOSSORO },
      { id: 'sem', endereco: { rua: 'x' } },
      { id: 'parnamirim', endereco: PARNAMIRIM },
      { id: 'natal', endereco: NATAL },
    ];
    expect(proximos(postos, NATAL).map((x) => x.item.id)).toEqual(['natal', 'parnamirim']);
  });
});
