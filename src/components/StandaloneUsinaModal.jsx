import React, { useState, useEffect } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';

const irrKeys = ['jan.khw', 'fev.khw', 'mar.kwh', 'abr.kwh', 'mai.kwh', 'jun.kwh', 'jul.kwh', 'ago.kwh', 'set.kwh', 'out.kwh', 'nov.kwh', 'dez.khw'];
const mesesLabels = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export default function StandaloneUsinaModal({ isOpen, onClose, onSave, usinaData, userId }) {
    const [usinaModalTab, setUsinaModalTab] = useState('dados');
    const [usinaModalYear, setUsinaModalYear] = useState(new Date().getFullYear());
    const [irradianciaInfo, setIrradianciaInfo] = useState(null);
    const [alertMsg, setAlertMsg] = useState('');
    const [codigoGeradoLocal, setCodigoGeradoLocal] = useState('');

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
        }
    }, [isOpen, usinaData]);

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

    const handleVerify = () => {
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl animate-in fade-in zoom-in-95 p-6 max-h-[95vh] overflow-y-auto">
                
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

                    <button onClick={() => handleSaveUsina()} disabled={!editUsinaModal.nome} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-md flex justify-center items-center mt-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        <Save className="w-4 h-4 mr-2"/> Salvar Usina
                    </button>
                </div>
            </div>
        </div>
    );
}
