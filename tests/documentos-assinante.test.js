import { describe, test, expect } from 'vitest';
import { anexarDocumentoAssinante } from '../src/lib/documentosAssinante';

// Cliente falso: guarda a ordem das chamadas e devolve o erro que o teste pedir.
const falso = ({ erroUpload = null, erroLinha = null } = {}) => {
  const chamadas = [];
  return {
    chamadas,
    storage: { from: (bucket) => ({ upload: async (path, file, opts) => { chamadas.push(['upload', bucket, path, opts]); return { error: erroUpload }; } }) },
    from: (tabela) => ({ insert: async (linha) => { chamadas.push(['insert', tabela, linha]); return { error: erroLinha }; } }),
  };
};
const pdf = { type: 'application/pdf', size: 1000, name: 'conta.pdf' };

describe('anexarDocumentoAssinante', () => {
  test('sobe o arquivo e só depois grava a linha, com os dados do arquivo', async () => {
    const sb = falso();
    const path = await anexarDocumentoAssinante(sb, { subscriberId: 'sub-1', tipo: 'conta_energia', consumerUnitId: 'uc-1', file: pdf });
    expect(sb.chamadas.map(c => c[0])).toEqual(['upload', 'insert']);
    expect(path).toMatch(/^sub-1\/conta_energia\/[0-9a-f-]{36}\.pdf$/);
    expect(sb.chamadas[0]).toEqual(['upload', 'documentos-assinante', path, { contentType: 'application/pdf', upsert: false }]);
    expect(sb.chamadas[1][1]).toBe('subscriber_documents');
    expect(sb.chamadas[1][2]).toEqual({
      subscriber_id: 'sub-1', consumer_unit_id: 'uc-1', tipo: 'conta_energia',
      storage_path: path, mime: 'application/pdf', tamanho: 1000,
    });
  });

  test('documento que não é de uma UC fica sem consumer_unit_id', async () => {
    const sb = falso();
    await anexarDocumentoAssinante(sb, { subscriberId: 'sub-1', tipo: 'identidade', file: { type: 'image/png', size: 5 } });
    expect(sb.chamadas[1][2].consumer_unit_id).toBeNull();
    expect(sb.chamadas[1][2].storage_path).toMatch(/\.png$/);
  });

  test('arquivo recusado não toca o Storage nem o banco', async () => {
    const sb = falso();
    await expect(anexarDocumentoAssinante(sb, { subscriberId: 's', tipo: 'identidade', file: { type: 'image/gif', size: 5 } }))
      .rejects.toThrow(/PDF, JPG ou PNG/);
    await expect(anexarDocumentoAssinante(sb, { subscriberId: 's', tipo: 'identidade', file: { type: 'application/pdf', size: 11 * 1024 * 1024 } }))
      .rejects.toThrow(/10 MB/);
    expect(sb.chamadas).toEqual([]);
  });

  test('falha no upload não grava linha: linha sem arquivo apareceria como recebido', async () => {
    const sb = falso({ erroUpload: new Error('bucket recusou') });
    await expect(anexarDocumentoAssinante(sb, { subscriberId: 's', tipo: 'identidade', file: pdf })).rejects.toThrow('bucket recusou');
    expect(sb.chamadas.map(c => c[0])).toEqual(['upload']);
  });

  test('falha na linha avisa, em vez de fingir que anexou', async () => {
    const sb = falso({ erroLinha: new Error('sem permissão') });
    await expect(anexarDocumentoAssinante(sb, { subscriberId: 's', tipo: 'identidade', file: pdf })).rejects.toThrow('sem permissão');
  });

  test('sem assinante não há onde anexar', async () => {
    const sb = falso();
    await expect(anexarDocumentoAssinante(sb, { subscriberId: null, tipo: 'conta_energia', file: pdf })).rejects.toThrow(/assinante/i);
    expect(sb.chamadas).toEqual([]);
  });
});
