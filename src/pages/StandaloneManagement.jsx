import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import StandaloneUsinaModal from '../components/StandaloneUsinaModal';
import { LayoutDashboard, Trash2, Edit, Plus, AlertCircle, Save, X, Building2, Zap, FileText, Coins } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';

export default function StandaloneManagement() {
    const { profile, user } = useAuth();
    const { showAlert } = useUI();
    const [activeTab, setActiveTab] = useState('usinas'); // usinas, ucs, contas
    
    // Data
    const [usinas, setUsinas] = useState([]);
    const [ucs, setUcs] = useState([]);
    const [contas, setContas] = useState([]);
    
    const [selectedUsinaId, setSelectedUsinaId] = useState('');
    const [selectedUcId, setSelectedUcId] = useState('');

    const [loading, setLoading] = useState(true);

    // Modals
    const [deleteModal, setDeleteModal] = useState(null); // { type, id, title, message }
    const [editUsinaModal, setEditUsinaModal] = useState(null);
    const [usinaModalTab, setUsinaModalTab] = useState('dados');
    const [usinaModalYear, setUsinaModalYear] = useState(new Date().getFullYear());
    const [editUcModal, setEditUcModal] = useState(null);
    const [editContaModal, setEditContaModal] = useState(null);

    const loadUsinas = async () => {
        if (!user || !profile) return;
        setLoading(true);
        let usinasQuery = supabase.from('standalone_usinas').select('*').order('nome');
        
        if (profile.role === 'admin') {
            const { data: subordinates } = await supabase.from('profiles').select('id').eq('superior_id', user.id);
            const subIds = subordinates ? subordinates.map(s => s.id) : [];
            const allowedIds = [user.id, ...subIds];
            usinasQuery = usinasQuery.in('owner_id', allowedIds);
        } else if (profile.role !== 'super_admin') {
            usinasQuery = usinasQuery.eq('owner_id', user.id);
        }

        const { data } = await usinasQuery;
        setUsinas(data || []);
        if (data?.length && !selectedUsinaId) {
            setSelectedUsinaId(data[0].id);
        }
        setLoading(false);
    };

    const loadUcs = async (usinaId) => {
        if (!usinaId) return;
        const { data } = await supabase.from('standalone_ucs').select('*').eq('usina_id', usinaId).order('tipo');
        setUcs(data || []);
        if (data?.length && !selectedUcId) {
            setSelectedUcId(data[0].id);
        } else if (!data?.length) {
            setSelectedUcId('');
        }
    };

    const loadContas = async (ucId) => {
        if (!ucId) {
            setContas([]);
            return;
        }
        const { data } = await supabase.from('standalone_contas').select('*').eq('uc_id', ucId).order('data_leitura', { ascending: false });
        setContas(data || []);
    };

    useEffect(() => {
        if (user && profile) {
            loadUsinas();
        }
    }, [user, profile]);

    useEffect(() => {
        if (selectedUsinaId) loadUcs(selectedUsinaId);
    }, [selectedUsinaId]);

    useEffect(() => {
        if (selectedUcId) loadContas(selectedUcId);
    }, [selectedUcId]);

    // ----------------- DELETE LOGIC -----------------
    const confirmDelete = async () => {
        if (!deleteModal) return;
        const { type, id } = deleteModal;
        
        let table = '';
        if (type === 'usina') table = 'standalone_usinas';
        if (type === 'uc') table = 'standalone_ucs';
        if (type === 'conta') table = 'standalone_contas';

        const { error } = await supabase.from(table).delete().eq('id', id);
        
        if (error) {
            showAlert('Erro ao excluir: ' + error.message, 'error');
        } else {
            if (type === 'usina') {
                setSelectedUsinaId('');
                loadUsinas();
            }
            if (type === 'uc') {
                setSelectedUcId('');
                loadUcs(selectedUsinaId);
            }
            if (type === 'conta') {
                loadContas(selectedUcId);
            }
        }
        setDeleteModal(null);
    };

    // ----------------- USINAS CRUD -----------------
    const handleSaveUsina = async () => {
        // Função agora gerida pelo StandaloneUsinaModal
    };      
    
    // ----------------- UCs CRUD -----------------
    const handleSaveUc = async () => {
        if (!editUcModal.numero_uc) return;
        const payload = {
            usina_id: selectedUsinaId,
            numero_uc: editUcModal.numero_uc,
            tipo: editUcModal.tipo,
            prioridade: editUcModal.prioridade,
            porcentagem: editUcModal.porcentagem,
            conta_saldo: editUcModal.conta_saldo,
            cep: editUcModal.cep || null,
            municipio: editUcModal.municipio || null,
            classe: editUcModal.classe || null
        };

        if (editUcModal.id) {
            await supabase.from('standalone_ucs').update(payload).eq('id', editUcModal.id);
        } else {
            // Verificação de limite Free
            if (profile && profile.role !== 'super_admin') {
                const { data: freshProfile } = await supabase.from('profiles').select('tokens, free_tokens').eq('id', profile.id).single();
                const totalTokens = (freshProfile?.free_tokens || 0) + (freshProfile?.tokens || 0);
                
                if (totalTokens < 10) {
                    const { data: userUsinas } = await supabase.from('standalone_usinas').select('id').eq('owner_id', profile.id);
                    if (userUsinas && userUsinas.length > 0) {
                        const usinaIds = userUsinas.map(u => u.id);
                        const { data: userUcs } = await supabase.from('standalone_ucs').select('id').in('usina_id', usinaIds);
                        if (userUcs && userUcs.length >= 3) {
                            showAlert('Limite Free excedido. Adquira Tokens para adicionar mais Unidades Consumidoras.', 'error');
                            return;
                        }
                    }
                }
            }
            await supabase.from('standalone_ucs').insert(payload);
        }
        setEditUcModal(null);
        loadUcs(selectedUsinaId);
    };

    // ----------------- CONTAS CRUD -----------------
    const handleSaveConta = async () => {
        if (!editContaModal.mes_referencia) return;
        const payload = {
            uc_id: selectedUcId,
            mes_referencia: editContaModal.mes_referencia,
            data_leitura: editContaModal.data_leitura || null,
            vencimento: editContaModal.vencimento || null,
            consumo_kwh: editContaModal.consumo_kwh,
            energia_injetada: editContaModal.energia_injetada,
            energia_compensada: editContaModal.energia_compensada,
            saldo_kwh: editContaModal.saldo_kwh
        };

        if (editContaModal.id) {
            await supabase.from('standalone_contas').update(payload).eq('id', editContaModal.id);
        } else {
            await supabase.from('standalone_contas').insert(payload);
        }
        setEditContaModal(null);
        loadContas(selectedUcId);
    };

    // UI Renders
    return (
        <div className="min-h-screen bg-[#f8fafc] font-sans selection:bg-emerald-200">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between sticky top-0 z-30">
                <div className="flex items-center space-x-4">
                    <Building2 className="w-8 h-8 text-emerald-600" />
                    <div>
                        <h1 className="text-2xl font-extrabold text-gray-800 tracking-tight">Gerenciar Unidades</h1>
                        <p className="text-sm text-gray-500 font-medium mt-0.5">Configure suas usinas, UCs e suba faturas manualmente.</p>
                    </div>
                </div>
                <div className="flex space-x-3">
                    <button onClick={() => window.location.href = '/analisedeconta'} className="bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-500 hover:text-white px-4 py-2.5 rounded-xl shadow-sm transition-all hover:shadow-md hover:shadow-emerald-500/20 text-sm font-bold flex items-center">
                        <LayoutDashboard className="w-4 h-4 mr-2" />
                        Análise (Dashboard)
                    </button>
                    <div className="flex items-center space-x-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-1">
                        <div className="flex flex-col items-end justify-center">
                            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Saldo</span>
                            <span className="text-sm font-extrabold text-emerald-700 leading-none">{(profile?.free_tokens || 0) + (profile?.tokens || 0)}</span>
                        </div>
                        <button onClick={() => window.location.href = '/analisedeconta/recarga'} className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white border border-emerald-400 hover:from-emerald-600 hover:to-emerald-700 px-3 py-1.5 rounded-lg shadow-sm transition-all hover:shadow-md hover:shadow-emerald-900/20 text-xs font-bold flex items-center">
                            <Coins className="w-3.5 h-3.5 mr-1" />
                            Recarga
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto p-8 space-y-6">
                {/* Tabs */}
                <div className="flex space-x-2 bg-gray-200/50 p-1.5 rounded-2xl w-fit">
                    <button onClick={() => setActiveTab('usinas')} className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'usinas' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'}`}>
                        <Building2 className="w-4 h-4 inline-block mr-2" />
                        Usinas
                    </button>
                    <button onClick={() => setActiveTab('ucs')} className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'ucs' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'}`}>
                        <Zap className="w-4 h-4 inline-block mr-2" />
                        Unidades (UGs/UCs)
                    </button>
                    <button onClick={() => setActiveTab('contas')} className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'contas' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'}`}>
                        <FileText className="w-4 h-4 inline-block mr-2" />
                        Faturas (Contas)
                    </button>
                </div>

                {/* TAB CONTENT: USINAS */}
                {activeTab === 'usinas' && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h2 className="text-lg font-bold text-gray-800">Usinas Cadastradas</h2>
                            <button onClick={() => {
                                setEditUsinaModal({ nome: '', tipo_compensacao: 'prioridade', cep: '', ibge_code: '', potencia_kwp: '', qtd_modulos: '', potencia_modulo: '', qtd_inversores: '', potencia_inversor: '', geracao_aferida: {} });
                                setUsinaModalTab('dados');
                            }} className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-emerald-500/20 transition-all hover:-translate-y-0.5 flex items-center">
                                <Plus className="w-4 h-4 mr-1" /> Nova Usina
                            </button>
                        </div>
                        <div className="p-0">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase text-[10px] tracking-wider font-bold">
                                    <tr>
                                        <th className="px-6 py-3">Nome da Usina</th>
                                        <th className="px-6 py-3">Tipo Compensação</th>
                                        <th className="px-6 py-3">Cadastrado em</th>
                                        <th className="px-6 py-3 text-right">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-gray-700">
                                    {usinas.map(u => (
                                        <tr key={u.id} className="hover:bg-emerald-50/30 transition-colors group">
                                            <td className="px-6 py-4 font-bold">{u.nome}</td>
                                            <td className="px-6 py-4"><span className="bg-gray-100 px-3 py-1 rounded-full text-xs font-semibold capitalize text-gray-600">{u.tipo_compensacao}</span></td>
                                            <td className="px-6 py-4 text-gray-400">{new Date(u.created_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 text-right space-x-3">
                                                <button onClick={() => setEditUsinaModal(u)} className="text-blue-500 hover:text-blue-700 transition-colors p-1"><Edit className="w-4 h-4"/></button>
                                                <button onClick={() => setDeleteModal({ type: 'usina', id: u.id, title: 'Excluir Usina', message: `Tem certeza que deseja excluir a usina "${u.nome}"? ATENÇÃO: Esta ação irá apagar definitivamente TODAS as UCs e Faturas vinculadas a ela (Exclusão em Cascata).` })} className="text-red-500 hover:text-red-700 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
                                            </td>
                                        </tr>
                                    ))}
                                    {usinas.length === 0 && <tr><td colSpan="4" className="text-center py-8 text-gray-400 italic">Nenhuma usina encontrada.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* TAB CONTENT: UCS */}
                {activeTab === 'ucs' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center space-x-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                            <span className="text-sm font-bold text-gray-500">Filtrar por Usina:</span>
                            <select value={selectedUsinaId} onChange={e => setSelectedUsinaId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold focus:ring-2 focus:ring-emerald-500/20 outline-none">
                                {usinas.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                            </select>
                        </div>
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                <h2 className="text-lg font-bold text-gray-800">Unidades da Usina</h2>
                                <button onClick={() => setEditUcModal({ numero_uc: '', tipo: 'uc', prioridade: 1, porcentagem: 0, conta_saldo: false, cep: '', municipio: '', classe: '' })} disabled={!selectedUsinaId} className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center">
                                    <Plus className="w-4 h-4 mr-1" /> Nova Unidade
                                </button>
                            </div>
                            <div className="p-0">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase text-[10px] tracking-wider font-bold">
                                        <tr>
                                            <th className="px-6 py-3">Número UC</th>
                                            <th className="px-6 py-3">Tipo</th>
                                            <th className="px-6 py-3">Regra</th>
                                            <th className="px-6 py-3">Conta Saldo</th>
                                            <th className="px-6 py-3 text-right">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 text-gray-700">
                                        {ucs.map(u => (
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
                                                    <button onClick={() => setEditUcModal(u)} className="text-blue-500 hover:text-blue-700 transition-colors p-1"><Edit className="w-4 h-4"/></button>
                                                    <button onClick={() => setDeleteModal({ type: 'uc', id: u.id, title: 'Excluir Unidade', message: `Deseja excluir a UC ${u.numero_uc}? Todas as faturas desta unidade também serão apagadas.` })} className="text-red-500 hover:text-red-700 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
                                                </td>
                                            </tr>
                                        ))}
                                        {ucs.length === 0 && <tr><td colSpan="5" className="text-center py-8 text-gray-400 italic">Nenhuma UC encontrada para esta Usina.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB CONTENT: CONTAS */}
                {activeTab === 'contas' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center space-x-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                            <span className="text-sm font-bold text-gray-500">Usina:</span>
                            <select value={selectedUsinaId} onChange={e => setSelectedUsinaId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none w-48">
                                {usinas.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                            </select>
                            
                            <span className="text-sm font-bold text-gray-500 pl-4">Unidade (UG/UC):</span>
                            <select value={selectedUcId} onChange={e => setSelectedUcId(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold outline-none w-48">
                                {ucs.map(u => <option key={u.id} value={u.id}>{u.numero_uc} ({u.tipo.toUpperCase()})</option>)}
                            </select>
                        </div>
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                <h2 className="text-lg font-bold text-gray-800">Faturas Lançadas</h2>
                                <button onClick={() => setEditContaModal({ mes_referencia: '', consumo_kwh: 0, energia_injetada: 0, energia_compensada: 0, saldo_kwh: 0, iluminacao_publica: 0, parcelamento: 0, outros_lancamentos: 0, consumo_reais: 0, fio_b_total: 0, valor_concessionaria: 0 })} disabled={!selectedUcId} className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center">
                                    <Plus className="w-4 h-4 mr-1" /> Fatura Manual
                                </button>
                            </div>
                            <div className="p-0 overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase text-[10px] tracking-wider font-bold">
                                        <tr>
                                            <th className="px-4 py-3">Mês Ref.</th>
                                            <th className="px-4 py-3">Leitura</th>
                                            <th className="px-4 py-3 text-right">Injetada (kWh)</th>
                                            <th className="px-4 py-3 text-right">Compensada (kWh)</th>
                                            <th className="px-4 py-3 text-right">Saldo (kWh)</th>
                                            <th className="px-4 py-3 text-right">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 text-gray-700">
                                        {contas.map(c => (
                                            <tr key={c.id} className="hover:bg-emerald-50/30 transition-colors">
                                                <td className="px-4 py-3 font-bold">{c.mes_referencia}</td>
                                                <td className="px-4 py-3 text-gray-500">{c.data_leitura ? new Date(c.data_leitura).toLocaleDateString() : '-'}</td>
                                                <td className="px-4 py-3 text-right font-medium text-emerald-600">{c.energia_injetada || 0}</td>
                                                <td className="px-4 py-3 text-right font-medium text-blue-600">{c.energia_compensada || 0}</td>
                                                <td className="px-4 py-3 text-right font-medium text-teal-600">{c.saldo_kwh || 0}</td>
                                                <td className="px-4 py-3 text-right space-x-3">
                                                    <button onClick={() => setEditContaModal(c)} className="text-blue-500 hover:text-blue-700 transition-colors p-1"><Edit className="w-4 h-4"/></button>
                                                    <button onClick={() => setDeleteModal({ type: 'conta', id: c.id, title: 'Excluir Fatura', message: `Deseja excluir a fatura de Ref ${c.mes_referencia}?` })} className="text-red-500 hover:text-red-700 transition-colors p-1"><Trash2 className="w-4 h-4"/></button>
                                                </td>
                                            </tr>
                                        ))}
                                        {contas.length === 0 && <tr><td colSpan="6" className="text-center py-8 text-gray-400 italic">Nenhuma fatura encontrada.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* MODALS */}
            
            {/* 1. Delete Confirmation Modal (Danger) */}
            {deleteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={() => setDeleteModal(null)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="bg-red-50 border-b border-red-100 p-5 flex items-center text-red-600">
                            <AlertCircle className="w-6 h-6 mr-3" />
                            <h3 className="font-extrabold text-lg">{deleteModal.title}</h3>
                        </div>
                        <div className="p-6">
                            <p className="text-sm text-gray-600 font-medium leading-relaxed">{deleteModal.message}</p>
                        </div>
                        <div className="p-4 bg-gray-50 flex justify-end space-x-3 border-t border-gray-100">
                            <button onClick={() => setDeleteModal(null)} className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors text-sm">Cancelar</button>
                            <button onClick={confirmDelete} className="px-4 py-2 font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-md shadow-red-500/20 transition-all text-sm">Sim, Excluir</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. Edit Usina Modal */}
            {/* 2. Edit Usina Modal (Refactored) */}
            <StandaloneUsinaModal 
                isOpen={!!editUsinaModal} 
                onClose={() => setEditUsinaModal(null)} 
                onSave={loadUsinas} 
                usinaData={editUsinaModal} 
                userId={user?.id}
            />

            {/* 3. Edit UC Modal */}
            {editUcModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditUcModal(null)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 p-6">
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="font-extrabold text-lg text-gray-800">{editUcModal.id ? 'Editar Unidade' : 'Nova Unidade'}</h3>
                            <button onClick={() => setEditUcModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Número UC/UG</label>
                                    <input type="text" value={editUcModal.numero_uc} onChange={e => setEditUcModal({...editUcModal, numero_uc: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                                    <select value={editUcModal.tipo} onChange={e => setEditUcModal({...editUcModal, tipo: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border">
                                        <option value="uc">UC (Consumo)</option>
                                        <option value="ug">UG (Geração)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CEP</label>
                                    <input type="text" value={editUcModal.cep || ''} onChange={e => setEditUcModal({...editUcModal, cep: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" placeholder="00000-000" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Município</label>
                                    <input type="text" value={editUcModal.municipio || ''} onChange={e => setEditUcModal({...editUcModal, municipio: e.target.value.toUpperCase()})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" placeholder="Nome da cidade (COSIP)" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Classe (B1 Residencial, B3 Comercial, etc)</label>
                                    <input type="text" value={editUcModal.classe || ''} onChange={e => setEditUcModal({...editUcModal, classe: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                            </div>
                            {editUcModal.tipo === 'uc' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Prioridade</label>
                                        <input type="number" value={editUcModal.prioridade} onChange={e => setEditUcModal({...editUcModal, prioridade: parseInt(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cota %</label>
                                        <input type="number" step="0.1" value={editUcModal.porcentagem} onChange={e => setEditUcModal({...editUcModal, porcentagem: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                    </div>
                                </div>
                            )}
                            <label className="flex items-center space-x-3 bg-gray-50 p-3 rounded-lg border border-gray-100 cursor-pointer">
                                <input type="checkbox" checked={editUcModal.conta_saldo} onChange={e => setEditUcModal({...editUcModal, conta_saldo: e.target.checked})} className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"/>
                                <span className="text-sm font-bold text-gray-700">Conta Saldo?</span>
                            </label>
                            
                            <button onClick={handleSaveUc} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-md flex justify-center items-center mt-4 transition-colors">
                                <Save className="w-4 h-4 mr-2"/> Salvar Unidade
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 4. Edit Conta Modal */}
            {editContaModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditContaModal(null)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="font-extrabold text-lg text-gray-800">{editContaModal.id ? 'Editar Fatura' : 'Lançar Fatura Manual'}</h3>
                            <button onClick={() => setEditContaModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mês Ref. (ex: 2026-07)</label>
                                    <input type="text" value={editContaModal.mes_referencia} onChange={e => setEditContaModal({...editContaModal, mes_referencia: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data Leitura</label>
                                    <input type="date" value={editContaModal.data_leitura || ''} onChange={e => setEditContaModal({...editContaModal, data_leitura: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Vencimento</label>
                                    <input type="date" value={editContaModal.vencimento || ''} onChange={e => setEditContaModal({...editContaModal, vencimento: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Consumo (kWh)</label>
                                    <input type="number" value={editContaModal.consumo_kwh} onChange={e => setEditContaModal({...editContaModal, consumo_kwh: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Injetada (kWh)</label>
                                    <input type="number" value={editContaModal.energia_injetada} onChange={e => setEditContaModal({...editContaModal, energia_injetada: parseFloat(e.target.value)})} className="w-full border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Compensada (kWh)</label>
                                    <input type="number" value={editContaModal.energia_compensada} onChange={e => setEditContaModal({...editContaModal, energia_compensada: parseFloat(e.target.value)})} className="w-full border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Saldo Kwh</label>
                                    <input type="number" value={editContaModal.saldo_kwh} onChange={e => setEditContaModal({...editContaModal, saldo_kwh: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Consumo R$</label>
                                    <input type="number" value={editContaModal.consumo_reais} onChange={e => setEditContaModal({...editContaModal, consumo_reais: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fio B Total</label>
                                    <input type="number" value={editContaModal.fio_b_total} onChange={e => setEditContaModal({...editContaModal, fio_b_total: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">IP (Iluminação)</label>
                                    <input type="number" value={editContaModal.iluminacao_publica} onChange={e => setEditContaModal({...editContaModal, iluminacao_publica: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-amber-500 uppercase mb-1">Parcelamento</label>
                                    <input type="number" value={editContaModal.parcelamento} onChange={e => setEditContaModal({...editContaModal, parcelamento: parseFloat(e.target.value)})} className="w-full border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Outros Lançamentos</label>
                                    <input type="number" value={editContaModal.outros_lancamentos} onChange={e => setEditContaModal({...editContaModal, outros_lancamentos: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-indigo-500 uppercase mb-1">Total Fatura (OCR)</label>
                                    <input type="number" value={editContaModal.valor_concessionaria} onChange={e => setEditContaModal({...editContaModal, valor_concessionaria: parseFloat(e.target.value)})} className="w-full border-indigo-200 bg-indigo-50 rounded-lg px-3 py-2 text-sm font-bold border" />
                                </div>
                            </div>
                            
                            <button onClick={handleSaveConta} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-md flex justify-center items-center mt-4 transition-colors">
                                <Save className="w-4 h-4 mr-2"/> Salvar Fatura
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
