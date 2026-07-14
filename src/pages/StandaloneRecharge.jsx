import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Zap, Coins, Check, AlertCircle, Copy } from 'lucide-react';

const PACKAGES = [
    { id: 30, tokens: 30, price: 0, desc: 'Renovação mensal (Plano Free).', isFree: true },
    { id: 50, tokens: 50, price: 49.90, desc: 'Ideal para testes e pequenas demandas.' },
    { id: 100, tokens: 100, price: 89.90, desc: 'Mais popular. Ótimo custo-benefício.' },
    { id: 200, tokens: 200, price: 159.90, desc: 'Para geradores com grande volume.' }
];

export default function StandaloneRecharge() {
    const { profile, user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [selectedPkg, setSelectedPkg] = useState(null);
    const [pixData, setPixData] = useState(null); // { qrCode, pixPayload, invoiceUrl }
    const [alertMsg, setAlertMsg] = useState('');
    const [copied, setCopied] = useState(false);
    const [showIframe, setShowIframe] = useState(false);
    const [multipliers, setMultipliers] = useState({});

    const handleBuy = async (pkg) => {
        setLoading(true);
        setSelectedPkg(pkg.id);
        setAlertMsg('');
        const mult = multipliers[pkg.id] || 1;
        const finalTokens = pkg.tokens * mult;
        const finalPrice = pkg.price * mult;

        try {
            const { data, error } = await supabase.functions.invoke('create-asaas-token-charge', {
                body: { 
                    token_amount: finalTokens, 
                    price: finalPrice, 
                    user_id: user.id 
                }
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error || 'Erro desconhecido ao gerar cobrança.');
            
            setPixData({
                qrCode: data.qrCode,
                pixPayload: data.pixPayload,
                invoiceUrl: data.invoiceUrl,
                paymentId: data.paymentId
            });
        } catch (err) {
            console.error(err);
            setAlertMsg('Erro ao processar compra: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = () => {
        if (pixData?.pixPayload) {
            navigator.clipboard.writeText(pixData.pixPayload);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    useEffect(() => {
        if (!pixData?.paymentId) return;

        const channel = supabase.channel(`payment_status_${pixData.paymentId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'token_transactions',
                    filter: `asaas_payment_id=eq.${pixData.paymentId}`
                },
                (payload) => {
                    if (payload.new.status === 'completed') {
                        setShowIframe(false);
                        setAlertMsg('Pagamento confirmado! Seus tokens foram creditados.');
                        setTimeout(() => {
                            window.location.reload();
                        }, 3000);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [pixData]);

    return (
        <div className="flex-1 overflow-auto bg-gray-50 flex flex-col p-4 md:p-8">
            <div className="max-w-6xl w-full mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Header */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                        <Zap className="w-48 h-48 text-emerald-500 transform rotate-12" />
                    </div>
                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
                                <Coins className="w-8 h-8 text-emerald-500" />
                                Recarga de Tokens
                            </h1>
                            <p className="text-gray-500 mt-2 text-lg">Adquira mais tokens para analisar contas além do seu limite gratuito.</p>
                        </div>
                        <div className="flex items-stretch gap-4 h-[90px]">
                            <div className="bg-emerald-50 border border-emerald-100 px-6 py-4 rounded-xl flex flex-col justify-center items-center min-w-[160px]">
                                <p className="text-sm text-emerald-600 font-bold uppercase tracking-wider mb-1">Seu Saldo</p>
                                <p className="text-3xl font-black text-emerald-700 leading-none">{(profile?.free_tokens || 0) + (profile?.tokens || 0)} <span className="text-base font-medium">tokens</span></p>
                            </div>
                            <button onClick={() => window.location.href = '/analisedeconta'} className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 px-6 py-4 rounded-xl font-bold shadow-sm transition-all flex items-center justify-center h-full whitespace-nowrap">
                                Analisar contas
                            </button>
                        </div>
                    </div>
                </div>

                {alertMsg && (
                    <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <p className="font-medium text-sm">{alertMsg}</p>
                    </div>
                )}

                {/* Pacotes */}
                {!pixData ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {PACKAGES.map((pkg) => (
                            <div key={pkg.id} className={`bg-white rounded-2xl border-2 transition-all duration-300 relative overflow-hidden group hover:-translate-y-1 hover:shadow-xl ${pkg.id === 100 ? 'border-emerald-500 shadow-lg' : 'border-gray-100 hover:border-emerald-300'}`}>
                                {pkg.id === 100 && (
                                    <div className="bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider text-center py-1 absolute top-0 inset-x-0">
                                        Mais Recomendado
                                    </div>
                                )}
                                <div className={`p-8 ${pkg.id === 100 ? 'pt-10' : ''}`}>
                                    <h3 className="text-5xl font-black text-gray-900 flex items-center gap-2">
                                        {pkg.tokens}
                                    </h3>
                                    <p className="text-emerald-600 font-bold mt-1">Tokens de Análise</p>
                                    
                                    <div className="mt-6 mb-6">
                                        <span className="text-3xl font-bold text-gray-900">
                                            R$ {((pkg.price) * (multipliers[pkg.id] || 1)).toFixed(2).replace('.', ',')}
                                        </span>
                                    </div>
                                    
                                    <p className="text-gray-500 mt-2 font-medium min-h-[48px]">{pkg.desc}</p>

                                    {!pkg.isFree && (
                                        <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Quantidade de Pacotes</label>
                                            <select 
                                                value={multipliers[pkg.id] || 1} 
                                                onChange={(e) => setMultipliers({...multipliers, [pkg.id]: parseInt(e.target.value)})}
                                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-emerald-500"
                                            >
                                                <option value="1">1 Pacote ({pkg.tokens} tokens)</option>
                                                <option value="3">3 Pacotes ({pkg.tokens * 3} tokens)</option>
                                                <option value="6">6 Pacotes ({pkg.tokens * 6} tokens)</option>
                                                <option value="12">12 Pacotes ({pkg.tokens * 12} tokens)</option>
                                            </select>
                                            <p className="text-xs text-gray-500 mt-3 italic leading-relaxed">
                                                Ao comprar {multipliers[pkg.id] || 1} pacote(s), você garante {((pkg.tokens) * (multipliers[pkg.id] || 1)) / 10} análises, o que cobre por exemplo a leitura de 5 contas por {Math.floor((((pkg.tokens) * (multipliers[pkg.id] || 1)) / 10) / 5)} meses.
                                            </p>
                                        </div>
                                    )}

                                    <ul className="mt-6 space-y-4 mb-8">
                                        <li className="flex items-center text-sm font-medium text-gray-700">
                                            <Check className="w-5 h-5 text-emerald-500 mr-3 flex-shrink-0" />
                                            {pkg.isFree ? 'Renovado todo mês' : `Analise até ${pkg.tokens / 10} contas de energia`}
                                        </li>
                                        <li className="flex items-center text-sm font-medium text-gray-700">
                                            <Check className="w-5 h-5 text-emerald-500 mr-3 flex-shrink-0" />
                                            {pkg.isFree ? 'Limite de 3 contas/mês' : 'Validade de 1 ano'}
                                        </li>
                                    </ul>

                                    <button 
                                        onClick={() => handleBuy(pkg)}
                                        disabled={loading || pkg.isFree}
                                        className={`w-full py-4 rounded-xl font-bold transition-all text-sm uppercase tracking-wider ${
                                            pkg.isFree ? 'bg-gray-100 text-gray-500 cursor-not-allowed border border-gray-200' :
                                            pkg.id === 100 
                                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/40 hover:-translate-y-0.5' 
                                                : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                                        }`}
                                    >
                                        {loading && selectedPkg === pkg.id ? 'Processando...' : pkg.isFree ? 'Plano Atual' : 'Comprar Agora'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-300">
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Pagamento Gerado</h2>
                        <p className="text-gray-500 mb-8 max-w-md">Para receber seus {PACKAGES.find(p => p.id === selectedPkg)?.tokens} tokens, escaneie o QR Code abaixo no app do seu banco ou use a chave PIX Copia e Cola.</p>
                        
                        {pixData.qrCode ? (
                            <img src={`data:image/png;base64,${pixData.qrCode}`} alt="PIX QR Code" className="w-64 h-64 border p-2 rounded-xl bg-white mb-6" />
                        ) : (
                            <div className="w-64 h-64 border-2 border-dashed border-gray-200 rounded-xl mb-6 flex flex-col items-center justify-center text-gray-400">
                                <AlertCircle className="w-8 h-8 mb-2" />
                                <span className="text-sm">QR Code não disponível</span>
                            </div>
                        )}

                        {pixData.pixPayload && (
                            <div className="w-full max-w-md">
                                <label className="block text-sm font-bold text-gray-700 mb-2 text-left">PIX Copia e Cola</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        readOnly 
                                        value={pixData.pixPayload} 
                                        className="flex-1 border border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600 font-mono outline-none"
                                    />
                                    <button 
                                        onClick={copyToClipboard}
                                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-3 rounded-xl transition-colors flex items-center font-bold text-sm"
                                    >
                                        <Copy className="w-4 h-4 mr-2" />
                                        {copied ? 'Copiado!' : 'Copiar'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="mt-8 flex gap-4">
                            <button 
                                onClick={() => { setPixData(null); setSelectedPkg(null); setShowIframe(false); }}
                                className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-lg transition-colors"
                            >
                                Cancelar / Voltar
                            </button>
                            {pixData.invoiceUrl && (
                                <button 
                                    onClick={() => {
                                        window.open(pixData.invoiceUrl, '_blank');
                                        setShowIframe(true);
                                    }}
                                    className="px-6 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold rounded-lg transition-colors border border-blue-200"
                                >
                                    Pagar com Cartão de Crédito
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Modal de Aviso Segurança Asaas */}
            {showIframe && pixData?.invoiceUrl && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-2xl w-full max-w-md p-8 text-center flex flex-col items-center shadow-2xl">
                        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-6">
                            <Zap className="w-8 h-8 text-blue-500" />
                        </div>
                        <h3 className="text-xl font-extrabold text-gray-900 mb-2">Ambiente Seguro Asaas</h3>
                        <p className="text-gray-500 mb-8 text-sm">
                            Por motivos de segurança bancária, o Asaas não permite que o checkout de cartão seja embutido dentro de outras plataformas. Uma nova janela segura foi aberta para você concluir o pagamento.
                        </p>
                        
                        <div className="w-full space-y-3">
                            <a 
                                href={pixData.invoiceUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="w-full block py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-blue-500/30"
                            >
                                Abrir Janela Segura
                            </a>
                            <button 
                                onClick={() => {
                                    setShowIframe(false);
                                    window.location.reload(); 
                                }} 
                                className="w-full py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors"
                            >
                                Já realizei o pagamento
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
