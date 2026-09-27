import { useState, useEffect, useMemo } from 'react';
import {
    X,
    Save,
    Sparkles,
    Check,
    Percent,
    BatteryCharging,
    ShieldCheck,
    AlertTriangle,
    TrendingUp,
    Award,
    Users,
    Zap,
    Activity,
    Link2
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useUI } from '../../../contexts/UIContext';

const formatCurrencyUnit = (val, decimals = 4) => {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: 6
    });
};

const formatPct = (val, decimals = 2) => {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
};

// Extrai o valor do Lastro (Tarifa da Concessionária - Desconto do Assinante do Plano)
export const extractSubscriptionPlanLastro = (planoAssinatura) => {
    if (!planoAssinatura) {
        return {
            concessionariaNome: 'Cosern',
            tarifaConcessionaria: 1.0300,
            descontoPlanoPct: 15,
            descontoPlanoValor: 0.1545,
            lastroEletroposto: 0.8755
        };
    }
    const lastroCfg = planoAssinatura.recorrente_config?.lastro_tarifario || {};
    const tarifaConc = Number(lastroCfg.tarifa_bruta) > 0 ? Number(lastroCfg.tarifa_bruta) : 1.0300;
    const descPct = Number(planoAssinatura.desconto_assinante ?? 15);
    const descValor = tarifaConc * (descPct / 100);
    const lastro = Math.max(0, tarifaConc - descValor);

    return {
        concessionariaNome: lastroCfg.concessionaria_nome || 'Concessionária',
        tarifaConcessionaria: tarifaConc,
        descontoPlanoPct: descPct,
        descontoPlanoValor: descValor,
        lastroEletroposto: Number(lastro.toFixed(6))
    };
};

export default function EletropostoPlanModal({
    isOpen,
    onClose,
    onSave,
    planToEdit,
    subscriptionPlans = []
}) {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(false);

    // Plano de Assinatura Vinculado (Lastro do Eletroposto)
    const [selectedSubPlanId, setSelectedSubPlanId] = useState('');
    const [planoVinculadoNome, setPlanoVinculadoNome] = useState('Plano Ultra 15%');
    const [concessionariaOrigem, setConcessionariaOrigem] = useState('Cosern');
    const [tarifaOrigem, setTarifaOrigem] = useState(1.0300);
    const [descontoOrigemPct, setDescontoOrigemPct] = useState(15);

    // Valor do Lastro (Tarifa Concessionária - Desconto Assinante do Plano Vinculado)
    // Sem Fio B, pois já foi deduzido no Plano de Assinatura!
    const [valorLastroPlano, setValorLastroPlano] = useState('0.8755');

    // Estado Principal do Plano de Eletroposto
    const [nome, setNome] = useState('');
    const [descontoEletroposto, setDescontoEletroposto] = useState('10');
    const [ativo, setAtivo] = useState(true);
    const [recompensasAtivo, setRecompensasAtivo] = useState(true);
    const [tipoRecompensa, setTipoRecompensa] = useState('recorrente'); // 'start' | 'recorrente' | 'hibrido'

    // Piso Contratual do Fornecedor / Operador (% sobre o Lastro)
    const [pisoFornecedorPct, setPisoFornecedorPct] = useState('50');

    // Cargos no Bloco Recorrente (% sobre a Base de Cálculo Líquida do Eletroposto)
    const [regrasRecorrente, setRegrasRecorrente] = useState({
        b2w: '10',
        lider: '1',
        ppe: '4',
        ppp: '4',
        ppf: '2',
        assinante_conect: '2'
    });

    // Configuração Start (Recargas / Faturas Iniciais)
    const [faturasElegiveisStart, setFaturasElegiveisStart] = useState([1]);
    const [regrasStart, setRegrasStart] = useState({
        1: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
        2: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
        3: { b2w: '0', lider: '0', ppe: '0', ppp: '0', ppf: '0', assinante_conect: '0' }
    });

    // Inicializa dados ao abrir o modal
    useEffect(() => {
        if (!isOpen) return;

        if (planToEdit) {
            setNome(planToEdit.nome || '');
            setDescontoEletroposto(String(planToEdit.desconto_assinante ?? '10'));
            setAtivo(planToEdit.ativo ?? true);
            setRecompensasAtivo(planToEdit.recompensas_ativo ?? true);
            setTipoRecompensa(planToEdit.tipo_recompensa || 'recorrente');

            const recCfg = planToEdit.recorrente_config || {};
            const vinc = recCfg.plano_assinatura_vinculado || {};
            const lastro = recCfg.lastro_tarifario || {};

            setSelectedSubPlanId(vinc.id || '');
            setPlanoVinculadoNome(vinc.nome || 'Plano de Assinatura');
            setConcessionariaOrigem(vinc.concessionaria_nome || 'Cosern');
            setTarifaOrigem(Number(vinc.tarifa_bruta_concessionaria ?? 1.0300));
            setDescontoOrigemPct(Number(vinc.desconto_plano_pct ?? 15));
            setValorLastroPlano(String(lastro.tarifa_bruta ?? vinc.valor_lastro_eletroposto ?? '0.8755'));
            setPisoFornecedorPct(String(lastro.piso_fornecedor_pct ?? '50'));

            const rRec = recCfg.regras || {};
            setRegrasRecorrente({
                b2w: String(rRec.b2w ?? rRec.associacao ?? '10'),
                lider: String(rRec.lider ?? rRec.coordenador ?? '1'),
                ppe: String(rRec.ppe ?? rRec.embaixador ?? '4'),
                ppp: String(rRec.ppp ?? rRec.embaixador ?? '4'),
                ppf: String(rRec.ppf ?? '2'),
                assinante_conect: String(rRec.assinante_conect ?? rRec.assinante ?? '2')
            });

            if (planToEdit.start_config) {
                setFaturasElegiveisStart(planToEdit.start_config.faturas_elegiveis || [1]);
                const mapStartRule = (ruleObj = {}) => ({
                    b2w: String(ruleObj.b2w ?? ruleObj.associacao ?? '0'),
                    lider: String(ruleObj.lider ?? ruleObj.coordenador ?? '0'),
                    ppe: String(ruleObj.ppe ?? ruleObj.embaixador ?? '0'),
                    ppp: String(ruleObj.ppp ?? ruleObj.embaixador ?? '0'),
                    ppf: String(ruleObj.ppf ?? '0'),
                    assinante_conect: String(ruleObj.assinante_conect ?? ruleObj.assinante ?? '0')
                });
                setRegrasStart({
                    1: mapStartRule(planToEdit.start_config.regras?.[1]),
                    2: mapStartRule(planToEdit.start_config.regras?.[2]),
                    3: mapStartRule(planToEdit.start_config.regras?.[3])
                });
            }
        } else {
            // Novo plano de eletroposto: vincula automaticamente ao 1º Plano de Assinatura disponível
            const defaultSubPlan = subscriptionPlans.find(p => p.ativo) || subscriptionPlans[0] || null;
            const info = extractSubscriptionPlanLastro(defaultSubPlan);

            setNome('');
            setDescontoEletroposto('10');
            setAtivo(true);
            setRecompensasAtivo(true);
            setTipoRecompensa('recorrente');
            setSelectedSubPlanId(defaultSubPlan?.id || '');
            setPlanoVinculadoNome(defaultSubPlan?.nome || 'Plano Ultra 15%');
            setConcessionariaOrigem(info.concessionariaNome);
            setTarifaOrigem(info.tarifaConcessionaria);
            setDescontoOrigemPct(info.descontoPlanoPct);
            setValorLastroPlano(info.lastroEletroposto.toFixed(4));
            setPisoFornecedorPct('50');
            setRegrasRecorrente({
                b2w: '10',
                lider: '1',
                ppe: '4',
                ppp: '4',
                ppf: '2',
                assinante_conect: '2'
            });
            setFaturasElegiveisStart([1]);
            setRegrasStart({
                1: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
                2: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
                3: { b2w: '0', lider: '0', ppe: '0', ppp: '0', ppf: '0', assinante_conect: '0' }
            });
        }
    }, [planToEdit, isOpen, subscriptionPlans]);

    // Handler ao trocar o Plano de Assinatura que serve de Lastro
    const handleSelectSubscriptionPlan = (e) => {
        const subId = e.target.value;
        setSelectedSubPlanId(subId);
        if (!subId) return;

        const found = subscriptionPlans.find(p => String(p.id) === String(subId));
        if (found) {
            const info = extractSubscriptionPlanLastro(found);
            setPlanoVinculadoNome(found.nome);
            setConcessionariaOrigem(info.concessionariaNome);
            setTarifaOrigem(info.tarifaConcessionaria);
            setDescontoOrigemPct(info.descontoPlanoPct);
            setValorLastroPlano(info.lastroEletroposto.toFixed(4));
        }
    };

    // MOTOR DE CÁLCULO DINÂMICO DO ELETROPOSTO
    // Lastro = Tarifa da Concessionária menos o Desconto do Assinante ofertado no Plano de Assinatura (SEM Fio B!)
    const calc = useMemo(() => {
        const vLastro = Math.max(0, parseFloat(valorLastroPlano) || 0);
        const pctDescEletroposto = Math.max(0, parseFloat(descontoEletroposto) || 0);

        // 2º Item: (-) Desconto do Assinante / Usuário no Eletroposto (% sobre o Lastro)
        const vDescEletroposto = vLastro * (pctDescEletroposto / 100);
        const pctRealDescEletroposto = pctDescEletroposto;

        // 3º Item: (=) Base de Cálculo Líquida (Sem Fio B, pois já foi deduzido no Plano de Assinatura)
        const baseLiquida = vLastro - vDescEletroposto;
        const pctRealBaseLiquida = vLastro > 0 ? (baseLiquida / vLastro) * 100 : 0;

        // Percentuais dos Cargos sobre a Base de Cálculo Líquida
        const pctB2W = Math.max(0, parseFloat(regrasRecorrente.b2w) || 0);
        const pctLider = Math.max(0, parseFloat(regrasRecorrente.lider) || 0);
        const pctPPE = Math.max(0, parseFloat(regrasRecorrente.ppe) || 0);
        const pctPPP = Math.max(0, parseFloat(regrasRecorrente.ppp) || 0);
        const pctPPF = Math.max(0, parseFloat(regrasRecorrente.ppf) || 0);
        const pctAssinanteConect = Math.max(0, parseFloat(regrasRecorrente.assinante_conect) || 0);

        const basePositiva = Math.max(0, baseLiquida);
        const vB2W = basePositiva * (pctB2W / 100);
        const vLider = basePositiva * (pctLider / 100);
        const vPPE = basePositiva * (pctPPE / 100);
        const vPPP = basePositiva * (pctPPP / 100);
        const vPPF = basePositiva * (pctPPF / 100);
        const vAssinanteConect = basePositiva * (pctAssinanteConect / 100);

        // Percentuais Reais sobre o Lastro do Plano de Assinatura
        const pctRealB2W = vLastro > 0 ? (vB2W / vLastro) * 100 : 0;
        const pctRealLider = vLastro > 0 ? (vLider / vLastro) * 100 : 0;
        const pctRealPPE = vLastro > 0 ? (vPPE / vLastro) * 100 : 0;
        const pctRealPPP = vLastro > 0 ? (vPPP / vLastro) * 100 : 0;
        const pctRealPPF = vLastro > 0 ? (vPPF / vLastro) * 100 : 0;
        const pctRealAssinanteConect = vLastro > 0 ? (vAssinanteConect / vLastro) * 100 : 0;

        // Teto de segurança entre PPE, PPP e PPF
        const pctParceiroPowerTeto = Math.max(pctPPE, pctPPP, pctPPF);
        const vParceiroPowerTeto = basePositiva * (pctParceiroPowerTeto / 100);
        const pctRealParceiroPowerTeto = vLastro > 0 ? (vParceiroPowerTeto / vLastro) * 100 : 0;

        let tetoLabel = 'PPE';
        if (pctPPP >= pctPPE && pctPPP >= pctPPF) tetoLabel = 'PPP';
        if (pctPPE >= pctPPP && pctPPE >= pctPPF) tetoLabel = 'PPE';
        if (pctPPF > pctPPE && pctPPF > pctPPP) tetoLabel = 'PPF';

        const totalDeducoesBase = vB2W + vLider + vParceiroPowerTeto + vAssinanteConect;
        const totalPctSobreBase = pctB2W + pctLider + pctParceiroPowerTeto + pctAssinanteConect;

        // (=) Líquido Efetivo do Fornecedor / Operador Eletroposto
        const liquidoEfetivoFornecedor = baseLiquida - totalDeducoesBase;
        const pctRealLiquidoFornecedor = vLastro > 0 ? (liquidoEfetivoFornecedor / vLastro) * 100 : 0;

        // Piso Contratual do Fornecedor (% sobre o Lastro)
        const pctPisoFornecedor = Math.max(0, parseFloat(pisoFornecedorPct) || 0);
        const vPisoFornecedor = vLastro * (pctPisoFornecedor / 100);
        const pctRealPisoFornecedor = pctPisoFornecedor;

        // MARGEM LIVRE / EXCEDENTE
        const margemLivre = liquidoEfetivoFornecedor - vPisoFornecedor;
        const pctRealMargemLivre = vLastro > 0 ? (margemLivre / vLastro) * 100 : 0;

        const isDeficitario =
            vLastro <= 0 ||
            baseLiquida <= 0 ||
            liquidoEfetivoFornecedor < 0 ||
            margemLivre < -0.000001;

        return {
            vLastro,
            pctDescEletroposto,
            vDescEletroposto,
            pctRealDescEletroposto,
            baseLiquida,
            pctRealBaseLiquida,
            pctB2W,
            vB2W,
            pctRealB2W,
            pctLider,
            vLider,
            pctRealLider,
            pctPPE,
            vPPE,
            pctRealPPE,
            pctPPP,
            vPPP,
            pctRealPPP,
            pctPPF,
            vPPF,
            pctRealPPF,
            pctParceiroPowerTeto,
            vParceiroPowerTeto,
            pctRealParceiroPowerTeto,
            tetoLabel,
            pctAssinanteConect,
            vAssinanteConect,
            pctRealAssinanteConect,
            totalDeducoesBase,
            totalPctSobreBase,
            liquidoEfetivoFornecedor,
            pctRealLiquidoFornecedor,
            pctPisoFornecedor,
            vPisoFornecedor,
            pctRealPisoFornecedor,
            margemLivre,
            pctRealMargemLivre,
            isDeficitario
        };
    }, [valorLastroPlano, descontoEletroposto, regrasRecorrente, pisoFornecedorPct]);

    if (!isOpen) return null;

    const handleRecorrentePctChange = (campo, value) => {
        setRegrasRecorrente(prev => ({
            ...prev,
            [campo]: value
        }));
    };

    const toggleFaturaStart = (faturaNum) => {
        setFaturasElegiveisStart(prev => {
            if (prev.includes(faturaNum)) {
                if (prev.length === 1) {
                    showAlert('Pelo menos um ciclo deve ser selecionado no Start.', 'warning');
                    return prev;
                }
                return prev.filter(f => f !== faturaNum).sort((a, b) => a - b);
            } else {
                return [...prev, faturaNum].sort((a, b) => a - b);
            }
        });
    };

    const handleStartPctChange = (faturaNum, campo, value) => {
        setRegrasStart(prev => ({
            ...prev,
            [faturaNum]: {
                ...prev[faturaNum],
                [campo]: value
            }
        }));
    };

    const startHasDeficit = faturasElegiveisStart.some(fatNum => {
        const r = regrasStart[fatNum] || {};
        const maxPP = Math.max(parseFloat(r.ppe) || 0, parseFloat(r.ppp) || 0, parseFloat(r.ppf) || 0);
        const soma = (parseFloat(r.b2w) || 0) + (parseFloat(r.lider) || 0) + maxPP + (parseFloat(r.assinante_conect) || 0);
        return soma > 100;
    });

    const bloqueadoPorDeficit = recompensasAtivo && (
        ((tipoRecompensa === 'recorrente' || tipoRecompensa === 'hibrido') && calc.isDeficitario) ||
        ((tipoRecompensa === 'start' || tipoRecompensa === 'hibrido') && startHasDeficit)
    );

    const handleSave = async (e) => {
        e.preventDefault();

        if (!nome.trim()) {
            showAlert('Por favor, informe o Nome do Plano de Eletroposto.', 'error');
            return;
        }

        if (bloqueadoPorDeficit) {
            showAlert('Operação bloqueada: O plano de Eletroposto apresenta resultado deficitário. Ajuste os percentuais.', 'error');
            return;
        }

        setLoading(true);

        const numRec = {
            b2w: parseFloat(regrasRecorrente.b2w) || 0,
            lider: parseFloat(regrasRecorrente.lider) || 0,
            ppe: parseFloat(regrasRecorrente.ppe) || 0,
            ppp: parseFloat(regrasRecorrente.ppp) || 0,
            ppf: parseFloat(regrasRecorrente.ppf) || 0,
            assinante_conect: parseFloat(regrasRecorrente.assinante_conect) || 0,
            associacao: parseFloat(regrasRecorrente.b2w) || 0,
            coordenador: parseFloat(regrasRecorrente.lider) || 0,
            embaixador: Math.max(parseFloat(regrasRecorrente.ppe) || 0, parseFloat(regrasRecorrente.ppp) || 0),
            assinante: parseFloat(regrasRecorrente.assinante_conect) || 0
        };

        const formatStartRulesPayload = (r = {}) => ({
            b2w: parseFloat(r.b2w) || 0,
            lider: parseFloat(r.lider) || 0,
            ppe: parseFloat(r.ppe) || 0,
            ppp: parseFloat(r.ppp) || 0,
            ppf: parseFloat(r.ppf) || 0,
            assinante_conect: parseFloat(r.assinante_conect) || 0,
            associacao: parseFloat(r.b2w) || 0,
            coordenador: parseFloat(r.lider) || 0,
            embaixador: Math.max(parseFloat(r.ppe) || 0, parseFloat(r.ppp) || 0),
            assinante: parseFloat(r.assinante_conect) || 0
        });

        const payload = {
            nome: nome.trim(),
            desconto_assinante: parseFloat(descontoEletroposto) || 0,
            ativo,
            recompensas_ativo: recompensasAtivo,
            tipo_recompensa: tipoRecompensa,
            start_config: {
                faturas_elegiveis: faturasElegiveisStart,
                regras: {
                    1: formatStartRulesPayload(regrasStart[1]),
                    2: formatStartRulesPayload(regrasStart[2]),
                    3: formatStartRulesPayload(regrasStart[3])
                }
            },
            recorrente_config: {
                categoria_plano: 'eletroposto',
                vigencia_tipo: 'status_ativo_entidade',
                meses: null,
                plano_assinatura_vinculado: {
                    id: selectedSubPlanId || null,
                    nome: planoVinculadoNome,
                    concessionaria_nome: concessionariaOrigem,
                    tarifa_bruta_concessionaria: tarifaOrigem,
                    desconto_plano_pct: descontoOrigemPct,
                    valor_lastro_eletroposto: calc.vLastro
                },
                lastro_tarifario: {
                    tipo_lastro: 'plano_assinatura_sem_fio_b',
                    concessionaria_nome: `${planoVinculadoNome} (${concessionariaOrigem})`,
                    tarifa_bruta: calc.vLastro,
                    fio_b: 0, // Fio B já deduzido no Plano de Assinatura
                    base_calculo_liquida: Number(calc.baseLiquida.toFixed(6)),
                    piso_fornecedor_pct: calc.pctPisoFornecedor,
                    liquido_efetivo_fornecedor: Number(calc.liquidoEfetivoFornecedor.toFixed(6)),
                    margem_livre_excedente: Number(calc.margemLivre.toFixed(6))
                },
                regras: numRec
            },
            updated_at: new Date().toISOString()
        };

        try {
            if (planToEdit?.id) {
                const { error } = await supabase
                    .from('planos_assinatura_energia')
                    .update(payload)
                    .eq('id', planToEdit.id);

                if (error) throw error;
                showAlert('Plano de Eletroposto atualizado com sucesso!', 'success');
            } else {
                const { error } = await supabase
                    .from('planos_assinatura_energia')
                    .insert([payload]);

                if (error) throw error;
                showAlert('Plano de Eletroposto criado com sucesso!', 'success');
            }

            if (onSave) onSave();
            onClose();
        } catch (err) {
            console.error('Erro ao salvar plano de eletroposto:', err);
            showAlert('Erro ao salvar plano: ' + (err.message || 'Erro desconhecido'), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.72)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(8px)', padding: '1rem'
        }}>
            <div style={{
                background: '#ffffff', width: '100%', maxWidth: '980px', borderRadius: '30px',
                maxHeight: '94vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
                animation: 'crmModalFadeIn 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
                border: '1px solid #e2e8f0'
            }}>
                <style>{`
                    @keyframes crmModalFadeIn {
                        from { opacity: 0; transform: translateY(12px) scale(0.985); }
                        to { opacity: 1; transform: translateY(0) scale(1); }
                    }
                    .crm-scrollbar::-webkit-scrollbar { width: 7px; }
                    .crm-scrollbar::-webkit-scrollbar-track { background: #f8fafc; }
                    .crm-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; }
                    .crm-input {
                        transition: all 0.2s ease;
                    }
                    .crm-input:focus {
                        border-color: #10b981 !important;
                        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12) !important;
                        outline: none;
                    }
                    .ledger-row {
                        display: grid;
                        grid-template-columns: 2.3fr 1.35fr 1.15fr 1fr;
                        align-items: center;
                        gap: 0.75rem;
                        padding: 0.75rem 1.25rem;
                        border-bottom: 1px solid #f1f5f9;
                        transition: background 0.15s ease;
                    }
                    .ledger-row:hover {
                        background: #f8fafc;
                    }
                `}</style>

                {/* HEADER PREMIUM (UI/UX CRM) */}
                <div style={{
                    padding: '1.4rem 2rem',
                    background: 'linear-gradient(135deg, #064e3b 0%, #1e293b 100%)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    color: '#ffffff'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{
                            width: '48px', height: '48px', borderRadius: '14px',
                            background: 'rgba(16, 185, 129, 0.2)', border: '1px solid rgba(52, 211, 153, 0.35)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34d399'
                        }}>
                            <BatteryCharging size={24} />
                        </div>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em' }}>
                                    {planToEdit ? 'Editar Plano de Eletroposto & Recompensas' : 'Novo Plano de Eletroposto & Recompensas'}
                                </h3>
                                <span style={{
                                    fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.6rem',
                                    borderRadius: '20px', background: 'rgba(59, 130, 246, 0.25)',
                                    color: '#93c5fd', border: '1px solid rgba(147, 197, 253, 0.35)'
                                }}>
                                    Lastro: Plano de Assinatura (Isento de Fio B)
                                </span>
                            </div>
                            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#cbd5e1' }}>
                                Ponto de partida = Tarifa da Concessionária menos o Desconto do Assinante do Plano vinculado
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.15)',
                            cursor: 'pointer', color: '#f8fafc', padding: '0.55rem', borderRadius: '12px',
                            display: 'flex', transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* BODY SCROLLABLE */}
                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div className="crm-scrollbar" style={{
                        padding: '1.75rem 2rem', overflowY: 'auto', flex: 1,
                        background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '1.5rem'
                    }}>

                        {/* BLOCO 1: VINCULAÇÃO AO PLANO DE ASSINATURA (LASTRO DO ELETROPOSTO) */}
                        <div style={{
                            background: '#ffffff', padding: '1.5rem', borderRadius: '20px',
                            border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.75rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                                    <Link2 size={18} color="#059669" />
                                    <h4 style={{ margin: 0, fontSize: '0.96rem', color: '#1e293b', fontWeight: 700 }}>
                                        1. Identificação e Plano de Assinatura Vinculado (Lastro)
                                    </h4>
                                </div>

                                {/* Status Ativo */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <span style={{
                                        fontSize: '0.76rem', fontWeight: 700,
                                        color: ativo ? '#16a34a' : '#64748b',
                                        background: ativo ? '#f0fdf4' : '#f1f5f9',
                                        border: `1px solid ${ativo ? '#22c55e' : '#cbd5e1'}`,
                                        padding: '0.25rem 0.7rem', borderRadius: '20px'
                                    }}>
                                        {ativo ? '● Eletroposto Ativo' : '○ Inativo'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setAtivo(!ativo)}
                                        style={{
                                            width: '44px', height: '24px', borderRadius: '20px',
                                            background: ativo ? '#22c55e' : '#cbd5e1', border: 'none',
                                            cursor: 'pointer', position: 'relative', transition: 'background 0.2s', padding: 0
                                        }}
                                    >
                                        <div style={{
                                            width: '18px', height: '18px', borderRadius: '50%', background: 'white',
                                            position: 'absolute', top: '3px', left: ativo ? '23px' : '3px',
                                            transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                        }} />
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.7fr', gap: '1rem' }}>
                                {/* Nome do Plano de Eletroposto */}
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.4rem' }}>
                                        Nome do Plano de Eletroposto *
                                    </label>
                                    <input
                                        type="text"
                                        className="crm-input"
                                        placeholder="Ex: Eletroposto Ultra Mobility"
                                        value={nome}
                                        onChange={e => setNome(e.target.value)}
                                        required
                                        style={{
                                            width: '100%', padding: '0.75rem 0.95rem', borderRadius: '12px',
                                            border: '1px solid #cbd5e1', fontSize: '0.88rem', color: '#1e293b',
                                            boxSizing: 'border-box', fontWeight: 600
                                        }}
                                    />
                                </div>

                                {/* Seletor do Plano de Assinatura que serve de Lastro */}
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.4rem' }}>
                                        Selecionar Plano de Assinatura Vinculado (Define o Lastro sem Fio B) *
                                    </label>
                                    <select
                                        className="crm-input"
                                        value={selectedSubPlanId}
                                        onChange={handleSelectSubscriptionPlan}
                                        style={{
                                            width: '100%', padding: '0.75rem 0.95rem', borderRadius: '12px',
                                            border: '1px solid #cbd5e1', fontSize: '0.86rem', color: '#1e293b',
                                            background: '#ffffff', boxSizing: 'border-box', fontWeight: 600, cursor: 'pointer'
                                        }}
                                    >
                                        {subscriptionPlans.length === 0 && (
                                            <option value="">
                                                Referência Padrão ({planoVinculadoNome} — Lastro R$ {formatCurrencyUnit(valorLastroPlano, 4)}/kWh)
                                            </option>
                                        )}
                                        {subscriptionPlans.map(subPlan => {
                                            const info = extractSubscriptionPlanLastro(subPlan);
                                            return (
                                                <option key={subPlan.id} value={subPlan.id}>
                                                    {subPlan.nome} ({info.concessionariaNome}: R$ {formatCurrencyUnit(info.tarifaConcessionaria, 4)} - {formatPct(info.descontoPlanoPct)}% = Lastro R$ {formatCurrencyUnit(info.lastroEletroposto, 4)}/kWh)
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                            </div>

                            {/* Composição Explicativa do Lastro Herdado do Plano de Assinatura */}
                            <div style={{
                                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.85rem',
                                marginTop: '1.1rem', paddingTop: '1.1rem', borderTop: '1px solid #f1f5f9'
                            }}>
                                <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, display: 'block' }}>
                                        Origem ({concessionariaOrigem} - {descontoOrigemPct}%)
                                    </span>
                                    <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' }}>
                                        R$ {formatCurrencyUnit(tarifaOrigem, 4)} - {formatPct(descontoOrigemPct)}% = R$ {formatCurrencyUnit(calc.vLastro, 4)}
                                    </span>
                                </div>

                                <div style={{ background: '#ecfdf5', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #a7f3d0' }}>
                                    <span style={{ fontSize: '0.72rem', color: '#047857', fontWeight: 700, display: 'block' }}>
                                        Fio B (Isento no Eletroposto)
                                    </span>
                                    <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#059669' }}>
                                        Já deduzido na Assinatura
                                    </span>
                                </div>

                                <div style={{ background: '#eff6ff', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #bfdbfe' }}>
                                    <span style={{ fontSize: '0.72rem', color: '#1d4ed8', fontWeight: 700, display: 'block' }}>
                                        (=) Base Líquida Eletroposto
                                    </span>
                                    <span style={{ fontSize: '1rem', fontWeight: 800, color: '#1e40af' }}>
                                        R$ {formatCurrencyUnit(calc.baseLiquida, 4)} <small style={{ fontSize: '0.72rem' }}>({formatPct(calc.pctRealBaseLiquida)}%)</small>
                                    </span>
                                </div>

                                <div style={{
                                    background: calc.isDeficitario ? '#fef2f2' : '#f0fdf4',
                                    padding: '0.75rem 1rem', borderRadius: '12px',
                                    border: `1px solid ${calc.isDeficitario ? '#ef4444' : '#22c55e'}`
                                }}>
                                    <span style={{
                                        fontSize: '0.72rem',
                                        color: calc.isDeficitario ? '#b91c1c' : '#15803d',
                                        fontWeight: 700, display: 'block'
                                    }}>
                                        Margem Livre / Excedente
                                    </span>
                                    <span style={{
                                        fontSize: '1rem', fontWeight: 800,
                                        color: calc.isDeficitario ? '#dc2626' : '#16a34a'
                                    }}>
                                        {calc.margemLivre >= 0 ? '+ ' : ''}R$ {formatCurrencyUnit(calc.margemLivre, 6)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* BLOCO 2: RECOMPENSAS E DEMONSTRATIVO DO ELETROPOSTO */}
                        <div style={{
                            background: '#ffffff', padding: '1.5rem', borderRadius: '20px',
                            border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem'
                            }}>
                                <div>
                                    <h4 style={{ margin: 0, fontSize: '1rem', color: '#0f172a', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Sparkles size={19} color="#059669" />
                                        2. Estrutura de Recompensas do Eletroposto
                                    </h4>
                                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                                        Sem incidência de Fio B • Cargos: <strong>B2W</strong>, <strong>Líder</strong>, <strong>Parceiro Power (PPE / PPP / PPF)</strong> e <strong>Assinante Conect</strong>
                                    </p>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                                    <div style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                                        background: '#ecfdf5', border: '1px solid #6ee7b7',
                                        color: '#047857', padding: '0.4rem 0.85rem', borderRadius: '12px',
                                        fontSize: '0.76rem', fontWeight: 700
                                    }}>
                                        <Activity size={15} color="#059669" />
                                        Vigência: Vinculada ao Status Ativo no Sistema
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: recompensasAtivo ? '#16a34a' : '#64748b' }}>
                                            {recompensasAtivo ? 'Recompensas Ativas' : 'Desativadas'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setRecompensasAtivo(!recompensasAtivo)}
                                            style={{
                                                width: '44px', height: '24px', borderRadius: '20px',
                                                background: recompensasAtivo ? '#10b981' : '#cbd5e1', border: 'none',
                                                cursor: 'pointer', position: 'relative', transition: 'background 0.2s', padding: 0
                                            }}
                                        >
                                            <div style={{
                                                width: '18px', height: '18px', borderRadius: '50%', background: 'white',
                                                position: 'absolute', top: '3px', left: recompensasAtivo ? '23px' : '3px',
                                                transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                            }} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {recompensasAtivo ? (
                                <>
                                    {/* Modalidades */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.85rem', marginBottom: '1.5rem' }}>
                                        <button
                                            type="button"
                                            onClick={() => setTipoRecompensa('recorrente')}
                                            style={{
                                                padding: '0.9rem 1.1rem', borderRadius: '14px', border: '2px solid',
                                                borderColor: tipoRecompensa === 'recorrente' ? '#22c55e' : '#e2e8f0',
                                                background: tipoRecompensa === 'recorrente' ? '#f0fdf4' : '#ffffff',
                                                cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: tipoRecompensa === 'recorrente' ? '#15803d' : '#1e293b' }}>
                                                    Recorrente (Por kWh Recarregado)
                                                </span>
                                                {tipoRecompensa === 'recorrente' && <Check size={16} color="#15803d" />}
                                            </div>
                                            <span style={{ fontSize: '0.73rem', color: '#64748b', display: 'block' }}>
                                                Repasse contínuo enquanto a entidade estiver Ativa
                                            </span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setTipoRecompensa('start')}
                                            style={{
                                                padding: '0.9rem 1.1rem', borderRadius: '14px', border: '2px solid',
                                                borderColor: tipoRecompensa === 'start' ? '#3b82f6' : '#e2e8f0',
                                                background: tipoRecompensa === 'start' ? '#eff6ff' : '#ffffff',
                                                cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: tipoRecompensa === 'start' ? '#1d4ed8' : '#1e293b' }}>
                                                    Start (Adesão Eletroposto)
                                                </span>
                                                {tipoRecompensa === 'start' && <Check size={16} color="#1d4ed8" />}
                                            </div>
                                            <span style={{ fontSize: '0.73rem', color: '#64748b', display: 'block' }}>
                                                Bonificação nos ciclos iniciais (1º, 2º ou 3º ciclo)
                                            </span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setTipoRecompensa('hibrido')}
                                            style={{
                                                padding: '0.9rem 1.1rem', borderRadius: '14px', border: '2px solid',
                                                borderColor: tipoRecompensa === 'hibrido' ? '#8b5cf6' : '#e2e8f0',
                                                background: tipoRecompensa === 'hibrido' ? '#f5f3ff' : '#ffffff',
                                                cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: tipoRecompensa === 'hibrido' ? '#6d28d9' : '#1e293b' }}>
                                                    Híbrido (Start + Recorrente)
                                                </span>
                                                {tipoRecompensa === 'hibrido' && <Check size={16} color="#6d28d9" />}
                                            </div>
                                            <span style={{ fontSize: '0.73rem', color: '#64748b', display: 'block' }}>
                                                Bônus de entrada + Recorrência vitalícia (status ativo)
                                            </span>
                                        </button>
                                    </div>

                                    {/* DEMONSTRATIVO RECORRENTE DO ELETROPOSTO (SEM FIO B) */}
                                    {(tipoRecompensa === 'recorrente' || tipoRecompensa === 'hibrido') && (
                                        <div style={{
                                            borderRadius: '18px', border: '1px solid #cbd5e1',
                                            background: '#ffffff', overflow: 'hidden',
                                            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.04)',
                                            marginBottom: tipoRecompensa === 'hibrido' ? '1.5rem' : 0
                                        }}>
                                            <div style={{
                                                padding: '1rem 1.25rem',
                                                background: 'linear-gradient(90deg, #064e3b 0%, #0f172a 100%)',
                                                color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                flexWrap: 'wrap', gap: '0.5rem'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                    <TrendingUp size={18} color="#34d399" />
                                                    <span style={{ fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.01em' }}>
                                                        Demonstrativo Dinâmico — Eletroposto (Sem Fio B • Lastro: {planoVinculadoNome})
                                                    </span>
                                                </div>
                                                <span style={{
                                                    fontSize: '0.74rem', color: '#d1fae5', background: 'rgba(255,255,255,0.1)',
                                                    padding: '0.25rem 0.65rem', borderRadius: '8px'
                                                }}>
                                                    Fio B já deduzido no Plano de Assinatura
                                                </span>
                                            </div>

                                            {/* Cabeçalho da Tabela */}
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: '2.3fr 1.35fr 1.15fr 1fr',
                                                gap: '0.75rem',
                                                padding: '0.75rem 1.25rem',
                                                background: '#f1f5f9',
                                                borderBottom: '1px solid #e2e8f0',
                                                fontSize: '0.74rem',
                                                fontWeight: 800,
                                                color: '#475569',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.03em'
                                            }}>
                                                <div>Item / Destinação</div>
                                                <div style={{ textAlign: 'center' }}>% Referência</div>
                                                <div style={{ textAlign: 'right' }}>Valor Unitário (R$/kWh)</div>
                                                <div style={{ textAlign: 'right' }}>% Real s/ Lastro</div>
                                            </div>

                                            {/* 1º ITEM: LASTRO DO PLANO DE ASSINATURA (TARIFA - DESCONTO DO PLANO) */}
                                            <div className="ledger-row" style={{ background: '#ffffff' }}>
                                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem', display: 'flex', flexDirection: 'column' }}>
                                                    <span>Lastro: {planoVinculadoNome}</span>
                                                    <small style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                                                        Tarifa {concessionariaOrigem} (R$ {formatCurrencyUnit(tarifaOrigem, 4)}) - Desconto Plano ({formatPct(descontoOrigemPct)}%)
                                                    </small>
                                                </div>
                                                <div style={{ textAlign: 'center', fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>
                                                    100% (Sem Fio B)
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.3rem' }}>
                                                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>R$</span>
                                                    <input
                                                        type="number"
                                                        step="0.0001"
                                                        min="0"
                                                        className="crm-input"
                                                        value={valorLastroPlano}
                                                        onChange={e => setValorLastroPlano(e.target.value)}
                                                        style={{
                                                            width: '96px', padding: '0.38rem 0.55rem', borderRadius: '8px',
                                                            border: '1px solid #cbd5e1', fontSize: '0.86rem', fontWeight: 800,
                                                            textAlign: 'right', color: '#0f172a'
                                                        }}
                                                    />
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a', fontSize: '0.86rem' }}>
                                                    100,00%
                                                </div>
                                            </div>

                                            {/* 2º ITEM: (-) DESCONTO ELETROPOSTO / ASSINANTE */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem' }}>
                                                    (-) Desconto do Assinante (Eletroposto)
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        max="100"
                                                        className="crm-input"
                                                        value={descontoEletroposto}
                                                        onChange={e => setDescontoEletroposto(e.target.value)}
                                                        style={{
                                                            width: '72px', padding: '0.38rem 0.5rem', borderRadius: '8px',
                                                            border: '1px solid #6ee7b7', background: '#ecfdf5',
                                                            fontSize: '0.85rem', fontWeight: 800, textAlign: 'center', color: '#047857'
                                                        }}
                                                    />
                                                    <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>% s/ Lastro</span>
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626', fontSize: '0.88rem' }}>
                                                    - R$ {formatCurrencyUnit(calc.vDescEletroposto, 4)}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(calc.pctRealDescEletroposto)}%
                                                </div>
                                            </div>

                                            {/* 3º ITEM: (=) BASE DE CÁLCULO LÍQUIDA */}
                                            <div className="ledger-row" style={{
                                                background: '#ecfdf5',
                                                borderTop: '1px solid #a7f3d0',
                                                borderBottom: '2px solid #a7f3d0'
                                            }}>
                                                <div style={{ fontWeight: 800, color: '#047857', fontSize: '0.92rem' }}>
                                                    (=) Base de Cálculo Líquida
                                                </div>
                                                <div style={{ textAlign: 'center', color: '#047857', fontWeight: 700 }}>
                                                    —
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.94rem' }}>
                                                    R$ {formatCurrencyUnit(calc.baseLiquida, 4)}
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#047857', fontSize: '0.88rem' }}>
                                                    {formatPct(calc.pctRealBaseLiquida)}%
                                                </div>
                                            </div>

                                            {/* 4º ITEM: (-) B2W (GESTÃO / PLATAFORMA) */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem' }}>
                                                    (-) B2W (Gestão / Plataforma)
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        max="100"
                                                        className="crm-input"
                                                        value={regrasRecorrente.b2w}
                                                        onChange={e => handleRecorrentePctChange('b2w', e.target.value)}
                                                        style={{
                                                            width: '72px', padding: '0.38rem 0.5rem', borderRadius: '8px',
                                                            border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700,
                                                            textAlign: 'center', color: '#0f172a'
                                                        }}
                                                    />
                                                    <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>% s/ Base</span>
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#334155', fontSize: '0.86rem', fontWeight: 600 }}>
                                                    - R$ {formatCurrencyUnit(calc.vB2W, 5)}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(calc.pctRealB2W)}%
                                                </div>
                                            </div>

                                            {/* 5º ITEM: (-) LÍDER */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem' }}>
                                                    (-) Líder
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        max="100"
                                                        className="crm-input"
                                                        value={regrasRecorrente.lider}
                                                        onChange={e => handleRecorrentePctChange('lider', e.target.value)}
                                                        style={{
                                                            width: '72px', padding: '0.38rem 0.5rem', borderRadius: '8px',
                                                            border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700,
                                                            textAlign: 'center', color: '#0f172a'
                                                        }}
                                                    />
                                                    <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>% s/ Base</span>
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#334155', fontSize: '0.86rem', fontWeight: 600 }}>
                                                    - R$ {formatCurrencyUnit(calc.vLider, 6)}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(calc.pctRealLider)}%
                                                </div>
                                            </div>

                                            {/* 6º GRUPO: (-) PARCEIRO POWER (PPE, PPP e PPF) */}
                                            <div style={{ background: '#fafaf9', borderBottom: '1px solid #e2e8f0' }}>
                                                <div style={{
                                                    padding: '0.55rem 1.25rem',
                                                    background: '#f8fafc',
                                                    borderBottom: '1px dashed #e2e8f0',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', fontWeight: 800, color: '#1e293b' }}>
                                                        <Award size={15} color="#059669" />
                                                        <span>(-) Categorias Parceiro Power</span>
                                                    </div>
                                                    <span style={{
                                                        fontSize: '0.72rem', fontWeight: 700, color: '#047857',
                                                        background: '#ecfdf5', padding: '0.15rem 0.55rem', borderRadius: '6px',
                                                        border: '1px solid #a7f3d0'
                                                    }}>
                                                        Teto na Margem: {calc.tetoLabel} ({formatPct(calc.pctParceiroPowerTeto)}% s/ Base = - R$ {formatCurrencyUnit(calc.vParceiroPowerTeto, 5)})
                                                    </span>
                                                </div>

                                                {/* PPE */}
                                                <div className="ledger-row" style={{ paddingLeft: '2rem' }}>
                                                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                        <span style={{
                                                            background: '#fef3c7', color: '#b45309', fontWeight: 800,
                                                            fontSize: '0.7rem', padding: '0.12rem 0.45rem', borderRadius: '6px',
                                                            border: '1px solid #fde68a'
                                                        }}>
                                                            PPE
                                                        </span>
                                                        <span>(-) Parceiro Power Embaixador (PPE)</span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="100"
                                                            className="crm-input"
                                                            value={regrasRecorrente.ppe}
                                                            onChange={e => handleRecorrentePctChange('ppe', e.target.value)}
                                                            style={{
                                                                width: '72px', padding: '0.35rem 0.5rem', borderRadius: '8px',
                                                                border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700,
                                                                textAlign: 'center', color: '#0f172a'
                                                            }}
                                                        />
                                                        <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>% s/ Base</span>
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: '#334155', fontSize: '0.85rem', fontWeight: 600 }}>
                                                        - R$ {formatCurrencyUnit(calc.vPPE, 5)}
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.84rem', fontWeight: 600 }}>
                                                        {formatPct(calc.pctRealPPE)}%
                                                    </div>
                                                </div>

                                                {/* PPP */}
                                                <div className="ledger-row" style={{ paddingLeft: '2rem' }}>
                                                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                        <span style={{
                                                            background: '#e0f2fe', color: '#0369a1', fontWeight: 800,
                                                            fontSize: '0.7rem', padding: '0.12rem 0.45rem', borderRadius: '6px',
                                                            border: '1px solid #bae6fd'
                                                        }}>
                                                            PPP
                                                        </span>
                                                        <span>(-) Parceiro Power Premium (PPP)</span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="100"
                                                            className="crm-input"
                                                            value={regrasRecorrente.ppp}
                                                            onChange={e => handleRecorrentePctChange('ppp', e.target.value)}
                                                            style={{
                                                                width: '72px', padding: '0.35rem 0.5rem', borderRadius: '8px',
                                                                border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700,
                                                                textAlign: 'center', color: '#0f172a'
                                                            }}
                                                        />
                                                        <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>% s/ Base</span>
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: '#334155', fontSize: '0.85rem', fontWeight: 600 }}>
                                                        - R$ {formatCurrencyUnit(calc.vPPP, 5)}
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.84rem', fontWeight: 600 }}>
                                                        {formatPct(calc.pctRealPPP)}%
                                                    </div>
                                                </div>

                                                {/* PPF */}
                                                <div className="ledger-row" style={{ paddingLeft: '2rem', borderBottom: 'none' }}>
                                                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                        <span style={{
                                                            background: '#f1f5f9', color: '#475569', fontWeight: 800,
                                                            fontSize: '0.7rem', padding: '0.12rem 0.45rem', borderRadius: '6px',
                                                            border: '1px solid #cbd5e1'
                                                        }}>
                                                            PPF
                                                        </span>
                                                        <span>(-) Parceiro Power Free (PPF)</span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            max="100"
                                                            className="crm-input"
                                                            value={regrasRecorrente.ppf}
                                                            onChange={e => handleRecorrentePctChange('ppf', e.target.value)}
                                                            style={{
                                                                width: '72px', padding: '0.35rem 0.5rem', borderRadius: '8px',
                                                                border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700,
                                                                textAlign: 'center', color: '#0f172a'
                                                            }}
                                                        />
                                                        <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>% s/ Base</span>
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: '#334155', fontSize: '0.85rem', fontWeight: 600 }}>
                                                        - R$ {formatCurrencyUnit(calc.vPPF, 5)}
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.84rem', fontWeight: 600 }}>
                                                        {formatPct(calc.pctRealPPF)}%
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 7º ITEM: (-) ASSINANTE CONECT */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                    <Users size={15} color="#10b981" />
                                                    <span>(-) Assinante Conect</span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        max="100"
                                                        className="crm-input"
                                                        value={regrasRecorrente.assinante_conect}
                                                        onChange={e => handleRecorrentePctChange('assinante_conect', e.target.value)}
                                                        style={{
                                                            width: '72px', padding: '0.38rem 0.5rem', borderRadius: '8px',
                                                            border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700,
                                                            textAlign: 'center', color: '#0f172a'
                                                        }}
                                                    />
                                                    <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>% s/ Base</span>
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#334155', fontSize: '0.86rem', fontWeight: 600 }}>
                                                    - R$ {formatCurrencyUnit(calc.vAssinanteConect, 5)}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(calc.pctRealAssinanteConect)}%
                                                </div>
                                            </div>

                                            {/* 8º ITEM: (=) LÍQUIDO EFETIVO DO FORNECEDOR / OPERADOR */}
                                            <div className="ledger-row" style={{
                                                background: '#f8fafc',
                                                borderTop: '2px solid #cbd5e1',
                                                borderBottom: '1px solid #cbd5e1'
                                            }}>
                                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>
                                                    (=) Líquido Efetivo do Fornecedor
                                                </div>
                                                <div style={{ textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
                                                    —
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.94rem' }}>
                                                    R$ {formatCurrencyUnit(calc.liquidoEfetivoFornecedor, 6)}
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>
                                                    {formatPct(calc.pctRealLiquidoFornecedor)}%
                                                </div>
                                            </div>

                                            {/* 9º ITEM: PISO CONTRATUAL DO FORNECEDOR */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem' }}>
                                                    Piso Contratual do Fornecedor ({formatPct(calc.pctPisoFornecedor, 0)}%)
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        max="100"
                                                        className="crm-input"
                                                        value={pisoFornecedorPct}
                                                        onChange={e => setPisoFornecedorPct(e.target.value)}
                                                        style={{
                                                            width: '72px', padding: '0.38rem 0.5rem', borderRadius: '8px',
                                                            border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700,
                                                            textAlign: 'center', color: '#0f172a'
                                                        }}
                                                    />
                                                    <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>% s/ Lastro</span>
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>
                                                    R$ {formatCurrencyUnit(calc.vPisoFornecedor, 6)}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(calc.pctRealPisoFornecedor)}%
                                                </div>
                                            </div>

                                            {/* 10º ITEM: MARGEM LIVRE / EXCEDENTE */}
                                            <div className="ledger-row" style={{
                                                background: calc.isDeficitario ? '#fef2f2' : '#f0fdf4',
                                                borderTop: `2px solid ${calc.isDeficitario ? '#ef4444' : '#22c55e'}`,
                                                borderBottom: 'none',
                                                padding: '1rem 1.25rem'
                                            }}>
                                                <div style={{
                                                    fontWeight: 900,
                                                    color: calc.isDeficitario ? '#b91c1c' : '#15803d',
                                                    fontSize: '0.95rem',
                                                    display: 'flex', alignItems: 'center', gap: '0.5rem'
                                                }}>
                                                    {calc.isDeficitario ? (
                                                        <AlertTriangle size={18} color="#dc2626" />
                                                    ) : (
                                                        <ShieldCheck size={18} color="#16a34a" />
                                                    )}
                                                    <span>MARGEM LIVRE / EXCEDENTE</span>
                                                </div>
                                                <div style={{ textAlign: 'center', fontWeight: 700, color: calc.isDeficitario ? '#dc2626' : '#15803d', fontSize: '0.78rem' }}>
                                                    {calc.isDeficitario ? 'DÉFICIT BLOQUEADO' : 'SUPERÁVIT VALIDADO'}
                                                </div>
                                                <div style={{
                                                    textAlign: 'right', fontWeight: 900,
                                                    color: calc.isDeficitario ? '#dc2626' : '#15803d',
                                                    fontSize: '1rem'
                                                }}>
                                                    {calc.margemLivre >= 0 ? '+ ' : '- '}R$ {formatCurrencyUnit(Math.abs(calc.margemLivre), 6)}
                                                </div>
                                                <div style={{
                                                    textAlign: 'right', fontWeight: 900,
                                                    color: calc.isDeficitario ? '#dc2626' : '#15803d',
                                                    fontSize: '0.95rem'
                                                }}>
                                                    {calc.pctRealMargemLivre >= 0 ? '+ ' : '- '}{formatPct(Math.abs(calc.pctRealMargemLivre))}%
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* PAINEL START */}
                                    {(tipoRecompensa === 'start' || tipoRecompensa === 'hibrido') && (
                                        <div style={{
                                            border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: '18px',
                                            padding: '1.25rem'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <span style={{
                                                        background: '#2563eb', color: 'white', fontSize: '0.7rem',
                                                        fontWeight: 800, padding: '0.2rem 0.6rem', borderRadius: '6px', textTransform: 'uppercase'
                                                    }}>
                                                        Start
                                                    </span>
                                                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#1e3a8a' }}>
                                                        Distribuição nos Ciclos Iniciais (% sobre Base Líquida: R$ {formatCurrencyUnit(calc.baseLiquida, 4)}/kWh)
                                                    </span>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                                                {[1, 2, 3].map(fatNum => {
                                                    const isChecked = faturasElegiveisStart.includes(fatNum);
                                                    return (
                                                        <button
                                                            key={fatNum}
                                                            type="button"
                                                            onClick={() => toggleFaturaStart(fatNum)}
                                                            style={{
                                                                flex: 1, padding: '0.6rem 0.85rem', borderRadius: '10px',
                                                                border: isChecked ? '2px solid #2563eb' : '1px solid #cbd5e1',
                                                                background: isChecked ? '#ffffff' : '#f8fafc',
                                                                color: isChecked ? '#1d4ed8' : '#64748b',
                                                                fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem'
                                                            }}
                                                        >
                                                            <div style={{
                                                                width: '16px', height: '16px', borderRadius: '4px',
                                                                background: isChecked ? '#2563eb' : 'transparent',
                                                                border: isChecked ? 'none' : '1.5px solid #94a3b8',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                            }}>
                                                                {isChecked && <Check size={12} color="white" />}
                                                            </div>
                                                            Ciclo {fatNum}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                                                {faturasElegiveisStart.map(fatNum => {
                                                    const r = regrasStart[fatNum] || {};
                                                    const maxPP = Math.max(parseFloat(r.ppe) || 0, parseFloat(r.ppp) || 0, parseFloat(r.ppf) || 0);
                                                    const somaPct = (parseFloat(r.b2w) || 0) + (parseFloat(r.lider) || 0) + maxPP + (parseFloat(r.assinante_conect) || 0);
                                                    const excedeu = somaPct > 100;

                                                    return (
                                                        <div key={fatNum} style={{
                                                            background: '#ffffff', padding: '1rem 1.25rem', borderRadius: '12px',
                                                            border: `1px solid ${excedeu ? '#ef4444' : '#bfdbfe'}`
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                                                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#1e3a8a' }}>
                                                                    Ciclo {fatNum} — Repasse Único (% sobre Base Líquida)
                                                                </span>
                                                                <span style={{
                                                                    fontSize: '0.75rem', fontWeight: 800,
                                                                    color: excedeu ? '#dc2626' : '#15803d',
                                                                    background: excedeu ? '#fef2f2' : '#f0fdf4',
                                                                    padding: '0.2rem 0.6rem', borderRadius: '8px'
                                                                }}>
                                                                    Total comprometido: {formatPct(somaPct)}% da Base Líquida
                                                                </span>
                                                            </div>

                                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.6rem' }}>
                                                                {[
                                                                    { key: 'b2w', label: 'B2W (%)' },
                                                                    { key: 'lider', label: 'Líder (%)' },
                                                                    { key: 'ppe', label: 'PPE (%)' },
                                                                    { key: 'ppp', label: 'PPP (%)' },
                                                                    { key: 'ppf', label: 'PPF (%)' },
                                                                    { key: 'assinante_conect', label: 'Assin. Conect (%)' }
                                                                ].map(item => {
                                                                    const pctVal = parseFloat(r[item.key]) || 0;
                                                                    const rsVal = Math.max(0, calc.baseLiquida) * (pctVal / 100);
                                                                    return (
                                                                        <div key={item.key}>
                                                                            <label style={{ display: 'block', fontSize: '0.7rem', color: '#475569', fontWeight: 700, marginBottom: '0.25rem' }}>
                                                                                {item.label}
                                                                            </label>
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                min="0"
                                                                                max="100"
                                                                                className="crm-input"
                                                                                value={r[item.key] ?? ''}
                                                                                onChange={e => handleStartPctChange(fatNum, item.key, e.target.value)}
                                                                                style={{
                                                                                    width: '100%', padding: '0.45rem 0.5rem', borderRadius: '8px',
                                                                                    border: '1px solid #cbd5e1', fontSize: '0.82rem', fontWeight: 700,
                                                                                    boxSizing: 'border-box', textAlign: 'center'
                                                                                }}
                                                                            />
                                                                            <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', textAlign: 'center', marginTop: '0.2rem', fontWeight: 600 }}>
                                                                                R$ {formatCurrencyUnit(rsVal, 4)}
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div style={{
                                    padding: '1.5rem', textAlign: 'center', background: '#f8fafc',
                                    borderRadius: '14px', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '0.85rem'
                                }}>
                                    Plano de Eletroposto configurado apenas com <strong>Desconto Direto de {formatPct(calc.pctDescEletroposto)}%</strong> sobre o Lastro ({planoVinculadoNome}).
                                </div>
                            )}
                        </div>

                        {bloqueadoPorDeficit && (
                            <div style={{
                                background: '#fef2f2', border: '1px solid #ef4444', borderRadius: '16px',
                                padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.85rem',
                                color: '#b91c1c'
                            }}>
                                <AlertTriangle size={22} color="#dc2626" style={{ flexShrink: 0 }} />
                                <div style={{ fontSize: '0.84rem', lineHeight: 1.4 }}>
                                    <strong style={{ display: 'block', fontSize: '0.9rem' }}>
                                        Trava Antidéficit Acionada — Não é permitido salvar plano deficitário
                                    </strong>
                                    O Líquido Efetivo do Fornecedor (<strong>R$ {formatCurrencyUnit(calc.liquidoEfetivoFornecedor, 6)}/kWh</strong>) está abaixo do Piso Contratual (<strong>R$ {formatCurrencyUnit(calc.vPisoFornecedor, 6)}/kWh</strong>), gerando um déficit de <strong>R$ {formatCurrencyUnit(Math.abs(calc.margemLivre), 6)}/kWh</strong>.
                                </div>
                            </div>
                        )}
                    </div>

                    {/* FOOTER */}
                    <div style={{
                        padding: '1.15rem 2rem', background: '#ffffff', borderTop: '1px solid #e2e8f0',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <Percent size={15} color="#059669" />
                            <span>
                                Total de Repasses na Base Líquida: <strong style={{ color: '#0f172a' }}>{formatPct(calc.totalPctSobreBase)}%</strong> (R$ {formatCurrencyUnit(calc.totalDeducoesBase, 5)}/kWh)
                            </span>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    padding: '0.75rem 1.4rem', borderRadius: '14px', border: '1px solid #cbd5e1',
                                    background: '#ffffff', color: '#475569', fontWeight: 700, fontSize: '0.88rem',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading || bloqueadoPorDeficit}
                                style={{
                                    padding: '0.75rem 2rem', borderRadius: '14px', border: 'none',
                                    background: bloqueadoPorDeficit
                                        ? '#94a3b8'
                                        : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                    color: '#ffffff', fontWeight: 800, fontSize: '0.88rem',
                                    cursor: (loading || bloqueadoPorDeficit) ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    boxShadow: bloqueadoPorDeficit ? 'none' : '0 10px 15px -3px rgba(5, 150, 105, 0.3)'
                                }}
                            >
                                <Save size={18} />
                                {loading ? 'Salvando...' : (planToEdit ? 'Salvar Alterações' : 'Criar Plano de Eletroposto')}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
