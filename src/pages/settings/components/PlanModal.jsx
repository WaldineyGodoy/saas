import { useState, useEffect, useMemo } from 'react';
import {
    X,
    Save,
    Sparkles,
    Check,
    Percent,
    Building2,
    ShieldCheck,
    AlertTriangle,
    TrendingUp,
    Award,
    Users,
    Zap,
    Activity,
    Lock,
    GitBranch
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useUI } from '../../../contexts/UIContext';

// Formatadores numéricos padrão PT-BR
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

// Estrutura padrão de níveis por cargo (Marketing Multinível B2W)
const DEFAULT_MULTILEVEL_RULES = {
    b2w: {
        max_niveis: 4, // Recebe em L1, L2, L3 e L4+
        niveis: { L1: '10', L2: '10', L3: '10', L4: '10' }
    },
    lider: {
        max_niveis: 3, // Recebe até L3 (Corte em L4)
        niveis: { L1: '1', L2: '1', L3: '1', L4: '0' }
    },
    ppe: {
        max_niveis: 2, // Recebe até L2 (Corte em L3)
        niveis: { L1: '4', L2: '2', L3: '0', L4: '0' }
    },
    ppp: {
        max_niveis: 2, // Recebe até L2 (Corte em L3)
        niveis: { L1: '4', L2: '2', L3: '0', L4: '0' }
    },
    ppf: {
        max_niveis: 1, // Recebe em L1 (Corte em L2)
        niveis: { L1: '2', L2: '0', L3: '0', L4: '0' }
    },
    assinante_conect: {
        max_niveis: 1, // Recebe 1 nível direto de quem indicou (atuante a partir de L2)
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

export default function PlanModal({ isOpen, onClose, onSave, planToEdit }) {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(false);

    // Nível selecionado para inspeção detalhada na coluna da direita
    const [activeLevelView, setActiveLevelView] = useState('L1');

    // Lista de Concessionárias (Lastro e Ponto de Partida)
    const [concessionarias, setConcessionarias] = useState([]);
    const [loadingCons, setLoadingCons] = useState(false);
    const [selectedConsKey, setSelectedConsKey] = useState('');
    const [concessionariaNome, setConcessionariaNome] = useState('Cosern');
    const [subgrupoTarifario, setSubgrupoTarifario] = useState('B1 Residencial');

    // Lastro Tarifário (R$/kWh — Somente Leitura no Demonstrativo, definido pela Concessionária)
    const [tarifaBruta, setTarifaBruta] = useState('1.0300');
    const [fioB, setFioB] = useState('0.2130');

    // Estado Principal do Plano
    const [nome, setNome] = useState('');
    const [descontoAssinante, setDescontoAssinante] = useState('15');
    const [ativo, setAtivo] = useState(true);
    const [recompensasAtivo, setRecompensasAtivo] = useState(true);
    const [tipoRecompensa, setTipoRecompensa] = useState('recorrente'); // 'start' | 'recorrente' | 'hibrido'

    // Piso Contratual do Fornecedor (% sobre Tarifa Bruta)
    const [pisoFornecedorPct, setPisoFornecedorPct] = useState('50');

    // Configuração Multinível do Bloco Recorrente
    const [regrasMultinivel, setRegrasMultinivel] = useState(DEFAULT_MULTILEVEL_RULES);

    // Configuração do Start (Faturas Iniciais)
    const [faturasElegiveisStart, setFaturasElegiveisStart] = useState([2]);
    const [regrasStart, setRegrasStart] = useState({
        1: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
        2: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
        3: { b2w: '0', lider: '0', ppe: '0', ppp: '0', ppf: '0', assinante_conect: '0' }
    });

    // Busca Concessionárias no Supabase
    useEffect(() => {
        if (!isOpen) return;
        const fetchCons = async () => {
            setLoadingCons(true);
            try {
                const { data, error } = await supabase
                    .from('view_concessionarias_resumo')
                    .select('*')
                    .order('Concessionaria', { ascending: true });

                if (!error && data) {
                    setConcessionarias(data);
                }
            } catch (err) {
                console.error('Erro ao carregar concessionárias no modal:', err);
            } finally {
                setLoadingCons(false);
            }
        };
        fetchCons();
    }, [isOpen]);

    // Preenche dados na abertura (Edição vs Novo)
    useEffect(() => {
        if (!isOpen) return;
        setActiveLevelView('L1');

        if (planToEdit) {
            setNome(planToEdit.nome || '');
            setDescontoAssinante(String(planToEdit.desconto_assinante ?? '15'));
            setAtivo(planToEdit.ativo ?? true);
            setRecompensasAtivo(planToEdit.recompensas_ativo ?? true);
            setTipoRecompensa(planToEdit.tipo_recompensa || 'recorrente');

            const recCfg = planToEdit.recorrente_config || {};
            const lastro = recCfg.lastro_tarifario || {};

            setConcessionariaNome(lastro.concessionaria_nome || 'Cosern');
            setSelectedConsKey(lastro.concessionaria_key || '');
            setSubgrupoTarifario(lastro.subgrupo || 'B1 Residencial');
            setTarifaBruta(String(lastro.tarifa_bruta ?? '1.0300'));
            setFioB(String(lastro.fio_b ?? '0.2130'));
            setPisoFornecedorPct(String(lastro.piso_fornecedor_pct ?? '50'));

            if (recCfg.regras_multinivel) {
                setRegrasMultinivel(recCfg.regras_multinivel);
            } else {
                const rRec = recCfg.regras || {};
                const b2wVal = String(rRec.b2w ?? rRec.associacao ?? '10');
                const liderVal = String(rRec.lider ?? rRec.coordenador ?? '1');
                const ppeVal = String(rRec.ppe ?? rRec.embaixador ?? '4');
                const pppVal = String(rRec.ppp ?? rRec.embaixador ?? '4');
                const ppfVal = String(rRec.ppf ?? '2');
                const conectVal = String(rRec.assinante_conect ?? rRec.assinante ?? '2');

                setRegrasMultinivel({
                    b2w: { max_niveis: 4, niveis: { L1: b2wVal, L2: b2wVal, L3: b2wVal, L4: b2wVal } },
                    lider: { max_niveis: 3, niveis: { L1: liderVal, L2: liderVal, L3: liderVal, L4: '0' } },
                    ppe: { max_niveis: 2, niveis: { L1: ppeVal, L2: String(Math.max(0, Number(ppeVal) / 2)), L3: '0', L4: '0' } },
                    ppp: { max_niveis: 2, niveis: { L1: pppVal, L2: String(Math.max(0, Number(pppVal) / 2)), L3: '0', L4: '0' } },
                    ppf: { max_niveis: 1, niveis: { L1: ppfVal, L2: '0', L3: '0', L4: '0' } },
                    assinante_conect: { max_niveis: 1, niveis: { L1: '0', L2: conectVal || '2', L3: conectVal || '2', L4: conectVal || '2' } }
                });
            }

            if (planToEdit.start_config) {
                setFaturasElegiveisStart(planToEdit.start_config.faturas_elegiveis || [2]);
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
            setNome('');
            setDescontoAssinante('15');
            setAtivo(true);
            setRecompensasAtivo(true);
            setTipoRecompensa('recorrente');
            setConcessionariaNome('Cosern');
            setSelectedConsKey('');
            setSubgrupoTarifario('B1 Residencial');
            setTarifaBruta('1.0300');
            setFioB('0.2130');
            setPisoFornecedorPct('50');
            setRegrasMultinivel(DEFAULT_MULTILEVEL_RULES);
            setFaturasElegiveisStart([2]);
            setRegrasStart({
                1: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
                2: { b2w: '0', lider: '50', ppe: '50', ppp: '40', ppf: '20', assinante_conect: '0' },
                3: { b2w: '0', lider: '0', ppe: '0', ppp: '0', ppf: '0', assinante_conect: '0' }
            });
        }
    }, [planToEdit, isOpen]);

    // Atualiza Tarifa e Fio B somente via seleção da Concessionária ou Subgrupo
    const applyConcessionariaTariff = (consObj, subgrupo) => {
        if (!consObj) return;
        let tVal = consObj['Tarifa Concessionaria'] || 0;
        let fVal = consObj['Fio B'] || 0;

        if (subgrupo === 'B2 Rural') {
            tVal = consObj['Tarifa Concessionaria_B2'] || tVal;
            fVal = consObj['Fio B_B2'] || fVal;
        } else if (subgrupo === 'B3 Comercial') {
            tVal = consObj['Tarifa Concessionaria_B3'] || tVal;
            fVal = consObj['Fio B_B3'] || fVal;
        } else if (subgrupo === 'Grupo A') {
            tVal = consObj['Tarifa Concessionaria_A'] || tVal;
            fVal = consObj['Fio B_A'] || fVal;
        }

        if (Number(tVal) > 0) setTarifaBruta(Number(tVal).toFixed(4));
        if (Number(fVal) > 0) setFioB(Number(fVal).toFixed(4));
        if (consObj['Desconto Assinante'] && Number(consObj['Desconto Assinante']) > 0 && !planToEdit) {
            setDescontoAssinante(String(consObj['Desconto Assinante']));
        }
    };

    const handleSelectConcessionaria = (e) => {
        const key = e.target.value;
        setSelectedConsKey(key);
        if (!key) {
            setConcessionariaNome('Cosern');
            setTarifaBruta('1.0300');
            setFioB('0.2130');
            return;
        }

        const found = concessionarias.find(c => `${c.Concessionaria}__${c.UF}` === key);
        if (found) {
            setConcessionariaNome(found.Concessionaria);
            applyConcessionariaTariff(found, subgrupoTarifario);
        }
    };

    const handleSelectSubgrupo = (novoSubgrupo) => {
        setSubgrupoTarifario(novoSubgrupo);
        if (selectedConsKey) {
            const found = concessionarias.find(c => `${c.Concessionaria}__${c.UF}` === selectedConsKey);
            if (found) applyConcessionariaTariff(found, novoSubgrupo);
        }
    };

    // Verifica se determinado nível (L1..L4) está habilitado para o cargo de acordo com max_niveis
    const isLevelAllowedForRole = (roleKey, levelKey, maxNiveis) => {
        if (roleKey === 'b2w') return true; // B2W (Gestão / Plataforma) recebe recorrência fixa em todos os níveis
        const levelIdx = LEVEL_KEYS.indexOf(levelKey) + 1; // 1, 2, 3, 4
        if (roleKey === 'assinante_conect') {
            // Assinante Conect indica a partir de L2 (em L1 a venda é direta do Parceiro Power)
            // Se max_niveis === 0, não recebe nunca. Se >= 1, atua de L2 em diante.
            if (maxNiveis === 0) return false;
            return levelIdx >= 2;
        }
        return levelIdx <= maxNiveis;
    };

    // Alterar percentual fixo da B2W (aplica igualmente em todos os níveis de assinante)
    const handleFixedB2WPctChange = (val) => {
        setRegrasMultinivel(prev => ({
            ...prev,
            b2w: {
                max_niveis: 4,
                niveis: { L1: val, L2: val, L3: val, L4: val }
            }
        }));
    };

    // Alterar quantidade de níveis que uma função tem direito a receber
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
                        // Sugere valor padrão se estava zerado
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

    // Alterar percentual de um cargo em um nível específico (L1, L2, L3, L4)
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

    // MOTOR DE CÁLCULO DINÂMICO MULTINÍVEL (Calcula L1, L2, L3 e L4+ simultaneamente)
    const calc = useMemo(() => {
        const tBruta = Math.max(0, parseFloat(tarifaBruta) || 0);
        const vFioB = Math.max(0, parseFloat(fioB) || 0);
        const pctDescAssinante = Math.max(0, parseFloat(descontoAssinante) || 0);

        // 2º Item: (-) Fio B
        const pctRealFioB = tBruta > 0 ? (vFioB / tBruta) * 100 : 0;

        // 3º Item: (-) Desconto do Assinante (% sobre Tarifa Bruta)
        const vDescAssinante = tBruta * (pctDescAssinante / 100);
        const pctRealDescAssinante = pctDescAssinante;

        // 4º Item: (=) Base de Cálculo Líquida
        const baseLiquida = tBruta - vFioB - vDescAssinante;
        const pctRealBaseLiquida = tBruta > 0 ? (baseLiquida / tBruta) * 100 : 0;
        const basePositiva = Math.max(0, baseLiquida);

        // Piso Contratual do Fornecedor (% sobre Tarifa Bruta)
        const pctPisoFornecedor = Math.max(0, parseFloat(pisoFornecedorPct) || 0);
        const vPisoFornecedor = tBruta * (pctPisoFornecedor / 100);
        const pctRealPisoFornecedor = pctPisoFornecedor;

        // Calcula os resultados financeiros para cada Nível (L1, L2, L3, L4)
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

            const pctRealB2W = tBruta > 0 ? (vB2W / tBruta) * 100 : 0;
            const pctRealLider = tBruta > 0 ? (vLider / tBruta) * 100 : 0;
            const pctRealPPE = tBruta > 0 ? (vPPE / tBruta) * 100 : 0;
            const pctRealPPP = tBruta > 0 ? (vPPP / tBruta) * 100 : 0;
            const pctRealPPF = tBruta > 0 ? (vPPF / tBruta) * 100 : 0;
            const pctRealAssinanteConect = tBruta > 0 ? (vAssinanteConect / tBruta) * 100 : 0;

            // Teto da categoria Parceiro Power neste nível
            const pctParceiroPowerTeto = Math.max(pctPPE, pctPPP, pctPPF);
            const vParceiroPowerTeto = basePositiva * (pctParceiroPowerTeto / 100);
            const pctRealParceiroPowerTeto = tBruta > 0 ? (vParceiroPowerTeto / tBruta) * 100 : 0;

            let tetoLabel = 'PPE';
            if (pctParceiroPowerTeto === 0) tetoLabel = 'Corte (0%)';
            else if (pctPPP >= pctPPE && pctPPP >= pctPPF) tetoLabel = 'PPP';
            else if (pctPPE >= pctPPP && pctPPE >= pctPPF) tetoLabel = 'PPE';
            else tetoLabel = 'PPF';

            const totalDeducoesBase = vB2W + vLider + vParceiroPowerTeto + vAssinanteConect;
            const totalPctSobreBase = pctB2W + pctLider + pctParceiroPowerTeto + pctAssinanteConect;

            const liquidoEfetivoFornecedor = baseLiquida - totalDeducoesBase;
            const pctRealLiquidoFornecedor = tBruta > 0 ? (liquidoEfetivoFornecedor / tBruta) * 100 : 0;

            const margemLivre = liquidoEfetivoFornecedor - vPisoFornecedor;
            const pctRealMargemLivre = tBruta > 0 ? (margemLivre / tBruta) * 100 : 0;

            const isLevelDeficit =
                tBruta <= 0 ||
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
            tBruta,
            vFioB,
            pctRealFioB,
            pctDescAssinante,
            vDescAssinante,
            pctRealDescAssinante,
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
    }, [tarifaBruta, fioB, descontoAssinante, regrasMultinivel, pisoFornecedorPct, activeLevelView]);

    if (!isOpen) return null;

    const toggleFaturaStart = (faturaNum) => {
        setFaturasElegiveisStart(prev => {
            if (prev.includes(faturaNum)) {
                if (prev.length === 1) {
                    showAlert('Pelo menos uma fatura deve ser selecionada na modalidade Start.', 'warning');
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
            showAlert('Por favor, informe o Nome do Plano.', 'error');
            return;
        }

        if (bloqueadoPorDeficit) {
            showAlert(`Operação bloqueada: O plano apresenta resultado deficitário no ${calc.worstDeficitLevel}. Ajuste os percentuais para que todos os níveis tenham Superávit.`, 'error');
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
            desconto_assinante: parseFloat(descontoAssinante) || 0,
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
                vigencia_tipo: 'status_ativo_entidade',
                meses: null,
                lastro_tarifario: {
                    concessionaria_key: selectedConsKey,
                    concessionaria_nome: concessionariaNome,
                    subgrupo: subgrupoTarifario,
                    tarifa_bruta: calc.tBruta,
                    fio_b: calc.vFioB,
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
                showAlert('Plano de assinatura atualizado com sucesso!', 'success');
            } else {
                const { error } = await supabase
                    .from('planos_assinatura_energia')
                    .insert([payload]);

                if (error) throw error;
                showAlert('Plano de assinatura criado com sucesso!', 'success');
            }

            if (onSave) onSave();
            onClose();
        } catch (err) {
            console.error('Erro ao salvar plano:', err);
            showAlert('Erro ao salvar plano: ' + (err.message || 'Erro desconhecido'), 'error');
        } finally {
            setLoading(false);
        }
    };

    // Renderizador auxiliar da coluna central (Níveis de Direito + Inputs L1..L4)
    const renderMultilevelCenterControl = (roleKey, optionsList) => {
        const cfg = regrasMultinivel[roleKey];
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%' }}>
                {/* Seletor de quantos níveis tem direito */}
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

                {/* Mini-inputs para L1, L2, L3 e L4+ */}
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
                                            ? '#eff6ff'
                                            : '#ffffff',
                                    border: `1px solid ${
                                        isFocusedLevel
                                            ? '#3b82f6'
                                            : allowed
                                                ? '#cbd5e1'
                                                : '#e2e8f0'
                                    }`,
                                    borderRadius: '7px',
                                    padding: '0.18rem 0.25rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s'
                                }}
                                title={allowed ? `Percentual no ${lk} (% sobre Base Líquida)` : `Corte automático no ${lk}`}
                            >
                                <span style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 800,
                                    color: isFocusedLevel ? '#1d4ed8' : allowed ? '#64748b' : '#94a3b8',
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
                                    <span style={{
                                        fontSize: '0.66rem',
                                        fontWeight: 700,
                                        color: '#94a3b8',
                                        padding: '0.08rem 0'
                                    }}>
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
                        border-color: #3b82f6 !important;
                        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12) !important;
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

                {/* HEADER PREMIUM (Padrão UI/UX CRM) */}
                <div style={{
                    padding: '1.35rem 2rem',
                    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    color: '#ffffff'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{
                            width: '48px', height: '48px', borderRadius: '14px',
                            background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(96, 165, 250, 0.35)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa'
                        }}>
                            <Zap size={24} />
                        </div>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em' }}>
                                    {planToEdit ? 'Editar Plano de Assinatura & Recompensas' : 'Novo Plano de Assinatura & Recompensas'}
                                </h3>
                                <span style={{
                                    fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.6rem',
                                    borderRadius: '20px', background: 'rgba(16, 185, 129, 0.2)',
                                    color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.3)'
                                }}>
                                    Multinível L1 a L4+
                                </span>
                            </div>
                            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: '#94a3b8' }}>
                                Lastro oficial na Concessionária, cálculo de Superávit por nível de rede e vigência por Status Ativo
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
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* BODY SCROLLABLE */}
                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div className="crm-scrollbar" style={{
                        padding: '1.65rem 2rem', overflowY: 'auto', flex: 1,
                        background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '1.4rem'
                    }}>

                        {/* =========================================================================
                            BLOCO 1: IDENTIFICAÇÃO DO PLANO E CONCESSIONÁRIA (ALINHAMENTO HORIZONTAL)
                           ========================================================================= */}
                        <div style={{
                            background: '#ffffff', padding: '1.4rem 1.5rem', borderRadius: '20px',
                            border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                                    <Building2 size={18} color="#3b82f6" />
                                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b', fontWeight: 700 }}>
                                        1. Identificação do Plano e Concessionária de Referência (Lastro)
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
                                        {ativo ? '● Plano Ativo' : '○ Plano Inativo'}
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

                            {/* Grid Horizontal perfeitamente alinhado com textos de label em linha única */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1.15fr 1.6fr 0.85fr',
                                gap: '1rem',
                                alignItems: 'end'
                            }}>
                                {/* Campo 1: Nome Comercial do Plano */}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <label style={{
                                        display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569',
                                        marginBottom: '0.42rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                    }}>
                                        Nome Comercial do Plano *
                                    </label>
                                    <input
                                        type="text"
                                        className="crm-input"
                                        placeholder="Ex: Plano Ultra Conect 15%"
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

                                {/* Campo 2: Selecionar Concessionária (Define Tarifa e Fio B) — Linha Única */}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <label style={{
                                        display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569',
                                        marginBottom: '0.42rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                    }}>
                                        Selecionar Concessionária (Define Tarifa e Fio B)
                                    </label>
                                    <select
                                        className="crm-input"
                                        value={selectedConsKey}
                                        onChange={handleSelectConcessionaria}
                                        style={{
                                            width: '100%', height: '44px', padding: '0 0.95rem', borderRadius: '12px',
                                            border: '1px solid #cbd5e1', fontSize: '0.86rem', color: '#1e293b',
                                            background: '#ffffff', boxSizing: 'border-box', fontWeight: 600, cursor: 'pointer'
                                        }}
                                    >
                                        <option value="">
                                            {loadingCons
                                                ? 'Carregando concessionárias...'
                                                : `Referência: ${concessionariaNome} — Tarifa R$ ${formatCurrencyUnit(tarifaBruta, 4)} | Fio B R$ ${formatCurrencyUnit(fioB, 4)}`}
                                        </option>
                                        {concessionarias.map((c, idx) => {
                                            const key = `${c.Concessionaria}__${c.UF}`;
                                            const tVal = Number(c['Tarifa Concessionaria'] || 0).toFixed(4);
                                            const fVal = Number(c['Fio B'] || 0).toFixed(4);
                                            return (
                                                <option key={`${key}_${idx}`} value={key}>
                                                    {c.Concessionaria} ({c.UF}) — Tarifa R$ {tVal} | Fio B R$ {fVal}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>

                                {/* Campo 3: Subgrupo de Referência */}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <label style={{
                                        display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569',
                                        marginBottom: '0.42rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                    }}>
                                        Subgrupo de Referência
                                    </label>
                                    <select
                                        className="crm-input"
                                        value={subgrupoTarifario}
                                        onChange={e => handleSelectSubgrupo(e.target.value)}
                                        style={{
                                            width: '100%', height: '44px', padding: '0 0.95rem', borderRadius: '12px',
                                            border: '1px solid #cbd5e1', fontSize: '0.86rem', color: '#1e293b',
                                            background: '#ffffff', boxSizing: 'border-box', fontWeight: 600, cursor: 'pointer'
                                        }}
                                    >
                                        <option value="B1 Residencial">B1 Residencial</option>
                                        <option value="B2 Rural">B2 Rural</option>
                                        <option value="B3 Comercial">B3 Comercial</option>
                                        <option value="Grupo A">Grupo A</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* =========================================================================
                            BLOCO 2: DEMONSTRATIVO DINÂMICO E MATRIZ DE NÍVEIS (L1, L2, L3 e L4+)
                           ========================================================================= */}
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
                                        <Sparkles size={19} color="#3b82f6" />
                                        2. Estrutura de Recompensas & Níveis de Recebimento (Multinível)
                                    </h4>
                                    <p style={{ margin: '0.22rem 0 0 0', fontSize: '0.79rem', color: '#64748b' }}>
                                        Parametrize quantos níveis cada função recebe e acompanhe o Superávit de L1 a L4+
                                    </p>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                                    <div style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                                        background: '#eff6ff', border: '1px solid #93c5fd',
                                        color: '#1d4ed8', padding: '0.38rem 0.85rem', borderRadius: '12px',
                                        fontSize: '0.75rem', fontWeight: 700
                                    }}>
                                        <Activity size={15} color="#2563eb" />
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
                                    {/* Modalidade (Recorrente | Start | Híbrido) */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.85rem', marginBottom: '1.35rem' }}>
                                        {[
                                            { id: 'recorrente', title: 'Recorrente (Multinível L1 a L4+)', sub: 'Repasse contínuo enquanto a entidade estiver Ativa', color: '#15803d', border: '#22c55e', bg: '#f0fdf4' },
                                            { id: 'start', title: 'Start (Pagamento Único)', sub: 'Bonificação nas faturas iniciais (1ª, 2ª ou 3ª fatura)', color: '#1d4ed8', border: '#3b82f6', bg: '#eff6ff' },
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

                                    {/* DEMONSTRATIVO DINÂMICO RECORRENTE COM NÍVEIS L1..L4+ */}
                                    {(tipoRecompensa === 'recorrente' || tipoRecompensa === 'hibrido') && (
                                        <div style={{
                                            borderRadius: '18px', border: '1px solid #cbd5e1',
                                            background: '#ffffff', overflow: 'hidden',
                                            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.04)',
                                            marginBottom: tipoRecompensa === 'hibrido' ? '1.5rem' : 0
                                        }}>
                                            {/* Barra Superior do Demonstrativo com Seletor de Nível (L1, L2, L3, L4+) */}
                                            <div style={{
                                                padding: '0.9rem 1.25rem',
                                                background: 'linear-gradient(90deg, #0f172a 0%, #1e293b 100%)',
                                                color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                flexWrap: 'wrap', gap: '0.75rem'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                    <GitBranch size={18} color="#38bdf8" />
                                                    <div>
                                                        <span style={{ fontWeight: 800, fontSize: '0.9rem', display: 'block' }}>
                                                            Demonstrativo Dinâmico — {LEVEL_LABELS[activeLevelView].short}: {LEVEL_LABELS[activeLevelView].desc}
                                                        </span>
                                                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                                            Clique nos níveis ao lado para inspecionar os valores em R$/kWh de cada geração da rede
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Segmented Control para alternar L1 | L2 | L3 | L4+ */}
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
                                                                    background: isSelected ? '#3b82f6' : 'transparent',
                                                                    color: isSelected ? '#ffffff' : '#cbd5e1',
                                                                    fontWeight: 800,
                                                                    fontSize: '0.75rem',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.35rem',
                                                                    transition: 'all 0.15s'
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

                                            {/* Cabeçalho das Colunas */}
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
                                                <div style={{ textAlign: 'right' }}>% Real s/ Tarifa</div>
                                            </div>

                                            {/* 1º ITEM: TARIFA BRUTA CONCESSIONÁRIA (SOMENTE LEITURA) */}
                                            <div className="ledger-row" style={{ background: '#ffffff' }}>
                                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                    <span>Tarifa Bruta {concessionariaNome}</span>
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                        fontSize: '0.66rem', background: '#f1f5f9', color: '#64748b',
                                                        padding: '0.12rem 0.45rem', borderRadius: '6px', fontWeight: 600
                                                    }} title="Editável apenas no cadastro da Concessionária">
                                                        <Lock size={11} /> Fixo Concessionária
                                                    </span>
                                                </div>
                                                <div style={{ textAlign: 'center', fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                                                    100% (Lastro Homologado)
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>
                                                    R$ {formatCurrencyUnit(calc.tBruta, 4)}
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a', fontSize: '0.86rem' }}>
                                                    100,00%
                                                </div>
                                            </div>

                                            {/* 2º ITEM DA LISTA: (-) FIO B (SOMENTE LEITURA) */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                    <span>(-) Fio B</span>
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                        fontSize: '0.66rem', background: '#f1f5f9', color: '#64748b',
                                                        padding: '0.12rem 0.45rem', borderRadius: '6px', fontWeight: 600
                                                    }} title="Editável apenas no cadastro da Concessionária">
                                                        <Lock size={11} /> Concessionária
                                                    </span>
                                                </div>
                                                <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                                                    Custo Regulatório ({concessionariaNome})
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626', fontSize: '0.88rem' }}>
                                                    - R$ {formatCurrencyUnit(calc.vFioB, 4)}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(calc.pctRealFioB)}%
                                                </div>
                                            </div>

                                            {/* 3º ITEM DA LISTA: (-) DESCONTO DO ASSINANTE */}
                                            <div className="ledger-row">
                                                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem' }}>
                                                    (-) Desconto do Assinante
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        max="100"
                                                        className="crm-input"
                                                        value={descontoAssinante}
                                                        onChange={e => setDescontoAssinante(e.target.value)}
                                                        style={{
                                                            width: '78px', padding: '0.36rem 0.5rem', borderRadius: '8px',
                                                            border: '1px solid #93c5fd', background: '#eff6ff',
                                                            fontSize: '0.85rem', fontWeight: 800, textAlign: 'center', color: '#1d4ed8'
                                                        }}
                                                    />
                                                    <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>% s/ Tarifa Bruta</span>
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626', fontSize: '0.88rem' }}>
                                                    - R$ {formatCurrencyUnit(calc.vDescAssinante, 4)}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(calc.pctRealDescAssinante)}%
                                                </div>
                                            </div>

                                            {/* 4º ITEM: (=) BASE DE CÁLCULO LÍQUIDA */}
                                            <div className="ledger-row" style={{
                                                background: '#f0f9ff',
                                                borderTop: '1px solid #bae6fd',
                                                borderBottom: '2px solid #bae6fd'
                                            }}>
                                                <div style={{ fontWeight: 800, color: '#0369a1', fontSize: '0.9rem' }}>
                                                    (=) Base de Cálculo Líquida
                                                </div>
                                                <div style={{ textAlign: 'center', color: '#0369a1', fontWeight: 700, fontSize: '0.8rem' }}>
                                                    Base sobre a qual incidem os níveis L1 a L4+
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>
                                                    R$ {formatCurrencyUnit(calc.baseLiquida, 4)}
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0369a1', fontSize: '0.88rem' }}>
                                                    {formatPct(calc.pctRealBaseLiquida)}%
                                                </div>
                                            </div>

                                            {/* 5º ITEM: (-) B2W (GESTÃO / PLATAFORMA) — FIXA EM TODOS OS NÍVEIS */}
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
                                                            border: '1px solid #93c5fd', background: '#eff6ff',
                                                            fontSize: '0.85rem', fontWeight: 800, textAlign: 'center', color: '#1d4ed8'
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

                                            {/* 6º ITEM: (-) LÍDER */}
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

                                            {/* 7º GRUPO: (-) CATEGORIAS PARCEIRO POWER (PPE, PPP e PPF) */}
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
                                                        <Award size={15} color="#3b82f6" />
                                                        <span>(-) Categorias Parceiro Power (PPE / PPP / PPF)</span>
                                                    </div>
                                                    <span style={{
                                                        fontSize: '0.71rem', fontWeight: 700, color: '#1d4ed8',
                                                        background: '#eff6ff', padding: '0.15rem 0.55rem', borderRadius: '6px',
                                                        border: '1px solid #bfdbfe'
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

                                            {/* 8º ITEM: (-) ASSINANTE CONECT */}
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

                                            {/* 9º ITEM: (=) LÍQUIDO EFETIVO DO FORNECEDOR */}
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

                                            {/* 10º ITEM: PISO CONTRATUAL DO FORNECEDOR */}
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
                                                    <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>% s/ Tarifa Bruta</span>
                                                </div>
                                                <div style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>
                                                    R$ {formatCurrencyUnit(calc.vPisoFornecedor, 6)}
                                                </div>
                                                <div style={{ textAlign: 'right', color: '#475569', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {formatPct(calc.pctRealPisoFornecedor)}%
                                                </div>
                                            </div>

                                            {/* 11º ITEM: MARGEM LIVRE / EXCEDENTE DO NÍVEL SELECIONADO */}
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

                                            {/* PAINEL COMPARATIVO DE SUPERÁVIT DOS 4 NÍVEIS (L1, L2, L3, L4+) */}
                                            <div style={{ padding: '1rem 1.25rem', background: '#f8fafc' }}>
                                                <div style={{
                                                    fontSize: '0.74rem', fontWeight: 800, color: '#475569',
                                                    textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.65rem',
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                                }}>
                                                    <span>Resumo Comparativo de Superávit por Nível da Rede (L1 a L4+)</span>
                                                    <span style={{ color: '#0284c7', fontWeight: 700, textTransform: 'none' }}>
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
                                                                                ? '#3b82f6'
                                                                                : '#bbf7d0'
                                                                    }`,
                                                                    boxShadow: isCurrent ? '0 4px 10px rgba(59, 130, 246, 0.12)' : 'none',
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
                                                                    Superávit: <strong>{lv.pctRealMargemLivre >= 0 ? '+' : '-'}{formatPct(Math.abs(lv.pctRealMargemLivre))}%</strong> s/ Tarifa
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
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
                                                        Distribuição nas Faturas Iniciais (% sobre Base Líquida: R$ {formatCurrencyUnit(calc.baseLiquida, 4)}/kWh)
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
                                                            Fatura {fatNum} {fatNum === 2 && <span style={{ fontSize: '0.72rem', fontWeight: 500 }}>(Padrão)</span>}
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
                                                                    Fatura {fatNum} — Repasse Único (% sobre Base Líquida)
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
                                    Este plano está configurado apenas com o <strong>Desconto Direto de {formatPct(calc.pctDescAssinante)}%</strong> ao assinante, sem distribuição de recompensas para rede.
                                </div>
                            )}
                        </div>

                        {/* ALERTA DE BLOQUEIO SE ALGUM NÍVEL ESTIVER DEFICITÁRIO */}
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
                                    No <strong>{calc.worstDeficitLevel}</strong>, o Líquido Efetivo do Fornecedor (<strong>R$ {formatCurrencyUnit(calc.byLevel[calc.worstDeficitLevel]?.liquidoEfetivoFornecedor, 6)}/kWh</strong>) está abaixo do Piso Contratual (<strong>R$ {formatCurrencyUnit(calc.vPisoFornecedor, 6)}/kWh</strong>). Reduza o desconto ou ajuste as alíquotas dos níveis para prosseguir.
                                </div>
                            </div>
                        )}
                    </div>

                    {/* FOOTER DE AÇÕES */}
                    <div style={{
                        padding: '1.15rem 2rem', background: '#ffffff', borderTop: '1px solid #e2e8f0',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                <Percent size={15} color="#3b82f6" />
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
                                        : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                    color: '#ffffff', fontWeight: 800, fontSize: '0.88rem',
                                    cursor: (loading || bloqueadoPorDeficit) ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    boxShadow: bloqueadoPorDeficit ? 'none' : '0 10px 15px -3px rgba(37, 99, 235, 0.3)'
                                }}
                            >
                                <Save size={18} />
                                {loading ? 'Salvando...' : (planToEdit ? 'Salvar Alterações' : 'Criar Plano de Assinatura')}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
