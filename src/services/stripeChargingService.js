import { supabase } from '../lib/supabase';
import { loadStripe } from '@stripe/stripe-js';

// Chave publicável de teste (derivada da conta de teste fornecida)
const STRIPE_PK = import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY || 
  'pk_test_51ULXLW2dv45q6qDT3mB097hP1U8w5VvLzJ1eF3K8q0X9r7S4m2n1p8o7i6u5y4t3r2e1w0q9a8s7d6f5g4h3j2k1l';

let stripePromise = null;

export const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(STRIPE_PK);
  }
  return stripePromise;
};

// anon não lê eletropostos nem planos (RLS). Estas RPCs (SECURITY DEFINER)
// devolvem só dados não pessoais de postos em operação, com a tarifa do plano.
export const fetchEletroposto = async (id) => {
  if (!id) return null;
  const { data, error } = await supabase.rpc('fn_eletroposto_publico', { p_id: id });

  if (error) {
    console.error('Erro ao buscar eletroposto:', error);
    return null;
  }
  return data?.[0] ?? null;
};

export const listEletropostos = async () => {
  const { data, error } = await supabase.rpc('fn_eletropostos_publicos');

  if (error) {
    console.error('Erro ao listar eletropostos:', error);
    return [];
  }
  return data || [];
};

// Preço ao motorista = tarifa do plano do posto. Sem tarifa: null (a tela mostra
// "Recarga indisponível"); nunca um valor padrão, preço divergente afasta motorista.
export const tarifaDoPosto = (posto) => {
  const t = Number(posto?.tarifa_motorista_kwh);
  return t > 0 ? t : null;
};

export const createChargingCheckoutSession = async ({
  eletroposto_id,
  conector_numero = 1,
  valor,
  motorista = {}
}) => {
  const { data, error } = await supabase.functions.invoke('create-charging-checkout', {
    body: {
      eletroposto_id,
      conector_numero,
      valor,
      motorista
    }
  });

  if (error) {
    // Recusas do servidor (conector em uso, sem tarifa...) vêm com motivo legível no corpo.
    const corpo = await error.context?.json?.().catch(() => null);
    throw new Error(corpo?.error || error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'Falha ao iniciar pagamento de recarga.');

  return data;
};

// Status em que a recarga não muda mais (spec OCPP §4.8).
export const STATUS_TERMINAIS = ['completed', 'failed', 'canceled'];

// Status da recarga em que o pagamento já foi confirmado pelo webhook.
const RECARGA_PAGA = ['paid', 'starting', 'charging', 'completed'];

export const statusPagamentoDaRecarga = (status) =>
  RECARGA_PAGA.includes(status) ? 'paid' : null;

// Andamento da recarga sem dados pessoais. anon não lê a tabela
// recargas_eletroposto (RLS), só esta RPC.
export const buscarRecargaPublica = async (recargaId) => {
  if (!recargaId) return null;
  const { data, error } = await supabase.rpc('fn_recarga_publica', { p_recarga_id: recargaId });

  if (error) {
    console.error('Erro ao consultar andamento da recarga:', error);
    return null;
  }
  return data?.[0] ?? null;
};

// Polling de 3 s (e não Realtime postgres_changes: com a RLS fechada o
// Realtime não entrega nada para anon, e um canal de broadcast exigiria que
// toda escrita na recarga também publicasse no canal). Para sozinho em status
// terminal; a função devolvida para antes disso.
export const acompanharRecarga = (recargaId, onDados, { intervaloMs = 3000 } = {}) => {
  let ativo = true;
  let timer = null;

  const consultar = async () => {
    const dados = await buscarRecargaPublica(recargaId);
    if (!ativo) return;
    if (dados) onDados(dados);
    if (dados && STATUS_TERMINAIS.includes(dados.status)) return;
    timer = setTimeout(consultar, intervaloMs);
  };

  consultar();

  return () => {
    ativo = false;
    clearTimeout(timer);
  };
};
