import React from 'react';
import { CheckCircle2, AlertCircle, Loader2, BatteryCharging, Plug, Square, RotateCcw, Undo2 } from 'lucide-react';

const brl = (n) => `R$ ${Number(n).toFixed(2).replace('.', ',')}`;
const kwhTxt = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} kWh`;

const Linha = ({ rotulo, valor, testid }) => (
  <div className="flex justify-between items-center text-sm pb-2 border-b border-slate-200 last:border-0 last:pb-0">
    <span className="text-slate-500">{rotulo}</span>
    <span className="font-semibold text-slate-900" data-testid={testid}>{valor}</span>
  </div>
);

const Cabecalho = ({ icone, titulo, texto, tom = 'emerald' }) => (
  <div className={`p-6 text-white text-center bg-gradient-to-br ${tom === 'red' ? 'from-slate-600 to-slate-800' : 'from-emerald-600 to-teal-700'}`}>
    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">{icone}</div>
    <h1 className="text-2xl font-bold tracking-tight" data-testid="recarga-titulo">{titulo}</h1>
    {texto && <p className="text-emerald-50 text-sm mt-1">{texto}</p>}
  </div>
);

/**
 * Tela da recarga depois do pagamento (spec OCPP §5.4). Só apresentação: os dados
 * vêm de fn_recarga_publica (sem dados pessoais) e as ações de quem a usa.
 *
 * recarga: { status, kwh_consumido, valor, valor_final, valor_estornado,
 *            conector_numero, nome_posto, tarifa_kwh_aplicada }
 */
export default function AcompanhamentoRecarga({ recarga, onParar, parando = false, erro = null, onNova }) {
  const status = recarga?.status;
  const conector = recarga?.conector_numero;

  const alerta = erro && (
    <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl flex items-start gap-2" role="alert">
      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <span>{erro}</span>
    </div>
  );

  const novaRecarga = onNova && (
    <button
      type="button"
      onClick={onNova}
      className="w-full py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
    >
      <RotateCcw className="w-4 h-4" />
      <span>Realizar Nova Recarga</span>
    </button>
  );

  const moldura = (cab, corpo) => (
    <div className="bg-white rounded-2xl shadow-sm border border-emerald-200 overflow-hidden" data-testid="success-screen" data-status={status || 'aguardando'}>
      {cab}
      <div className="p-6 space-y-5">{corpo}</div>
    </div>
  );

  // Pagamento ainda não confirmado pelo servidor (cartão aceito no navegador, webhook pendente)
  if (!recarga || status === 'pending_payment') {
    return moldura(
      <Cabecalho icone={<Loader2 className="w-10 h-10 animate-spin" />} titulo="Confirmando pagamento..." />,
      alerta,
    );
  }

  if (status === 'charging') {
    const tarifa = Number(recarga.tarifa_kwh_aplicada);
    const kwh = Number(recarga.kwh_consumido || 0);
    // Sem tarifa na recarga não se inventa preço: mostra "R$ --".
    const reais = tarifa > 0 ? brl(kwh * tarifa) : 'R$ --';
    return moldura(
      <Cabecalho icone={<BatteryCharging className="w-10 h-10" />} titulo="Carregando" texto={`Conector ${conector} liberando energia para o seu veículo.`} />,
      <>
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
          <Linha rotulo="Energia" valor={kwhTxt(kwh)} testid="kwh-consumido" />
          <Linha rotulo="Valor até agora" valor={reais} testid="valor-parcial" />
          <Linha rotulo="Estação" valor={recarga.nome_posto || 'Eletroposto B2W'} />
        </div>
        {alerta}
        {onParar ? (
        <button
          type="button"
          onClick={onParar}
          disabled={parando}
          data-testid="parar-recarga"
          className="w-full py-3.5 px-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
        >
          {parando ? (
            <><Loader2 className="w-4 h-4 animate-spin" /><span>Parando...</span></>
          ) : (
            <><Square className="w-4 h-4 fill-current" /><span>Parar recarga</span></>
          )}
        </button>
        ) : (
          <p className="text-xs text-slate-500 text-center">Para parar a recarga por aqui, entre na conta usada no pagamento ou use o botão do totem.</p>
        )}
        <p className="text-xs text-slate-500 text-center">O valor pago que não for usado é estornado ao terminar.</p>
      </>,
    );
  }

  if (status === 'completed') {
    const estornado = Number(recarga.valor_estornado || 0);
    return moldura(
      <Cabecalho icone={<CheckCircle2 className="w-10 h-10 stroke-[2.5]" />} titulo="Recarga concluída" texto={recarga.nome_posto} />,
      <>
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
          <Linha rotulo="Energia consumida" valor={kwhTxt(recarga.kwh_consumido)} testid="kwh-consumido" />
          <Linha rotulo="Valor pago" valor={brl(recarga.valor)} />
          <Linha rotulo="Valor da recarga" valor={brl(recarga.valor_final ?? recarga.valor)} testid="valor-final" />
          {estornado > 0 && <Linha rotulo="Valor estornado" valor={brl(estornado)} testid="valor-estornado" />}
        </div>
        {estornado > 0 && (
          <p className="text-xs text-slate-500 text-center">O estorno volta para o cartão usado no pagamento.</p>
        )}
        {novaRecarga}
      </>,
    );
  }

  if (status === 'failed' || status === 'canceled') {
    return moldura(
      <Cabecalho tom="red" icone={<Undo2 className="w-10 h-10" />} titulo="Recarga não realizada" />,
      <>
        <p className="text-sm text-slate-700 text-center" data-testid="estorno-total">
          O valor de {brl(recarga.valor)} será estornado integralmente para o seu cartão.
        </p>
        {novaRecarga}
      </>,
    );
  }

  if (status !== 'paid' && status !== 'starting') {
    // status que a tela não conhece: neutro, sem afirmar sucesso nem estorno
    return moldura(
      <Cabecalho icone={<Loader2 className="w-10 h-10 animate-spin" />} titulo="Atualizando..." />,
      alerta,
    );
  }

  // paid | starting: o servidor já confirmou o pagamento
  return moldura(
    <Cabecalho icone={<Plug className="w-10 h-10" />} titulo="Conecte o cabo ao veículo" texto="Pagamento confirmado. O conector está liberado!" />,
    <>
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
        <Linha rotulo="Estação" valor={recarga.nome_posto || 'Eletroposto B2W'} />
        <Linha rotulo="Conector liberado" valor={`Conector ${conector}`} />
        <Linha rotulo="Valor pago" valor={brl(recarga.valor)} />
      </div>
      <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-xl p-4">
        Retire o plugue do <strong>Conector {conector}</strong> e encaixe firmemente no veículo. A energia começa a fluir sozinha em instantes.
      </p>
      {alerta}
    </>,
  );
}
