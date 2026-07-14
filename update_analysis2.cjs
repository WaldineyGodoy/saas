const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneAnalysis.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Imports
content = content.replace(
    "import { LayoutDashboard, Plus, FileText, AlertCircle, ChevronDown, Activity, Zap } from 'lucide-react';",
    "import { LayoutDashboard, Plus, FileText, AlertCircle, ChevronDown, Activity, Zap, Edit, Trash2, Save, X } from 'lucide-react';"
);

// 2. States
const newStates = `    const [alertPopup, setAlertPopup] = useState(null); // { isOpen, alertas, ucName }
    
    // CRUD States
    const [editContaModal, setEditContaModal] = useState(null);
    const [deleteModal, setDeleteModal] = useState(null);`;
content = content.replace("    const [alertPopup, setAlertPopup] = useState(null); // { isOpen, alertas, ucName }", newStates);

// 3. Handlers
const handlers = `
    const handleSaveConta = async () => {
        try {
            const dataToSave = {
                mes_referencia: editContaModal.mes_referencia,
                data_leitura: editContaModal.data_leitura || null,
                vencimento: editContaModal.vencimento || null,
                consumo_kwh: editContaModal.consumo_kwh,
                energia_injetada: editContaModal.energia_injetada,
                energia_compensada: editContaModal.energia_compensada,
                saldo_kwh: editContaModal.saldo_kwh,
                iluminacao_publica: editContaModal.iluminacao_publica || 0,
                parcelamento: editContaModal.parcelamento || 0,
                outros_lancamentos: editContaModal.outros_lancamentos || 0,
                consumo_reais: editContaModal.consumo_reais || 0,
                fio_b_total: editContaModal.fio_b_total || 0,
                valor_concessionaria: editContaModal.valor_concessionaria || 0
            };

            if (editContaModal.id) {
                const { error } = await supabase.from('standalone_contas').update(dataToSave).eq('id', editContaModal.id);
                if (error) throw error;
            }
            loadData();
            setEditContaModal(null);
        } catch (err) {
            alert('Erro ao salvar fatura: ' + err.message);
        }
    };

    const confirmDelete = async () => {
        try {
            if (deleteModal.type === 'conta') {
                const { error } = await supabase.from('standalone_contas').delete().eq('id', deleteModal.id);
                if (error) throw error;
            }
            loadData();
            setDeleteModal(null);
        } catch (err) {
            alert('Erro ao excluir: ' + err.message);
        }
    };
`;
content = content.replace("    const handleCreateUsina = async () => {", handlers + "\n    const handleCreateUsina = async () => {");

// 4. Progress bar prep logic
const mapPreCalc = `        const mappedUcs = sortedUcs.map(uc => {
            const conta = filteredContas.find(c => c.uc_id === uc.id);
            const compensado = conta ? Number(conta.energia_compensada || 0) : 0;
            const consumo = conta ? Number(conta.consumo_kwh || 0) : 0;
            const injetado = conta && uc.tipo === 'ug' ? Number(conta.energia_injetada || 0) : 0;
            const uncompensated = Math.max(0, consumo - compensado);

            let saldoCascata = 0;
            if (uc.tipo === 'ug') {
                currentCascadeBalance += injetado;
                currentCascadeBalance -= compensado;
                saldoCascata = Math.max(0, currentCascadeBalance);
            } else {
                currentCascadeBalance -= compensado;
                saldoCascata = Math.max(0, currentCascadeBalance);
            }

            let saldoAnterior = 0;
            if (cycle && selectedCycleId !== 'all') {
                const contasAnteriores = contas.filter(c => {
                    if (c.uc_id !== uc.id || !c.data_leitura) return false;
                    const d = new Date(c.data_leitura);
                    return d < cycle.startDate;
                });
                contasAnteriores.forEach(c => {
                    if (uc.tipo === 'ug') {
                        const inj = Number(c.energia_injetada || 0);
                        const comp = Number(c.energia_compensada || 0);
                        saldoAnterior += Math.max(0, inj - comp);
                    } else {
                        saldoAnterior += Number(c.saldo_kwh || 0);
                    }
                });
            }

            const dataLeituraObj = conta?.data_leitura ? new Date(conta.data_leitura) : null;
            let dataLeitura = '';
            if (dataLeituraObj) {
                const d = dataLeituraObj.getUTCDate().toString().padStart(2, '0');
                const m = (dataLeituraObj.getUTCMonth() + 1).toString().padStart(2, '0');
                dataLeitura = \`\${d}/\${m}\`;
            }

            const valorOcr = conta ? Number(conta.valor_concessionaria || 0) : 0;
            const valorAuditado = conta ? Number(conta.valor_auditado || 0) : 0;
            const statusAuditoria = conta?.status_auditoria || '';
            const hasAlerts = conta && conta.alertas && conta.alertas.length > 0;

            return { uc, conta, compensado, consumo, injetado, uncompensated, saldo: saldoCascata, saldoAnterior, dataLeitura, valorOcr, valorAuditado, statusAuditoria, hasAlerts };
        });

        // Find max values for progress bar scaling
        let maxVal = Math.max(totalInjetado, 1);
        mappedUcs.forEach(c => {
            if (c.compensado > maxVal) maxVal = c.compensado;
            if (c.consumo > maxVal) maxVal = c.consumo;
            if (c.saldo > maxVal) maxVal = c.saldo;
        });`;
content = content.replace(/        const mappedUcs = sortedUcs\.map[\s\S]*?if \(c\.saldo > maxVal\) maxVal = c\.saldo;\n        \}\);/, mapPreCalc);

// 5. Progress bar UI
const currentBarLogic = `                                        {/* Barras Empilhadas Equipotencializadas com Texto nas pontas */}
                                        <div className="flex items-center group/bar cursor-default w-full">
                                            <div className="flex flex-col items-end mr-3 min-w-[70px]">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 tracking-wider">Compensado</span>
                                                <span className="text-[13px] font-extrabold text-blue-600 leading-none">{compensado} <span className="text-[10px] opacity-70">kWh</span></span>
                                            </div>

                                            <div className="flex-1 bg-gray-100/80 rounded-full h-4 flex overflow-hidden relative shadow-inner">
                                                <div 
                                                    style={{ width: \`\${compWidth}%\` }} 
                                                    className="bg-gradient-to-r from-blue-400 to-blue-500 h-full transition-all duration-1000 ease-out border-r border-white/30"
                                                ></div>
                                                <div 
                                                    style={{ width: \`\${saldoWidth}%\` }} 
                                                    className="bg-gradient-to-r from-emerald-400 to-emerald-500 h-full transition-all duration-1000 ease-out"
                                                ></div>
                                            </div>
                                            
                                            <div className="flex flex-col items-start ml-3 min-w-[70px]">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 tracking-wider">Saldo</span>
                                                <span className="text-[13px] font-extrabold text-emerald-600 leading-none">{saldo} <span className="text-[10px] opacity-70">kWh</span></span>
                                            </div>
                                        </div>`;

const newBarLogic = `                            // Escala para a barra empilhada
                            const maxValTable = Math.max(totalInjetado, maxVal);
                            const currentMax = maxValTable > 0 ? maxValTable : 1;
                            
                            const compWidth = (compensado / currentMax) * 100;
                            const uncompWidth = (uncompensated / currentMax) * 100;
                            const saldoWidth = (saldo / currentMax) * 100;

                            return (
                                <div key={uc.id} className="p-4 hover:bg-emerald-50/30 transition-all duration-300 flex items-center group">
                                    <div className="w-[20%] pr-4">
                                        <div className="font-bold text-gray-800 group-hover:text-emerald-700 transition-colors">{uc.numero_uc}</div>
                                        <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mt-1 flex flex-wrap gap-1">
                                            <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">{uc.tipo === 'ug' ? 'Geradora' : 'Consumidora'}</span>
                                            {uc.tipo === 'uc' && usinaInfo.tipo_compensacao === 'prioridade' && <span className="bg-blue-50 px-2 py-0.5 rounded text-blue-600">Prio: {uc.prioridade} {dataLeitura && \`| \${dataLeitura}\`}</span>}
                                            {uc.tipo === 'uc' && usinaInfo.tipo_compensacao === 'porcentagem' && <span className="bg-purple-50 px-2 py-0.5 rounded text-purple-600">Cota: {uc.porcentagem}% {dataLeitura && \`| \${dataLeitura}\`}</span>}
                                            {uc.tipo === 'ug' && dataLeitura && <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">{dataLeitura}</span>}
                                            {uc.conta_saldo && <span className="bg-emerald-50 px-2 py-0.5 rounded text-emerald-600">Saldo</span>}
                                        </div>
                                    </div>
                                    
                                    <div className="w-[50%] px-4 border-l border-gray-100 flex flex-col justify-center">
                                        <div className="flex items-center group/bar cursor-default w-full">
                                            <div className="flex flex-col items-end mr-3 min-w-[70px]">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 tracking-wider">Compensado</span>
                                                <span className="text-[13px] font-extrabold text-blue-600 leading-none">{compensado} <span className="text-[10px] opacity-70">kWh</span></span>
                                            </div>

                                            <div className="flex-1 bg-gray-100/80 rounded-full h-4 flex overflow-hidden relative shadow-inner">
                                                {/* Compensado (Azul) */}
                                                <div 
                                                    style={{ width: \`\${compWidth}%\` }} 
                                                    className="bg-gradient-to-r from-blue-400 to-blue-500 h-full transition-all duration-1000 ease-out z-20 relative"
                                                ></div>
                                                
                                                {/* Consumo Nao Compensado (Vermelho) - se compensado == consumo, o vermelho e 0 */}
                                                {uncompWidth > 0 && (
                                                    <div 
                                                        style={{ width: \`\${uncompWidth}%\` }} 
                                                        className="bg-gradient-to-r from-red-400 to-red-500 h-full transition-all duration-1000 ease-out z-10 relative border-l border-white/20"
                                                    ></div>
                                                )}

                                                {/* Saldo Cascata (Verde) - ancorado a direita */}
                                                <div 
                                                    style={{ width: \`\${saldoWidth}%\` }} 
                                                    className="absolute top-0 right-0 bg-gradient-to-l from-emerald-400 to-emerald-500 h-full transition-all duration-1000 ease-out z-0 rounded-l-full"
                                                ></div>
                                            </div>
                                            
                                            <div className="flex flex-col items-start ml-3 min-w-[70px]">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 tracking-wider">Saldo</span>
                                                <span className="text-[13px] font-extrabold text-emerald-600 leading-none">{saldo} <span className="text-[10px] opacity-70">kWh</span></span>
                                            </div>
                                        </div>
                                    </div>`;

content = content.replace(/                            \/\/ Escala para a barra empilhada[\s\S]*?<\/div>\n                                    <\/div>/, newBarLogic);


// 6. Right Side - Add CRUD
const oldRightSide = `                                                <span className={\`text-sm font-extrabold \${statusAuditoria === 'contestado' ? 'text-red-600' : 'text-emerald-600'}\`}>
                                                    R$ {valorAuditado.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                                </span>
                                            </div>
                                        )}`;
const newRightSide = `                                                <span className={\`text-sm font-extrabold \${statusAuditoria === 'contestado' ? 'text-red-600' : 'text-emerald-600'}\`}>
                                                    R$ {valorAuditado.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                                </span>
                                                <div className="flex space-x-2 mt-2 w-full justify-end">
                                                    <button onClick={() => setEditContaModal(conta)} className="text-blue-500 hover:text-blue-700 transition-colors p-1" title="Editar Fatura"><Edit className="w-3.5 h-3.5"/></button>
                                                    <button onClick={() => setDeleteModal({ type: 'conta', id: conta.id, title: 'Excluir Fatura', message: \`Deseja excluir a fatura de Ref \${conta.mes_referencia}?\` })} className="text-red-500 hover:text-red-700 transition-colors p-1" title="Excluir Fatura"><Trash2 className="w-3.5 h-3.5"/></button>
                                                </div>
                                            </div>
                                        )}`;
content = content.replace(oldRightSide, newRightSide);

// 7. Modals at the end
const modals = `
            {/* CRUD MODALS */}
            {deleteModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
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

            {editContaModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditContaModal(null)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="font-extrabold text-lg text-gray-800">Editar Fatura (OCR)</h3>
                            <button onClick={() => setEditContaModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mês Ref.</label>
                                    <input type="text" value={editContaModal.mes_referencia} onChange={e => setEditContaModal({...editContaModal, mes_referencia: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data Leitura</label>
                                    <input type="date" value={editContaModal.data_leitura || ''} onChange={e => setEditContaModal({...editContaModal, data_leitura: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Consumo (kWh)</label>
                                    <input type="number" value={editContaModal.consumo_kwh} onChange={e => setEditContaModal({...editContaModal, consumo_kwh: parseFloat(e.target.value)})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
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
}`;

content = content.replace(/        <\/div>\n    \);\n\}\n?$/, modals);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAnalysis.jsx updated with CRUD and new bars successfully.');
