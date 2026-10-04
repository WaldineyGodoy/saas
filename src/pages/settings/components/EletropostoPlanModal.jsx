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
    Award,
    Users,
    Activity,
    Link2,
    Lock,
    GitBranch
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

const DEFAULT_MULTILEVEL_RULES = {
    b2w: {
        max_niveis: 4,
        niveis: { L1: '10', L2: '10', L3: '10', L4: '10' }
    },
    lider: {
        max_niveis: 3,
        niveis: { L1: '1', L2: '1', L3: '1', L4: '0' }
    },
    ppe: {
        max_niveis: 2,
        niveis: { L1: '4', L2: '2', L3: '0', L4: '0' }
    },
    ppp: {
        max_niveis: 2,
        niveis: { L1: '4', L2: '2', L3: '0', L4: '0' }
    },
    ppf: {
        max_niveis: 1,
        niveis: { L1: '2', L2: '0', L3: '0', L4: '0' }
    },
    assinante_conect: {
        max_niveis: 1,
        niveis: { L1: '0', L2: '2', L3: '2', L4: '2' }
    }
};

const LEVEL_KEYS = ['L1', 'L2', 'L3', 'L4'];
const LEVEL_LABELS = {
    L1: { short: 'Nível L1', desc: 'Venda Direta (Parceiro Power)' },
    L2: { short: 'Nível L2', desc: '1ª Indicação (Assinante Connect)' },
    L3: { short: 'Nível L3', desc: '2ª Indicação (Corte Parceiro Power)' },
    L4: { short: 'Nível L4+', desc: 'Expansão Profunda (Corte Líder)' }
};

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
    const [activeLevelView, setActiveLevelView] = useState('L1');

    // Plano de Assinatura Vinculado (Lastro do Eletroposto)
    const [selectedSubPlanId, setSelectedSubPlanId] = useState('');
    const [planoVinculadoNome, setPlanoVinculadoNome] = useState('Plano Ultra 15%');
    const [concessionariaOrigem, setConcessionariaOrigem] = useState('Cosern');
    const [tarifaOrigem, setTarifaOrigem] = useState(1.0300);
    const [descontoOrigemPct, setDescontoOrigemPct] = useState(15);

    // Valor do Lastro (Somente Leitura: Tarifa Concessionária - Desconto Assinante do Plano Vinculado)
    const [valorLastroPlano, setValorLastroPlano] = useState('0.8755');

    // Estado Principal do Plano de Eletroposto
    const [nome, setNome] = useState('');
    const [tarifaMotorista, setTarifaMotorista] = useState('');
    const [descontoEletroposto, setDescontoEletroposto] = useState('10');
    const [ativo, setAtivo] = useState(true);
    const [recompensasAtivo, setRecompensasAtivo] = useState(true);
    const [tipoRecompensa, setTipoRecompensa] = useState('recorrente');

    // Piso Contratual do Fornecedor / Operador (% sobre o Lastro)
    const [pisoFornecedorPct, setPisoFornecedorPct] = useState('50');

    // Regras Multinível (L1, L2, L3, L4+)
    const [regrasMultinivel, setRegrasMultinivel] = useState(DEFAULT_MULTILEVEL_RULES);

    // Configuração Start
    const [faturasElegiveisStart, setFaturasElegiveisStart] = useState([1]);
    const [regrasStart, setRegrasStart] = useState({
        1: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
        2: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
        3: { b2w: '0', lider: '0', ppe: '0', ppp: '0', ppf: '0', assinante_conect: '0' }
    });

    useEffect(() => {
        if (!isOpen) return;
        setActiveLevelView('L1');

        if (planToEdit) {
            setNome(planToEdit.nome || '');
            setTarifaMotorista(planToEdit.tarifa_motorista_kwh != null ? String(planToEdit.tarifa_motorista_kwh) : '');
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

            if (recCfg.regras_multinivel) {
                setRegrasMultinivel(recCfg.regras_multinivel);
            } else {
                setRegrasMultinivel(DEFAULT_MULTILEVEL_RULES);
            }

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
            const defaultSubPlan = subscriptionPlans.find(p => p.ativo) || subscriptionPlans[0] || null;
            const info = extractSubscriptionPlanLastro(defaultSubPlan);

            setNome('');
            setTarifaMotorista('');
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
            setRegrasMultinivel(DEFAULT_MULTILEVEL_RULES);
            setFaturasElegiveisStart([1]);
            setRegrasStart({
                1: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
                2: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
                3: { b2w: '0', lider: '0', ppe: '0', ppp: '0', ppf: '0', assinante_conect: '0' }
            });
        }
    }, [planToEdit, isOpen, subscriptionPlans]);

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

    const isLevelAllowedForRole = (roleKey, levelKey, maxNiveis) => {
        if (roleKey === 'b2w') return true; // B2W (Gestão / Plataforma) recebe recorrência fixa em todos os níveis
        const levelIdx = LEVEL_KEYS.indexOf(levelKey) + 1;
        if (roleKey === 'assinante_conect') {
            if (maxNiveis === 0) return false;
            return levelIdx >= 2;
        }
        return levelIdx <= maxNiveis;
    };

    const handleFixedB2WPctChange = (val) => {
        setRegrasMultinivel(prev => ({
            ...prev,
            b2w: {
                max_niveis: 4,
                niveis: { L1: val, L2: val, L3: val, L4: val }
            }
        }));
    };

    const handleRoleMaxLevelsChange = (roleKey, newMaxStr) => {
        const newMax = parseInt(newMaxStr, 10);
        setRegrasMultinivel(prev => {
            const currentRole = prev[roleKey];
            const updatedNiveis = { ...currentRole.niveis };

            LEVEL_KEYS.forEach((lk, idx) => {
                const lvNum = idx + 1;
                if (roleKey === 'assinante_conect') {
                    if (newMax === 0 || lvNum === 1) {
                        updatedNiveis[lk] = '0';
                    } else if (Number(updatedNiveis[lk]) === 0) {
                        updatedNiveis[lk] = '2';
                    }
                } else {
                    if (lvNum > newMax) {
                        updatedNiveis[lk] = '0';
                    } else if (Number(updatedNiveis[lk]) === 0) {
                        const defVal = DEFAULT_MULTILEVEL_RULES[roleKey]?.niveis?.[lk] || '1';
                        updatedNiveis[lk] = defVal === '0' ? '1' : defVal;
                    }
                }
            });

            return {
                ...prev,
                [roleKey]: {
                    max_niveis: newMax,
                    niveis: updatedNiveis
                }
            };
        });
    };

    const handleRoleLevelPctChange = (roleKey, levelKey, val) => {
        setRegrasMultinivel(prev => ({
            ...prev,
            [roleKey]: {
                ...prev[roleKey],
                niveis: {
                    ...prev[roleKey].niveis,
                    [levelKey]: val
                }
            }
        }));
    };

    // MOTOR DE CÁLCULO DINÂMICO MULTINÍVEL DO ELETROPOSTO (SEM FIO B)
    const calc = useMemo(() => {
        const vLastro = Math.max(0, parseFloat(valorLastroPlano) || 0);
        const pctDescEletroposto = Math.max(0, parseFloat(descontoEletroposto) || 0);

        const vDescEletroposto = vLastro * (pctDescEletroposto / 100);
        const pctRealDescEletroposto = pctDescEletroposto;

        const baseLiquida = vLastro - vDescEletroposto;
        const pctRealBaseLiquida = vLastro > 0 ? (baseLiquida / vLastro) * 100 : 0;
        const basePositiva = Math.max(0, baseLiquida);

        const pctPisoFornecedor = Math.max(0, parseFloat(pisoFornecedorPct) || 0);
        const vPisoFornecedor = vLastro * (pctPisoFornecedor / 100);
        const pctRealPisoFornecedor = pctPisoFornecedor;

        const byLevel = {};
        let anyLevelDeficit = false;
        let worstDeficitLevel = null;

        LEVEL_KEYS.forEach(lk => {
            const getPct = (roleKey) => {
                const roleCfg = regrasMultinivel[roleKey];
                if (!roleCfg) return 0;
                if (!isLevelAllowedForRole(roleKey, lk, roleCfg.max_niveis)) return 0;
                return Math.max(0, parseFloat(roleCfg.niveis?.[lk]) || 0);
            };

            const pctB2W = getPct('b2w');
            const pctLider = getPct('lider');
            const pctPPE = getPct('ppe');
            const pctPPP = getPct('ppp');
            const pctPPF = getPct('ppf');
            const pctAssinanteConect = getPct('assinante_conect');

            const vB2W = basePositiva * (pctB2W / 100);
            const vLider = basePositiva * (pctLider / 100);
            const vPPE = basePositiva * (pctPPE / 100);
            const vPPP = basePositiva * (pctPPP / 100);
            const vPPF = basePositiva * (pctPPF / 100);
            const vAssinanteConect = basePositiva * (pctAssinanteConect / 100);

            const pctRealB2W = vLastro > 0 ? (vB2W / vLastro) * 100 : 0;
            const pctRealLider = vLastro > 0 ? (vLider / vLastro) * 100 : 0;
            const pctRealPPE = vLastro > 0 ? (vPPE / vLastro) * 100 : 0;
            const pctRealPPP = vLastro > 0 ? (vPPP / vLastro) * 100 : 0;
            const pctRealPPF = vLastro > 0 ? (vPPF / vLastro) * 100 : 0;
            const pctRealAssinanteConect = vLastro > 0 ? (vAssinanteConect / vLastro) * 100 : 0;

            const pctParceiroPowerTeto = Math.max(pctPPE, pctPPP, pctPPF);
            const vParceiroPowerTeto = basePositiva * (pctParceiroPowerTeto / 100);
            const pctRealParceiroPowerTeto = vLastro > 0 ? (vParceiroPowerTeto / vLastro) * 100 : 0;

            let tetoLabel = 'PPE';
            if (pctParceiroPowerTeto === 0) tetoLabel = 'Corte (0%)';
            else if (pctPPP >= pctPPE && pctPPP >= pctPPF) tetoLabel = 'PPP';
            else if (pctPPE >= pctPPP && pctPPE >= pctPPF) tetoLabel = 'PPE';
            else tetoLabel = 'PPF';

            const totalDeducoesBase = vB2W + vLider + vParceiroPowerTeto + vAssinanteConect;
            const totalPctSobreBase = pctB2W + pctLider + pctParceiroPowerTeto + pctAssinanteConect;

            const liquidoEfetivoFornecedor = baseLiquida - totalDeducoesBase;
            const pctRealLiquidoFornecedor = vLastro > 0 ? (liquidoEfetivoFornecedor / vLastro) * 100 : 0;

            const margemLivre = liquidoEfetivoFornecedor - vPisoFornecedor;
            const pctRealMargemLivre = vLastro > 0 ? (margemLivre / vLastro) * 100 : 0;

            const isLevelDeficit =
                vLastro <= 0 ||
                baseLiquida <= 0 ||
                liquidoEfetivoFornecedor < 0 ||
                margemLivre < -0.000001;

            if (isLevelDeficit) {
                anyLevelDeficit = true;
                if (!worstDeficitLevel || margemLivre < byLevel[worstDeficitLevel].margemLivre) {
                    worstDeficitLevel = lk;
                }
            }

            byLevel[lk] = {
                pctB2W, vB2W, pctRealB2W,
                pctLider, vLider, pctRealLider,
                pctPPE, vPPE, pctRealPPE,
                pctPPP, vPPP, pctRealPPP,
                pctPPF, vPPF, pctRealPPF,
                pctParceiroPowerTeto, vParceiroPowerTeto, pctRealParceiroPowerTeto, tetoLabel,
                pctAssinanteConect, vAssinanteConect, pctRealAssinanteConect,
                totalDeducoesBase, totalPctSobreBase,
                liquidoEfetivoFornecedor, pctRealLiquidoFornecedor,
                margemLivre, pctRealMargemLivre,
                isLevelDeficit
            };
        });

        const currentView = byLevel[activeLevelView] || byLevel.L1;

        return {
            vLastro,
            pctDescEletroposto,
            vDescEletroposto,
            pctRealDescEletroposto,
            baseLiquida,
            pctRealBaseLiquida,
            pctPisoFornecedor,
            vPisoFornecedor,
            pctRealPisoFornecedor,
            byLevel,
            currentView,
            isDeficitario: anyLevelDeficit,
            worstDeficitLevel: worstDeficitLevel || activeLevelView
        };
    }, [valorLastroPlano, descontoEletroposto, regrasMultinivel, pisoFornecedorPct, activeLevelView]);

    if (!isOpen) return null;

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

        const tarifaMotoristaNum = tarifaMotorista.trim() === '' ? null : Number(tarifaMotorista.replace(',', '.'));
        if (tarifaMotoristaNum !== null && !(tarifaMotoristaNum > 0)) {
            showAlert('A Tarifa ao motorista (R$/kWh) deve ser maior que zero.', 'error');
            return;
        }

        if (bloqueadoPorDeficit) {
            showAlert(`Operação bloqueada: O plano apresenta resultado deficitário no ${calc.worstDeficitLevel}. Ajuste os percentuais.`, 'error');
            return;
        }

        setLoading(true);

        const l1View = calc.byLevel.L1;
        const numRec = {
            b2w: l1View.pctB2W,
            lider: l1View.pctLider,
            ppe: l1View.pctPPE,
            ppp: l1View.pctPPP,
            ppf: l1View.pctPPF,
            assinante_conect: calc.byLevel.L2.pctAssinanteConect,
            associacao: l1View.pctB2W,
            coordenador: l1View.pctLider,
            embaixador: Math.max(l1View.pctPPE, l1View.pctPPP),
            assinante: calc.byLevel.L2.pctAssinanteConect
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
            tarifa_motorista_kwh: tarifaMotoristaNum,
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
                    fio_b: 0,
                    base_calculo_liquida: Number(calc.baseLiquida.toFixed(6)),
                    piso_fornecedor_pct: calc.pctPisoFornecedor,
                    liquido_efetivo_fornecedor: Number(l1View.liquidoEfetivoFornecedor.toFixed(6)),
                    margem_livre_excedente: Number(l1View.margemLivre.toFixed(6)),
                    superavit_por_nivel: {
                        L1: Number(calc.byLevel.L1.margemLivre.toFixed(6)),
                        L2: Number(calc.byLevel.L2.margemLivre.toFixed(6)),
                        L3: Number(calc.byLevel.L3.margemLivre.toFixed(6)),
                        L4: Number(calc.byLevel.L4.margemLivre.toFixed(6))
                    }
                },
                regras: numRec,
                regras_multinivel: regrasMultinivel
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

    const renderMultilevelCenterControl = (roleKey, optionsList) => {
        const cfg = regrasMultinivel[roleKey];
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%' }}>
                <select
                    className="crm-input"
                    value={cfg.max_niveis}
                    onChange={e => handleRoleMaxLevelsChange(roleKey, e.target.value)}
                    style={{
                        padding: '0.32rem 0.45rem',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        fontSize: '0.73rem',
                        fontWeight: 700,
                        color: '#334155',
                        cursor: 'pointer',
                        minWidth: '112px'
                    }}
                >
                    {optionsList.map(opt => (
                        <option key={opt.val} value={opt.val}>{opt.label}</option>
                    ))}
                </select>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.3rem', flex: 1 }}>
                    {LEVEL_KEYS.map(lk => {
                        const allowed = isLevelAllowedForRole(roleKey, lk, cfg.max_niveis);
                        const isFocusedLevel = activeLevelView === lk;
                        const val = allowed ? (cfg.niveis?.[lk] ?? '0') : '0';

                        return (
                            <div
                                key={lk}
                                onClick={() => setActiveLevelView(lk)}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    background: !allowed
                                        ? '#f1f5f9'
                                        : isFocusedLevel
                                            ? '#ecfdf5'
                                            : '#ffffff',
                                    border: `1px solid ${
                                        isFocusedLevel
                                            ? '#10b981'
                                            : allowed
                                                ? '#cbd5e1'
                                                : '#e2e8f0'
                                    }`,
                                    borderRadius: '7px',
                                    padding: '0.18rem 0.25rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s'
                                }}
                            >
                                <span style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 800,
                                    color: isFocusedLevel ? '#047857' : allowed ? '#64748b' : '#94a3b8',
                                    lineHeight: 1.1
                                }}>
                                    {lk === 'L4' ? 'L4+' : lk}
                                </span>
                                {allowed ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max="100"
                                            value={val}
                                            onChange={e => handleRoleLevelPctChange(roleKey, lk, e.target.value)}
                                            style={{
                                                width: '38px',
                                                border: 'none',
                                                background: 'transparent',
                                                fontSize: '0.76rem',
                                                fontWeight: 800,
                                                color: '#0f172a',
                                                textAlign: 'center',
                                                outline: 'none',
                                                padding: 0
                                            }}
                                        />
                                        <span style={{ fontSize: '0.64rem', color: '#64748b', fontWeight: 700 }}>%</span>
                                    </div>
                                ) : (
                                    <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#94a3b8', padding: '0.08rem 0' }}>
                                        Corte
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const cv = calc.currentView;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.72)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(8px)', padding: '1rem'
        }}>
            <div style={{
                background: '#ffffff', width: '100%', maxWidth: '1060px', borderRadius: '30px',
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
                        grid-template-columns: 1.9fr 2.3fr 1.05fr 0.9fr;
                        align-items: center;
                        gap: 0.75rem;
                        padding: 0.7rem 1.25rem;
                        border-bottom: 1px solid #f1f5f9;
                        transition: background 0.15s ease;
                    }
                    .ledger-row:hover {
                        background: #f8fafc;
                    }
                `}</style>

                {/* HEADER PREMIUM */}
                <div style={{
                    padding: '1.35rem 2rem',
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
                                    Lastro: Plano de Assinatura (Sem Fio B) • Multinível L1 a L4+
                                </span>
                            </div>
                            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#cbd5e1' }}>
                                Ponto de partida fixo no Plano de Assinatura vinculado (Tarifa Concessionária menos Desconto do Assinante)
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.15)',
                            cursor: 'pointer', color: '#f8fafc', padding: '0.55rem', borderRadius: '12px',
                            display: 'flex'
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div className="crm-scrollbar" style={{
                        padding: '1.65rem 2rem', overflowY: 'auto', flex: 1,
                        background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '1.4rem'
                    }}>

                        {/* BLOCO 1: ALINHAMENTO HORIZONTAL PERFEITO E LINHA ÚNICA */}
                        <div style={{
                            background: '#ffffff', padding: '1.4rem 1.5rem', borderRadius: '20px',
                            border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                                    <Link2 size={18} color="#059669" />
                                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b', fontWeight: 700 }}>
                                        1. Identificação e Plano de Assinatura Vinculado (Lastro)
                                    </h4>
                                </div>

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

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1.2fr 1.8fr',
                                gap: '1rem',
                                alignItems: 'end'
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <label style={{
                                        display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569',
                                        marginBottom: '0.42rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                    }}>
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
                                            width: '100%', height: '44px', padding: '0 0.95rem', borderRadius: '12px',
                                            border: '1px solid #cbd5e1', fontSize: '0.88rem', color: '#1e293b',
                                            boxSizing: 'border-box', fontWeight: 600
                                        }}
                                    />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <label style={{
                                        display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569',
                                        marginBottom: '0.42rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                    }}>
                                        Tarifa ao motorista (R$/kWh)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        min="0"
                                        className="crm-input"
                                        placeholder="Ex: 2.1500"
                                        value={tarifaMotorista}
                                        onChange={e => setTarifaMotorista(e.target.value)}
                                        style={{
                                            width: '100%', height: '44px', padding: '0 0.95rem', borderRadius: '12px',
                                            border: '1px solid #cbd5e1', fontSize: '0.88rem', color: '#1e293b',
                                            boxSizing: 'border-box', fontWeight: 600
                                        }}
                                    />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <label style={{
                                        display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569',
                                        marginBottom: '0.42rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                    }}>
                                        Selecionar Plano de Assinatura Vinculado (Define Lastro sem Fio B) *
                                    </label>
                                    <select
                                        className="crm-input"
                                        value={selectedSubPlanId}
                                        onChange={handleSelectSubscriptionPlan}
                                        style={{
                                            width: '100%', height: '44px', padding: '0 0.95rem', borderRadius: '12px',
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
                        </div>

                        {/* BLOCO 2: DEMONSTRATIVO MULTINÍVEL DO ELETROPOSTO */}
                        <div style={{
                            background: '#ffffff', padding: '1.4rem 1.5rem', borderRadius: '20px',
                            border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                marginBottom: '1.15rem', flexWrap: 'wrap', gap: '0.75rem'
                            }}>
                                <div>
                                    <h4 style={{ margin: 0, fontSize: '1rem', color: '#0f172a', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Sparkles size={19} color="#059669" />
                                        2. Estrutura de Recompensas & Níveis do Eletroposto (Sem Fio B)
                                    </h4>
                                    <p style={{ margin: '0.22rem 0 0 0', fontSize: '0.79rem', color: '#64748b' }}>
                                        Parametrize quantos níveis cada função recebe e acompanhe o Superávit de L1 a L4+
                                    </p>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                                    <div style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                                        background: '#ecfdf5', border: '1px solid #6ee7b7',
                                        color: '#047857', padding: '0.38rem 0.85rem', borderRadius: '12px',
                                        fontSize: '0.75rem', fontWeight: 700
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
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.85rem', marginBottom: '1.35rem' }}>
                                        {[
                                            { id: 'recorrente', title: 'Recorrente (Multinível L1 a L4+)', sub: 'Repasse contínuo enquanto a entidade estiver Ativa', color: '#15803d', border: '#22c55e', bg: '#f0fdf4' },
                                            { id: 'start', title: 'Start (Adesão Eletroposto)', sub: 'Bonificação nos ciclos iniciais (1º, 2º ou 3º ciclo)', color: '#1d4ed8', border: '#3b82f6', bg: '#eff6ff' },
                                            { id: 'hibrido', title: 'Híbrido (Start + Recorrente)', sub: 'Bônus de entrada + Recorrência por níveis', color: '#6d28d9', border: '#8b5cf6', bg: '#f5f3ff' }
                                        ].map(mod => (
                                            <button
                                                key={mod.id}
                                                type="button"
                                                onClick={() => setTipoRecompensa(mod.id)}
                                                style={{
                                                    padding: '0.85rem 1.1rem', borderRadius: '14px', border: '2px solid',
                                                    borderColor: tipoRecompensa === mod.id ? mod.border : '#e2e8f0',
                                                    background: tipoRecompensa === mod.id ? mod.bg : '#ffffff',
                                                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s'
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.22rem' }}>
                                                    <span style={{ fontWeight: 800, fontSize: '0.86rem', color: tipoRecompensa === mod.id ? mod.color : '#1e293b' }}>
                                                        {mod.title}
                                                    </span>
                                                    {tipoRecompensa === mod.id && <Check size={16} color={mod.color} />}
                                                </div>
                                                <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block' }}>
                                                    {mod.sub}
                                                </span>
                                            </button>
                                        ))}
                                    </div>

                                    {(tipoRecompensa === 'recorrente' || tipoRecompensa === 'hibrido') && (
                                        <div style={{
                                            borderRadius: '18px', border: '1px solid #cbd5e1',
                                            background: '#ffffff', overflow: 'hidden',
                                            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.04)',
                                            marginBottom: tipoRecompensa === 'hibrido' ? '1.5rem' : 0
                                        }}>
                                            {/* Barra Superior do Demonstrativo com Seletor de Nível */}
                                            <div style={{
                                                padding: '0.9rem 1.25rem',
                                                background: 'linear-gradient(90deg, #064e3b 0%, #0f172a 100%)',
                                                color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                flexWrap: 'wrap', gap: '0.75rem'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                    <GitBranch size={18} color="#34d399" />
                                                    <div>
                                                        <span style={{ fontWeight: 800, fontSize: '0.9rem', display: 'block' }}>
                                                            Demonstrativo Eletroposto — {LEVEL_LABELS[activeLevelView].short}: {LEVEL_LABELS[activeLevelView].desc}
                                                        </span>
                                                        <span style={{ fontSize: '0.72rem', color: '#a7f3d0' }}>
                                                            Fio B isento (já deduzido no Plano de Assinatura)
                                                        </span>
                                                    </div>
                                                </div>

                                                <div style={{
                                                    display: 'inline-flex', background: 'rgba(15, 23, 42, 0.65)',
                                                    padding: '0.25rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.12)',
                                                    gap: '0.25rem'
                                                }}>
                                                    {LEVEL_KEYS.map(lk => {
                                                        const isSelected = activeLevelView === lk;
                                                        const lvSuperavit = calc.byLevel[lk].margemLivre;
                                                        const lvDeficit = calc.byLevel[lk].isLevelDeficit;
                                                        return (
                                                            <button
                                                                key={lk}
                                                                type="button"
                                                                onClick={() => setActiveLevelView(lk)}
                                                                style={{
                                                                    padding: '0.35rem 0.7rem',
                                                                    borderRadius: '7px',
                                                                    border: 'none',
                                                                    cursor: 'pointer',
                                                                    background: isSelected ? '#10b981' : 'transparent',
                                                                    color: isSelected ? '#ffffff' : '#cbd5e1',
                                                                    fontWeight: 800,
                                                                    fontSize: '0.75rem',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.35rem'
                                                                }}
                                                            >
                                                                <span>{lk === 'L4' ? 'Nível L4+' : `Nível ${lk}`}</span>
                                                                <span style={{
                                                                    fontSize: '0.66rem',
                                                                    padding: '0.05rem 0.35rem',
                                                                    borderRadius: '4px',
                                                                    background: lvDeficit
                                                                        ? 'rgba(239, 68, 68, 0.25)'
                                                                        : isSelected
                                                                            ? 'rgba(255,255,255,0.2)'
                                                                            : 'rgba(34, 197, 94, 0.2)',
                                                                    color: lvDeficit ? '#fca5a5' : isSelected ? '#ffffff' : '#4ade80'
                                                                }}>
                                                                    {lvSuperavit >= 0 ? `+${formatPct(calc.byLevel[lk].pctRealMargemLivre, 1)}%` : 'Déficit'}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* Cabeçalho da Tabela */}
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: '1.9fr 2.3fr 1.05fr 0.9fr',
                                                gap: '0.75rem',
                                                padding: '0.7rem 1.25rem',
                                                background: '#f1f5f9',
                                                borderBottom: '1px solid #e2e8f0',
                                                fontSize: '0.73rem',
                                                fontWeight: 800,
                                                color: '#475569',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.03em'
                                            }}>
                                                <div>Item / Destinação</div>
                                                <div style={{ textAlign: 'center' }}>Direito de Níveis & Alíquotas (% s/ Base)</div>
                                                <div style={{ textAlign: 'right' }}>Valor {activeLevelView === 'L4' ? 'L4+' : activeLevelView} (R$/kWh)</div>
                                                <div style={{ textAlign: 'right' }}>% Real s/ Lastro</div>
                                            </div>

                                            {/* 1º ITEM: LASTRO DO PLANO DE ASSINATURA (SOMENTE LEITURA) */}
                                            <div className="ledger-row" style={{ background: '#ffffff' }}>
                                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.86rem', display: 'flex', flexDirection: 'column' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                        <span>Lastro: {planoVinculadoNome}</span>
                                                        <span style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: '0.22rem',
                                                            fontSize: '0.65rem', background: '#f1f5f9', color: '#64748b',
                                                            padding: '0.1rem 0.4rem', borderRadius: '6px', fontWeight: 600
                                                        }}>
                                                            <Lock size={10} /> Fixo Plano Assinatura
                                                        </span>
                                                    </div>
                                                    <small style={{ fontSize: '0.71rem', color: '#64748b', fontWeight: 600 }}>
                                                        Tarifa {concessionariaOrigem} (R$ {formatCurrencyUnit(tarifaOrigem, 4)}) - Desconto ({formatPct(descontoOrigemPct)}%)
                                                    </small>
                                                </div>
                                                <div style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, color: '#047857' }}>
                                                    100% (Isento de Fio B)
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>
                                                    R$ {formatCurrencyUnit(calc.vLastro, 4)}
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a', fontSize: '0.86rem' }}>
                                                    100,00%
                                                </div>
                                            </div>

                                            {/* 2º ITEM: (-) DESCONTO DO ASSINANTE (ELETROPOSTO) */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem' }}>
                                                    (-) Desconto do Assinante (Eletroposto)
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        max="100"
                                                        className="crm-input"
                                                        value={descontoEletroposto}
                                                        onChange={e => setDescontoEletroposto(e.target.value)}
                                                        style={{
                                                            width: '78px', padding: '0.36rem 0.5rem', borderRadius: '8px',
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
                                                <div style={{ fontWeight: 800, color: '#047857', fontSize: '0.9rem' }}>
                                                    (=) Base de Cálculo Líquida
                                                </div>
                                                <div style={{ textAlign: 'center', color: '#047857', fontWeight: 700, fontSize: '0.8rem' }}>
                                                    Base sobre a qual incidem os níveis L1 a L4+
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>
                                                    R$ {formatCurrencyUnit(calc.baseLiquida, 4)}
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#047857', fontSize: '0.88rem' }}>
                                                    {formatPct(calc.pctRealBaseLiquida)}%
                                                </div>
                                            </div>

                                            {/* 4º ITEM: (-) B2W (GESTÃO / PLATAFORMA) — FIXA EM TODOS OS NÍVEIS */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                    <span>(-) B2W (Gestão / Plataforma)</span>
                                                    <span style={{
                                                        fontSize: '0.66rem', background: '#f1f5f9', color: '#475569',
                                                        padding: '0.12rem 0.45rem', borderRadius: '6px', fontWeight: 700
                                                    }}>
                                                        Recorrência Fixa
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        max="100"
                                                        className="crm-input"
                                                        value={regrasMultinivel.b2w?.niveis?.L1 ?? '10'}
                                                        onChange={e => handleFixedB2WPctChange(e.target.value)}
                                                        style={{
                                                            width: '78px', padding: '0.36rem 0.5rem', borderRadius: '8px',
                                                            border: '1px solid #6ee7b7', background: '#ecfdf5',
                                                            fontSize: '0.85rem', fontWeight: 800, textAlign: 'center', color: '#047857'
                                                        }}
                                                    />
                                                    <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>% s/ Base Líquida</span>
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#334155', fontSize: '0.86rem', fontWeight: 700 }}>
                                                    - R$ {formatCurrencyUnit(cv.vB2W, 5)}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(cv.pctRealB2W)}%
                                                </div>
                                            </div>

                                            {/* 5º ITEM: (-) LÍDER */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.86rem' }}>
                                                    (-) Líder / Coordenador
                                                </div>
                                                <div>
                                                    {renderMultilevelCenterControl('lider', [
                                                        { val: 3, label: '3 Níveis (L1-L3)' },
                                                        { val: 2, label: '2 Níveis (L1-L2)' },
                                                        { val: 1, label: '1 Nível (L1)' },
                                                        { val: 4, label: 'Todos (L1-L4+)' },
                                                        { val: 0, label: 'Sem Recorrência' }
                                                    ])}
                                                </div>
                                                <div style={{ textAlign: 'right', color: cv.pctLider > 0 ? '#334155' : '#94a3b8', fontSize: '0.86rem', fontWeight: 700 }}>
                                                    {cv.pctLider > 0 ? `- R$ ${formatCurrencyUnit(cv.vLider, 6)}` : 'R$ 0,0000 (Corte)'}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(cv.pctRealLider)}%
                                                </div>
                                            </div>

                                            {/* 6º GRUPO: (-) PARCEIRO POWER */}
                                            <div style={{ background: '#fafaf9', borderBottom: '1px solid #e2e8f0' }}>
                                                <div style={{
                                                    padding: '0.5rem 1.25rem',
                                                    background: '#f8fafc',
                                                    borderBottom: '1px dashed #e2e8f0',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.81rem', fontWeight: 800, color: '#1e293b' }}>
                                                        <Award size={15} color="#059669" />
                                                        <span>(-) Categorias Parceiro Power (PPE / PPP / PPF)</span>
                                                    </div>
                                                    <span style={{
                                                        fontSize: '0.71rem', fontWeight: 700, color: '#047857',
                                                        background: '#ecfdf5', padding: '0.15rem 0.55rem', borderRadius: '6px',
                                                        border: '1px solid #a7f3d0'
                                                    }}>
                                                        Teto no {activeLevelView === 'L4' ? 'L4+' : activeLevelView}: {cv.tetoLabel} ({formatPct(cv.pctParceiroPowerTeto)}% s/ Base = - R$ {formatCurrencyUnit(cv.vParceiroPowerTeto, 5)})
                                                    </span>
                                                </div>

                                                {/* PPE */}
                                                <div className="ledger-row" style={{ paddingLeft: '1.75rem' }}>
                                                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                        <span style={{
                                                            background: '#fef3c7', color: '#b45309', fontWeight: 800,
                                                            fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: '6px',
                                                            border: '1px solid #fde68a'
                                                        }}>
                                                            PPE
                                                        </span>
                                                        <span>Parceiro Power Embaixador</span>
                                                    </div>
                                                    <div>
                                                        {renderMultilevelCenterControl('ppe', [
                                                            { val: 2, label: '2 Níveis (L1-L2)' },
                                                            { val: 3, label: '3 Níveis (L1-L3)' },
                                                            { val: 1, label: '1 Nível (L1)' },
                                                            { val: 0, label: 'Desativado' }
                                                        ])}
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: cv.pctPPE > 0 ? '#334155' : '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>
                                                        {cv.pctPPE > 0 ? `- R$ ${formatCurrencyUnit(cv.vPPE, 5)}` : 'R$ 0,0000 (Corte)'}
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.84rem', fontWeight: 600 }}>
                                                        {formatPct(cv.pctRealPPE)}%
                                                    </div>
                                                </div>

                                                {/* PPP */}
                                                <div className="ledger-row" style={{ paddingLeft: '1.75rem' }}>
                                                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                        <span style={{
                                                            background: '#e0f2fe', color: '#0369a1', fontWeight: 800,
                                                            fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: '6px',
                                                            border: '1px solid #bae6fd'
                                                        }}>
                                                            PPP
                                                        </span>
                                                        <span>Parceiro Power Premium</span>
                                                    </div>
                                                    <div>
                                                        {renderMultilevelCenterControl('ppp', [
                                                            { val: 2, label: '2 Níveis (L1-L2)' },
                                                            { val: 3, label: '3 Níveis (L1-L3)' },
                                                            { val: 1, label: '1 Nível (L1)' },
                                                            { val: 0, label: 'Desativado' }
                                                        ])}
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: cv.pctPPP > 0 ? '#334155' : '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>
                                                        {cv.pctPPP > 0 ? `- R$ ${formatCurrencyUnit(cv.vPPP, 5)}` : 'R$ 0,0000 (Corte)'}
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.84rem', fontWeight: 600 }}>
                                                        {formatPct(cv.pctRealPPP)}%
                                                    </div>
                                                </div>

                                                {/* PPF */}
                                                <div className="ledger-row" style={{ paddingLeft: '1.75rem', borderBottom: 'none' }}>
                                                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                        <span style={{
                                                            background: '#f1f5f9', color: '#475569', fontWeight: 800,
                                                            fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: '6px',
                                                            border: '1px solid #cbd5e1'
                                                        }}>
                                                            PPF
                                                        </span>
                                                        <span>Parceiro Power Free</span>
                                                    </div>
                                                    <div>
                                                        {renderMultilevelCenterControl('ppf', [
                                                            { val: 1, label: '1 Nível (L1)' },
                                                            { val: 2, label: '2 Níveis (L1-L2)' },
                                                            { val: 0, label: 'Desativado' }
                                                        ])}
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: cv.pctPPF > 0 ? '#334155' : '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>
                                                        {cv.pctPPF > 0 ? `- R$ ${formatCurrencyUnit(cv.vPPF, 5)}` : 'R$ 0,0000 (Corte)'}
                                                    </div>
                                                    <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.84rem', fontWeight: 600 }}>
                                                        {formatPct(cv.pctRealPPF)}%
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 7º ITEM: (-) ASSINANTE CONECT */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                    <Users size={15} color="#10b981" />
                                                    <span>(-) Assinante Connect</span>
                                                </div>
                                                <div>
                                                    {renderMultilevelCenterControl('assinante_conect', [
                                                        { val: 1, label: '1 Nível Direto (L2+)' },
                                                        { val: 0, label: 'Sem MGM (0%)' }
                                                    ])}
                                                </div>
                                                <div style={{ textAlign: 'right', color: cv.pctAssinanteConect > 0 ? '#334155' : '#94a3b8', fontSize: '0.86rem', fontWeight: 600 }}>
                                                    {cv.pctAssinanteConect > 0 ? `- R$ ${formatCurrencyUnit(cv.vAssinanteConect, 5)}` : 'R$ 0,0000 (N/A L1)'}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(cv.pctRealAssinanteConect)}%
                                                </div>
                                            </div>

                                            {/* 8º ITEM: (=) LÍQUIDO EFETIVO DO FORNECEDOR */}
                                            <div className="ledger-row" style={{
                                                background: '#f8fafc',
                                                borderTop: '2px solid #cbd5e1',
                                                borderBottom: '1px solid #cbd5e1'
                                            }}>
                                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>
                                                    (=) Líquido Efetivo do Fornecedor ({activeLevelView === 'L4' ? 'L4+' : activeLevelView})
                                                </div>
                                                <div style={{ textAlign: 'center', color: '#475569', fontWeight: 700, fontSize: '0.78rem' }}>
                                                    Deduções no {activeLevelView === 'L4' ? 'L4+' : activeLevelView}: {formatPct(cv.totalPctSobreBase)}% s/ Base (- R$ {formatCurrencyUnit(cv.totalDeducoesBase, 5)})
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>
                                                    R$ {formatCurrencyUnit(cv.liquidoEfetivoFornecedor, 6)}
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.88rem' }}>
                                                    {formatPct(cv.pctRealLiquidoFornecedor)}%
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
                                                            width: '72px', padding: '0.35rem 0.5rem', borderRadius: '8px',
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

                                            {/* 10º ITEM: MARGEM LIVRE / SUPERÁVIT */}
                                            <div className="ledger-row" style={{
                                                background: cv.isLevelDeficit ? '#fef2f2' : '#f0fdf4',
                                                borderTop: `2px solid ${cv.isLevelDeficit ? '#ef4444' : '#22c55e'}`,
                                                borderBottom: '1px solid #e2e8f0',
                                                padding: '0.9rem 1.25rem'
                                            }}>
                                                <div style={{
                                                    fontWeight: 900,
                                                    color: cv.isLevelDeficit ? '#b91c1c' : '#15803d',
                                                    fontSize: '0.92rem',
                                                    display: 'flex', alignItems: 'center', gap: '0.5rem'
                                                }}>
                                                    {cv.isLevelDeficit ? <AlertTriangle size={18} color="#dc2626" /> : <ShieldCheck size={18} color="#16a34a" />}
                                                    <span>MARGEM LIVRE / SUPERÁVIT ({activeLevelView === 'L4' ? 'NÍVEL L4+' : `NÍVEL ${activeLevelView}`})</span>
                                                </div>
                                                <div style={{ textAlign: 'center', fontWeight: 700, color: cv.isLevelDeficit ? '#dc2626' : '#15803d', fontSize: '0.78rem' }}>
                                                    {cv.isLevelDeficit ? 'DÉFICIT DETECTADO NESTE NÍVEL' : 'SUPERÁVIT OPERACIONAL GARANTIDO'}
                                                </div>
                                                <div style={{
                                                    textAlign: 'right', fontWeight: 900,
                                                    color: cv.isLevelDeficit ? '#dc2626' : '#15803d',
                                                    fontSize: '0.98rem'
                                                }}>
                                                    {cv.margemLivre >= 0 ? '+ ' : '- '}R$ {formatCurrencyUnit(Math.abs(cv.margemLivre), 6)}
                                                </div>
                                                <div style={{
                                                    textAlign: 'right', fontWeight: 900,
                                                    color: cv.isLevelDeficit ? '#dc2626' : '#15803d',
                                                    fontSize: '0.94rem'
                                                }}>
                                                    {cv.pctRealMargemLivre >= 0 ? '+ ' : '- '}{formatPct(Math.abs(cv.pctRealMargemLivre))}%
                                                </div>
                                            </div>

                                            {/* PAINEL COMPARATIVO DE SUPERÁVIT DOS 4 NÍVEIS */}
                                            <div style={{ padding: '1rem 1.25rem', background: '#f8fafc' }}>
                                                <div style={{
                                                    fontSize: '0.74rem', fontWeight: 800, color: '#475569',
                                                    textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.65rem',
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                                }}>
                                                    <span>Resumo Comparativo de Superávit por Nível da Rede (L1 a L4+)</span>
                                                    <span style={{ color: '#059669', fontWeight: 700, textTransform: 'none' }}>
                                                        Clique em qualquer card para detalhar o nível na tabela acima
                                                    </span>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                                                    {LEVEL_KEYS.map(lk => {
                                                        const lv = calc.byLevel[lk];
                                                        const isCurrent = activeLevelView === lk;
                                                        return (
                                                            <div
                                                                key={lk}
                                                                onClick={() => setActiveLevelView(lk)}
                                                                style={{
                                                                    padding: '0.75rem 0.9rem',
                                                                    borderRadius: '12px',
                                                                    cursor: 'pointer',
                                                                    background: lv.isLevelDeficit
                                                                        ? '#fef2f2'
                                                                        : isCurrent
                                                                            ? '#ffffff'
                                                                            : '#f0fdf4',
                                                                    border: `2px solid ${
                                                                        lv.isLevelDeficit
                                                                            ? '#ef4444'
                                                                            : isCurrent
                                                                                ? '#10b981'
                                                                                : '#bbf7d0'
                                                                    }`,
                                                                    boxShadow: isCurrent ? '0 4px 10px rgba(16, 185, 129, 0.12)' : 'none',
                                                                    transition: 'all 0.15s'
                                                                }}
                                                            >
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                                                    <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f172a' }}>
                                                                        {LEVEL_LABELS[lk].short}
                                                                    </span>
                                                                    <span style={{
                                                                        fontSize: '0.68rem', fontWeight: 700,
                                                                        padding: '0.1rem 0.4rem', borderRadius: '6px',
                                                                        background: lv.isLevelDeficit ? '#fee2e2' : '#dcfce7',
                                                                        color: lv.isLevelDeficit ? '#b91c1c' : '#15803d'
                                                                    }}>
                                                                        Pool: {formatPct(lv.totalPctSobreBase, 1)}% Base
                                                                    </span>
                                                                </div>
                                                                <div style={{
                                                                    fontSize: '0.96rem', fontWeight: 900,
                                                                    color: lv.isLevelDeficit ? '#dc2626' : '#16a34a'
                                                                }}>
                                                                    {lv.margemLivre >= 0 ? '+ ' : '- '}R$ {formatCurrencyUnit(Math.abs(lv.margemLivre), 6)}
                                                                </div>
                                                                <div style={{ fontSize: '0.71rem', color: '#64748b', marginTop: '0.15rem', fontWeight: 600 }}>
                                                                    Superávit: <strong>{lv.pctRealMargemLivre >= 0 ? '+' : '-'}{formatPct(Math.abs(lv.pctRealMargemLivre))}%</strong> s/ Lastro
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
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
                                        Trava Antidéficit Acionada ({calc.worstDeficitLevel}) — Não é permitido salvar plano deficitário
                                    </strong>
                                    No <strong>{calc.worstDeficitLevel}</strong>, o Líquido Efetivo do Fornecedor (<strong>R$ {formatCurrencyUnit(calc.byLevel[calc.worstDeficitLevel]?.liquidoEfetivoFornecedor, 6)}/kWh</strong>) está abaixo do Piso Contratual (<strong>R$ {formatCurrencyUnit(calc.vPisoFornecedor, 6)}/kWh</strong>).
                                </div>
                            </div>
                        )}
                    </div>

                    {/* FOOTER */}
                    <div style={{
                        padding: '1.15rem 2rem', background: '#ffffff', borderTop: '1px solid #e2e8f0',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                <Percent size={15} color="#059669" />
                                Superávit L1: <strong style={{ color: '#16a34a' }}>+R$ {formatCurrencyUnit(calc.byLevel.L1.margemLivre, 5)}</strong>
                            </span>
                            <span>•</span>
                            <span>
                                Superávit L2: <strong style={{ color: '#16a34a' }}>+R$ {formatCurrencyUnit(calc.byLevel.L2.margemLivre, 5)}</strong>
                            </span>
                            <span>•</span>
                            <span>
                                Superávit L3: <strong style={{ color: '#16a34a' }}>+R$ {formatCurrencyUnit(calc.byLevel.L3.margemLivre, 5)}</strong>
                            </span>
                            <span>•</span>
                            <span>
                                Superávit L4+: <strong style={{ color: '#16a34a' }}>+R$ {formatCurrencyUnit(calc.byLevel.L4.margemLivre, 5)}</strong>
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
