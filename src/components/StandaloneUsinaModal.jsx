import React, { useState, useEffect } from 'react';
import { X, Save, AlertCircle, Edit, Trash2, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';
import StandaloneUcModal from './StandaloneUcModal';
import StandaloneAccountModal from './StandaloneAccountModal';

const irrKeys = ['jan.khw', 'fev.khw', 'mar.kwh', 'abr.kwh', 'mai.kwh', 'jun.kwh', 'jul.kwh', 'ago.kwh', 'set.kwh', 'out.kwh', 'nov.kwh', 'dez.khw'];
const mesesLabels = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export default function StandaloneUsinaModal({ isOpen, onClose, onSave, usinaData, userId }) {
    const [usinaModalTab, setUsinaModalTab] = useState('dados');
    const [usinaModalYear, setUsinaModalYear] = useState(new Date().getFullYear());
    const [irradianciaInfo, setIrradianciaInfo] = useState(null);
    const [alertMsg, setAlertMsg] = useState('');
    const [codigoGeradoLocal, setCodigoGeradoLocal] = useState('');

    const [ucs, setUcs] = useState([]);
    const [searchUc, setSearchUc] = useState('');
    const [sortUcConfig, setSortUcConfig] = useState({ key: 'numero_uc', direction: 'asc' });
    const [editUcModalData, setEditUcModalData] = useState(null);
    const [deleteUcModalData, setDeleteUcModalData] = useState(null);

    const [faturas, setFaturas] = useState([]);
    const [selectedFaturas, setSelectedFaturas] = useState([]);
    const [isFaturasLoading, setIsFaturasLoading] = useState(false);
    const [editFaturaModalData, setEditFaturaModalData] = useState(null);
    const [deleteFaturasModalOpen, setDeleteFaturasModalOpen] = useState(false);

    const [editUsinaModal, setEditUsinaModal] = useState({
        nome: '',
        tipo_compensacao: 'prioridade',
        cep: '',
        ibge_code: '',
        potencia_kwp: '',
        qtd_modulos: '',
        potencia_modulo: '',
        qtd_inversores: '',
        potencia_inversor: '',
        geracao_aferida: {},
        telefone: '',
        email: '',
        codigo_verificacao: '',
        codigo_gerado: '',
        verificada: false
    });

    useEffect(() => {
        if (isOpen) {
            if (usinaData) {
                setEditUsinaModal({
                    id: usinaData.id,
                    nome: usinaData.nome || '',
                    tipo_compensacao: usinaData.tipo_compensacao || 'prioridade',
                    cep: usinaData.cep || '',
                    ibge_code: usinaData.ibge_code || '',
                    potencia_kwp: usinaData.potencia_kwp || '',
                    qtd_modulos: usinaData.qtd_modulos || '',
                    potencia_modulo: usinaData.potencia_modulo || '',
                    qtd_inversores: usinaData.qtd_inversores || '',
                    potencia_inversor: usinaData.potencia_inversor || '',
                    geracao_aferida: usinaData.geracao_aferida || {},
                    telefone: usinaData.telefone || '',
                    email: usinaData.email || '',
                    codigo_verificacao: usinaData.codigo_verificacao || '',
                    codigo_gerado: usinaData.codigo_gerado || '',
                    verificada: usinaData.verificada || false
                });
            } else {
                setEditUsinaModal({
                    nome: '',
                    tipo_compensacao: 'prioridade',
                    cep: '',
                    ibge_code: '',
                    potencia_kwp: '',
                    qtd_modulos: '',
                    potencia_modulo: '',
                    qtd_inversores: '',
                    potencia_inversor: '',
                    geracao_aferida: {},
                    telefone: '',
                    email: '',
                    codigo_verificacao: '',
                    codigo_gerado: '',
                    verificada: false
                });
            }
            setUsinaModalTab('dados');
            if (usinaData && usinaData.id) {
                loadUcs(usinaData.id);
                loadFaturas(usinaData.id);
            } else {
                setUcs([]);
                setFaturas([]);
            }
        }
    }, [isOpen, usinaData]);

    const loadUcs = async (usinaId) => {
        if (!usinaId) return;
        const { data } = await supabase.from('standalone_ucs').select('*').eq('usina_id', usinaId).order('tipo');
        setUcs(data || []);
    };

    const loadFaturas = async (usinaId) => {
        if (!usinaId) return;
        setIsFaturasLoading(true);
        try {
            const { data: ucsData, error: ucsError } = await supabase.from('standalone_ucs').select('id, numero_uc').eq('usina_id', usinaId);
            if (ucsError) throw new Error("Erro ao buscar UCs: " + ucsError.message);
            
            if (!ucsData || ucsData.length === 0) {
                setFaturas([]);
                return;
            }
            
            const ucIds = ucsData.map(u => u.id);
            const { data: faturasData, error: faturasError } = await supabase.from('standalone_contas')
                .select('*')
                .in('uc_id', ucIds)
                .order('mes_referencia', { ascending: false });
                
            if (faturasError) throw new Error("Erro ao buscar Faturas: " + faturasError.message);
                
            const faturasWithUc = faturasData?.map(f => ({
                ...f,
                numero_uc: ucsData.find(u => u.id === f.uc_id)?.numero_uc || 'Desconhecida'
            })) || [];
            
            setFaturas(faturasWithUc);
        } catch(e) {
            console.error('Erro ao carregar faturas da usina', e);
            showAlert(e.message);
        } finally {
            setIsFaturasLoading(false);
        }
    };

    useEffect(() => {
        const fetchIrradiancia = async () => {
            if (editUsinaModal.ibge_code) {
                const { data } = await supabase.from('irradiancia').select('*').eq('"cod.ibge"', editUsinaModal.ibge_code).single();
                setIrradianciaInfo(data || null);
            } else {
                setIrradianciaInfo(null);
            }
        };
        fetchIrradiancia();
    }, [editUsinaModal.ibge_code]);

    if (!isOpen) return null;

    const showAlert = (msg) => {
        setAlertMsg(msg);
        setTimeout(() => setAlertMsg(''), 4000);
    };

    const confirmDeleteUc = async () => {
        if (!deleteUcModalData) return;
        try {
            await supabase.from('standalone_ucs').delete().eq('id', deleteUcModalData.id);
            loadUcs(usinaData.id);
            setDeleteUcModalData(null);
        } catch (err) {
            showAlert('Erro ao excluir UC: ' + err.message);
        }
    };

    const handleMassDeleteFaturas = async () => {
        if (selectedFaturas.length === 0) return;
        if (!window.confirm(`Tem certeza que deseja apagar ${selectedFaturas.length} faturas selecionadas?`)) return;
        
        try {
            const { error } = await supabase.from('standalone_contas').delete().in('id', selectedFaturas);
            if (error) throw error;
            setSelectedFaturas([]);
            loadFaturas(editUsinaModal.id);
            showAlert(`${selectedFaturas.length} faturas excluídas com sucesso.`);
        } catch(e) {
            showAlert('Erro ao excluir faturas em lote: ' + e.message);
        }
    };

    const handleSaveFatura = async () => {
        if (!editFaturaModalData) return;
        const dataToSave = {
            mes_referencia: editFaturaModalData.mes_referencia,
            data_leitura: editFaturaModalData.data_leitura || null,
            vencimento: editFaturaModalData.vencimento || null,
            consumo_kwh: editFaturaModalData.consumo_kwh,
            energia_injetada: editFaturaModalData.energia_injetada,
            energia_compensada: editFaturaModalData.energia_compensada,
            saldo_kwh: editFaturaModalData.saldo_kwh,
            iluminacao_publica: editFaturaModalData.iluminacao_publica || 0,
            parcelamento: editFaturaModalData.parcelamento || 0,
            outros_lancamentos: editFaturaModalData.outros_lancamentos || 0,
            consumo_reais: editFaturaModalData.consumo_reais || 0,
            fio_b_total: editFaturaModalData.fio_b_total || 0,
            valor_concessionaria: editFaturaModalData.valor_concessionaria || 0,
            valor_a_pagar: editFaturaModalData.valor_a_pagar || editFaturaModalData.valor_concessionaria || 0
        };

        try {
            if (editFaturaModalData.id) {
                const { error } = await supabase.from('standalone_contas').update(dataToSave).eq('id', editFaturaModalData.id);
                if (error) throw error;
            }
            showAlert('Fatura atualizada com sucesso!');
            setEditFaturaModalData(null);
            loadFaturas(editUsinaModal.id);
        } catch (err) {
            showAlert('Erro ao atualizar fatura: ' + err.message);
        }
    };

    const buscarCep = async () => {
        if (!editUsinaModal.cep) return;
        try {
            const res = await fetch(`https://viacep.com.br/ws/${editUsinaModal.cep.replace(/\D/g, '')}/json/`);
            const data = await res.json();
            if (data.erro) {
                showAlert('CEP não encontrado.');
                return;
            }
            setEditUsinaModal(prev => ({
                ...prev,
                ibge_code: data.ibge
            }));
            showAlert(`CEP encontrado! IBGE: ${data.ibge}`);
        } catch (err) {
            showAlert('Erro ao buscar CEP.');
        }
    };

    const handleSendCode = async () => {
        if (!editUsinaModal.telefone) {
            setAlertMsg('Por favor, informe um telefone (WhatsApp) válido.');
            setTimeout(() => setAlertMsg(''), 3000);
            return;
        }
        try {
            // Verificar unicidade do telefone se não for admin
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
            if (profile && profile.role !== 'super_admin' && profile.role !== 'admin') {
                const { data: existing } = await supabase
                    .from('standalone_usinas')
                    .select('id')
                    .eq('telefone', editUsinaModal.telefone)
                    .neq('id', editUsinaModal.id || '00000000-0000-0000-0000-000000000000')
                    .limit(1);
                    
                if (existing && existing.length > 0) {
                    setAlertMsg('Este número já está em outra usina. É necessário um número único por usina.');
                    setTimeout(() => setAlertMsg(''), 4000);
                    return;
                }
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();
            setCodigoGeradoLocal(code);
            setEditUsinaModal(prev => ({ ...prev, codigo_gerado: code }));
            
            const { error } = await supabase.functions.invoke('send-whatsapp', {
                body: { 
                    phone: editUsinaModal.telefone, 
                    text: `Olá! O código de verificação para a usina ${editUsinaModal.nome || 'Solar'} é: ${code}` 
                }
            });
            if (error) throw error;
            setAlertMsg('Código enviado com sucesso via WhatsApp!');
            setTimeout(() => setAlertMsg(''), 3000);
        } catch(err) {
            console.error(err);
            setAlertMsg('Erro ao enviar o código via WhatsApp.');
            setTimeout(() => setAlertMsg(''), 3000);
        }
    };

    const handleVerify = async () => {
        if (!editUsinaModal.codigo_verificacao) {
            setAlertMsg('Digite o código recebido.');
            setTimeout(() => setAlertMsg(''), 3000);
            return;
        }
        const codeToMatch = codigoGeradoLocal || editUsinaModal.codigo_gerado;
        if (!codeToMatch) {
            setAlertMsg('Nenhum código foi gerado. Clique em Enviar Código.');
            setTimeout(() => setAlertMsg(''), 3000);
            return;
        }
        if (editUsinaModal.codigo_verificacao === codeToMatch) {
            // Bônus de 100 Tokens na primeira ativação
            try {
                const { data: pData } = await supabase.from('profiles').select('tokens, free_tokens').eq('id', userId).single();
                if (pData && (pData.free_tokens || 0) === 0 && (pData.tokens || 0) === 0) {
                    await supabase.from('profiles').update({ free_tokens: 100 }).eq('id', userId);
                    await supabase.from('token_transactions').insert({
                        profile_id: userId,
                        amount: 100,
                        type: 'bonus',
                        status: 'completed',
                        description: 'Bônus de Ativação de Usina'
                    });
                }
            } catch (err) {
                console.error('Erro ao creditar bônus', err);
            }

            setEditUsinaModal(prev => ({ ...prev, verificada: true }));
            setAlertMsg('Usina verificada com sucesso! Salvando...');
            setTimeout(() => setAlertMsg(''), 3000);
            
            // Salva automaticamente para não perder o status e o telefone, mas NÃO fecha o modal
            handleSaveUsina({ verificada: true }, false);
        } else {
            setAlertMsg('Código incorreto.');
            setTimeout(() => setAlertMsg(''), 3000);
        }
    };

    const handleSaveUsina = async (overridePayload = {}, shouldClose = true) => {
        if (!editUsinaModal.nome) {
            setAlertMsg('Preencha o nome da usina antes de salvar.');
            setTimeout(() => setAlertMsg(''), 3000);
            return;
        }
        const payload = {
            nome: editUsinaModal.nome,
            tipo_compensacao: editUsinaModal.tipo_compensacao,
            cep: editUsinaModal.cep || null,
            ibge_code: editUsinaModal.ibge_code || null,
            potencia_kwp: editUsinaModal.potencia_kwp ? parseFloat(editUsinaModal.potencia_kwp) : null,
            qtd_modulos: editUsinaModal.qtd_modulos ? parseInt(editUsinaModal.qtd_modulos) : null,
            potencia_modulo: editUsinaModal.potencia_modulo ? parseFloat(editUsinaModal.potencia_modulo) : null,
            qtd_inversores: editUsinaModal.qtd_inversores ? parseInt(editUsinaModal.qtd_inversores) : null,
            potencia_inversor: editUsinaModal.potencia_inversor ? parseFloat(editUsinaModal.potencia_inversor) : null,
            geracao_aferida: editUsinaModal.geracao_aferida || {},
            telefone: editUsinaModal.telefone || null,
            email: editUsinaModal.email || null,
            codigo_verificacao: editUsinaModal.codigo_verificacao || null,
            codigo_gerado: editUsinaModal.codigo_gerado || null,
            verificada: editUsinaModal.verificada || false,
            modalidade_gd: editUsinaModal.modalidade_gd || 'GD1',
            owner_id: userId || null,
            ...overridePayload
        };
        
        try {
            if (editUsinaModal.id) {
                const { error } = await supabase.from('standalone_usinas').update(payload).eq('id', editUsinaModal.id);
                if (error) throw error;
            } else {
                const { data, error } = await supabase.from('standalone_usinas').insert(payload).select().single();
                if (error) throw error;
                if (data && data.id) {
                    setEditUsinaModal(prev => ({ ...prev, id: data.id }));
                }
            }
            onSave();
            if (shouldClose) onClose();
        } catch(err) {
            alert('Erro ao salvar usina: ' + err.message);
        }
    };

    return (
        <>
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${editUcModalData ? 'hidden' : ''}`}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
            <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${usinaModalTab === 'unidades' ? 'max-w-4xl' : 'max-w-xl'} animate-in fade-in zoom-in-95 p-6 max-h-[95vh] overflow-y-auto transition-all duration-300`}>
                
                {alertMsg && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg z-50">
                        {alertMsg}
                    </div>
                )}
                <div className="flex justify-between items-center mb-5">
                    <h3 className="font-extrabold text-lg text-gray-800">Dados da Usina</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                </div>
                
                <div className="flex border-b border-gray-200 mb-4">
                    <button onClick={() => setUsinaModalTab('dados')} className={`px-4 py-2 text-sm font-bold border-b-2 ${usinaModalTab === 'dados' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                        Dados da Usina
                    </button>
                    {editUsinaModal.id && (
                        <button onClick={() => setUsinaModalTab('unidades')} className={`px-4 py-2 text-sm font-bold border-b-2 ${usinaModalTab === 'unidades' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                            Unidades (UGs/UCs)
                        </button>
                    )}
                    {editUsinaModal.id && (
                        <button onClick={() => setUsinaModalTab('faturas')} className={`px-4 py-2 text-sm font-bold border-b-2 ${usinaModalTab === 'faturas' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                            Faturas
                        </button>
                    )}
                    <button onClick={() => setUsinaModalTab('geracao')} className={`px-4 py-2 text-sm font-bold border-b-2 ${usinaModalTab === 'geracao' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                        Geração
                    </button>
                </div>

                <div className="space-y-4">
                    {usinaModalTab === 'dados' && (
                        <>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Usina</label>
                                <input type="text" value={editUsinaModal.nome} onChange={e => setEditUsinaModal({...editUsinaModal, nome: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none border" />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Telefone (WhatsApp)</label>
                                    <input type="text" value={editUsinaModal.telefone} onChange={e => setEditUsinaModal({...editUsinaModal, telefone: e.target.value})} placeholder="(00) 00000-0000" className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">E-mail</label>
                                    <input type="email" value={editUsinaModal.email} onChange={e => setEditUsinaModal({...editUsinaModal, email: e.target.value})} placeholder="email@exemplo.com" className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CEP</label>
                                    <div className="flex space-x-2">
                                        <input type="text" placeholder="Apenas Nrs" value={editUsinaModal.cep || ''} onChange={e => setEditUsinaModal({...editUsinaModal, cep: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                        <button onClick={buscarCep} className="bg-emerald-100 text-emerald-700 font-bold px-3 rounded-lg hover:bg-emerald-200 transition-colors text-xs">
                                            Buscar
                                        </button>
                                    </div>
                                    {editUsinaModal.ibge_code && <p className="text-[10px] text-gray-400 mt-1">IBGE: {editUsinaModal.ibge_code}</p>}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Método de Compensação</label>
                                    <select value={editUsinaModal.tipo_compensacao} onChange={e => setEditUsinaModal({...editUsinaModal, tipo_compensacao: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:border-emerald-500 outline-none border">
                                        <option value="prioridade">Prioridade</option>
                                        <option value="porcentagem">Porcentagem</option>
                                    </select>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Modalidade GD (Fio B)</label>
                                    <select value={editUsinaModal.modalidade_gd || 'GD1'} onChange={e => setEditUsinaModal({...editUsinaModal, modalidade_gd: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:border-emerald-500 outline-none border">
                                        <option value="GD1">GD1 (Instalada antes de 2023 - Isenta de Fio B)</option>
                                        <option value="GD2">GD2 (Instalada após 2022 - Paga Fio B)</option>
                                    </select>
                                    <p className="text-[10px] text-gray-400 mt-1">Isso orienta o motor a calcular o Fio B automaticamente para esta usina.</p>
                                </div>
                            </div>
                            
                            <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100 flex flex-col justify-center">
                                <label className="block text-xs font-bold text-emerald-800 uppercase tracking-wider mb-2">Verificação da Usina</label>
                                {editUsinaModal.verificada ? (
                                    <div className="flex items-center text-emerald-600 font-bold bg-white px-4 py-3 rounded-lg shadow-sm">
                                        <div className="w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center mr-3">✓</div>
                                        Usina Verificada
                                    </div>
                                ) : (
                                    <div className="flex flex-col space-y-2">
                                        <button onClick={handleSendCode} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-lg text-sm transition-colors shadow-sm">
                                            Receber código no WhatsApp
                                        </button>
                                        <div className="flex space-x-2">
                                            <input 
                                                type="text" 
                                                value={editUsinaModal.codigo_verificacao || ''} 
                                                onChange={e => setEditUsinaModal({...editUsinaModal, codigo_verificacao: e.target.value})} 
                                                placeholder="Cód 6 dígitos" 
                                                className="w-full border-emerald-200 rounded-lg px-3 py-2 text-sm font-bold text-center tracking-widest border bg-white focus:ring-2 focus:ring-emerald-500 outline-none" 
                                            />
                                            <button onClick={handleVerify} className="bg-emerald-100 text-emerald-700 font-bold px-4 rounded-lg hover:bg-emerald-200 transition-colors text-sm border border-emerald-200">
                                                Verificar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="border-t border-gray-100 pt-4 mt-2">
                                <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-3">Componentes da Usina</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Qtd. Módulos</label>
                                        <input type="number" value={editUsinaModal.qtd_modulos || ''} onChange={e => {
                                            const qtd = e.target.value;
                                            const pot_mod = editUsinaModal.potencia_modulo || 0;
                                            const calc = qtd && pot_mod ? (qtd * pot_mod) / 1000 : editUsinaModal.potencia_kwp;
                                            setEditUsinaModal({...editUsinaModal, qtd_modulos: qtd, potencia_kwp: calc});
                                        }} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border hide-number-spin" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Potência Módulo (W)</label>
                                        <input type="number" list="modulos-list" value={editUsinaModal.potencia_modulo || ''} onChange={e => {
                                            const pot_mod = e.target.value;
                                            const qtd = editUsinaModal.qtd_modulos || 0;
                                            const calc = qtd && pot_mod ? (qtd * pot_mod) / 1000 : editUsinaModal.potencia_kwp;
                                            setEditUsinaModal({...editUsinaModal, potencia_modulo: pot_mod, potencia_kwp: calc});
                                        }} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border hide-number-spin" />
                                        <datalist id="modulos-list">
                                            <option value="330" />
                                            <option value="400" />
                                            <option value="450" />
                                            <option value="550" />
                                            <option value="555" />
                                        </datalist>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Qtd. Inversores</label>
                                        <input type="number" value={editUsinaModal.qtd_inversores || ''} onChange={e => setEditUsinaModal({...editUsinaModal, qtd_inversores: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border hide-number-spin" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Potência Inversor (W)</label>
                                        <input type="number" list="inversores-list" value={editUsinaModal.potencia_inversor || ''} onChange={e => setEditUsinaModal({...editUsinaModal, potencia_inversor: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border hide-number-spin" />
                                        <datalist id="inversores-list">
                                            <option value="3000" />
                                            <option value="5000" />
                                            <option value="10000" />
                                            <option value="15000" />
                                            <option value="20000" />
                                        </datalist>
                                    </div>
                                </div>
                                <div className="mt-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Potência Calculada (kWp)</label>
                                    <input type="number" disabled value={editUsinaModal.potencia_kwp || ''} className="w-full border-transparent bg-transparent text-lg font-extrabold text-gray-800 outline-none" />
                                    <p className="text-[10px] text-gray-400 leading-tight mt-1">Calculada via (Qtd Módulos * Pot. Módulo) / 1000.</p>
                                </div>
                            </div>
                        </>
                    )}

                    {usinaModalTab === 'geracao' && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center bg-gray-50 p-2 rounded-lg sticky top-0 border border-gray-200 shadow-sm z-10">
                                <button onClick={() => setUsinaModalYear(usinaModalYear - 1)} className="px-2 py-1 bg-white border border-gray-200 rounded text-sm font-bold hover:bg-gray-100">&lt;</button>
                                <span className="font-extrabold text-emerald-700">{usinaModalYear}</span>
                                <button onClick={() => setUsinaModalYear(usinaModalYear + 1)} className="px-2 py-1 bg-white border border-gray-200 rounded text-sm font-bold hover:bg-gray-100">&gt;</button>
                            </div>
                            
                            {/* Gráfico Anual Recharts */}
                            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-6">
                                <h4 className="text-sm font-bold text-gray-700 mb-4 text-center">Geração Anual: {usinaModalYear}</h4>
                                <div className="h-48 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart 
                                            data={mesesLabels.map((mes, index) => {
                                                const aferida = Number(editUsinaModal.geracao_aferida?.[usinaModalYear]?.[index]) || 0;
                                                let est = 0;
                                                if (irradianciaInfo && editUsinaModal.potencia_kwp) {
                                                    const irr = irradianciaInfo[irrKeys[index]];
                                                    if (irr) est = Math.round(Number(irr) * Number(editUsinaModal.potencia_kwp));
                                                }
                                                return {
                                                    name: mes.substring(0, 3), // Jan, Fev, Mar...
                                                    Estimada: est,
                                                    Aferida: aferida
                                                };
                                            })} 
                                            margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                                            <Tooltip cursor={{fill: '#F3F4F6'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                                            <Bar dataKey="Estimada" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="Aferida" fill="#10B981" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                {mesesLabels.map((mes, index) => {
                                    const currentAferida = editUsinaModal.geracao_aferida?.[usinaModalYear]?.[index] || '';
                                    
                                    // Cálculo de Geração Estimada
                                    let est = 0;
                                    if (irradianciaInfo && editUsinaModal.potencia_kwp) {
                                        const irr = irradianciaInfo[irrKeys[index]];
                                        if (irr) est = Math.round(Number(irr) * Number(editUsinaModal.potencia_kwp));
                                    }
                                    
                                    // Barra de progresso para comparar Aferida x Estimada
                                    const aferidaNum = Number(currentAferida) || 0;
                                    const perc = est > 0 ? Math.min(100, Math.round((aferidaNum / est) * 100)) : 0;
                                    let barColor = 'bg-gray-200';
                                    if (est > 0 && aferidaNum > 0) {
                                        if (aferidaNum < est * 0.9) barColor = 'bg-red-400';
                                        else if (aferidaNum > est * 1.1) barColor = 'bg-emerald-500';
                                        else barColor = 'bg-blue-400';
                                    }

                                    return (
                                        <div key={index} className="flex flex-col bg-gray-50 rounded-lg p-2 border border-gray-100">
                                            <div className="flex justify-between items-center mb-1 ml-1">
                                                <label className="text-[10px] font-bold text-gray-600 uppercase">{mes}</label>
                                                {est > 0 && <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 rounded" title="Geração Estimada">Est: {est}</span>}
                                            </div>
                                            <input 
                                                type="number" 
                                                placeholder="kWh" 
                                                value={currentAferida}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setEditUsinaModal(prev => {
                                                        const newAferida = { ...(prev.geracao_aferida || {}) };
                                                        if (!newAferida[usinaModalYear]) newAferida[usinaModalYear] = {};
                                                        newAferida[usinaModalYear][index] = val ? parseFloat(val) : null;
                                                        return { ...prev, geracao_aferida: newAferida };
                                                    });
                                                }}
                                                className="w-full border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm font-bold text-gray-700 border hide-number-spin focus:border-emerald-500 outline-none" 
                                            />
                                            {/* Mini Barra de Geração */}
                                            {est > 0 && (
                                                <div className="w-full h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden flex">
                                                    <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${perc}%` }}></div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-gray-500 italic mt-2">Dica: Se um mês ficar em branco, o sistema utilizará a Geração Estimada gerada automaticamente via irradiação local.</p>
                        </div>
                    )}

                    {usinaModalTab === 'unidades' && (() => {
                        const sortedAndFilteredUcs = [...ucs]
                            .filter(u => u.numero_uc.includes(searchUc) || u.tipo.toLowerCase().includes(searchUc.toLowerCase()))
                            .sort((a, b) => {
                                if (sortUcConfig.key === 'numero_uc') {
                                    return sortUcConfig.direction === 'asc' ? a.numero_uc.localeCompare(b.numero_uc) : b.numero_uc.localeCompare(a.numero_uc);
                                }
                                if (sortUcConfig.key === 'tipo') {
                                    return sortUcConfig.direction === 'asc' ? a.tipo.localeCompare(b.tipo) : b.tipo.localeCompare(a.tipo);
                                }
                                if (sortUcConfig.key === 'regra') {
                                    const getVal = x => x.tipo === 'ug' ? -1 : (x.prioridade || x.porcentagem || 0);
                                    return sortUcConfig.direction === 'asc' ? getVal(a) - getVal(b) : getVal(b) - getVal(a);
                                }
                                return 0;
                            });

                        const handleSortUc = (key) => {
                            let direction = 'asc';
                            if (sortUcConfig.key === key && sortUcConfig.direction === 'asc') {
                                direction = 'desc';
                            }
                            setSortUcConfig({ key, direction });
                        };

                        return (
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                    <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 flex-wrap gap-4">
                                        <h2 className="text-lg font-bold text-gray-800">Unidades da Usina</h2>
                                        <div className="flex items-center gap-3">
                                            <input 
                                                type="text" 
                                                placeholder="Buscar por UC ou Tipo..." 
                                                value={searchUc}
                                                onChange={e => setSearchUc(e.target.value)}
                                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none w-64"
                                            />
                                            <button onClick={() => setEditUcModalData({ numero_uc: '', tipo: 'uc', prioridade: 1, porcentagem: 0, conta_saldo: false, cep: '', municipio: '', classe: '' })} className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center">
                                                <Plus className="w-4 h-4 mr-1" /> Nova Unidade
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-0">
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase text-[10px] tracking-wider font-bold">
                                                <tr>
                                                    <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleSortUc('numero_uc')}>
                                                        Número UC {sortUcConfig.key === 'numero_uc' && (sortUcConfig.direction === 'asc' ? '↑' : '↓')}
                                                    </th>
                                                    <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleSortUc('tipo')}>
                                                        Tipo {sortUcConfig.key === 'tipo' && (sortUcConfig.direction === 'asc' ? '↑' : '↓')}
                                                    </th>
                                                    <th className="px-6 py-3 cursor-pointer hover:bg-gray-100" onClick={() => handleSortUc('regra')}>
                                                        Regra {sortUcConfig.key === 'regra' && (sortUcConfig.direction === 'asc' ? '↑' : '↓')}
                                                    </th>
                                                    <th className="px-6 py-3">Conta Saldo</th>
                                                    <th className="px-6 py-3 text-right">Ações</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 text-gray-700">
                                                {sortedAndFilteredUcs.map(u => (
                                                    <tr key={u.id} className="hover:bg-emerald-50/30 transition-colors">
                                                        <td className="px-6 py-3 font-bold">{u.numero_uc}</td>
                                                        <td className="px-6 py-3 uppercase text-xs font-bold text-emerald-600">{u.tipo}</td>
                                                        <td className="px-6 py-3">
                                                            {u.tipo === 'ug' ? '-' : `Prio: ${u.prioridade} | Cota: ${u.porcentagem}%`}
                                                        </td>
                                                        <td className="px-6 py-3">
                                                            {u.conta_saldo ? <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-bold">Sim</span> : '-'}
                                                        </td>
                                                        <td className="px-6 py-3 text-right space-x-3">
                                                            <button onClick={() => setEditUcModalData(u)} className="text-blue-500 hover:text-blue-700 transition-colors p-1"><Edit className="w-4 h-4"/></button>
                                                            <button onClick={() => setDeleteUcModalData({ id: u.id, message: `Deseja excluir a UC ${u.numero_uc}? Todas as faturas desta unidade também serão apagadas.` })} className="text-red-500 hover:text-red-700 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {sortedAndFilteredUcs.length === 0 && <tr><td colSpan="5" className="text-center py-8 text-gray-400 italic">Nenhuma UC encontrada.</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {usinaModalTab === 'faturas' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100 shadow-sm">
                                <div className="text-sm font-bold text-gray-700">
                                    Todas as faturas ({faturas.length})
                                </div>
                                <div className="flex space-x-2">
                                    {selectedFaturas.length > 0 && (
                                        <button onClick={handleMassDeleteFaturas} className="flex items-center space-x-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-bold transition-colors">
                                            <Trash2 className="w-4 h-4" />
                                            <span>Apagar ({selectedFaturas.length})</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                            
                            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm max-h-[50vh] overflow-y-auto">
                                {isFaturasLoading ? (
                                    <div className="p-10 text-center text-gray-400 font-bold flex flex-col items-center">
                                        <Loader2 className="w-8 h-8 animate-spin mb-3 text-emerald-500" />
                                        Carregando faturas...
                                    </div>
                                ) : faturas.length === 0 ? (
                                    <div className="p-10 text-center text-gray-400 font-bold">Nenhuma fatura encontrada para esta usina.</div>
                                ) : (
                                    <table className="w-full text-left border-collapse text-sm">
                                        <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10 shadow-sm">
                                            <tr className="text-gray-500 text-[10px] uppercase font-extrabold tracking-wider">
                                                <th className="p-4 w-12 text-center">
                                                    <input 
                                                        type="checkbox" 
                                                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                                        checked={faturas.length > 0 && selectedFaturas.length === faturas.length}
                                                        onChange={e => {
                                                            if (e.target.checked) setSelectedFaturas(faturas.map(f => f.id));
                                                            else setSelectedFaturas([]);
                                                        }}
                                                    />
                                                </th>
                                                <th className="p-4">Mês Ref.</th>
                                                <th className="p-4">UC</th>
                                                <th className="p-4 text-right">Vencimento</th>
                                                <th className="p-4 text-right">Valor A Pagar</th>
                                                <th className="p-4 text-center">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50 font-medium text-gray-600">
                                            {faturas.map(f => (
                                                <tr key={f.id} className={`transition-colors ${selectedFaturas.includes(f.id) ? 'bg-emerald-50/50' : 'hover:bg-gray-50'}`}>
                                                    <td className="p-4 text-center">
                                                        <input 
                                                            type="checkbox" 
                                                            className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                                            checked={selectedFaturas.includes(f.id)}
                                                            onChange={e => {
                                                                if (e.target.checked) setSelectedFaturas([...selectedFaturas, f.id]);
                                                                else setSelectedFaturas(selectedFaturas.filter(id => id !== f.id));
                                                            }}
                                                        />
                                                    </td>
                                                    <td className="p-4 font-bold text-gray-800">{f.mes_referencia}</td>
                                                    <td className="p-4">{f.numero_uc}</td>
                                                    <td className="p-4 text-right">{f.vencimento ? new Date(f.vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}</td>
                                                    <td className="p-4 text-right font-black text-gray-800">
                                                        {Number(f.valor_a_pagar || f.valor_da_fatura || f.valor_concessionaria || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                    </td>
                                                    <td className="p-4 flex justify-center space-x-2">
                                                        <button onClick={() => setEditFaturaModalData(f)} className="p-2 text-blue-500 hover:bg-blue-100 rounded-lg transition-colors" title="Editar">
                                                            <Edit className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => {
                                                            setSelectedFaturas([f.id]);
                                                            setTimeout(() => handleMassDeleteFaturas(), 50);
                                                        }} className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition-colors" title="Excluir">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}

                    {(usinaModalTab === 'dados' || usinaModalTab === 'geracao') && (
                        <button onClick={() => handleSaveUsina()} disabled={!editUsinaModal.nome} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-md flex justify-center items-center mt-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            <Save className="w-4 h-4 mr-2"/> Salvar Usina
                        </button>
                    )}
                </div>
            </div>
        </div>

        {/* Delete UC Confirmation */}
        {deleteUcModalData && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={() => setDeleteUcModalData(null)}></div>
                <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="bg-red-50 border-b border-red-100 p-5 flex items-center text-red-600">
                        <AlertCircle className="w-6 h-6 mr-3" />
                        <h3 className="font-extrabold text-lg">Excluir Unidade</h3>
                    </div>
                    <div className="p-6">
                        <p className="text-sm text-gray-600 font-medium leading-relaxed">{deleteUcModalData.message}</p>
                    </div>
                    <div className="p-4 bg-gray-50 flex justify-end space-x-3 border-t border-gray-100">
                        <button onClick={() => setDeleteUcModalData(null)} className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm">Cancelar</button>
                        <button onClick={confirmDeleteUc} className="px-4 py-2 font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-md shadow-red-500/20 transition-all text-sm">Sim, Excluir</button>
                    </div>
                </div>
            </div>
        )}

        {/* Modal de UC e Faturas */}
        <StandaloneUcModal 
            isOpen={!!editUcModalData} 
            onClose={() => setEditUcModalData(null)} 
            onSave={() => loadUcs(editUsinaModal.id)} 
            ucData={editUcModalData} 
            usinaId={editUsinaModal.id} 
            profile={{ role: 'user', id: userId }} // Simples mock ou passe o real se necessário
        />
            {/* Modal Edit Fatura */}
            {editFaturaModalData && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditFaturaModalData(null)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="font-extrabold text-lg text-gray-800">Editar Fatura (OCR)</h3>
                            <button onClick={() => setEditFaturaModalData(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mês Ref.</label>
                                    <input type="text" value={editFaturaModalData.mes_referencia} onChange={e => setEditFaturaModalData({...editFaturaModalData, mes_referencia: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data Leitura</label>
                                    <input type="date" value={editFaturaModalData.data_leitura || ''} onChange={e => setEditFaturaModalData({...editFaturaModalData, data_leitura: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Consumo (kWh)</label>
                                    <input type="number" value={editFaturaModalData.consumo_kwh} onChange={e => setEditFaturaModalData({...editFaturaModalData, consumo_kwh: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Compensada (kWh)</label>
                                    <input type="number" value={editFaturaModalData.energia_compensada} onChange={e => setEditFaturaModalData({...editFaturaModalData, energia_compensada: parseFloat(e.target.value)})} className="w-full border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Saldo Kwh</label>
                                    <input type="number" value={editFaturaModalData.saldo_kwh} onChange={e => setEditFaturaModalData({...editFaturaModalData, saldo_kwh: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Consumo R$</label>
                                    <input type="number" value={editFaturaModalData.consumo_reais} onChange={e => setEditFaturaModalData({...editFaturaModalData, consumo_reais: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fio B Total</label>
                                    <input type="number" value={editFaturaModalData.fio_b_total} onChange={e => setEditFaturaModalData({...editFaturaModalData, fio_b_total: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">IP (Iluminação)</label>
                                    <input type="number" value={editFaturaModalData.iluminacao_publica} onChange={e => setEditFaturaModalData({...editFaturaModalData, iluminacao_publica: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-amber-500 uppercase mb-1">Parcelamento</label>
                                    <input type="number" value={editFaturaModalData.parcelamento} onChange={e => setEditFaturaModalData({...editFaturaModalData, parcelamento: parseFloat(e.target.value)})} className="w-full border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Outros Lançamentos</label>
                                    <input type="number" value={editFaturaModalData.outros_lancamentos} onChange={e => setEditFaturaModalData({...editFaturaModalData, outros_lancamentos: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-indigo-500 uppercase mb-1">Total Fatura (OCR)</label>
                                    <input type="number" value={editFaturaModalData.valor_concessionaria} onChange={e => setEditFaturaModalData({...editFaturaModalData, valor_concessionaria: parseFloat(e.target.value)})} className="w-full border-indigo-200 bg-indigo-50 rounded-lg px-3 py-2 text-sm font-bold border" />
                                </div>
                            </div>
                            
                            <button onClick={handleSaveFatura} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-md flex justify-center items-center mt-4 transition-colors">
                                <Save className="w-4 h-4 mr-2"/> Salvar Fatura
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
