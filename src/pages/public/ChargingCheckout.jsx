import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { 
  Zap, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  BatteryCharging, 
  MapPin, 
  User, 
  Mail, 
  Phone, 
  ShieldCheck, 
  ArrowRight, 
  RotateCcw, 
  Info, 
  Gauge, 
  Plug,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getStripe,
  fetchEletroposto,
  listEletropostos,
  createChargingCheckoutSession,
  tarifaDoPosto,
  acompanharRecarga,
  statusPagamentoDaRecarga
} from '../../services/stripeChargingService';

/**
 * Subcomponente interno para formulário Stripe Elements.
 * Deve ser renderizado obrigatoriamente dentro de um <Elements>.
 */
export function StripePaymentForm({ 
  valor, 
  onPaymentSuccess, 
  onPaymentError 
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
      });

      if (error) {
        setErrorMessage(error.message || 'Erro ao processar pagamento.');
        if (onPaymentError) onPaymentError(error);
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        if (onPaymentSuccess) onPaymentSuccess(paymentIntent);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Erro inesperado na confirmação de pagamento.');
      if (onPaymentError) onPaymentError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" data-testid="stripe-payment-form">
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
        <PaymentElement />
      </div>

      {errorMessage && (
        <div 
          className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl flex items-start gap-2 animate-in fade-in"
          role="alert"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        data-testid="pay-submit-button"
        className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-md transition flex items-center justify-center gap-2 text-base cursor-pointer"
      >
        {submitting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Processando Pagamento...</span>
          </>
        ) : (
          <>
            <Zap className="w-5 h-5 fill-current" />
            <span>Pagar R$ {valor.toFixed(2).replace('.', ',')} e Iniciar Recarga</span>
          </>
        )}
      </button>

      <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
        <ShieldCheck className="w-4 h-4 text-emerald-600" />
        <span>Pagamento seguro e criptografado via Stripe</span>
      </div>
    </form>
  );
}

/**
 * Página principal de Checkout de Recarga Rápida B2W Charge
 */
export default function ChargingCheckout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const urlPostoId = searchParams.get('posto');
  const urlConector = searchParams.get('conector');

  // Estados da Estação
  const [loadingPosto, setLoadingPosto] = useState(true);
  const [postosDisponiveis, setPostosDisponiveis] = useState([]);
  const [selectedPosto, setSelectedPosto] = useState(null);
  const [selectedConector, setSelectedConector] = useState(urlConector ? parseInt(urlConector, 10) : 1);
  const [showPostoSelector, setShowPostoSelector] = useState(false);

  // Estados de Recarga
  const [valor, setValor] = useState(50);
  const [customValorInput, setCustomValorInput] = useState('50');

  // Identificação do Motorista
  const [motoristaNome, setMotoristaNome] = useState('');
  const [motoristaEmail, setMotoristaEmail] = useState('');
  const [motoristaTelefone, setMotoristaTelefone] = useState('');

  // Sessão Stripe e Status
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionData, setSessionData] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('idle'); // 'idle' | 'processing' | 'paid' | 'failed'

  // Carregar dados iniciais de postos ou do posto especificado na URL
  useEffect(() => {
    let isMounted = true;

    async function carregarDados() {
      setLoadingPosto(true);
      try {
        if (urlPostoId) {
          const posto = await fetchEletroposto(urlPostoId);
          if (posto && isMounted) {
            setSelectedPosto(posto);
            setLoadingPosto(false);
            return;
          }
        }

        // Se não houver posto na URL ou se falhou a busca do ID específico
        const lista = await listEletropostos();
        if (isMounted) {
          setPostosDisponiveis(lista);
          // posto da URL (QR do totem) indisponível: não troca por outro em silêncio
          if (lista.length > 0 && !selectedPosto && !urlPostoId) {
            setSelectedPosto(lista[0]);
          }
        }
      } catch (err) {
        console.error('Erro ao carregar eletropostos:', err);
      } finally {
        if (isMounted) setLoadingPosto(false);
      }
    }

    carregarDados();

    return () => {
      isMounted = false;
    };
  }, [urlPostoId]);

  // Atualizar conector se URL mudar
  useEffect(() => {
    if (urlConector) {
      setSelectedConector(parseInt(urlConector, 10) || 1);
    }
  }, [urlConector]);

  // Preencher dados do motorista caso logado
  useEffect(() => {
    if (user) {
      setMotoristaNome(profile?.nome || user?.email?.split('@')[0] || '');
      setMotoristaEmail(user?.email || '');
      setMotoristaTelefone(profile?.telefone || '');
    }
  }, [user, profile]);

  // Acompanha a confirmação do webhook por polling de fn_recarga_publica
  // (anon não lê recargas_eletroposto; ver acompanharRecarga). Para quando
  // o pagamento é confirmado.
  useEffect(() => {
    if (!sessionData?.recargaId || paymentStatus === 'paid') return;

    return acompanharRecarga(sessionData.recargaId, (recarga) => {
      if (statusPagamentoDaRecarga(recarga.status)) setPaymentStatus('paid');
    });
  }, [sessionData?.recargaId, paymentStatus]);

  // Cálculos dinâmicos de energia e autonomia
  // Preço = tarifa do plano do posto, sem valor de reserva (null = indisponível).
  const tarifaKwh = tarifaDoPosto(selectedPosto);
  const postoIndisponivel = !loadingPosto && !tarifaKwh;
  const estimativaKwh = tarifaKwh ? (valor / tarifaKwh).toFixed(1) : '--';
  const estimativaKm = tarifaKwh ? Math.round(Number(estimativaKwh) * 6) : '--'; // Base padrão B2W Charge: ~6 km por kWh

  // Manipulação de valores rápidos
  const handleSelectPreset = (presetValue) => {
    setValor(presetValue);
    setCustomValorInput(presetValue.toString());
  };

  const handleCustomValorChange = (e) => {
    const valStr = e.target.value;
    setCustomValorInput(valStr);
    const parsed = parseFloat(valStr);
    if (!isNaN(parsed) && parsed > 0) {
      setValor(parsed);
    }
  };

  // Iniciar sessão de checkout
  const handleStartCheckout = async (e) => {
    e.preventDefault();
    setSessionError(null);

    if (!tarifaKwh) {
      setSessionError('Recarga indisponível neste posto.');
      return;
    }

    if (valor < 5) {
      setSessionError('O valor mínimo de recarga é de R$ 5,00.');
      return;
    }

    if (!user) {
      if (!motoristaNome.trim()) {
        setSessionError('Por favor, informe seu nome completo.');
        return;
      }
      if (!motoristaEmail.trim() || !motoristaEmail.includes('@')) {
        setSessionError('Por favor, informe um e-mail válido para receber o comprovante.');
        return;
      }
    }

    setCreatingSession(true);

    try {
      const payload = {
        eletroposto_id: selectedPosto?.id || null,
        conector_numero: selectedConector,
        valor,
        motorista: {
          nome: user ? (profile?.nome || user?.email) : motoristaNome.trim(),
          email: user ? user?.email : motoristaEmail.trim(),
          telefone: user ? (profile?.telefone || '') : motoristaTelefone.trim()
        }
      };

      const res = await createChargingCheckoutSession(payload);
      setSessionData(res);
    } catch (err) {
      console.error('Erro ao criar sessão de recarga:', err);
      setSessionError(err?.message || 'Falha ao iniciar pagamento. Verifique os dados e tente novamente.');
    } finally {
      setCreatingSession(false);
    }
  };

  // Resetar para nova recarga
  const handleNovaRecarga = () => {
    setSessionData(null);
    setPaymentStatus('idle');
    setSessionError(null);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-inter text-slate-800">
      {/* Top Header */}
      <header className="bg-slate-900 text-white shadow-md">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-lg text-white">B2W <span className="text-emerald-400">Charge</span></span>
              <span className="block text-[11px] text-slate-400 font-medium">Recarga Ultrarrápida de Veículos Elétricos</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 border border-emerald-700/50 text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Online
          </span>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* TELA DE SUCESSO */}
        {paymentStatus === 'paid' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200" data-testid="success-screen">
            <div className="bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
                <CheckCircle2 className="w-10 h-10 text-white stroke-[2.5]" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Recarga Autorizada!</h1>
              <p className="text-emerald-100 text-sm mt-1">
                Seu pagamento foi confirmado com sucesso. O conector está liberado!
              </p>
            </div>

            <div className="p-6 space-y-6">
              {/* Resumo da Recarga */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                <div className="flex justify-between items-center text-sm pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Estação</span>
                  <span className="font-semibold text-slate-800">{selectedPosto?.nome || sessionData?.nome_posto || 'Eletroposto B2W'}</span>
                </div>
                <div className="flex justify-between items-center text-sm pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Conector Liberado</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    <Plug className="w-3.5 h-3.5" />
                    Conector {selectedConector}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Valor Pago</span>
                  <span className="font-bold text-slate-900 text-base">R$ {valor.toFixed(2).replace('.', ',')}</span>
                </div>
                <div className="flex justify-between items-center text-sm pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Energia Estimada</span>
                  <span className="font-semibold text-emerald-600">~{estimativaKwh} kWh</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">Autonomia Prevista</span>
                  <span className="font-semibold text-slate-800">~{estimativaKm} km</span>
                </div>
                {sessionData?.recargaId && (
                  <div className="pt-2 text-[11px] text-slate-400 font-mono text-center">
                    ID da Recarga: {sessionData.recargaId}
                  </div>
                )}
              </div>

              {/* Instruções de Conexão Passo a Passo */}
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4">
                <h3 className="font-semibold text-blue-900 text-sm flex items-center gap-1.5 mb-3">
                  <Info className="w-4 h-4 text-blue-700" />
                  Próximos Passos para Iniciar
                </h3>
                <ol className="space-y-2.5 text-xs text-blue-800 font-medium">
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0 text-[11px] font-bold">1</span>
                    <span>Retire o plugue do <strong>Conector {selectedConector}</strong> e conecte firmemente no bocal do seu veículo elétrico.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0 text-[11px] font-bold">2</span>
                    <span>A trava do conector será acionada e o fluxo de energia iniciará automaticamente em alguns instantes.</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0 text-[11px] font-bold">3</span>
                    <span>Acompanhe o nível de carga e potência pelo display do totem ou painel do carro.</span>
                  </li>
                </ol>
              </div>

              <button
                onClick={handleNovaRecarga}
                className="w-full py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Realizar Nova Recarga</span>
              </button>
            </div>
          </div>
        ) : (
          /* FORMULÁRIO DE SELEÇÃO E CHECKOUT */
          <div className="space-y-6">
            {/* Card do Eletroposto */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4" data-testid="station-card">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Zap className="w-3 h-3 fill-current" />
                      {selectedPosto?.tipo_recarga || 'Carga Rápida DC'}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      {selectedPosto?.potencia_kw ? `${selectedPosto.potencia_kw} kW` : '60 kW'}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                    {loadingPosto ? 'Carregando eletroposto...' : (selectedPosto?.nome || 'Eletroposto B2W')}
                  </h2>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                    <span>{selectedPosto?.endereco || 'Estação Central B2W Charge'}</span>
                  </p>
                </div>

                <div className="text-right flex-shrink-0">
                  <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-bold">Tarifa</span>
                  <span className="text-base font-extrabold text-slate-900">
                    {tarifaKwh ? `R$ ${tarifaKwh.toFixed(2).replace('.', ',')}` : '--'}
                  </span>
                  <span className="text-[10px] text-slate-500 block">por kWh</span>
                </div>
              </div>

              {/* Botão de Trocar Estação se houver mais de uma */}
              {postosDisponiveis.length > 1 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowPostoSelector(!showPostoSelector)}
                    className="text-xs text-emerald-700 hover:text-emerald-800 font-medium underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>{showPostoSelector ? 'Ocultar lista de estações' : 'Trocar estação de recarga'}</span>
                  </button>

                  {showPostoSelector && (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      <span className="text-xs font-semibold text-slate-700">Selecione o Eletroposto:</span>
                      <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
                        {postosDisponiveis.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedPosto(p);
                              setShowPostoSelector(false);
                            }}
                            className={`p-2.5 rounded-lg border text-left text-xs transition cursor-pointer flex justify-between items-center ${
                              selectedPosto?.id === p.id 
                                ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-semibold' 
                                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div>
                              <div className="font-semibold">{p.nome}</div>
                              <div className="text-[11px] text-slate-500">{p.endereco || 'Endereço padrão'}</div>
                            </div>
                            <span className="text-xs font-bold text-slate-800">
                              {tarifaDoPosto(p) ? `R$ ${tarifaDoPosto(p).toFixed(2).replace('.', ',')}/kWh` : 'Indisponível'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Seletor de Conector */}
              <div className="border-t border-slate-100 pt-3">
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Escolha o Conector do Totem:
                </label>
                <div className="grid grid-cols-2 gap-2" data-testid="connector-selector">
                  {Array.from({ length: selectedPosto?.qtd_carregadores || 2 }).map((_, idx) => {
                    const cNum = idx + 1;
                    const isSelected = selectedConector === cNum;
                    return (
                      <button
                        key={cNum}
                        type="button"
                        onClick={() => setSelectedConector(cNum)}
                        className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-semibold transition cursor-pointer ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <Plug className="w-4 h-4" />
                        <span>Conector {cNum}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Seletor de Valor e Estimativas */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4" data-testid="value-selector">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Quanto você deseja recarregar?
              </label>

              {/* Botões Rápidos */}
              <div className="grid grid-cols-3 gap-2">
                {[30, 50, 100].map((preset) => {
                  const isSelected = valor === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`py-3 px-2 rounded-xl border font-bold text-sm transition cursor-pointer ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      R$ {preset},00
                    </button>
                  );
                })}
              </div>

              {/* Input Customizado */}
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Ou digite outro valor (mínimo R$ 5,00):
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    R$
                  </span>
                  <input
                    type="number"
                    min="5"
                    step="1"
                    value={customValorInput}
                    onChange={handleCustomValorChange}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold text-slate-800 text-base"
                    placeholder="Ex: 75"
                  />
                </div>
              </div>

              {/* Card Dinâmico de Estimativa */}
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-1 text-xs text-emerald-900" data-testid="estimate-card">
                <div className="flex items-center gap-1.5 font-bold">
                  <BatteryCharging className="w-4 h-4 text-emerald-600" />
                  <span>R$ {valor.toFixed(2).replace('.', ',')} equivalem a ~{estimativaKwh} kWh</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-700 pl-5.5">
                  <Gauge className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Aproximadamente <strong>{estimativaKm} km</strong> de autonomia para o seu veículo</span>
                </div>
              </div>
            </div>

            {/* Identificação do Motorista */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4" data-testid="driver-identification">
              {user ? (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block">
                        Assinante B2W
                      </span>
                      <span className="font-semibold text-sm text-slate-800">
                        Conectado como {profile?.nome || user?.email}
                      </span>
                    </div>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Seus Dados para o Comprovante
                    </label>
                    <span className="text-[11px] text-slate-400">Recarga Avulsa</span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block text-slate-600 mb-1 font-medium">Nome Completo *</label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          required
                          value={motoristaNome}
                          onChange={(e) => setMotoristaNome(e.target.value)}
                          placeholder="Ex: João da Silva"
                          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium text-slate-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-600 mb-1 font-medium">E-mail para Recibo *</label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          value={motoristaEmail}
                          onChange={(e) => setMotoristaEmail(e.target.value)}
                          placeholder="seu.email@exemplo.com"
                          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium text-slate-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-600 mb-1 font-medium">WhatsApp / Telefone (opcional)</label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="tel"
                          value={motoristaTelefone}
                          onChange={(e) => setMotoristaTelefone(e.target.value)}
                          placeholder="(11) 99999-9999"
                          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium text-slate-800"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Alerta de Erro na Sessão */}
            {sessionError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl flex items-start gap-2" role="alert">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span>{sessionError}</span>
              </div>
            )}

            {/* SEÇÃO DO STRIPE ELEMENTS (se já gerou sessão) */}
            {sessionData?.clientSecret ? (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4 animate-in fade-in" data-testid="stripe-container">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    <span className="font-bold text-sm text-slate-800">Pagamento Seguro</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSessionData(null)}
                    className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Alterar valor</span>
                  </button>
                </div>

                <Elements
                  stripe={getStripe()}
                  options={{
                    clientSecret: sessionData.clientSecret,
                    appearance: {
                      theme: 'stripe',
                      variables: {
                        colorPrimary: '#059669',
                        colorBackground: '#ffffff',
                        colorText: '#1f2937',
                        borderRadius: '12px',
                      }
                    }
                  }}
                >
                  <StripePaymentForm
                    valor={valor}
                    onPaymentSuccess={() => setPaymentStatus('paid')}
                    onPaymentError={(err) => setSessionError(err?.message)}
                  />
                </Elements>
              </div>
            ) : (
              /* BOTÃO PARA AVANÇAR AO PAGAMENTO */
              <>
              {postoIndisponivel && (
                <p className="text-sm font-semibold text-red-600 text-center" data-testid="posto-indisponivel">
                  Recarga indisponível neste posto
                </p>
              )}
              <button
                type="button"
                onClick={handleStartCheckout}
                disabled={creatingSession || loadingPosto || postoIndisponivel}
                data-testid="start-checkout-button"
                className="w-full py-4 px-6 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-2xl shadow-md transition flex items-center justify-center gap-2 text-base cursor-pointer"
              >
                {creatingSession ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Iniciando Checkout Seguro...</span>
                  </>
                ) : (
                  <>
                    <span>Continuar para Pagamento</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
              </>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-xs text-slate-400">
        <p>B2W Energia Solar e Mobilidade Elétrica &copy; {new Date().getFullYear()}</p>
        <p className="mt-1">Dúvidas ou suporte? Entre em contato pelo suporte@b2wenergia.com.br</p>
      </footer>
    </div>
  );
}
