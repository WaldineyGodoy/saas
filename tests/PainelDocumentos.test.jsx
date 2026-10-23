import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import PainelDocumentos from '../src/components/subscriber/PainelDocumentos';
import { situacaoDocumentos } from '../src/lib/onboarding';

// React 19 SSR emite <!-- --> entre textos adjacentes.
const render = (ui) => renderToString(ui).replace(/<!-- -->/g, '');

const itens = (cpf_cnpj, ucs = [], docs = []) => situacaoDocumentos({ cpf_cnpj, ucs, docs });

describe('PainelDocumentos (aba Documentos do modal do assinante)', () => {
  it('assinante recém-criado: obrigatórios pendentes COM botão de upload (o defeito reportado)', () => {
    const html = render(<PainelDocumentos itens={itens('52998224725')} podeEnviar onEscolherArquivo={() => {}} onAbrir={() => {}} />);
    expect(html).toContain('CNH ou RG do titular');
    expect(html).toContain('Pendente');
    expect(html).toContain('Escolher arquivo');
    expect(html).toContain('type="file"');
    expect(html).toContain('Nenhum documento enviado.');
  });

  it('sem UC cadastrada, avisa onde cadastrar para anexar a conta de energia', () => {
    const html = render(<PainelDocumentos itens={itens('52998224725')} temUcs={false} podeEnviar />);
    expect(html).toContain('Unidades Consumidoras');
  });

  it('com UC, pede a conta de energia daquela UC e não mostra o aviso', () => {
    const html = render(<PainelDocumentos itens={itens('52998224725', [{ id: 'u1', numero_uc: '7001234567' }])} temUcs podeEnviar />);
    expect(html).toContain('Conta de energia da UC 7001234567');
    expect(html).not.toContain('Cadastre as unidades consumidoras');
  });

  it('CNPJ pede contrato social e documento do representante', () => {
    const html = render(<PainelDocumentos itens={itens('11222333000181')} podeEnviar />);
    expect(html).toContain('CNH ou RG do representante legal');
    expect(html).toContain('Contrato social');
  });

  it('documento recebido aparece como Recebido, oferece enviar outro e lista o arquivo', () => {
    const docs = [{ id: 'd1', tipo: 'identidade', consumer_unit_id: null, criado_em: '2026-10-23T12:00:00Z', consumer_units: null }];
    const html = render(<PainelDocumentos itens={itens('52998224725', [], docs)} docs={docs} podeEnviar />);
    expect(html).toContain('Recebido');
    expect(html).toContain('Enviar outro arquivo');
    expect(html).toContain('Identidade (CNH/RG)');
    expect(html).not.toContain('Nenhum documento enviado.');
  });

  it('quem não é admin vê a situação, mas nenhum botão de envio', () => {
    const html = render(<PainelDocumentos itens={itens('52998224725')} podeEnviar={false} />);
    expect(html).toContain('Pendente');
    expect(html).not.toContain('Escolher arquivo');
    expect(html).not.toContain('type="file"');
    expect(html).toContain('Só administradores anexam documentos');
  });

  it('durante o envio, o item mostra Enviando e os demais ficam travados', () => {
    const html = render(<PainelDocumentos itens={itens('11222333000181')} podeEnviar enviando="identidade:" />);
    expect(html).toContain('Enviando...');
    expect(html).toContain('disabled');
  });

  it('erro de envio aparece no item que falhou', () => {
    const html = render(<PainelDocumentos itens={itens('52998224725')} podeEnviar errosEnvio={{ 'identidade:': 'O arquivo deve ter até 10 MB.' }} />);
    expect(html).toContain('O arquivo deve ter até 10 MB.');
  });
});
