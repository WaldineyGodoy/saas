import { describe, test, expect } from 'vitest';
import { ucsParaContrato, descontoDaUc, avisosDoContrato, contratoBloqueado, STATUS_UC_ENCERRADA } from '../src/lib/contratoUcs';

const uc = (o = {}) => ({
  id: 'u1', numero_uc: '7001', status: 'ativo', concessionaria: 'COSERN',
  desconto_assinante: null, created_at: '2026-01-10T10:00:00Z',
  planos_assinatura_energia: { id: 'p1', nome: 'Plano Ultra Connect', desconto_assinante: '15.00' },
  ...o,
});

describe('descontoDaUc: o percentual que o contrato imprime para a UC', () => {
  test('o desconto gravado na UC vale primeiro', () => {
    expect(descontoDaUc(uc({ desconto_assinante: '17.50' }))).toBe(17.5);
  });
  test('sem desconto na UC, vale o do plano', () => {
    expect(descontoDaUc(uc())).toBe(15);
  });
  test('desconto 0 na UC nao vale: cai no plano, em vez de virar o padrao de 20%', () => {
    expect(descontoDaUc(uc({ desconto_assinante: 0 }))).toBe(15);
    expect(descontoDaUc(uc({ desconto_assinante: '0.00' }))).toBe(15);
  });
  test('aceita virgula decimal digitada em campo de texto', () => {
    expect(descontoDaUc(uc({ desconto_assinante: '17,5' }))).toBe(17.5);
  });
  test('sem desconto na UC e sem plano: nulo (nunca inventa um numero)', () => {
    expect(descontoDaUc(uc({ planos_assinatura_energia: null }))).toBeNull();
    expect(descontoDaUc(uc({ planos_assinatura_energia: { desconto_assinante: null } }))).toBeNull();
    expect(descontoDaUc(null)).toBeNull();
    expect(descontoDaUc(undefined)).toBeNull();
  });
  test('texto que nao e numero e ignorado', () => {
    expect(descontoDaUc(uc({ desconto_assinante: 'abc', planos_assinatura_energia: null }))).toBeNull();
  });
});

describe('ucsParaContrato: qual UC e a primeira (a que define o termo)', () => {
  test('a mais antiga vem primeiro, independente da ordem em que o banco devolveu', () => {
    const lista = [
      uc({ id: 'c', numero_uc: '3', created_at: '2026-03-01T00:00:00Z' }),
      uc({ id: 'a', numero_uc: '1', created_at: '2026-01-01T00:00:00Z' }),
      uc({ id: 'b', numero_uc: '2', created_at: '2026-02-01T00:00:00Z' }),
    ];
    expect(ucsParaContrato(lista).map((u) => u.id)).toEqual(['a', 'b', 'c']);
  });

  test.each(STATUS_UC_ENCERRADA)('UC %s nao define contrato nem aparece nele', (status) => {
    const lista = [uc({ id: 'velha', status, created_at: '2025-01-01T00:00:00Z' }), uc({ id: 'viva', created_at: '2026-05-01T00:00:00Z' })];
    expect(ucsParaContrato(lista).map((u) => u.id)).toEqual(['viva']);
  });

  test('uma UC antiga cancelada nao tira o lugar da UC vigente, mesmo sendo mais antiga', () => {
    const lista = [uc({ id: 'cancelada', status: 'cancelado', created_at: '2020-01-01T00:00:00Z' }), uc({ id: 'ativa' })];
    expect(ucsParaContrato(lista)[0].id).toBe('ativa');
  });

  test('UC em ativacao, aguardando conexao e em atraso contam como vigentes', () => {
    const lista = ['em_ativacao', 'aguardando_conexao', 'em_atraso', 'ativacao', 'vinculado', 'sem_geracao', 'em_transf_titularidade']
      .map((status, i) => uc({ id: `u${i}`, status, created_at: `2026-01-0${i + 1}T00:00:00Z` }));
    expect(ucsParaContrato(lista)).toHaveLength(7);
  });

  test('sem data de criacao vai para o fim; empate desempata pelo id, sempre igual', () => {
    const lista = [uc({ id: 'z', created_at: null }), uc({ id: 'b', created_at: '2026-01-01T00:00:00Z' }), uc({ id: 'a', created_at: '2026-01-01T00:00:00Z' })];
    expect(ucsParaContrato(lista).map((u) => u.id)).toEqual(['a', 'b', 'z']);
  });

  test('todas encerradas: lista vazia (o contrato nao usa UC que saiu)', () => {
    expect(ucsParaContrato([uc({ status: 'cancelado' }), uc({ status: 'desconectado' })])).toEqual([]);
  });

  test('entrada nula, vazia ou que nao e lista nao explode', () => {
    expect(ucsParaContrato(null)).toEqual([]);
    expect(ucsParaContrato(undefined)).toEqual([]);
    expect(ucsParaContrato([])).toEqual([]);
    expect(ucsParaContrato('x')).toEqual([]);
  });

  test('nao altera a lista original', () => {
    const lista = [uc({ id: 'b', created_at: '2026-02-01T00:00:00Z' }), uc({ id: 'a', created_at: '2026-01-01T00:00:00Z' })];
    const copia = lista.map((u) => u.id);
    ucsParaContrato(lista);
    expect(lista.map((u) => u.id)).toEqual(copia);
  });
});

describe('avisosDoContrato: o que a equipe precisa saber antes de enviar', () => {
  const codigos = (a) => a.map((x) => x.codigo);

  test('sem nenhuma UC: bloqueia, e a mensagem diz o que sai no termo e onde corrigir', () => {
    const a = avisosDoContrato([]);
    expect(codigos(a)).toEqual(['sem_uc']);
    expect(a[0].gravidade).toBe('bloqueia');
    expect(a[0].mensagem).toMatch(/20%/);
    expect(a[0].mensagem).toMatch(/Unidades Consumidoras/);
    expect(contratoBloqueado(a)).toBe(true);
  });

  test('so UC encerrada conta como sem UC', () => {
    expect(codigos(avisosDoContrato([uc({ status: 'cancelado' })]))).toEqual(['sem_uc']);
  });

  test('uma UC com plano e concessionaria: nenhum aviso', () => {
    const a = avisosDoContrato([uc()]);
    expect(a).toEqual([]);
    expect(contratoBloqueado(a)).toBe(false);
  });

  test('UC sem desconto e sem plano: bloqueia, porque o termo sairia com 20% que ninguem escolheu', () => {
    const a = avisosDoContrato([uc({ planos_assinatura_energia: null, plano_assinatura_id: null })]);
    expect(codigos(a)).toContain('sem_desconto');
    expect(a.find((x) => x.codigo === 'sem_desconto').gravidade).toBe('bloqueia');
    expect(a.find((x) => x.codigo === 'sem_desconto').mensagem).toContain('7001');
    expect(contratoBloqueado(a)).toBe(true);
  });

  test('UCs com descontos diferentes: avisa sem bloquear e diz qual UC define o termo', () => {
    const a = avisosDoContrato([
      uc({ id: 'a', numero_uc: '7001', created_at: '2026-01-01T00:00:00Z' }),
      uc({ id: 'b', numero_uc: '7002', created_at: '2026-02-01T00:00:00Z', desconto_assinante: 20, planos_assinatura_energia: { desconto_assinante: 20 } }),
    ]);
    const d = a.find((x) => x.codigo === 'descontos_diferentes');
    expect(d).toBeTruthy();
    expect(d.gravidade).toBe('atencao');
    expect(d.mensagem).toContain('7001');
    expect(d.mensagem).toContain('15%');
    expect(d.mensagem).toContain('20%');
    expect(contratoBloqueado(a)).toBe(false);
  });

  test('UCs com o MESMO desconto, mesmo de planos diferentes: sem aviso', () => {
    const a = avisosDoContrato([
      uc({ id: 'a' }),
      uc({ id: 'b', numero_uc: '7002', created_at: '2026-02-01T00:00:00Z', planos_assinatura_energia: { id: 'p2', nome: 'Outro', desconto_assinante: '15.00' } }),
    ]);
    expect(codigos(a)).not.toContain('descontos_diferentes');
  });

  test('UC encerrada com desconto diferente nao gera aviso de divergencia', () => {
    const a = avisosDoContrato([uc({ id: 'a' }), uc({ id: 'velha', status: 'cancelado', desconto_assinante: 30 })]);
    expect(a).toEqual([]);
  });

  test('UC sem concessionaria: avisa que o termo sai com "sua distribuidora local", sem bloquear', () => {
    const a = avisosDoContrato([uc({ concessionaria: null })]);
    expect(codigos(a)).toEqual(['sem_concessionaria']);
    expect(a[0].gravidade).toBe('atencao');
    expect(a[0].mensagem).toMatch(/distribuidora/);
    expect(contratoBloqueado(a)).toBe(false);
  });

  test('concessionaria so com espacos tambem conta como ausente', () => {
    expect(codigos(avisosDoContrato([uc({ concessionaria: '   ' })]))).toEqual(['sem_concessionaria']);
  });

  test('bloqueios vem antes dos avisos na lista', () => {
    const a = avisosDoContrato([uc({ concessionaria: null, planos_assinatura_energia: null })]);
    expect(a[0].gravidade).toBe('bloqueia');
    expect(a[a.length - 1].gravidade).toBe('atencao');
  });

  test('entrada invalida nao explode', () => {
    expect(codigos(avisosDoContrato(null))).toEqual(['sem_uc']);
    expect(codigos(avisosDoContrato(undefined))).toEqual(['sem_uc']);
  });
});

describe('contratoBloqueado', () => {
  test('so bloqueia com aviso de gravidade "bloqueia"', () => {
    expect(contratoBloqueado([{ gravidade: 'atencao' }])).toBe(false);
    expect(contratoBloqueado([{ gravidade: 'atencao' }, { gravidade: 'bloqueia' }])).toBe(true);
    expect(contratoBloqueado([])).toBe(false);
    expect(contratoBloqueado(null)).toBe(false);
  });
});

describe('avisosDoContrato: UC e plano discordam (o caso MULTI TV: UC 20%, plano Ultra Connect 15%)', () => {
  const divergente = () => uc({ numero_uc: '000000000', desconto_assinante: '20', planos_assinatura_energia: { id: 'p', nome: 'Plano Ultra Connect', desconto_assinante: '15.00' } });

  test('bloqueia e diz os dois numeros, o plano e qual o termo vai usar', () => {
    const a = avisosDoContrato([divergente()]);
    const d = a.find((x) => x.codigo === 'desconto_diverge_plano');
    expect(d).toBeTruthy();
    expect(d.gravidade).toBe('bloqueia');
    expect(d.mensagem).toContain('000000000');
    expect(d.mensagem).toContain('20%');
    expect(d.mensagem).toContain('15%');
    expect(d.mensagem).toContain('Plano Ultra Connect');
    expect(contratoBloqueado(a)).toBe(true);
  });

  test('desconto da UC igual ao do plano, mesmo em formatos diferentes: sem aviso', () => {
    expect(avisosDoContrato([uc({ desconto_assinante: 15 })])).toEqual([]);
    expect(avisosDoContrato([uc({ desconto_assinante: '15.00' })])).toEqual([]);
    expect(avisosDoContrato([uc({ desconto_assinante: '15,0' })])).toEqual([]);
  });

  test('desconto 0 ou vazio na UC nao e divergencia: o termo ja usa o plano', () => {
    expect(avisosDoContrato([uc({ desconto_assinante: 0 })])).toEqual([]);
    expect(avisosDoContrato([uc({ desconto_assinante: null })])).toEqual([]);
  });

  test('UC sem plano nao tem com o que divergir', () => {
    expect(avisosDoContrato([uc({ desconto_assinante: 20, planos_assinatura_energia: null })])).toEqual([]);
  });

  test('UC encerrada divergente nao trava o contrato', () => {
    expect(avisosDoContrato([uc({ id: 'a' }), { ...divergente(), id: 'velha', status: 'cancelado' }])).toEqual([]);
  });

  test('com varias UCs, lista cada uma que diverge', () => {
    const a = avisosDoContrato([divergente(), { ...divergente(), id: 'b', numero_uc: '555', created_at: '2026-03-01T00:00:00Z' }]);
    const d = a.find((x) => x.codigo === 'desconto_diverge_plano');
    expect(d.mensagem).toContain('000000000');
    expect(d.mensagem).toContain('555');
  });
});

describe('avisosDoContrato com o assinante: CNPJ sem representante legal', () => {
  const cnpj = (o = {}) => ({ cpf_cnpj: '02.052.700/0001-55', representante_nome: null, representante_cpf: null, ...o });

  test('CNPJ sem representante bloqueia: o termo qualificaria a empresa como pessoa fisica', () => {
    const a = avisosDoContrato([uc()], cnpj());
    const r = a.find((x) => x.codigo === 'sem_representante');
    expect(r).toBeTruthy();
    expect(r.gravidade).toBe('bloqueia');
    expect(r.mensagem).toMatch(/representante legal/i);
    expect(contratoBloqueado(a)).toBe(true);
  });

  test('CNPJ com nome mas sem CPF so avisa: o envio segue liberado (o CPF dos socios a Receita oculta)', () => {
    const a = avisosDoContrato([uc()], cnpj({ representante_nome: 'Maria da Silva' }));
    const r = a.find((x) => x.codigo === 'representante_sem_cpf');
    expect(r).toBeTruthy();
    expect(r.gravidade).toBe('atencao');
    expect(a.map((x) => x.codigo)).not.toContain('sem_representante');
    expect(contratoBloqueado(a)).toBe(false);
  });

  test('CNPJ com nome e CPF: sem aviso', () => {
    expect(avisosDoContrato([uc()], cnpj({ representante_nome: 'Maria da Silva', representante_cpf: '11144477735' }))).toEqual([]);
  });

  test('pessoa fisica nao precisa de representante', () => {
    expect(avisosDoContrato([uc()], { cpf_cnpj: '529.982.247-25' })).toEqual([]);
  });

  test('sem informar o assinante, o comportamento anterior continua (so UCs)', () => {
    expect(avisosDoContrato([uc()])).toEqual([]);
  });

  test('o bloqueio do representante aparece junto com os das UCs, bloqueios primeiro', () => {
    const a = avisosDoContrato([], cnpj());
    expect(a.map((x) => x.codigo).sort()).toEqual(['sem_representante', 'sem_uc']);
    expect(a.every((x) => x.gravidade === 'bloqueia')).toBe(true);
  });
});

describe('avisosDoContrato: o aviso diz exatamente o que falta do representante', () => {
  const cnpj = (o = {}) => ({ cpf_cnpj: '02.052.700/0001-55', representante_nome: null, representante_cpf: null, ...o });
  const msg = (a) => a.find((x) => x.codigo === 'sem_representante')?.mensagem;

  test('so o nome (o caso da busca na Receita): avisa que o termo sai sem CPF e explica que a Receita o oculta', () => {
    const a = avisosDoContrato([uc()], cnpj({ representante_nome: 'Juanribe Pagliarin' }));
    const m = a.find((x) => x.codigo === 'representante_sem_cpf')?.mensagem;
    expect(m).toContain('Juanribe Pagliarin');
    expect(m).toMatch(/sem CPF/i);
    expect(m).toMatch(/sai sem o CPF|sairá sem o CPF/i);
    expect(m).toMatch(/Receita/i);
  });

  test('so o CPF: pede o nome', () => {
    expect(msg(avisosDoContrato([uc()], cnpj({ representante_cpf: '11144477735' })))).toMatch(/sem nome/i);
  });

  test('nenhum dos dois: a mensagem geral', () => {
    expect(msg(avisosDoContrato([uc()], cnpj()))).toMatch(/não tem representante legal/i);
  });

  test('bloqueia o envio sem representante ou sem NOME; sem CPF so avisa', () => {
    expect(contratoBloqueado(avisosDoContrato([uc()], cnpj()))).toBe(true);
    expect(contratoBloqueado(avisosDoContrato([uc()], cnpj({ representante_cpf: '11144477735' })))).toBe(true);
    expect(contratoBloqueado(avisosDoContrato([uc()], cnpj({ representante_nome: 'Juanribe Pagliarin' })))).toBe(false);
  });
});
