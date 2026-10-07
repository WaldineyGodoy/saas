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

export const fetchEletroposto = async (id) => {
  if (!id) return null;
  const { data, error } = await supabase
    .from('eletropostos')
    .select('id, nome, endereco, tarifa_investidor_kwh, potencia_kw, tipo_recarga, qtd_carregadores')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Erro ao buscar eletroposto:', error);
    return null;
  }
  return data;
};

export const listEletropostos = async () => {
  const { data, error } = await supabase
    .from('eletropostos')
    .select('id, nome, endereco, tarifa_investidor_kwh, potencia_kw, status')
    .limit(20);

  if (error) {
    console.error('Erro ao listar eletropostos:', error);
    return [];
  }
  return data || [];
};

export const createChargingCheckoutSession = async ({
  eletroposto_id,
  conector_numero = 1,
  valor,
  motorista = {},
  tipo_usuario = 'avulso',
  user_id = null
}) => {
  const { data, error } = await supabase.functions.invoke('create-charging-checkout', {
    body: {
      eletroposto_id,
      conector_numero,
      valor,
      motorista,
      tipo_usuario,
      user_id
    }
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Falha ao iniciar pagamento de recarga.');

  return data;
};
