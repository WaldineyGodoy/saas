import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { fetchAddressByCep, fetchCpfCnpjData, sendWhatsapp } from '../../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone } from '../../lib/validators';
import { useUI } from '../../contexts/UIContext';
import { useBranding } from '../../contexts/BrandingContext';
import PublicConsumerUnitForm from '../../components/PublicConsumerUnitForm';
import ContratoAdesao from '../../components/ContratoAdesao';
import { gerarPdfContratoBase64 } from '../../lib/contrato';
import { Zap, CheckCircle, Plus, Trash2, ArrowRight } from 'lucide-react';

export default function SubscriberSignup() {
    const [searchParams] = useSearchParams();
    const { showAlert, showConfirm } = useUI();
    const { branding } = useBranding();

    // URL Params
    const paramName = searchParams.get('name') || '';
    const paramEmail = searchParams.get('email') || '';
    const paramPhone = searchParams.get('phone') || '';
    const paramCep = searchParams.get('cep') || '';
    const paramOriginatorId = searchParams.get('originator_id') || '';
    const paramLeadId = searchParams.get('lead_id') || '';
    const paramDiscountPercent = searchParams.get('discount_percent') || '0';
    const paramSavingsAnnual = searchParams.get('savings_annual') || '0';
    const paramConcessionaria = searchParams.get('concessionaria') || '';
    const paramConsumo = searchParams.get('consumo') || '';

    const [loading, setLoading] = useState(false);
    const [etapa, setEtapa] = useState('');
    const [done, setDone] = useState(false);
    const [showUcModal, setShowUcModal] = useState(false);
    // Alimenta as páginas ocultas do contrato. Só é preenchido depois que o
    // assinante existe no banco — o PDF precisa refletir o que foi gravado.
    const [dadosContrato, setDadosContrato] = useState(null);
    // UCs vivem em memória até o "Finalizar Adesão". Antes, adicionar uma UC
    // gravava o assinante no banco só para ter um id de vínculo: quem
    // desistia no meio deixava assinante órfão sem nenhuma unidade.
    const [consumerUnits, setConsumerUnits] = useState([]);

    const [formData, setFormData] = useState({
        name: paramName,
        cpf_cnpj: '',
        // Os parâmetros chegam só com dígitos vindos da simulação; sem a
        // máscara aqui o cliente via "84999998888" no campo de WhatsApp.
        phone: maskPhone(paramPhone),
        email: paramEmail,
        cep: paramCep,
        rua: searchParams.get('rua') || '',
        numero: '',
        complemento: '',
        bairro: searchParams.get('bairro') || '',
        cidade: searchParams.get('cidade') || '',
        uf: searchParams.get('uf') || ''
    });

    // Address & Doc Search States
    const [searchingCep, setSearchingCep] = useState(false);
    const [searchingDoc, setSearchingDoc] = useState(false);

    // Initial Address Fetch if CEP provided
    useEffect(() => {
        if (paramCep) {
            handleCepBlur(paramCep);
        }
    }, [paramCep]);

    const handleCepBlur = async (cepValue) => {
        const rawCep = (cepValue || formData.cep).replace(/\D/g, '');
        if (rawCep.length === 8) {
            setSearchingCep(true);
            try {
                const addr = await fetchAddressByCep(rawCep);
                setFormData(prev => ({
                    ...prev,
                    cep: maskCEP(rawCep),
                    rua: addr.rua || '',
                    bairro: addr.bairro || '',
                    cidade: addr.cidade || '',
                    uf: addr.uf || ''
                }));
            } catch (error) {
                console.error('Erro CEP:', error);
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handleDocBlur = async () => {
        const doc = formData.cpf_cnpj.replace(/\D/g, '');
        if (doc.length >= 11) {
            setSearchingDoc(true);
            try {
                const data = await fetchCpfCnpjData(doc);
                if (data.nome) {
                    setFormData(prev => ({ ...prev, name: data.nome }));
                }
            } catch (error) {
                console.error('Erro Doc:', error);
            } finally {
                setSearchingDoc(false);
            }
        }
    };

    // Derived State for Consumption
    const totalConsumption = consumerUnits.reduce((acc, uc) => acc + (Number(uc.franquia) || 0), 0);
    const displayConsumption = totalConsumption > 0 ? totalConsumption : (paramConsumo || 0);

    const maskCEP = (v) => v.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substr(0, 9);

    const handleAddUcClick = () => setShowUcModal(true);

    const handleFinalize = async () => {
        // Validação local — a RPC revalida tudo do lado do banco, já que ela
        // é chamada direto da internet.
        if (!formData.name?.trim()) return showAlert('Informe seu nome completo.', 'warning');
        if (!validateDocument(formData.cpf_cnpj)) return showAlert('CPF/CNPJ inválido.', 'warning');
        if (!validatePhone(formData.phone)) return showAlert('WhatsApp inválido. Informe DDD + 9 dígitos.', 'warning');
        if (!formData.email?.trim()) return showAlert('Informe seu e-mail.', 'warning');
        if (consumerUnits.length === 0) {
            return showAlert('Adicione pelo menos uma Unidade Consumidora para concluir a adesão.', 'warning');
        }

        setLoading(true);
        setEtapa('Registrando sua adesão...');
        try {
            // Assinante + UCs numa transação só. Se qualquer UC falhar, nada
            // é gravado — não sobra assinante pela metade.
            const { data, error } = await supabase.rpc('fn_criar_assinante_publico', {
                p_nome: formData.name,
                p_cpf_cnpj: formData.cpf_cnpj,
                p_email: formData.email,
                p_telefone: formData.phone,
                p_cep: formData.cep,
                p_rua: formData.rua,
                p_numero: formData.numero,
                p_complemento: formData.complemento,
                p_bairro: formData.bairro,
                p_cidade: formData.cidade,
                p_uf: formData.uf,
                p_originator_id: paramOriginatorId || null,
                p_lead_id: paramLeadId || null,
                p_ucs: consumerUnits.map(uc => ({
                    numero_uc: uc.numero_uc,
                    titular_conta: uc.titular_conta,
                    concessionaria: uc.concessionaria,
                    franquia: uc.franquia,
                    cep: uc.cep,
                    rua: uc.rua,
                    numero: uc.numero,
                    complemento: uc.complemento,
                    bairro: uc.bairro,
                    cidade: uc.cidade,
                    uf: uc.uf
                }))
            });

            if (error) throw error;
            console.info('Adesão criada:', data);

            // A partir daqui o assinante JÁ EXISTE. Nada abaixo pode
            // desfazê-lo nem esconder isso do cliente — só degradar a
            // experiência para "o contrato chega pelo WhatsApp".
            await notificarOriginador();
            await enviarContrato(data?.subscriber_id);

            setDone(true);

        } catch (error) {
            console.error(error);
            showAlert(error.message || 'Não foi possível concluir a adesão.', 'error');
        } finally {
            setLoading(false);
            setEtapa('');
        }
    };

    /**
     * Gera o contrato e leva o assinante para a página de termos.
     *
     * Antes isso dependia de um admin abrir o CRM e clicar em "Gerar e
     * Enviar para Assinatura Eletrônica" — o cliente saía do site sem
     * contrato nenhum e sem saber que faltava um passo.
     */
    const enviarContrato = async (subscriberId) => {
        if (!subscriberId) return;

        try {
            setEtapa('Preparando seu contrato...');

            // Monta as páginas ocultas e espera o React renderizar antes de
            // o html2canvas tentar capturá-las.
            setDadosContrato({
                subscriber: { ...formData, cpf_cnpj: formData.cpf_cnpj.replace(/\D/g, '') },
                ucs: consumerUnits
            });
            await new Promise(resolve => setTimeout(resolve, 400));

            const pdfBase64 = await gerarPdfContratoBase64();

            setEtapa('Enviando para assinatura digital...');
            const { data: fim, error: fimErro } = await supabase.functions.invoke('onboarding-finalizar', {
                body: { subscriber_id: subscriberId, pdf_base64: pdfBase64 }
            });

            if (fimErro) throw fimErro;
            if (fim?.error) throw new Error(fim.error);
            if (fim?.avisos?.length) console.warn('Avisos do onboarding:', fim.avisos);

            if (fim?.contrato_url) {
                // Página de termos com o link de assinatura embutido.
                window.location.href = fim.contrato_url;
            }
        } catch (e) {
            // Falhou o contrato, não a adesão. O cliente continua cadastrado
            // e a tela de sucesso avisa que o link chega pelo WhatsApp.
            console.error('Falha ao gerar/enviar contrato:', e);
        }
    };

    /**
     * Avisa o originador da conversão.
     *
     * A mensagem para o próprio assinante NÃO sai daqui: quem manda é a
     * `onboarding-finalizar`, junto com o link de assinatura. Duas
     * mensagens seguidas, uma sem link e outra com, só confundiriam.
     *
     * `integrations_config` é admin-only por RLS e esta página roda como
     * visitante anônimo, então a instância do WhatsApp é resolvida pela
     * Edge Function, não aqui.
     */
    const notificarOriginador = async () => {
        if (!paramOriginatorId) return;
        try {
            const { data: org } = await supabase
                .from('originators_v2')
                .select('phone')
                .eq('id', paramOriginatorId)
                .maybeSingle();

            if (org?.phone) {
                await sendWhatsapp(
                    org.phone,
                    `🚀 Novo cliente cadastrado!\n\n${formData.name} concluiu a adesão pelo seu link e recebeu o contrato para assinar.\nAcompanhe pelo CRM.`
                );
            }
        } catch (e) {
            console.error('Falha ao notificar originador:', e);
        }
    };


    if (done) {
        return (
            <div className="min-h-screen bg-slate-50 font-inter flex items-center justify-center px-4">
                <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-10 max-w-lg text-center">
                    <CheckCircle size={64} className="mx-auto mb-6 text-green-500" />
                    <h1 className="text-3xl font-bold mb-4" style={{ color: '#003366' }}>
                        Adesão concluída!
                    </h1>
                    <p className="text-slate-600 text-lg mb-2">
                        Obrigado, {formData.name.split(' ')[0]}. Recebemos seu cadastro e ele já está em ativação.
                    </p>
                    <p className="text-slate-500">
                        Em instantes você recebe no WhatsApp <strong>{formData.phone}</strong> o contrato
                        de adesão para assinatura digital. É o último passo.
                    </p>
                </div>
            </div>
        );
    }

    /* Páginas do contrato: ficam fora da tela e só existem durante a
       geração do PDF. Montadas aqui para valerem em qualquer ramo do
       render abaixo. */
    const paginasContrato = dadosContrato && (
        <ContratoAdesao
            subscriber={dadosContrato.subscriber}
            consumerUnits={dadosContrato.ucs}
            branding={branding}
        />
    );

    return (
        <div className="min-h-screen bg-slate-50 font-inter">
            {/* Header / Banner */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-4 py-6">
                    <h1 className="text-3xl font-bold" style={{ color: '#003366' }}>
                        {formData.name || 'Novo Assinante'}
                    </h1>
                    <p className="text-slate-500 mt-2 text-lg">
                        Confira os detalhes da sua economia e finalize sua adesão abaixo.
                    </p>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

                {/* Info Cards Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Concessionária</p>
                        <p className="font-semibold text-slate-900">{paramConcessionaria || 'Distribuidora Local'}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Média de Consumo</p>
                        <p className="font-semibold text-slate-900">{Number(displayConsumption).toLocaleString('pt-BR')} kWh</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Endereço da Instalação</p>
                        <p className="font-semibold text-slate-900 truncate" title={`${formData.rua}, ${formData.numero}`}>
                            {formData.rua ? `${formData.rua}, ${formData.numero}` : 'Endereço não informado'}
                        </p>
                    </div>
                </div>

                {/* Economy Banner */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex items-center gap-2">
                        <Zap className="text-orange-500 fill-orange-500" size={24} />
                        <h2 className="text-xl font-bold text-slate-800">Economia esperada com a B2W Energia</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2">
                        {/* Blue Box */}
                        <div className="p-8 text-center text-white flex flex-col justify-center items-center" style={{ backgroundColor: '#003366' }}>
                            <p className="text-sm font-medium opacity-90 mb-2 uppercase tracking-wider">Desconto Garantido</p>
                            <p className="text-6xl font-bold mb-2">{paramDiscountPercent}%</p>
                            <p className="text-xs opacity-75">Sobre a tarifa de energia</p>
                        </div>
                        {/* Orange Box */}
                        <div className="p-8 text-center text-white flex flex-col justify-center items-center" style={{ backgroundColor: '#FF6600' }}>
                            <p className="text-sm font-medium opacity-90 mb-2 uppercase tracking-wider">Economia Anual Estimada</p>
                            <p className="text-5xl font-bold mb-2">
                                {Number(paramSavingsAnnual).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </p>
                            <p className="text-xs opacity-75">Mais dinheiro no seu bolso</p>
                        </div>
                    </div>
                    <div className="bg-slate-50 p-3 text-center text-xs text-slate-500">
                        * Estimativa baseada no seu histórico de consumo médio mensal informado.
                    </div>
                </div>

                {/* Subscriber Form */}
                <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 md:p-10">
                    <h2 className="text-2xl font-bold mb-8 flex items-center gap-2" style={{ color: '#003366' }}>
                        <div className="w-1 h-8 bg-[#FF6600] rounded-full"></div>
                        Dados do Assinante
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* CPF/CNPJ */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">CPF ou CNPJ</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={formData.cpf_cnpj}
                                    onChange={e => setFormData({ ...formData, cpf_cnpj: maskCpfCnpj(e.target.value) })}
                                    onBlur={handleDocBlur}
                                    className={`w-full px-4 py-4 rounded-xl border ${searchingDoc ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'} focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700`}
                                    placeholder="000.000.000-00"
                                />
                                {searchingDoc && <span className="absolute right-3 top-4 text-xs text-[#003366] font-bold">Buscando...</span>}
                            </div>
                        </div>

                        {/* Name */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Nome Completo / Razão Social</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                className="w-full px-4 py-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700"
                                placeholder="Seu nome"
                            />
                        </div>

                        {/* Email */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">E-mail</label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                className="w-full px-4 py-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700"
                            />
                        </div>

                        {/* Phone */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">WhatsApp</label>
                            <input
                                type="tel"
                                value={formData.phone}
                                onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                                className="w-full px-4 py-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700"
                            />
                        </div>

                        {/* Address */}
                        <div className="md:col-span-2 pt-6 border-t border-slate-100 mt-2">
                            <h3 className="text-lg font-bold mb-6 flex items-center gap-2" style={{ color: '#003366' }}>
                                <div className="w-1 h-6 bg-[#FF6600] rounded-full"></div>
                                Endereço
                            </h3>
                        </div>

                        <div className="grid grid-cols-3 gap-6 md:col-span-2">
                            <div className="col-span-1">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">CEP</label>
                                <input
                                    type="text"
                                    value={formData.cep}
                                    onChange={e => setFormData({ ...formData, cep: maskCEP(e.target.value) })}
                                    onBlur={e => handleCepBlur(e.target.value)}
                                    className={`w-full px-4 py-4 rounded-xl border ${searchingCep ? 'bg-blue-50' : 'bg-white'} border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700`}
                                />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Rua</label>
                                <input
                                    type="text"
                                    value={formData.rua}
                                    onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                    className="w-full px-4 py-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700"
                                />
                            </div>
                        </div>

                        <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Número</label>
                                <input
                                    type="text"
                                    value={formData.numero}
                                    onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                    className="w-full px-4 py-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Comp.</label>
                                <input
                                    type="text"
                                    value={formData.complemento}
                                    onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                    className="w-full px-4 py-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Bairro</label>
                                <input
                                    type="text"
                                    value={formData.bairro}
                                    onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                    className="w-full px-4 py-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Cidade/UF</label>
                                <input
                                    type="text"
                                    value={`${formData.cidade}-${formData.uf}`}
                                    readOnly
                                    className="w-full px-4 py-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed font-medium"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Consumer Units (UCs) */}
                <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 md:p-10">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#003366' }}>
                            <div className="w-1 h-8 bg-[#FF6600] rounded-full"></div>
                            Unidades Consumidoras
                        </h2>
                        <button
                            onClick={handleAddUcClick}
                            className="flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-lg font-bold hover:bg-green-100 transition-colors border border-green-200"
                        >
                            <Plus size={20} />
                            Adicionar UC
                        </button>
                    </div>

                    {consumerUnits.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                            <p>Nenhuma UC cadastrada. Adicione pelo menos uma para continuar.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {consumerUnits.map((uc, idx) => (
                                <div key={`${uc.numero_uc}-${idx}`} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-200">
                                    <div>
                                        <p className="font-bold text-slate-800">UC: {uc.numero_uc}</p>
                                        <p className="text-sm text-slate-500">
                                            {[uc.concessionaria, uc.franquia ? `${Number(uc.franquia)} kWh` : null]
                                                .filter(Boolean).join(' • ') || 'Sem dados adicionais'}
                                        </p>
                                    </div>
                                    <button
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        onClick={async () => {
                                            if (await showConfirm('Remover esta UC?')) {
                                                setConsumerUnits(prev => prev.filter((_, i) => i !== idx));
                                            }
                                        }}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Finalize Button */}
                <button
                    onClick={handleFinalize}
                    disabled={loading}
                    className="w-full py-5 text-xl font-bold text-white uppercase tracking-wider rounded-xl shadow-xl transition-all transform active:scale-[0.99] flex justify-center items-center gap-3 hover:shadow-2xl disabled:opacity-70"
                    style={{ backgroundColor: '#FF6600' }}
                >
                    {loading ? (etapa || 'Processando...') : (
                        <>
                            Finalizar Adesão <ArrowRight size={24} />
                        </>
                    )}
                </button>

                {loading && etapa && (
                    <p className="text-center text-sm text-slate-500 -mt-4">
                        Não feche esta página — estamos preparando seu contrato para assinatura.
                    </p>
                )}

            </div>

            {paginasContrato}

            {/* UC Modal */}
            {showUcModal && (
                <PublicConsumerUnitForm
                    concessionariaDefault={paramConcessionaria}
                    titularDefault={formData.name}
                    franquiaDefault={consumerUnits.length === 0 ? paramConsumo : ''}
                    enderecoDefault={{
                        cep: formData.cep,
                        rua: formData.rua,
                        numero: formData.numero,
                        complemento: formData.complemento,
                        bairro: formData.bairro,
                        cidade: formData.cidade,
                        uf: formData.uf
                    }}
                    onClose={() => setShowUcModal(false)}
                    onSave={(uc) => {
                        setConsumerUnits(prev => [...prev, uc]);
                        setShowUcModal(false);
                    }}
                />
            )}
        </div>
    );
}
