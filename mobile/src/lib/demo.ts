// Modo demonstracao (EXPO_PUBLIC_DEMO=1): app inteiro com os dados de exemplo
// das telas do Stitch, sem login nem banco. Serve para revisar layout e para
// demo comercial. Nunca ligar em build de loja.
import type { Fatura, Indicado, MeuEletroposto, Perfil, Producao, UcResumo, UsinaResumo } from './types';

export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';

const SUB = '11111111-1111-4111-8111-111111111111';
const end = (rua: string, numero: string, bairro: string, cidade: string, uf: string) => ({ rua, numero, bairro, cidade, uf });

const perfil: Perfil = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Ana Beatriz Moura',
  email: 'ana@exemplo.com.br',
  role: 'subscriber',
  subscriber: { id: SUB, name: 'Ana Beatriz Moura', status: 'ativo', short_url: 'https://b2w.link/ana' },
  supplier: { id: '22222222-2222-4222-8222-222222222222', name: 'Ana Beatriz Moura' },
  originator: false,
};

const ucBase = (id: string, numero: string, address: Record<string, string>, consumo: number, valor: number, economia: number): UcResumo => ({
  id, numero_uc: numero, status: 'ativo', address, concessionaria: 'ENEL SP', desconto_assinante: 22.8, dia_vencimento: 15,
  consumo_kwh: consumo, valor_concessionaria: valor, economia_reais: economia, valor_a_pagar: valor - economia, mes_referencia: '2025-03-01',
});

const ucs: UcResumo[] = [
  ucBase('a1', '704.819.2043', end('Av. Paulista', '1842', 'Bela Vista', 'São Paulo', 'SP'), 1845, 1648, 375),
  ucBase('a2', '512.940.1832', end('Rua das Palmeiras', '340', 'Lourdes', 'Belo Horizonte', 'MG'), 850, 760, 173),
  ucBase('a3', '839.102.5741', end('Av. das Américas', '4200', 'Barra', 'Rio de Janeiro', 'RJ'), 2100, 1876, 427),
];

const meses = ['2024-10-01', '2024-11-01', '2024-12-01', '2025-01-01', '2025-02-01', '2025-03-01'];
const faturas: Fatura[] = meses.map((m, i) => ({
  id: `f${i}`, mes_referencia: m, vencimento: m.replace(/-01$/, '-15'), status: i === meses.length - 1 ? 'a_vencer' : 'pago',
  consumo_kwh: [1720, 1810, 2010, 2150, 2014, 1845][i]!, consumo_compensado: [1300, 1390, 1560, 1640, 1530, 1420][i]!,
  energia_injetada: null, valor_concessionaria: [1530, 1610, 1790, 1910, 1790, 1648][i]!, economia_reais: [349, 367, 408, 435, 408, 375][i]!,
  valor_a_pagar: [1181, 1243, 1382, 1475, 1382, 1273][i]!, desconto_aplicado: 22.8,
  asaas_boleto_url: 'https://b2wenergia.com.br', asaas_pdf_storage_url: null,
  linha_digitavel: '34191.79001 01043.510047 91020.150008 8 10270000127300', pix_string: '00020126580014br.gov.bcb.pix0136b2w-demo',
})).reverse();

const usinas: UsinaResumo[] = [
  { id: 'u1', name: 'UFV - São Thomé', address: end('BR-304', 'Km 115', '', 'Mossoró', 'RN'), status: 'gerando', potencia_kwp: 75, valor_investido: 330000, geracao_estimada_kwh: 14375, geracao_mes_kwh: 14145, receita_mes: 7072.5, mes_referencia: '2025-03-01' },
  { id: 'u2', name: 'UFV - Alfa Solar', address: end('BR-101', 'Km 82', '', 'Parnamirim', 'RN'), status: 'gerando', potencia_kwp: 78, valor_investido: 345000, geracao_estimada_kwh: 14955, geracao_mes_kwh: 14820, receita_mes: 7410, mes_referencia: '2025-03-01' },
  { id: 'u3', name: 'UFV - Serra Dourada', address: end('RN-118', 'Km 45', '', 'Caicó', 'RN'), status: 'gerando', potencia_kwp: 72, valor_investido: 320000, geracao_estimada_kwh: 14090, geracao_mes_kwh: 13780, receita_mes: 6890, mes_referencia: '2025-03-01' },
];

const geracao = [12100, 12900, 13400, 13950, 14300, 14600, 14010, 13200, 12800, 13500, 13900, 14145];
const producao: Producao[] = geracao.map((g, i) => {
  const d = new Date(Date.UTC(2024, 3 + i, 1)).toISOString().slice(0, 10);
  return { id: `p${i}`, mes_referencia: d, geracao_mensal_kwh: g, geracao_prevista: 13630, faturamento_mensal: g * 0.55, total_despesas: g * 0.05, saldo_receber: g * 0.5, status: 'liquidado', repasse_status: i === geracao.length - 1 ? 'em_processamento' : 'pago' };
}).reverse();

const rede: Indicado[] = [
  { subscriber_id: 'r1', name: 'Mariana Silveira', status: 'ativo', numero_uc: '704.819.2043', cidade: 'São Paulo', uf: 'SP', consumo_kwh: 1420, cashback: 42.6, fatura_status: 'pago', fatura_vencimento: null },
  { subscriber_id: 'r2', name: 'Carlos Eduardo Mendes', status: 'ativo', numero_uc: '512.940.1832', cidade: 'Belo Horizonte', uf: 'MG', consumo_kwh: 850, cashback: 25.5, fatura_status: 'pago', fatura_vencimento: null },
  { subscriber_id: 'r3', name: 'Fernanda Rocha', status: 'ativo', numero_uc: '839.102.5741', cidade: 'Rio de Janeiro', uf: 'RJ', consumo_kwh: 2100, cashback: 63, fatura_status: 'a_vencer', fatura_vencimento: null },
  { subscriber_id: 'r4', name: 'Lucas Martins', status: 'contrato_assinado', numero_uc: '320.481.9056', cidade: 'Santos', uf: 'SP', consumo_kwh: null, cashback: 0, fatura_status: null, fatura_vencimento: null },
  { subscriber_id: 'r5', name: 'Roberto Almeida', status: 'ativo', numero_uc: '641.728.3190', cidade: 'Curitiba', uf: 'PR', consumo_kwh: 680, cashback: 20.4, fatura_status: 'pago', fatura_vencimento: null },
  { subscriber_id: 'r6', name: 'Juliana Costa', status: 'ativo', numero_uc: '915.204.6827', cidade: 'Belo Horizonte', uf: 'MG', consumo_kwh: 1120, cashback: 33.5, fatura_status: 'atrasado', fatura_vencimento: '2025-10-12' },
];

const meusPostos: MeuEletroposto[] = [
  { id: 'e1', nome: 'Hub Jardins · B2W Fast Charge', endereco: end('Av. Brigadeiro Luís Antônio', '3200', 'Jardins', 'São Paulo', 'SP'), status: 'operando', potencia_kw: 150, qtd_carregadores: 6, percentual: 13.3, kwh_mes: 12450, receita_mes: 13800 },
];

export const demoRpc = (fn: string, args?: Record<string, unknown>): unknown => {
  switch (fn) {
    case 'app_perfil': return perfil;
    case 'app_minhas_ucs': return ucs;
    case 'app_uc_detalhe': {
      const uc = ucs.find((u) => u.id === args?.p_uc);
      return uc ? { uc, faturas } : null;
    }
    case 'app_minhas_usinas': return usinas;
    case 'app_usina_detalhe': {
      const u = usinas.find((x) => x.id === args?.p_usina);
      return u ? { usina: { ...u, fabricante_inversor: 'Sungrow 75K' }, producao } : null;
    }
    case 'app_minha_rede': return rede;
    case 'app_meus_eletropostos': return meusPostos;
    case 'app_eletropostos_publicos': return [
      { id: '3f2b9c1e-8a4d-4e2f-9b1a-0c5d6e7f8a9b', nome: 'Eletroposto B2W Hub Jardins', endereco: end('Av. Brigadeiro Luís Antônio', '3200', 'Jardins', 'São Paulo', 'SP'), status: 'operando', potencia_kw: 150, qtd_carregadores: 6, tarifa_kwh: 1.89 },
      { id: '4a2b9c1e-8a4d-4e2f-9b1a-0c5d6e7f8a9b', nome: 'B2W Faria Lima', endereco: end('Av. Brig. Faria Lima', '1500', 'Pinheiros', 'São Paulo', 'SP'), status: 'operando', potencia_kw: 60, qtd_carregadores: 2, tarifa_kwh: 1.79 },
    ];
    case 'app_minhas_recargas': return [
      { id: 'c1', eletroposto_id: null, eletroposto_nome: 'Hub Jardins', valor: 50, kwh_estimado: 26.4, status: 'paid', created_at: '2025-03-28T14:00:00Z' },
    ];
    default: return null;
  }
};
