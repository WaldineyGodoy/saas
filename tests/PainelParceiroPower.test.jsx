import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import PainelParceiroPower from '../src/components/subscriber/PainelParceiroPower';

// React 19 SSR emite <!-- --> entre textos adjacentes.
const render = (ui) => renderToString(ui).replace(/<!-- -->/g, '');

describe('PainelParceiroPower: o que a equipe ve no rodape do cadastro do assinante', () => {
  it('pessoa que ainda nao e parceira: botao "Tornar Parceiro Power" habilitado', () => {
    const html = render(<PainelParceiroPower estado={{ tipo: 'pode' }} onClick={() => {}} />);
    expect(html).toContain('Tornar Parceiro Power');
    expect(html).not.toContain('disabled');
  });

  it('durante a criacao, o botao fica travado e mostra Cadastrando', () => {
    const html = render(<PainelParceiroPower estado={{ tipo: 'pode' }} ocupado onClick={() => {}} />);
    expect(html).toContain('Cadastrando...');
    expect(html).toContain('disabled');
  });

  it('faltam dados: botao desabilitado, e o motivo aparece escrito (nao so no tooltip)', () => {
    const html = render(<PainelParceiroPower estado={{ tipo: 'faltam', faltando: ['e-mail', 'telefone com DDD e 9 dígitos'] }} onClick={() => {}} />);
    expect(html).toContain('Tornar Parceiro Power');
    expect(html).toContain('disabled');
    expect(html).toContain('Falta: e-mail, telefone com DDD e 9 dígitos');
  });

  it('ja e parceiro: mostra o cargo e NAO oferece o botao de novo (nada de cadastro duplicado)', () => {
    const html = render(<PainelParceiroPower estado={{ tipo: 'parceiro', parceiro: { cargo: 'ppf', short_url: null } }} onClick={() => {}} />);
    expect(html).toContain('Parceiro Power');
    expect(html).toContain('PPF');
    expect(html).not.toContain('Tornar Parceiro Power');
    expect(html).not.toContain('<button');
  });

  it('ja e parceiro com link: oferece copiar o link', () => {
    const html = render(<PainelParceiroPower estado={{ tipo: 'parceiro', parceiro: { cargo: 'ppe', short_url: 'https://link.b2wenergia.com.br/maria-c1' } }} onCopiar={() => {}} />);
    expect(html).toContain('PPE');
    expect(html).toContain('Copiar link');
  });

  it('cargo desconhecido ou vazio cai num texto seguro', () => {
    const html = render(<PainelParceiroPower estado={{ tipo: 'parceiro', parceiro: { cargo: null } }} />);
    expect(html).toContain('Parceiro Power');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });

  it('carregando: nao mostra botao (evita clicar antes de saber se ja e parceiro)', () => {
    const html = render(<PainelParceiroPower estado={{ tipo: 'carregando' }} onClick={() => {}} />);
    expect(html).not.toContain('Tornar Parceiro Power');
  });

  it('estado desconhecido ou ausente: nada na tela, sem quebrar', () => {
    expect(render(<PainelParceiroPower estado={{ tipo: 'xyz' }} />)).toBe('');
    expect(render(<PainelParceiroPower />)).toBe('');
  });
});
