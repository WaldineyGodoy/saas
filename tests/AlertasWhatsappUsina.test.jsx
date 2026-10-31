import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import AlertasWhatsappUsina from '../src/components/AlertasWhatsappUsina';
import { alertasParaGravar, inversoresParaGravar, ehSnDatalogger, TIPOS_ALERTA } from '../src/lib/alertasUsina';

// React 19 SSR emite <!-- --> entre textos adjacentes.
const render = (ui) => renderToString(ui).replace(/<!-- -->/g, '');
const nada = () => {};

describe('AlertasWhatsappUsina (aba Técnico do modal da usina)', () => {
  it('marca sem API conectada: bloco indisponível, sem campos', () => {
    const html = render(<AlertasWhatsappUsina marca="Solplanet" apiConectada={false} numeros={[]} tipos={['offline']}
      onChangeNumeros={nada} onChangeTipos={nada} />);
    expect(html).toContain('Indisponível');
    expect(html).toContain('Solplanet');
    expect(html).not.toContain('type="tel"');
    expect(html).not.toContain('type="checkbox"');
  });

  it('sem fabricante informado, diz onde informar', () => {
    const html = render(<AlertasWhatsappUsina marca="" apiConectada={false} onChangeNumeros={nada} onChangeTipos={nada} />);
    expect(html).toContain('informe o fabricante do inversor');
  });

  it('SAJ com API: quatro tipos marcáveis e um campo de telefone vazio para começar', () => {
    const html = render(<AlertasWhatsappUsina marca="Saj" apiConectada numeros={[]} tipos={['offline']}
      onChangeNumeros={nada} onChangeTipos={nada} />);
    for (const t of TIPOS_ALERTA) expect(html).toContain(t.titulo);
    expect(html.match(/type="checkbox"/g)).toHaveLength(4);
    expect(html.match(/type="tel"/g)).toHaveLength(1);
    expect(html).toContain('Adicionar');
    expect(html).toContain('Sem número cadastrado');
  });

  it('vários números aparecem mascarados, cada um com botão de remover', () => {
    const html = render(<AlertasWhatsappUsina marca="Saj" apiConectada numeros={['84999990000', '84988887777']} tipos={[]}
      onChangeNumeros={nada} onChangeTipos={nada} />);
    expect(html).toContain('(84) 99999-0000');
    expect(html).toContain('(84) 98888-7777');
    expect(html.match(/title="Remover número"/g)).toHaveLength(2);
    expect(html).not.toContain('Sem número cadastrado');
  });

  it('número incompleto é sinalizado', () => {
    const html = render(<AlertasWhatsappUsina marca="Saj" apiConectada numeros={['8499']} tipos={['offline']}
      onChangeNumeros={nada} onChangeTipos={nada} />);
    expect(html).toContain('11 dígitos');
  });

  it('grava só números completos, em dígitos, sem repetir', () => {
    expect(alertasParaGravar(['(84) 99999-0000', '', '8499', '84999990000', '84 98888 7777']))
      .toEqual(['84999990000', '84988887777']);
    expect(alertasParaGravar(undefined)).toEqual([]);
  });

  it('inversor visto pela SAJ mostra modelo, usina e status', () => {
    const status = { C6V6753J2512E00528: { modelo: 'C6', plant_nome: 'UFV Bom Jesus', online: true, visto_em: '2026-10-31T12:00:00Z' } };
    const html = render(<AlertasWhatsappUsina marca="Saj" apiConectada inversores={['C6V6753J2512E00528']} statusInversores={status}
      numeros={[]} tipos={[]} onChangeInversores={nada} onChangeNumeros={nada} onChangeTipos={nada} />);
    expect(html).toContain('value="C6V6753J2512E00528"');
    expect(html).toContain('UFV Bom Jesus');
    expect(html).toContain('online');
  });

  it('SN de datalogger é recusado na tela; SN desconhecido pede a autorização do proprietário', () => {
    const html = render(<AlertasWhatsappUsina marca="Saj" apiConectada inversores={['M5380J2510015660', 'R6X0000000000']} statusInversores={{}}
      numeros={[]} tipos={[]} onChangeInversores={nada} onChangeNumeros={nada} onChangeTipos={nada} />);
    expect(html).toContain('SN do datalogger');
    expect(html).toContain('Ainda não visto na SAJ');
    expect(html).toContain('Adicionar inversor');
  });

  it('SN normalizado e sem repetir; datalogger reconhecido pelo prefixo M5', () => {
    expect(inversoresParaGravar([' c6v6753j2512e00528 ', 'C6V6753J2512E00528', ''])).toEqual(['C6V6753J2512E00528']);
    expect(ehSnDatalogger('m5380J2510015660')).toBe(true);
    expect(ehSnDatalogger('C6V6753J2512E00528')).toBe(false);
  });
});
