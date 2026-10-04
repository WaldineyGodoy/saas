import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { textoDosItens, parseEnergyBillText, normalizarUc, ucConfere, completarLeitura, contaParaPedido, separarNumero } from '../src/lib/energyBillParser.js';

// As contas reais (PDF) não vão para o git: têm nome, endereço e UC de clientes.
// Os testes usam o texto que o pdfjs extrai delas (textoDosItens), com os dados
// pessoais trocados por fictícios. O teste do caminho PDF -> texto só roda onde
// os PDFs existem.
const fixture = (arquivo) => path.join(__dirname, 'fixtures', arquivo);
const lerFixture = (arquivo) => fs.readFileSync(fixture(arquivo), 'utf8');

// Mesmo caminho do navegador: pdfjs -> textoDosItens -> parseEnergyBillText
const lerPdf = async (arquivo) => {
  const data = new Uint8Array(fs.readFileSync(fixture(arquivo)));
  const pdf = await getDocument({ data, verbosity: 0 }).promise;
  let texto = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const conteudo = await (await pdf.getPage(i)).getTextContent();
    texto += textoDosItens(conteudo.items) + '\n';
  }
  return texto;
};

describe('Cosern, layout novo (número de UC padrão Aneel)', () => {
  let texto;
  beforeAll(async () => { texto = lerFixture('cosern-layout-novo-2026-09.txt'); });

  test('lê o número novo da UC e o código antigo de débito em conta', () => {
    const r = parseEnergyBillText(texto);
    expect(r.numeroUc).toBe('1.900.000.001-23');
    expect(r.numeroUcNovo).toBe('1.900.000.001-23');
    expect(r.codigoCliente).toBe('7000000003');
  });

  test('não confunde o protocolo de autorização com a UC', () => {
    const r = parseEnergyBillText(texto);
    expect(normalizarUc(r.numeroUc)).not.toBe('3242600015');
  });

  test('confere com o cadastro pelo número novo ou pelo anterior', () => {
    expect(parseEnergyBillText(texto, ['1.900.000.001-23', '007000000003']).isUcMatch).toBe(true);
    expect(parseEnergyBillText(texto, ['190000000123']).isUcMatch).toBe(true);
    expect(parseEnergyBillText(texto, [null, '007000000003']).isUcMatch).toBe(true);
    expect(parseEnergyBillText(texto, ['7000000001']).isUcMatch).toBe(false);
  });

  test('titular, documento, endereço e ligação', () => {
    const r = parseEnergyBillText(texto);
    expect(r.titular).toBe('ASSOCIACAO EXEMPLO DE ENERGIA');
    expect(r.documentoTipo).toBe('CNPJ');
    expect(r.documento).toBe('12.345.***/****-**');
    expect(r.endereco).toMatchObject({
      logradouro: 'RODOVIA EXEMPLO 1000 CD- A',
      complemento: 'COND EXEMPLO, SE- 02',
      bairro: 'JARDINS',
      cep: '59294-390',
      cidade: 'SAO GONCALO DO AMARANTE',
      uf: 'RN',
    });
    expect(r.ligacao).toBe('trifasico');
  });

  test('histórico ignora os meses sem valor anteriores à troca de titularidade', () => {
    const r = parseEnergyBillText(texto);
    expect(r.historico).toEqual([
      { mes: '2026-09', kwh: 4623, dias: 30 },
      { mes: '2026-08', kwh: 4948, dias: 33 },
      { mes: '2026-07', kwh: 3450, dias: 35 },
    ]);
    expect(r.mediaKwh).toBe(4340);
  });

  test('valores da fatura', () => {
    const r = parseEnergyBillText(texto);
    expect(r.mesReferencia).toBe('09/2026');
    expect(r.vencimento).toBe('2026-10-26');
    expect(r.valorTotal).toBe(1702.51);
    expect(r.consumoKwh).toBe(4623);
    expect(r.consumoCompensado).toBe(4623);
    expect(r.cipValor).toBe(661.25);
  });
});

describe('Cosern, layout antigo (código da instalação + código do cliente)', () => {
  let texto;
  beforeAll(async () => { texto = lerFixture('cosern-layout-antigo-2026-05.txt'); });

  test('identificação e conferência com o cadastro', () => {
    const r = parseEnergyBillText(texto, '007000000001');
    expect(r.numeroUc).toBe('7000000001');
    expect(r.codigoInstalacao).toBe('6000001');
    expect(r.numeroUcNovo).toBe('');
    expect(r.isUcMatch).toBe(true);
  });

  test('titular, documento, endereço e histórico completo', () => {
    const r = parseEnergyBillText(texto);
    expect(r.titular).toBe('MARIA EXEMPLO DA SILVA');
    expect(r.documentoTipo).toBe('CPF');
    expect(r.endereco).toMatchObject({ logradouro: 'RUA DAS FLORES 100', complemento: '', bairro: 'CENTRO', cep: '59678-000', cidade: 'TIBAU', uf: 'RN' });
    expect(r.ligacao).toBe('monofasico');
    expect(r.historico).toHaveLength(13);
    expect(r.historico[0]).toEqual({ mes: '2026-05', kwh: 166, dias: 29 });
    expect(r.historico[12]).toEqual({ mes: '2025-05', kwh: 87, dias: 32 });
  });

  test('consumo compensado não pega o número do medidor', () => {
    const r = parseEnergyBillText(texto);
    expect(r.consumoCompensado).toBe(0);
    expect(r.consumoKwh).toBe(166);
    expect(r.valorTotal).toBe(403.09);
  });
});

describe('ucConfere', () => {
  test('ignora pontuação e zeros à esquerda, e nunca casa vazio com vazio', () => {
    expect(ucConfere(['0001000002'], ['1000002'])).toBe(true);
    expect(ucConfere(['451.234.567-89'], ['45123456789'])).toBe(true);
    expect(ucConfere(['', null], ['', undefined])).toBe(false);
  });
});

describe('completarLeitura (formato devolvido pela leitura de foto)', () => {
  // Campos como a parse-invoice-image devolve para uma conta física do layout antigo
  const lido = {
    numeroUcNovo: '', codigoCliente: '7000000002', codigoInstalacao: '0001000002',
    titular: 'CLIENTE EXEMPLO', documentoTipo: 'CPF', documento: '111.2**.***-**',
    endereco: { logradouro: 'AV EXEMPLO 209', complemento: '', bairro: 'CENTRO', cep: '59460-000', cidade: 'SAO PAULO DO POTENGI', uf: 'RN' },
    classificacao: 'B3 COMERCIAL', tipoFornecimento: 'Conv. Monômia - Trifásico',
    historico: [
      { mes: '2026-04', kwh: 2424, dias: 32 }, { mes: '2026-03', kwh: 2236, dias: 30 },
      { mes: '2026-02', kwh: 2010, dias: 27 }, { mes: '2026-01', kwh: 2764, dias: 20 },
      { mes: '2025-12', kwh: 0, dias: 0 },
    ],
  };

  test('deriva UC, ligação, média sem meses zerados e endereço completo', () => {
    const r = completarLeitura(lido);
    expect(r.numeroUc).toBe('7000000002');
    expect(r.ligacao).toBe('trifasico');
    expect(r.mediaKwh).toBe(2359);
    expect(r.endereco.completo).toBe('AV EXEMPLO 209, CENTRO, 59460-000 SAO PAULO DO POTENGI RN');
  });

  test('confere pelo código da instalação ou do cliente', () => {
    expect(completarLeitura(lido, ['1000002']).isUcMatch).toBe(true);
    expect(completarLeitura(lido, ['007000000002']).isUcMatch).toBe(true);
    expect(completarLeitura(lido, ['1.900.000.001-23']).isUcMatch).toBe(false);
  });
});

// Só onde as contas reais estão (máquina de quem desenvolve): garante que o
// caminho pdfjs -> textoDosItens continua produzindo o texto que os testes acima usam.
const pdfs = ['cosern-layout-novo-2026-09', 'cosern-layout-antigo-2026-05'];
describe.skipIf(!pdfs.every((nome) => fs.existsSync(fixture(`${nome}.pdf`))))('PDF real -> texto (local)', () => {
  test.each(pdfs)('%s: os campos sem dado pessoal batem com a fixture de texto', async (nome) => {
    const doPdf = parseEnergyBillText(await lerPdf(`${nome}.pdf`));
    const daFixture = parseEnergyBillText(lerFixture(`${nome}.txt`));
    for (const campo of ['mesReferencia', 'vencimento', 'valorTotal', 'consumoKwh', 'consumoCompensado', 'cipValor', 'historico', 'ligacao', 'documentoTipo']) {
      expect(doPdf[campo], campo).toEqual(daFixture[campo]);
    }
  });
});

describe('pedido de nova UC (leads.conta_lida)', () => {
  test('guarda só os campos de cadastro, sem dados de pagamento', () => {
    const r = contaParaPedido(parseEnergyBillText(lerFixture('cosern-layout-antigo-2026-05.txt')));
    expect(r.numeroUc).toBe('7000000001');
    expect(r.ligacao).toBe('monofasico');
    expect(r.mediaKwh).toBeGreaterThan(0);
    expect(r.concessionaria).toBe('Neoenergia Cosern');
    expect(r).not.toHaveProperty('linhaDigitavel');
    expect(r).not.toHaveProperty('pixString');
    expect(r).not.toHaveProperty('isUcMatch');
  });

  test('separa o número do logradouro só quando ele está no fim', () => {
    expect(separarNumero('AV JOSE PEREIRA DE ARAUJO 209')).toEqual({ rua: 'AV JOSE PEREIRA DE ARAUJO', numero: '209' });
    expect(separarNumero('RUA DAS FLORES 100')).toEqual({ rua: 'RUA DAS FLORES', numero: '100' });
    expect(separarNumero('RODOVIA EXEMPLO 1000 CD- A')).toEqual({ rua: 'RODOVIA EXEMPLO 1000 CD- A', numero: '' });
    expect(separarNumero('')).toEqual({ rua: '', numero: '' });
  });
});
