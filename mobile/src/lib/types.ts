export type Perfil = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  subscriber: { id: string; name: string; status: string; short_url: string | null } | null;
  supplier: { id: string; name: string } | null;
  originator: boolean;
};

export type UcResumo = {
  id: string;
  numero_uc: string;
  status: string;
  address: Record<string, string> | null;
  concessionaria: string | null;
  desconto_assinante: number | null;
  dia_vencimento: number | null;
  consumo_kwh: number | null;
  valor_concessionaria: number | null;
  economia_reais: number | null;
  valor_a_pagar: number | null;
  mes_referencia: string | null;
};

export type Fatura = {
  id: string;
  mes_referencia: string | null;
  vencimento: string | null;
  status: string;
  consumo_kwh: number | null;
  consumo_compensado: number | null;
  energia_injetada: number | null;
  valor_concessionaria: number | null;
  economia_reais: number | null;
  valor_a_pagar: number | null;
  desconto_aplicado: number | null;
  asaas_boleto_url: string | null;
  asaas_pdf_storage_url: string | null;
  linha_digitavel: string | null;
  pix_string: string | null;
};

export type UcDetalhe = {
  uc: UcResumo & { tipo_ligacao?: string | null; modalidade?: string | null };
  faturas: Fatura[];
};

export type UsinaResumo = {
  id: string;
  name: string;
  address: Record<string, string> | null;
  status: string;
  potencia_kwp: number | null;
  valor_investido: number | null;
  geracao_estimada_kwh: number | null;
  geracao_mes_kwh: number | null;
  receita_mes: number | null;
  mes_referencia: string | null;
};

export type Producao = {
  id: string;
  mes_referencia: string | null;
  geracao_mensal_kwh: number | null;
  geracao_prevista: number | null;
  faturamento_mensal: number | null;
  total_despesas: number | null;
  saldo_receber: number | null;
  status: string | null;
  repasse_status: string | null;
};

export type UsinaDetalhe = {
  usina: UsinaResumo & {
    fabricante_inversor?: string | null;
    potencia_inversor_w?: number | null;
    qtd_modulos?: number | null;
    concessionaria?: string | null;
  };
  producao: Producao[];
};

export type Indicado = {
  subscriber_id: string;
  name: string;
  status: string;
  numero_uc: string | null;
  cidade: string | null;
  uf: string | null;
  consumo_kwh: number | null;
  cashback: number | null;
  fatura_status: string | null;
  fatura_vencimento: string | null;
};

export type MeuEletroposto = {
  id: string;
  nome: string;
  endereco: Record<string, string> | null;
  status: string;
  potencia_kw: number | null;
  qtd_carregadores: number | null;
  percentual: number | null;
  kwh_mes: number | null;
  receita_mes: number | null;
};

export type EletropostoPublico = {
  id: string;
  nome: string;
  endereco: Record<string, string> | null;
  status: string;
  potencia_kw: number | null;
  qtd_carregadores: number | null;
  tarifa_kwh: number | null;
};

export type Recarga = {
  id: string;
  eletroposto_id: string | null;
  eletroposto_nome: string | null;
  valor: number | null;
  kwh_estimado: number | null;
  status: string;
  created_at: string;
};
