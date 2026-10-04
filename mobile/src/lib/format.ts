const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const fmtBRL = (v: unknown) => {
  const n = num(v);
  return n === null ? '—' : brl.format(n).replace(/ /g, ' ');
};

export const fmtKwh = (v: unknown) => {
  const n = num(v);
  return n === null ? '—' : int.format(n);
};

export const fmtPct = (v: unknown) => {
  const n = num(v);
  return n === null ? '—' : `${pct.format(n)}%`;
};

/** "2025-03-01" -> "03/2025". Datas do banco sao `date`; nao passar por Date
 *  para nao deslocar um dia no fuso de Brasilia. */
export const fmtCiclo = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m] = iso.slice(0, 10).split('-');
  return y && m ? `${m}/${y}` : '—';
};

export const fmtData = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const mesCurto = (iso?: string | null) => {
  if (!iso) return '';
  const m = Number(iso.slice(5, 7));
  return MESES[m - 1] ?? '';
};

/** Variacao percentual de `atual` sobre `anterior`; null se nao da para calcular. */
export const variacao = (atual: unknown, anterior: unknown) => {
  const a = num(atual);
  const b = num(anterior);
  if (a === null || b === null || b === 0) return null;
  return ((a - b) / b) * 100;
};

export const enderecoCurto = (addr: unknown) => {
  if (!addr || typeof addr !== 'object') return '';
  const a = addr as Record<string, string | undefined>;
  const rua = [a.rua ?? a.street ?? a.logradouro, a.numero ?? a.number].filter(Boolean).join(', ');
  const local = [a.bairro ?? a.neighborhood, a.cidade ?? a.city].filter(Boolean).join(', ');
  const uf = a.uf ?? a.state;
  return [rua, [local, uf].filter(Boolean).join(' - ')].filter(Boolean).join(' - ');
};

export const iniciais = (nome?: string | null) =>
  (nome ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export const primeiroNome = (nome?: string | null) => (nome ?? '').trim().split(/\s+/)[0] ?? '';
