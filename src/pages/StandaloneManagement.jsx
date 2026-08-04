import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import StandaloneUsinaModal from '../components/StandaloneUsinaModal';
import { LayoutDashboard, Trash2, Edit, Plus, AlertCircle, Building2, Coins, Eye } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import OnboardingTour from '../components/OnboardingTour';

export default function StandaloneManagement() {
    const { profile, user } = useAuth();
    const { showAlert } = useUI();
    
    // Data
    const [usinas, setUsinas] = useState([]);
    const [loading, setLoading] = useState(true);

    // Modals
    const [deleteModal, setDeleteModal] = useState(null); // { type, id, title, message }
    const [editUsinaModal, setEditUsinaModal] = useState(null);

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
        setLoading(false);
    };

    useEffect(() => {
        if (user && profile) {
            loadUsinas();
        }
    }, [user, profile]);

    // ----------------- DELETE LOGIC -----------------
    const confirmDelete = async () => {
        if (!deleteModal) return;
        const { type, id } = deleteModal;
        
        let table = '';
        if (type === 'usina') table = 'standalone_usinas';

        if (table) {
            const { error } = await supabase.from(table).delete().eq('id', id);
            
            if (error) {
                showAlert('Erro ao excluir: ' + error.message, 'error');
            } else {
                if (type === 'usina') {
                    loadUsinas();
                }
            }
        }
        setDeleteModal(null);
    };

    // UI Renders
    return (
        <div className="min-h-screen bg-[#f8fafc] font-sans selection:bg-emerald-200">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between sticky top-0 z-30">
                <div className="flex items-center space-x-4">
                    <Building2 className="w-8 h-8 text-emerald-600" />
                    <div>
                        <h1 className="text-2xl font-extrabold text-gray-800 tracking-tight">Gerenciar Usinas e Unidades</h1>
                        <p className="text-sm text-gray-500 font-medium mt-0.5">Configure suas usinas, adicione UCs e suba faturas manualmente.</p>
                    </div>
                </div>
                <div className="flex space-x-3">
                    <button data-tour="btn-analise" onClick={() => window.location.href = '/analisedeconta'} className="bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-500 hover:text-white px-4 py-2.5 rounded-xl shadow-sm transition-all hover:shadow-md hover:shadow-emerald-500/20 text-sm font-bold flex items-center">
                        <LayoutDashboard className="w-4 h-4 mr-2" />
                        Análise (Dashboard)
                    </button>
                    <div data-tour="btn-recarga" className="flex items-center space-x-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-1">
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
                <div data-tour="tabela-usinas" className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <h2 className="text-lg font-bold text-gray-800">Usinas Cadastradas</h2>
                        <button data-tour="nova-usina" onClick={() => {
                            setEditUsinaModal({ nome: '', tipo_compensacao: 'prioridade', cep: '', ibge_code: '', potencia_kwp: '', qtd_modulos: '', potencia_modulo: '', qtd_inversores: '', potencia_inversor: '', geracao_aferida: {} });
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
                                            <button onClick={() => setEditUsinaModal(u)} className="text-gray-500 hover:text-gray-700 transition-colors p-1" title="Visualizar Usina"><Eye className="w-4 h-4"/></button>
                                            <button onClick={() => setEditUsinaModal(u)} className="text-blue-500 hover:text-blue-700 transition-colors p-1" title="Editar Usina"><Edit className="w-4 h-4"/></button>
                                            <button onClick={() => setDeleteModal({ type: 'usina', id: u.id, title: 'Excluir Usina', message: `Tem certeza que deseja excluir a usina "${u.nome}"? ATENÇÃO: Esta ação irá apagar definitivamente TODAS as UCs e Faturas vinculadas a ela (Exclusão em Cascata).` })} className="text-red-500 hover:text-red-700 transition-colors p-1" title="Excluir Usina"><Trash2 className="w-4 h-4"/></button>
                                        </td>
                                    </tr>
                                ))}
                                {usinas.length === 0 && <tr><td colSpan="4" className="text-center py-8 text-gray-400 italic">Nenhuma usina encontrada.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>

            {/* MODALS */}
            
            {/* 1. Delete Confirmation Modal (Danger) */}
            {deleteModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
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

            {/* 2. Edit Usina Modal (Refactored) */}
            <StandaloneUsinaModal 
                isOpen={!!editUsinaModal} 
                onClose={() => setEditUsinaModal(null)} 
                onSave={loadUsinas} 
                usinaData={editUsinaModal} 
                userId={user?.id}
            />

            <OnboardingTour />
        </div>
    );
}
