import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { fetchAddressByCep, fetchCpfCnpjData, manageAsaasCustomer, sendWhatsapp } from '../../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone } from '../../lib/validators';
import { useUI } from '../../contexts/UIContext';
import ConsumerUnitModal from '../../components/ConsumerUnitModal';
import { Zap, CheckCircle, Plus, Trash2, ArrowRight } from 'lucide-react';

export default function SubscriberSignup() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { showAlert, showConfirm } = useUI();

    // URL Params
    const paramName = searchParams.get('name') || '';
    const paramEmail = searchParams.get('email') || '';
    const paramPhone = searchParams.get('phone') || '';
    const paramCep = searchParams.get('cep') || '';
    const paramOriginatorId = searchParams.get('originator_id') || '';
    const paramDiscountPercent = searchParams.get('discount_percent') || '0';
    const paramSavingsAnnual = searchParams.get('savings_annual') || '0';

    const [loading, setLoading] = useState(false);
    const [showUcModal, setShowUcModal] = useState(false);
    const [savedSubscriber, setSavedSubscriber] = useState(null); // To Link UCs
    const [consumerUnits, setConsumerUnits] = useState([]); // Temporary list before saving? Or save immediately if subscriber exists?
    // Strategy: We need a subscriber ID to save UCs. 
    // Option A: Save Subscriber first, then enable UC addition. 
    // Option B: "Save All" at the end. Complex because UCs need subscriber_id foreign key.
    // user said: "permitir a inclusão de mais de uma UC e o consumo de cada uma delas" AND "ao concluir deverá seguir para uma pagina de criaçao de login"
    // Best approach: Create Subscriber *silently* or require user to click "Salvar Dados Pessoais" first? 
    // Better: Allow adding UCs to a list in memory, then save everything in batch? 
    // Supabase usually requires parent ID. 
    // Let's go with: Save Subscriber Step -> Then Add UCs -> Then Finalize. 
    // OR: "Finalizar Adesão" saves Subscriber + UCs. 
    // But ConsumerUnitModal needs a subscriber_id to check duplicates/logic? The modal provided `ConsumerUnitModal` takes `subscriber_id`.
    // Let's try to save subscriber in background if possible, or just hold UCs in memory if the modal supports it? 
    // `ConsumerUnitModal` saves directly to DB: `supabase.from('consumer_units').insert...`
    // So we MUST have a subscriber ID.
    // We will auto-save subscriber when they click "Adicionar UC" if not saved yet? or just asking them to fill form first.
    
    // Let's make it a single form, but "Adicionar UC" saves the subscriber first if needed? 
    // Or maybe we modify ConsumerUnitModal to accept "onSave" without DB? 
    // No, `ConsumerUnitModal` is robust and coupled to DB. 
    // Workaround: We will have a "Salvar e Continuar" for the personal data, then show UCs section?
    // The prompt implies a single flow. "ao concluir...". 
    // Let's Auto-Save Subscriber when basic data is valid and user tries to add UC?
    
    const [formData, setFormData] = useState({
        name: paramName,
        cpf_cnpj: '',
        status: 'ativacao', // Default hidden
        phone: paramPhone,
        email: paramEmail,
        cep: paramCep,
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        originator_id: paramOriginatorId
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
    const totalConsumption = consumerUnits.reduce((acc, uc) => acc + (Number(uc.franquia) || 0), 0); // Using 'franquia' as consumption proxy or we need a 'consumo' field? 
    // Modal has 'franquia'. Lead form has 'consumo'. Consumo is usually Average Monthly Consumption.
    // We will use the sum of 'franquia' (Simulated consumption) or 'media_consumo' if we add it to UC modal. 
    // ConsumerUnitModal has `franquia`. Let's use that.
    
    // Derived State for Savings
    // paramSavingsAnnual is passed from simulation. 
    // If we want to recalculate based on UCs: (TotalConsumo * Tariff * Discount).
    // For now, let's use the passed value OR update it if UCs present. 
    // If UCs present, we might want to sum their savings? 
    // The prompt says: "Média de consumo (soma do consumo das ucs informadas no formulario)".
    // So distinct from passed param.
    // If no UCs, maybe show 0? Or show the simulated value from Lead?
    // Let's show Simulated Value initially, then Real Value if UCs added.
    const displayConsumption = consumerUnits.length > 0 ? totalConsumption : (searchParams.get('consumo') || 0);

    const maskCEP = (v) => v.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substr(0, 9);


    // SAVE SUBSCRIBER (Helper)
    const saveSubscriberToDb = async () => {
        // Validation
        if (!validateDocument(formData.cpf_cnpj)) throw new Error('CPF/CNPJ inválido!');
        if (!formData.name) throw new Error('Nome é obrigatório');
        
        const cleanDoc = formData.cpf_cnpj.replace(/\D/g, '');
        
        // Check duplication
        if (!savedSubscriber) {
            const { data: existing } = await supabase.from('subscribers').select('id').eq('cpf_cnpj', formData.cpf_cnpj).single();
            if (existing) throw new Error('Já existe um assinante com este CPF/CNPJ.');
        }

        // Asaas Sync (Fail-safe)
        let asaasId = savedSubscriber?.asaas_customer_id;
        try {
            const asaasResult = await manageAsaasCustomer({
                id: asaasId, // Update if exists
                name: formData.name,
                cpfCnpj: formData.cpf_cnpj,
                email: formData.email,
                phone: formData.phone,
                postalCode: formData.cep,
                addressNumber: formData.numero,
                address: formData.rua,
                province: formData.bairro
            });
            if (asaasResult?.success) asaasId = asaasResult.asaas_id;
        } catch (e) {
            console.warn('Asaas Sync warning:', e);
            // Continue execution, don't block
        }

        const payload = {
            ...formData,
            asaas_customer_id: asaasId
        };
        // Ensure originator_id is null if empty string
        if (!payload.originator_id) payload.originator_id = null;

        let result;
        if (savedSubscriber?.id) {
             result = await supabase.from('subscribers').update(payload).eq('id', savedSubscriber.id).select().single();
        } else {
             result = await supabase.from('subscribers').insert(payload).select().single();
        }

        if (result.error) throw result.error;
        setSavedSubscriber(result.data);
        return result.data;
    };

    const handleAddUcClick = async () => {
        // We must save subscriber first to link UC
        if (!savedSubscriber) {
            try {
                // Check if form is filled enough (CPF, Name)
                if (!formData.cpf_cnpj || !formData.name) {
                    return showAlert('Preencha os dados do assinante (CPF e Nome) antes de adicionar UCs.', 'warning');
                }
                setLoading(true);
                await saveSubscriberToDb();
                setLoading(false);
                setShowUcModal(true);
            } catch (error) {
                setLoading(false);
                showAlert(error.message, 'error');
            }
        } else {
            setShowUcModal(true);
        }
    };

    const handleFinalize = async () => {
        setLoading(true);
        try {
            // 1. Ensure Subscriber Saved/Updated
            const sub = await saveSubscriberToDb();

            // 2. Validate UCs
            if (consumerUnits.length === 0) {
                 const proceed = await showConfirm('Nenhuma Unidade Consumidora (UC) foi cadastrada. Deseja finalizar mesmo assim?');
                 if (!proceed) {
                     setLoading(false);
                     return;
                 }
            }

            // 3. Send WhatsApps
            // To Originator
            if (paramOriginatorId) {
                // Fetch originator phone? We assume backend or another fetch. 
                // For now, we might skip or need to fetch Originator data.
                // Let's try to fetch originator phone quick.
                const { data: org } = await supabase.from('originators_v2').select('phone').eq('id', paramOriginatorId).single();
                if (org?.phone) {
                    const msgOrg = `🚀 Novo Cliente Cadastrado!\n\n${sub.name} acabou de completar o cadastro.\nVerifique no CRM.`;
                    await sendWhatsapp(org.phone, msgOrg, null, 'default');
                }
            }
            
            // To Subscriber
            if (sub.phone) {
                const msgSub = `Olá, ${sub.name}! 👋\n\nSeu cadastro na B2W Energia foi recebido com sucesso e está em fase de ativação.\n\nPara acompanhar o processo, acesse seu email e crie seu login.`;
                await sendWhatsapp(sub.phone, msgSub, null, 'default');
            }

            showAlert('Cadastro realizado com sucesso!', 'success');
            
            // 4. Redirect to Login
            navigate('/login');

        } catch (error) {
            console.error(error);
            showAlert('Erro ao finalizar: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    // Refresh UCs list
    const fetchLinkedUCs = async () => {
        if (!savedSubscriber?.id) return;
        const { data } = await supabase.from('consumer_units').select('*').eq('subscriber_id', savedSubscriber.id);
        setConsumerUnits(data || []);
    };

    useEffect(() => {
        if (savedSubscriber) {
            fetchLinkedUCs();
        }
    }, [savedSubscriber]);


    return (
        <div className="min-h-screen bg-slate-50 font-inter">
            {/* Header / Banner */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-4 py-6">
                    <h1 className="text-2xl font-bold text-slate-900">
                        Olá, {formData.name.split(' ')[0] || 'Cliente'}!
                    </h1>
                    <p className="text-slate-600 mt-1">
                        Confira os detalhes da sua economia e finalize sua adesão abaixo.
                    </p>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
                
                {/* Info Cards Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Concessionária</p>
                        <p className="font-semibold text-slate-900">Distribuidora Local</p>
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
                        <div className="bg-[#0b2545] p-8 text-center text-white flex flex-col justify-center items-center">
                            <p className="text-sm font-medium opacity-90 mb-2">Desconto na energia renovável</p>
                            <p className="text-5xl font-bold mb-2">{paramDiscountPercent}%</p>
                            <p className="text-xs opacity-75">No seu consumo de energia</p>
                        </div>
                        {/* Orange Box */}
                        <div className="bg-[#ff7706] p-8 text-center text-white flex flex-col justify-center items-center">
                            <p className="text-sm font-medium opacity-90 mb-2">Economia anual estimada</p>
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
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
                    <h2 className="text-2xl font-bold text-[#0b2545] mb-6">Dados do Assinante</h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* CPF/CNPJ */}
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">CPF/CNPJ</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={formData.cpf_cnpj}
                                    onChange={e => setFormData({...formData, cpf_cnpj: maskCpfCnpj(e.target.value)})}
                                    onBlur={handleDocBlur}
                                    className={`w-full px-4 py-3 rounded-lg border content-center ${searchingDoc ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'} focus:outline-none focus:border-orange-500 transition-colors`}
                                    placeholder="000.000.000-00"
                                />
                                {searchingDoc && <span className="absolute right-3 top-3.5 text-xs text-blue-600 font-bold">Buscando...</span>}
                            </div>
                        </div>

                        {/* Name */}
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">Nome Completo / Razão Social</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData({...formData, name: e.target.value})}
                                className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-orange-500 transition-colors"
                                placeholder="Seu nome"
                            />
                        </div>

                        {/* Email */}
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">E-mail</label>
                            <input
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({...formData, email: e.target.value})}
                                className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-orange-500 transition-colors"
                            />
                        </div>

                        {/* Phone */}
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">WhatsApp</label>
                            <input
                                type="tel"
                                value={formData.phone}
                                onChange={e => setFormData({...formData, phone: maskPhone(e.target.value)})}
                                className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-orange-500 transition-colors"
                            />
                        </div>

                        {/* Address */}
                        <div className="md:col-span-2 pt-4 border-t border-slate-100">
                             <h3 className="text-lg font-semibold text-[#0b2545] mb-4">Endereço</h3>
                        </div>

                        <div className="grid grid-cols-3 gap-4 md:col-span-2">
                             <div className="col-span-1">
                                <label className="block text-sm font-bold text-slate-700 mb-2">CEP</label>
                                <input
                                    type="text"
                                    value={formData.cep}
                                    onChange={e => setFormData({...formData, cep: maskCEP(e.target.value)})}
                                    onBlur={e => handleCepBlur(e.target.value)}
                                    className={`w-full px-4 py-3 rounded-lg border ${searchingCep ? 'bg-blue-50' : 'bg-slate-50'} border-slate-200 focus:outline-none focus:border-orange-500`}
                                />
                             </div>
                             <div className="col-span-2">
                                <label className="block text-sm font-bold text-slate-700 mb-2">Rua</label>
                                <input
                                    type="text"
                                    value={formData.rua}
                                    onChange={e => setFormData({...formData, rua: e.target.value})}
                                    className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-orange-500"
                                />
                             </div>
                        </div>

                        <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-4">
                             <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Número</label>
                                <input
                                    type="text"
                                    value={formData.numero}
                                    onChange={e => setFormData({...formData, numero: e.target.value})}
                                    className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-orange-500"
                                />
                             </div>
                             <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Comp.</label>
                                <input
                                    type="text"
                                    value={formData.complemento}
                                    onChange={e => setFormData({...formData, complemento: e.target.value})}
                                    className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-orange-500"
                                />
                             </div>
                             <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Bairro</label>
                                <input
                                    type="text"
                                    value={formData.bairro}
                                    onChange={e => setFormData({...formData, bairro: e.target.value})}
                                    className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:border-orange-500"
                                />
                             </div>
                             <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Cidade/UF</label>
                                <input
                                    type="text"
                                    value={`${formData.cidade}-${formData.uf}`}
                                    readOnly
                                    className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
                                />
                             </div>
                        </div>
                    </div>
                </div>

                {/* Consumer Units (UCs) */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-[#0b2545]">Unidades Consumidoras</h2>
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
                             {consumerUnits.map(uc => (
                                 <div key={uc.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-200">
                                     <div>
                                         <p className="font-bold text-slate-800">UC: {uc.numero_uc}</p>
                                         <p className="text-sm text-slate-500">{uc.concessionaria} • {Number(uc.franquia)} kWh</p>
                                     </div>
                                     <button 
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        onClick={async () => {
                                            if(await showConfirm('Remover esta UC?')) {
                                                await supabase.from('consumer_units').delete().eq('id', uc.id);
                                                fetchLinkedUCs();
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
                    className={`w-full py-4 text-xl font-bold text-white uppercase tracking-wider rounded-xl shadow-lg 
                        ${loading ? 'bg-slate-400 cursor-wait' : 'bg-[#ff7706] hover:bg-[#e06600] cursor-pointer'} 
                        transition-all transform active:scale-[0.99] flex justify-center items-center gap-3`}
                >
                    {loading ? 'Processando...' : (
                        <>
                            Finalizar Adesão <ArrowRight size={24} />
                        </>
                    )}
                </button>

            </div>

            {/* UC Modal */}
            {showUcModal && (
                <ConsumerUnitModal
                    consumerUnit={{ subscriber_id: savedSubscriber?.id }}
                    onClose={() => setShowUcModal(false)}
                    onSave={() => {
                        fetchLinkedUCs();
                        setShowUcModal(false);
                    }}
                />
            )}
        </div>
    );
}
