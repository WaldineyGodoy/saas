import React, { useState, useEffect } from 'react';
import { X, Save, Edit, Trash2, Plus, AlertCircle, Receipt } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function StandaloneUcModal({ isOpen, onClose, onSave, ucData, usinaId, profile }) {
    const [activeTab, setActiveTab] = useState('dados');
    const [alertMsg, setAlertMsg] = useState('');
    
    const [editUcModal, setEditUcModal] = useState({
        numero_uc: '',
        tipo: 'uc',
        prioridade: 1,
        porcentagem: 0,
        conta_saldo: false,
        cep: '',
        municipio: '',
        classe: ''
    });

    const [contas, setContas] = useState([]);
    const [editContaModal, setEditContaModal] = useState(null);
    const [deleteModal, setDeleteModal] = useState(null);

    useEffect(() => {
        if (isOpen) {
            if (ucData && ucData.id) {
                setEditUcModal({ ...ucData });
                loadContas(ucData.id);
            } else {
                setEditUcModal({
                    numero_uc: '',
                    tipo: 'uc',
                    prioridade: 1,
                    porcentagem: 0,
                    conta_saldo: false,
                    cep: '',
                    municipio: '',
                    classe: ''
                });
                setContas([]);
            }
            setActiveTab('dados');
        }
    }, [isOpen, ucData]);

    const loadContas = async (ucId) => {
        if (!ucId) {
            setContas([]);
            return;
        }
        const { data } = await supabase.from('standalone_contas').select('*').eq('uc_id', ucId).order('data_leitura', { ascending: false });
        setContas(data || []);
    };

    if (!isOpen) return null;

    const showAlert = (msg) => {
        setAlertMsg(msg);
        setTimeout(() => setAlertMsg(''), 4000);
    };

    const handleSaveUc = async () => {
        if (!editUcModal.numero_uc) {
            showAlert('O número da UC é obrigatório.');
            return;
        }
        const payload = {
            usina_id: usinaId,
            numero_uc: editUcModal.numero_uc,
            tipo: editUcModal.tipo,
            prioridade: editUcModal.tipo === 'ug' ? 0 : editUcModal.prioridade,
            porcentagem: editUcModal.porcentagem,
            conta_saldo: editUcModal.conta_saldo,
            cep: editUcModal.cep || null,
            municipio: editUcModal.municipio || null,
            classe: editUcModal.classe || null
        };

        try {
            if (editUcModal.id) {
                const { error } = await supabase.from('standalone_ucs').update(payload).eq('id', editUcModal.id);
                if (error) throw error;
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
                                showAlert('Limite Free excedido. Adquira Tokens para adicionar mais Unidades Consumidoras.');
                                return;
                            }
                        }
                    }
                }
                const { error } = await supabase.from('standalone_ucs').insert(payload);
                if (error) throw error;
            }
            onSave();
            onClose();
        } catch (err) {
            showAlert('Erro ao salvar UC: ' + err.message);
        }
    };

    const handleSaveConta = async () => {
        if (!editContaModal.mes_referencia) return;
        const payload = {
            uc_id: ucData.id,
            mes_referencia: editContaModal.mes_referencia,
            data_leitura: editContaModal.data_leitura || null,
            vencimento: editContaModal.vencimento || null,
            consumo_kwh: editContaModal.consumo_kwh,
            energia_injetada: editContaModal.energia_injetada,
            energia_compensada: editContaModal.energia_compensada,
            saldo_kwh: editContaModal.saldo_kwh,
            consumo_reais: editContaModal.consumo_reais || 0,
            fio_b_total: editContaModal.fio_b_total || 0,
            iluminacao_publica: editContaModal.iluminacao_publica || 0,
            parcelamento: editContaModal.parcelamento || 0,
            outros_lancamentos: editContaModal.outros_lancamentos || 0,
            valor_concessionaria: editContaModal.valor_concessionaria || 0
        };

        try {
            if (editContaModal.id) {
                await supabase.from('standalone_contas').update(payload).eq('id', editContaModal.id);
            } else {
                await supabase.from('standalone_contas').insert(payload);
            }
            setEditContaModal(null);
            loadContas(ucData.id);
        } catch (err) {
            showAlert('Erro ao salvar fatura: ' + err.message);
        }
    };

    const confirmDeleteConta = async () => {
        if (!deleteModal) return;
        try {
            await supabase.from('standalone_contas').delete().eq('id', deleteModal.id);
            loadContas(ucData.id);
            setDeleteModal(null);
        } catch(err) {
            showAlert('Erro ao excluir fatura: ' + err.message);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl animate-in fade-in zoom-in-95 overflow-hidden flex flex-col max-h-[95vh]">
                {/* Header */}
                <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
                    <div className="flex items-center space-x-3">
                        <div className="bg-emerald-100 p-2 rounded-xl">
                            <Receipt className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-extrabold text-gray-800 tracking-tight">
                                {editUcModal.id ? `Unidade: ${editUcModal.numero_uc}` : 'Nova Unidade'}
                            </h2>
                            <p className="text-xs font-semibold text-gray-500 uppercase mt-1">
                                {editUcModal.tipo === 'ug' ? 'Unidade Geradora' : 'Unidade Consumidora'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {alertMsg && (
                    <div className="bg-red-50 text-red-600 px-6 py-3 text-sm font-bold flex items-center border-b border-red-100">
                        <AlertCircle className="w-4 h-4 mr-2" /> {alertMsg}
                    </div>
                )}

                {/* Tabs */}
                {editUcModal.id && (
                    <div className="px-6 border-b border-gray-100 bg-white pt-4">
                        <div className="flex space-x-6">
                            <button 
                                onClick={() => setActiveTab('dados')} 
                                className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'dados' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                Dados da UC
                            </button>
                            <button 
                                onClick={() => setActiveTab('faturas')} 
                                className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeTab === 'faturas' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                Faturas (Contas)
                            </button>
                        </div>
                    </div>
                )}

                {/* Content */}
                <div className="p-6 overflow-y-auto bg-gray-50 flex-1">
                    {activeTab === 'dados' && (
                        <div className="space-y-4 max-w-2xl mx-auto bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Número UC/UG</label>
                                    <input type="text" value={editUcModal.numero_uc} onChange={e => setEditUcModal({...editUcModal, numero_uc: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border focus:ring-2 focus:ring-emerald-500/20 outline-none" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                                    <select value={editUcModal.tipo} onChange={e => setEditUcModal({...editUcModal, tipo: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border focus:ring-2 focus:ring-emerald-500/20 outline-none">
                                        <option value="uc">UC (Consumo)</option>
                                        <option value="ug">UG (Geração)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CEP</label>
                                    <input type="text" value={editUcModal.cep || ''} onChange={e => setEditUcModal({...editUcModal, cep: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border focus:ring-2 focus:ring-emerald-500/20 outline-none" placeholder="00000-000" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Município</label>
                                    <input type="text" value={editUcModal.municipio || ''} onChange={e => setEditUcModal({...editUcModal, municipio: e.target.value.toUpperCase()})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border focus:ring-2 focus:ring-emerald-500/20 outline-none" placeholder="Nome da cidade (COSIP)" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Classe (B1 Residencial, B3 Comercial, etc)</label>
                                    <input type="text" value={editUcModal.classe || ''} onChange={e => setEditUcModal({...editUcModal, classe: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border focus:ring-2 focus:ring-emerald-500/20 outline-none" />
                                </div>
                            </div>
                            {editUcModal.tipo === 'uc' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Prioridade</label>
                                        <input type="number" min="1" value={editUcModal.prioridade} onChange={e => setEditUcModal({...editUcModal, prioridade: parseInt(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border focus:ring-2 focus:ring-emerald-500/20 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cota %</label>
                                        <input type="number" step="0.1" value={editUcModal.porcentagem} onChange={e => setEditUcModal({...editUcModal, porcentagem: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border focus:ring-2 focus:ring-emerald-500/20 outline-none" />
                                    </div>
                                </div>
                            )}
                            <label className="flex items-center space-x-3 bg-gray-50 p-3 rounded-lg border border-gray-100 cursor-pointer">
                                <input type="checkbox" checked={editUcModal.conta_saldo} onChange={e => setEditUcModal({...editUcModal, conta_saldo: e.target.checked})} className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"/>
                                <span className="text-sm font-bold text-gray-700">Conta Saldo?</span>
                            </label>
                            
                            <div className="pt-4 flex justify-end">
                                <button onClick={handleSaveUc} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-6 rounded-xl shadow-md flex justify-center items-center transition-colors">
                                    <Save className="w-4 h-4 mr-2"/> Salvar Unidade
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'faturas' && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                <h2 className="text-lg font-bold text-gray-800">Faturas Lançadas</h2>
                                <button onClick={() => setEditContaModal({ mes_referencia: '', consumo_kwh: 0, energia_injetada: 0, energia_compensada: 0, saldo_kwh: 0, iluminacao_publica: 0, parcelamento: 0, outros_lancamentos: 0, consumo_reais: 0, fio_b_total: 0, valor_concessionaria: 0 })} className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center">
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
                                        {contas.length === 0 && <tr><td colSpan="6" className="text-center py-8 text-gray-400 italic">Nenhuma fatura encontrada para esta UC.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modais Secundários (Delete e Edit Conta) */}
            {deleteModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDeleteModal(null)}></div>
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
                            <button onClick={confirmDeleteConta} className="px-4 py-2 font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-md shadow-red-500/20 transition-all text-sm">Sim, Excluir</button>
                        </div>
                    </div>
                </div>
            )}

            {editContaModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
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
