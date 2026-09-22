import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { fetchAddressByCep, fetchCpfCnpjData } from '../../lib/api';
import { maskCpfCnpj, maskPhone, validateCpf, validateDocument, validatePhone } from '../../lib/validators';
import { useUI } from '../../contexts/UIContext';
import { useBranding } from '../../contexts/BrandingContext';
import PublicConsumerUnitForm from '../../components/PublicConsumerUnitForm';
import ContratoAdesao from '../../components/ContratoAdesao';
import PassoDocumentos from './onboarding/PassoDocumentos';
import { dividirEmPaginas, gerarPdfContratoBase64, montarTextoContrato } from '../../lib/contrato';
import { semTituloRepetido } from '../../lib/contratoBase';
import { DIAS_VENCIMENTO, VERSAO_TERMOS, lerErroFuncao, uuidOuNulo } from '../../lib/onboarding';
import { Zap, CheckCircle, Plus, Trash2, ArrowRight, Clock, Link2, FileSignature } from 'lucide-react';

const TITULO_TERMO = 'Termo de Ingresso e Adesão à Associação de Geração Compartilhada';
const URL_TERMOS_USO = 'https://b2wenergia.com.br/termos-de-uso/';
const URL_PRIVACIDADE = 'https://b2wenergia.com.br/politica-de-privacidade/';

const PASSOS = [
    { id: 'dados', rotulo: 'Dados' },
    { id: 'documentos', rotulo: 'Documentos' },
    { id: 'contrato', rotulo: 'Contrato' }
];

const inputClass = 'w-full px-4 py-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:border-transparent transition-all shadow-sm font-medium text-slate-700';

/** Tela cheia de mensagem: carregando, link expirado, concluído etc. */
function TelaMensagem({ icone, titulo, children }) {
    return (
        <div className="min-h-screen bg-slate-50 font-inter flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8 md:p-10 max-w-lg w-full text-center">
                {icone}
                <h1 className="text-2xl md:text-3xl font-bold mb-4" style={{ color: '#003366' }}>{titulo}</h1>
                <div className="text-slate-600">{children}</div>
            </div>
        </div>
    );
}

/** Indicador Dados → Documentos → Contrato. */
function Passos({ atual }) {
    const idx = Math.max(0, PASSOS.findIndex(p => p.id === atual));
    const concluidoTudo = atual === 'enviado';
    return (
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 mt-4 text-xs sm:text-sm">
            {PASSOS.map((p, i) => {
                const feito = concluidoTudo || i < idx;
                const ativo = !concluidoTudo && i === idx;
                return (
                    <li key={p.id} className="flex items-center gap-2">
                        <span
                            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-white ${feito ? 'bg-green-500' : ''}`}
                            style={!feito ? { backgroundColor: ativo ? '#FF6600' : '#cbd5e1' } : undefined}
                        >
                            {feito ? '✓' : i + 1}
                        </span>
                        <span className={`font-semibold ${ativo ? 'text-slate-900' : 'text-slate-500'}`}>{p.rotulo}</span>
                        {i < PASSOS.length - 1 && <span className="w-3 sm:w-8 h-px bg-slate-300" />}
                    </li>
                );
            })}
        </ol>
    );
}

/**
 * Adesão pública em três passos: Dados → Documentos → Contrato.
 *
 * O passo Dados grava assinante + UCs pela RPC `fn_criar_assinante_publico`
 * e recebe um token de retomada. A partir daí a URL vira
 * `/contrato?retomar=<token>`: quem fecha a página no meio volta de onde
 * parou, e o estado vem sempre do banco (`fn_onboarding_estado`), nunca da
 * memória do navegador.
 */
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
    const paramRetomar = searchParams.get('retomar') || '';

    // 'carregando' | 'expirado' | 'dados' | 'documentos' | 'contrato' |
    // 'enviado' | 'assinado' | 'pendente_equipe'
    const [passo, setPasso] = useState(paramRetomar ? 'carregando' : 'dados');
    const [onboardingToken, setOnboardingToken] = useState(paramRetomar);
    const [estado, setEstado] = useState(null);

    const [loading, setLoading] = useState(false);
    const [etapa, setEtapa] = useState('');
    // Trava síncrona contra duplo clique: o `disabled` só vale depois do
    // próximo render, e dois cliques rápidos criavam dois documentos na
    // Autentique (o servidor não tem trava de concorrência).
    const ocupadoRef = useRef(false);
    const [showUcModal, setShowUcModal] = useState(false);
    // Alimenta as páginas ocultas do contrato. Só é preenchido a partir do
    // estado do banco — o PDF precisa refletir o que foi gravado.
    const [dadosContrato, setDadosContrato] = useState(null);
    // UCs vivem em memória até o envio do passo Dados.
    const [consumerUnits, setConsumerUnits] = useState([]);

    const [diaVencimento, setDiaVencimento] = useState(null);
    const [aceite, setAceite] = useState(false);

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
        uf: searchParams.get('uf') || '',
        ibge: '',
        representante_nome: '',
        representante_cpf: ''
    });

    const ehCnpj = formData.cpf_cnpj.replace(/\D/g, '').length === 14;

    // Address & Doc Search States
    const [searchingCep, setSearchingCep] = useState(false);
    const [searchingDoc, setSearchingDoc] = useState(false);

    // Initial Address Fetch if CEP provided
    useEffect(() => {
        if (paramCep && !paramRetomar) {
            handleCepBlur(paramCep);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paramCep]);

    // Retomada: o link `/contrato?retomar=<token>` reabre a adesão no passo
    // em que ela parou.
    useEffect(() => {
        if (!paramRetomar) return;
        carregarEstado(paramRetomar).then(est => {
            if (est === null) {
                setPasso('expirado');
                showAlert('Link expirado, refaça a simulação.', 'warning');
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paramRetomar]);

    /**
     * Busca o estado da adesão no banco e leva a tela ao passo certo.
     * Devolve o estado, `null` se o token não vale mais, ou `undefined` se
     * a chamada falhou (rede) — nesse caso não dá para dizer que expirou.
     */
    const carregarEstado = async (token) => {
        const { data, error } = await supabase.rpc('fn_onboarding_estado', { p_token: token });
        if (error) {
            console.error('fn_onboarding_estado:', error);
            showAlert(error.message || 'Não foi possível carregar sua adesão. Tente de novo.', 'error');
            setPasso(prev => (prev === 'carregando' ? 'erro_carga' : prev));
            return undefined;
        }
        if (!data) return null;

        const sub = data.subscriber || {};
        const ucs = data.ucs || [];
        setEstado(data);
        setFormData(prev => ({
            ...prev,
            name: sub.name || '',
            cpf_cnpj: maskCpfCnpj(sub.cpf_cnpj || ''),
            phone: maskPhone(sub.phone || ''),
            email: sub.email || '',
            cep: sub.cep || '',
            rua: sub.rua || '',
            numero: sub.numero || '',
            complemento: sub.complemento || '',
            bairro: sub.bairro || '',
            cidade: sub.cidade || '',
            uf: sub.uf || '',
            representante_nome: sub.representante_nome || '',
            representante_cpf: sub.representante_cpf || ''
        }));
        setConsumerUnits(ucs);
        setDiaVencimento(ucs[0]?.dia_vencimento ?? null);
        setPasso(data.etapa || 'documentos');
        return data;
    };

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
                    uf: addr.uf || '',
                    // Código do município: é por ele que a RPC acha o desconto.
                    ibge: addr.ibge || ''
                }));
            } catch (error) {
                console.error('Erro CEP:', error);
                setFormData(prev => ({ ...prev, ibge: '' }));
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

    /** Passo Dados: grava assinante + UCs e abre o passo Documentos. */
    const handleEnviarDados = async () => {
        if (ocupadoRef.current) return;

        // Validação local — a RPC revalida tudo do lado do banco, já que ela
        // é chamada direto da internet.
        if (!formData.name?.trim()) return showAlert('Informe seu nome completo.', 'warning');
        if (!validateDocument(formData.cpf_cnpj)) return showAlert('CPF/CNPJ inválido.', 'warning');
        if (ehCnpj) {
            if (!formData.representante_nome.trim()) return showAlert('Informe o nome do representante legal.', 'warning');
            if (!validateCpf(formData.representante_cpf)) return showAlert('CPF do representante legal inválido.', 'warning');
        }
        if (!validatePhone(formData.phone)) return showAlert('WhatsApp inválido. Informe DDD + 9 dígitos.', 'warning');
        if (!formData.email?.trim()) return showAlert('Informe seu e-mail.', 'warning');
        if (consumerUnits.length === 0) {
            return showAlert('Adicione pelo menos uma Unidade Consumidora para continuar.', 'warning');
        }
        if (!DIAS_VENCIMENTO.includes(diaVencimento)) return showAlert('Escolha o dia de vencimento.', 'warning');
        if (!aceite) return showAlert('Aceite os termos de uso e a política de privacidade para continuar.', 'warning');

        ocupadoRef.current = true;
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
                p_ibge: formData.ibge || null,
                p_originator_id: uuidOuNulo(paramOriginatorId),
                p_lead_id: uuidOuNulo(paramLeadId),
                p_ucs: consumerUnits.map(uc => ({
                    numero_uc: uc.numero_uc,
                    titular_conta: uc.titular_conta,
                    cpf_cnpj_fatura: uc.cpf_cnpj_fatura,
                    tipo_ligacao: uc.tipo_ligacao,
                    concessionaria: uc.concessionaria,
                    franquia: uc.franquia,
                    ibge: uc.ibge,
                    cep: uc.cep,
                    rua: uc.rua,
                    numero: uc.numero,
                    complemento: uc.complemento,
                    bairro: uc.bairro,
                    cidade: uc.cidade,
                    uf: uc.uf
                })),
                p_dia_vencimento: diaVencimento,
                p_representante_nome: ehCnpj ? formData.representante_nome.trim() : null,
                p_representante_cpf: ehCnpj ? formData.representante_cpf : null,
                p_aceite_versao: VERSAO_TERMOS
            });

            if (error) throw error;

            // A partir daqui o assinante JÁ EXISTE. A URL passa a ser o link
            // de retomada: recarregar a página não cria outro cadastro.
            const token = data?.onboarding_token;
            setOnboardingToken(token);
            window.history.replaceState(null, '', '/contrato?retomar=' + token);

            setEtapa('Carregando o próximo passo...');
            const est = await carregarEstado(token);
            // Cadastro gravado mas o estado não veio: a URL já é o link de
            // retomada, então "tentar de novo" continua de onde parou.
            if (!est) setPasso('erro_carga');
        } catch (error) {
            console.error(error);
            showAlert(error.message || 'Não foi possível registrar sua adesão.', 'error');
        } finally {
            ocupadoRef.current = false;
            setLoading(false);
            setEtapa('');
        }
    };

    /**
     * Passo Contrato: gera o PDF a partir do que está no banco e manda para
     * a assinatura digital. O servidor cria a conta, o documento na
     * Autentique e avisa assinante e originador.
     */
    const handleGerarContrato = async () => {
        if (ocupadoRef.current || !estado) return;
        ocupadoRef.current = true;
        setLoading(true);
        try {
            setEtapa('Preparando seu contrato...');
            // Monta as páginas ocultas e espera o React renderizar antes de
            // o html2canvas tentar capturá-las.
            setDadosContrato({ subscriber: estado.subscriber, ucs: estado.ucs });
            await new Promise(resolve => setTimeout(resolve, 400));

            const pdfBase64 = await gerarPdfContratoBase64();
            const uc0 = estado.ucs?.[0];
            // Mesma paginação do ContratoAdesao (que tira o título repetido
            // antes de paginar): a assinatura vai na última folha do termo.
            const paginasTermo = dividirEmPaginas(semTituloRepetido(
                montarTextoContrato(estado.subscriber, uc0?.concessionaria, {
                    desconto: uc0?.desconto_assinante,
                    diaVencimento: uc0?.dia_vencimento
                }),
                TITULO_TERMO
            )).length;

            setEtapa('Enviando para assinatura digital...');
            const { data: fim, error } = await supabase.functions.invoke('onboarding-finalizar', {
                body: { token: onboardingToken, pdf_base64: pdfBase64, paginas_termo: paginasTermo }
            });

            if (error) {
                const { status, corpo, mensagem } = await lerErroFuncao(error);
                if (status === 409) {
                    const lista = (corpo?.faltantes || []).length;
                    showAlert(mensagem || `Faltam ${lista} documento(s).`, 'warning');
                    await carregarEstado(onboardingToken);
                    return;
                }
                if (status === 502) {
                    setPasso('pendente_equipe');
                    return;
                }
                if (status === 401) {
                    setPasso('expirado');
                    return;
                }
                throw new Error(mensagem);
            }
            if (fim?.error) throw new Error(fim.error);
            if (fim?.avisos?.length) console.warn('Avisos do onboarding:', fim.avisos);

            if (fim?.contrato_url) {
                // Página de termos com o link de assinatura embutido.
                window.location.href = fim.contrato_url;
                return;
            }
            setEstado(prev => ({ ...prev, etapa: 'enviado', signature_link: fim?.signature_link || prev?.signature_link }));
            setPasso('enviado');
        } catch (e) {
            console.error('Falha ao gerar/enviar contrato:', e);
            showAlert(e.message || 'Não foi possível gerar seu contrato. Tente de novo.', 'error');
        } finally {
            ocupadoRef.current = false;
            setLoading(false);
            setEtapa('');
        }
    };

    /** Contrato já enviado: o servidor reenvia o mesmo link, sem PDF novo. */
    const handleReenviar = async () => {
        if (ocupadoRef.current) return;
        ocupadoRef.current = true;
        setLoading(true);
        try {
            const { data: fim, error } = await supabase.functions.invoke('onboarding-finalizar', {
                body: { token: onboardingToken }
            });
            if (error) {
                const { status, mensagem } = await lerErroFuncao(error);
                if (status === 401) {
                    setPasso('expirado');
                    return;
                }
                throw new Error(mensagem);
            }
            if (fim?.error) throw new Error(fim.error);
            if (fim?.signature_link) setEstado(prev => ({ ...prev, signature_link: fim.signature_link }));
            showAlert('Pronto! Reenviamos o link de assinatura para o seu WhatsApp e e-mail.', 'success');
        } catch (e) {
            console.error('Falha ao reenviar:', e);
            showAlert(e.message || 'Não foi possível reenviar o link.', 'error');
        } finally {
            ocupadoRef.current = false;
            setLoading(false);
        }
    };

    const primeiroNome = (formData.name || '').split(' ')[0];

    if (passo === 'carregando') {
        return (
            <TelaMensagem icone={<Clock size={56} className="mx-auto mb-6 text-slate-400" />} titulo="Carregando sua adesão...">
                <p>Só um instante.</p>
            </TelaMensagem>
        );
    }

    if (passo === 'expirado') {
        return (
            <TelaMensagem icone={<Clock size={56} className="mx-auto mb-6 text-orange-500" />} titulo="Link expirado">
                <p className="text-lg">Link expirado, refaça a simulação.</p>
            </TelaMensagem>
        );
    }

    if (passo === 'erro_carga') {
        return (
            <TelaMensagem icone={<Clock size={56} className="mx-auto mb-6 text-orange-500" />} titulo="Não conseguimos abrir sua adesão">
                <p className="mb-6">Verifique sua conexão e tente de novo.</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-6 py-3 rounded-xl font-bold text-white"
                    style={{ backgroundColor: '#FF6600' }}
                >
                    Tentar de novo
                </button>
            </TelaMensagem>
        );
    }

    if (passo === 'assinado') {
        return (
            <TelaMensagem icone={<CheckCircle size={64} className="mx-auto mb-6 text-green-500" />} titulo="Adesão concluída!">
                <p className="text-lg mb-2">
                    Obrigado{primeiroNome ? `, ${primeiroNome}` : ''}. Seu contrato está assinado.
                </p>
                <p className="text-slate-500">Agora cuidamos da conexão da sua unidade consumidora e avisamos você pelo WhatsApp.</p>
            </TelaMensagem>
        );
    }

    if (passo === 'pendente_equipe') {
        return (
            <TelaMensagem icone={<CheckCircle size={64} className="mx-auto mb-6 text-green-500" />} titulo="Dados recebidos">
                <p className="text-lg">Recebemos seus dados; nossa equipe vai enviar o contrato em até 1 dia útil.</p>
            </TelaMensagem>
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

    const descontoExibido = estado?.ucs?.[0]?.desconto_assinante ?? paramDiscountPercent;

    return (
        <div className="min-h-screen bg-slate-50 font-inter">
            {/* Header / Banner */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-4 py-6">
                    <h1 className="text-3xl font-bold" style={{ color: '#003366' }}>
                        {formData.name || 'Novo Assinante'}
                    </h1>
                    <p className="text-slate-500 mt-2 text-lg">
                        {passo === 'dados'
                            ? 'Confira os detalhes da sua economia e finalize sua adesão abaixo.'
                            : 'Sua adesão fica salva: se sair, volte por este mesmo link.'}
                    </p>
                    <Passos atual={passo} />
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

                {passo === 'dados' && (<>
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
                            <p className="text-6xl font-bold mb-2">{descontoExibido}%</p>
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

                        {/* Representante legal — obrigatório para CNPJ: é quem
                            assina o termo em nome da empresa. */}
                        {ehCnpj && (
                            <div className="md:col-span-2 p-5 rounded-xl border border-orange-200 bg-orange-50">
                                <h3 className="text-base font-bold mb-4" style={{ color: '#003366' }}>Representante legal</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Nome do representante</label>
                                        <input
                                            type="text"
                                            value={formData.representante_nome}
                                            onChange={e => setFormData({ ...formData, representante_nome: e.target.value })}
                                            className={inputClass}
                                            placeholder="Quem assina pela empresa"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">CPF do representante</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={formData.representante_cpf}
                                            onChange={e => setFormData({ ...formData, representante_cpf: maskCpfCnpj(e.target.value).slice(0, 14) })}
                                            className={inputClass}
                                            placeholder="000.000.000-00"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

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
                    <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
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

                {/* Vencimento + aceite */}
                <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 md:p-10 space-y-8">
                    <div>
                        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2" style={{ color: '#003366' }}>
                            <div className="w-1 h-8 bg-[#FF6600] rounded-full"></div>
                            Dia de vencimento
                        </h2>
                        <p className="text-slate-500 mb-4">Escolha o dia do mês para pagar sua contribuição.</p>
                        <div className="grid grid-cols-4 gap-3 max-w-md">
                            {DIAS_VENCIMENTO.map(dia => (
                                <button
                                    key={dia}
                                    type="button"
                                    onClick={() => setDiaVencimento(dia)}
                                    aria-pressed={diaVencimento === dia}
                                    className={`py-4 rounded-xl font-bold text-lg border transition-colors ${diaVencimento === dia ? 'text-white border-transparent' : 'bg-white text-slate-700 border-slate-200 hover:border-[#FF6600]'}`}
                                    style={diaVencimento === dia ? { backgroundColor: '#003366' } : undefined}
                                >
                                    {dia}
                                </button>
                            ))}
                        </div>
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={aceite}
                            onChange={e => setAceite(e.target.checked)}
                            className="mt-1 w-5 h-5 accent-[#FF6600] shrink-0"
                        />
                        <span className="text-slate-600">
                            Li e aceito os{' '}
                            <a href={URL_TERMOS_USO} target="_blank" rel="noopener noreferrer" className="font-semibold underline" style={{ color: '#003366' }}>termos de uso</a>
                            {' '}e a{' '}
                            <a href={URL_PRIVACIDADE} target="_blank" rel="noopener noreferrer" className="font-semibold underline" style={{ color: '#003366' }}>política de privacidade</a>.
                        </span>
                    </label>
                </div>

                {/* Finalize Button */}
                <button
                    onClick={handleEnviarDados}
                    disabled={loading}
                    className="w-full py-5 text-xl font-bold text-white uppercase tracking-wider rounded-xl shadow-xl transition-all transform active:scale-[0.99] flex justify-center items-center gap-3 hover:shadow-2xl disabled:opacity-70"
                    style={{ backgroundColor: '#FF6600' }}
                >
                    {loading ? (etapa || 'Processando...') : (
                        <>
                            Continuar <ArrowRight size={24} />
                        </>
                    )}
                </button>

                </>)}

                {passo === 'documentos' && estado && (
                    <PassoDocumentos
                        token={onboardingToken}
                        estado={estado}
                        onCompleto={() => setPasso('contrato')}
                    />
                )}

                {passo === 'contrato' && estado && (
                    <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 md:p-10">
                        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2" style={{ color: '#003366' }}>
                            <div className="w-1 h-8 bg-[#FF6600] rounded-full"></div>
                            Contrato
                        </h2>
                        <p className="text-slate-500 mb-6">
                            Tudo certo com seus documentos. Confira o resumo e gere o termo de adesão para assinatura digital.
                        </p>
                        <div className="space-y-3 mb-8">
                            {(estado.ucs || []).map(uc => (
                                <div key={uc.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                                    <p className="font-bold text-slate-800">UC {uc.numero_uc}</p>
                                    <p className="text-sm text-slate-500">
                                        {[uc.concessionaria,
                                          uc.desconto_assinante != null ? `${Number(uc.desconto_assinante)}% de desconto` : null,
                                          uc.dia_vencimento ? `vencimento dia ${uc.dia_vencimento}` : null]
                                            .filter(Boolean).join(' • ')}
                                    </p>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={handleGerarContrato}
                            disabled={loading}
                            className="w-full py-5 text-lg md:text-xl font-bold text-white uppercase tracking-wider rounded-xl shadow-xl flex justify-center items-center gap-3 disabled:opacity-70 disabled:cursor-wait"
                            style={{ backgroundColor: '#FF6600' }}
                        >
                            {loading ? (etapa || 'Processando...') : (<><FileSignature size={24} /> Gerar e enviar meu contrato</>)}
                        </button>
                        {loading && (
                            <p className="text-center text-sm text-slate-500 mt-3">
                                Não feche esta página — estamos preparando seu contrato para assinatura.
                            </p>
                        )}
                    </div>
                )}

                {passo === 'enviado' && (
                    <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 md:p-10 text-center">
                        <CheckCircle size={56} className="mx-auto mb-4 text-green-500" />
                        <h2 className="text-2xl font-bold mb-3" style={{ color: '#003366' }}>Contrato enviado para assinatura</h2>
                        <p className="text-slate-600 mb-6">
                            Enviamos o link de assinatura para o seu WhatsApp e e-mail. É o último passo.
                        </p>
                        {estado?.signature_link && (
                            <a
                                href={estado.signature_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full md:w-auto inline-flex justify-center items-center gap-2 px-8 py-4 rounded-xl font-bold text-white text-lg shadow-lg mb-4"
                                style={{ backgroundColor: '#FF6600' }}
                            >
                                <Link2 size={22} /> Assinar meu contrato
                            </a>
                        )}
                        <div>
                            <button
                                onClick={handleReenviar}
                                disabled={loading}
                                className="mt-2 px-6 py-3 rounded-xl font-bold border disabled:opacity-60 disabled:cursor-wait"
                                style={{ color: '#003366', borderColor: '#003366' }}
                            >
                                {loading ? 'Reenviando...' : 'Reenviar link'}
                            </button>
                        </div>
                    </div>
                )}

            </div>

            {paginasContrato}

            {/* UC Modal */}
            {showUcModal && (
                <PublicConsumerUnitForm
                    concessionariaDefault={paramConcessionaria}
                    titularDefault={formData.name}
                    docAssinante={formData.cpf_cnpj}
                    franquiaDefault={consumerUnits.length === 0 ? paramConsumo : ''}
                    enderecoDefault={{
                        cep: formData.cep,
                        rua: formData.rua,
                        numero: formData.numero,
                        complemento: formData.complemento,
                        bairro: formData.bairro,
                        cidade: formData.cidade,
                        uf: formData.uf,
                        ibge: formData.ibge
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
