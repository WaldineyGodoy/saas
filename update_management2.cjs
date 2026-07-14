const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneManagement.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add states for Tabs and Year
const oldStates = `    const [deleteModal, setDeleteModal] = useState(null); // { type, id, title, message }
    const [editUsinaModal, setEditUsinaModal] = useState(null);
    const [editUcModal, setEditUcModal] = useState(null);
    const [editContaModal, setEditContaModal] = useState(null);`;

const newStates = `    const [deleteModal, setDeleteModal] = useState(null); // { type, id, title, message }
    const [editUsinaModal, setEditUsinaModal] = useState(null);
    const [usinaModalTab, setUsinaModalTab] = useState('dados');
    const [usinaModalYear, setUsinaModalYear] = useState(new Date().getFullYear());
    const [editUcModal, setEditUcModal] = useState(null);
    const [editContaModal, setEditContaModal] = useState(null);`;

content = content.replace(oldStates, newStates);

// 2. Update handleSaveUsina payload
const oldSaveUsina = `        const payload = {
            nome: editUsinaModal.nome, 
            tipo_compensacao: editUsinaModal.tipo_compensacao,
            cep: editUsinaModal.cep || null,
            ibge_code: editUsinaModal.ibge_code || null,
            potencia_kwp: editUsinaModal.potencia_kwp ? parseFloat(editUsinaModal.potencia_kwp) : null
        };`;

const newSaveUsina = `        const payload = {
            nome: editUsinaModal.nome, 
            tipo_compensacao: editUsinaModal.tipo_compensacao,
            cep: editUsinaModal.cep || null,
            ibge_code: editUsinaModal.ibge_code || null,
            potencia_kwp: editUsinaModal.potencia_kwp ? parseFloat(editUsinaModal.potencia_kwp) : null,
            qtd_modulos: editUsinaModal.qtd_modulos ? parseInt(editUsinaModal.qtd_modulos) : null,
            potencia_modulo: editUsinaModal.potencia_modulo ? parseFloat(editUsinaModal.potencia_modulo) : null,
            qtd_inversores: editUsinaModal.qtd_inversores ? parseInt(editUsinaModal.qtd_inversores) : null,
            potencia_inversor: editUsinaModal.potencia_inversor ? parseFloat(editUsinaModal.potencia_inversor) : null,
            geracao_aferida: editUsinaModal.geracao_aferida || {}
        };`;

content = content.replace(oldSaveUsina, newSaveUsina);

// 3. New Usina button reset
const oldNewUsinaButton = `<button onClick={() => setEditUsinaModal({ nome: '', tipo_compensacao: 'prioridade', cep: '', ibge_code: '', potencia_kwp: '' })}`;
const newNewUsinaButton = `<button onClick={() => {
                                setEditUsinaModal({ nome: '', tipo_compensacao: 'prioridade', cep: '', ibge_code: '', potencia_kwp: '', qtd_modulos: '', potencia_modulo: '', qtd_inversores: '', potencia_inversor: '', geracao_aferida: {} });
                                setUsinaModalTab('dados');
                            }}`;
content = content.replace(oldNewUsinaButton, newNewUsinaButton);

// Also need to reset tab when editing existing usina (around line 232)
const oldEditUsinaBtn = `                                                <button onClick={() => setEditUsinaModal(u)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-md transition-colors"><Edit className="w-4 h-4"/></button>`;
const newEditUsinaBtn = `                                                <button onClick={() => { setEditUsinaModal(u); setUsinaModalTab('dados'); }} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-md transition-colors"><Edit className="w-4 h-4"/></button>`;
content = content.replace(oldEditUsinaBtn, newEditUsinaBtn);

// 4. Modal Render
const oldModalRender = `                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Usina</label>
                                <input type="text" value={editUsinaModal.nome} onChange={e => setEditUsinaModal({...editUsinaModal, nome: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none border" />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
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
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Potência (kWp)</label>
                                    <input type="number" step="0.01" value={editUsinaModal.potencia_kwp || ''} onChange={e => setEditUsinaModal({...editUsinaModal, potencia_kwp: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Método de Compensação</label>
                                <select value={editUsinaModal.tipo_compensacao} onChange={e => setEditUsinaModal({...editUsinaModal, tipo_compensacao: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none border">
                                    <option value="prioridade">Prioridade</option>
                                    <option value="porcentagem">Porcentagem</option>
                                </select>
                            </div>
                            <button onClick={handleSaveUsina} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-md flex justify-center items-center mt-4 transition-colors">
                                <Save className="w-4 h-4 mr-2"/> Salvar Usina
                            </button>
                        </div>`;

const newModalRender = `                        {/* Tabs within Modal */}
                        <div className="flex border-b border-gray-200 mb-4">
                            <button onClick={() => setUsinaModalTab('dados')} className={\`px-4 py-2 text-sm font-bold border-b-2 \${usinaModalTab === 'dados' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}\`}>
                                Dados da Usina
                            </button>
                            <button onClick={() => setUsinaModalTab('geracao')} className={\`px-4 py-2 text-sm font-bold border-b-2 \${usinaModalTab === 'geracao' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}\`}>
                                Geração Aferida
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
                                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                                    <div className="flex justify-between items-center bg-gray-50 p-2 rounded-lg sticky top-0 border border-gray-200 shadow-sm z-10">
                                        <button onClick={() => setUsinaModalYear(usinaModalYear - 1)} className="px-2 py-1 bg-white border border-gray-200 rounded text-sm font-bold hover:bg-gray-100">&lt;</button>
                                        <span className="font-extrabold text-emerald-700">{usinaModalYear}</span>
                                        <button onClick={() => setUsinaModalYear(usinaModalYear + 1)} className="px-2 py-1 bg-white border border-gray-200 rounded text-sm font-bold hover:bg-gray-100">&gt;</button>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-3">
                                        {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map((mes, index) => {
                                            const currentAferida = editUsinaModal.geracao_aferida?.[usinaModalYear]?.[index] || '';
                                            return (
                                                <div key={index} className="flex items-center space-x-2">
                                                    <label className="w-20 text-xs font-bold text-gray-600 truncate">{mes}</label>
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
                                                        className="flex-1 border-gray-200 rounded-lg px-2 py-1.5 text-sm font-medium border hide-number-spin focus:border-emerald-500 outline-none" 
                                                    />
                                                </div>
                                            )
                                        })}
                                    </div>
                                    <p className="text-xs text-gray-500 italic mt-2">Dica: Se um mês ficar em branco, o sistema utilizará o cálculo automático de irradiação.</p>
                                </div>
                            )}

                            <button onClick={handleSaveUsina} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-md flex justify-center items-center mt-4 transition-colors">
                                <Save className="w-4 h-4 mr-2"/> Salvar Usina
                            </button>
                        </div>`;

content = content.replace(oldModalRender, newModalRender);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneManagement.jsx updated.');
