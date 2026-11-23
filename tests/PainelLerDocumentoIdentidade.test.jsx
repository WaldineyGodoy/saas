import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import PainelLerDocumentoIdentidade from '../src/components/subscriber/PainelLerDocumentoIdentidade';

// React 19 SSR emite <!-- --> entre textos adjacentes.
const render = (ui) => renderToString(ui).replace(/<!-- -->/g, '');

describe('PainelLerDocumentoIdentidade: bloco no topo de Dados Cadastrais do assinante', () => {
  it('mostra a orientacao pedida e o botao de leitura', () => {
    const html = render(<PainelLerDocumentoIdentidade />);
    expect(html).toContain('Informe o CPF ou faça o upload do documento de identificação (para fazer a leitura do documento e preencher os dados)');
    expect(html).toContain('Ler CNH ou RG (foto ou PDF)');
    expect(html).not.toContain('disabled');
  });

  it('durante a leitura, o botao trava e diz o que esta fazendo', () => {
    const html = render(<PainelLerDocumentoIdentidade lendo />);
    expect(html).toContain('Lendo o documento...');
    expect(html).toContain('disabled');
  });

  it('documento lido: informa que o arquivo sera anexado ao salvar', () => {
    const html = render(<PainelLerDocumentoIdentidade arquivoNome="cnh-maria.jpg" />);
    expect(html).toContain('cnh-maria.jpg');
    expect(html).toContain('anexado ao salvar');
  });

  it('sem arquivo lido, nao fala em anexo', () => {
    expect(render(<PainelLerDocumentoIdentidade />)).not.toContain('anexado ao salvar');
  });

  it('avisos da leitura aparecem como alerta', () => {
    const html = render(<PainelLerDocumentoIdentidade avisos={['Não encontrei CPF neste documento. Digite o CPF à mão.']} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Não encontrei CPF neste documento');
  });
});
