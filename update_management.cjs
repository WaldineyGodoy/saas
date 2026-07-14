const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneManagement.jsx';
let content = fs.readFileSync(path, 'utf8');

// Insert buscarCep function and modify handleSaveUsina
const oldSaveUsina = `    // ----------------- USINAS CRUD -----------------
    const handleSaveUsina = async () => {
        if (!editUsinaModal.nome) return;
        if (editUsinaModal.id) {
            await supabase.from('standalone_usinas').update({ 
                nome: editUsinaModal.nome, 
                tipo_compensacao: editUsinaModal.tipo_compensacao 
            }).eq('id', editUsinaModal.id);
        } else {
            await supabase.from('standalone_usinas').insert({ 
                nome: editUsinaModal.nome, 
                tipo_compensacao: editUsinaModal.tipo_compensacao 
            });
        }
        setEditUsinaModal(null);
        loadUsinas();
    };`;

const newSaveUsina = `    // ----------------- USINAS CRUD -----------------
    const buscarCep = async () => {
        if (!editUsinaModal.cep) return;
        const cleanCep = editUsinaModal.cep.replace(/\\D/g, '');
        if (cleanCep.length !== 8) {
            alert('CEP inválido.');
            return;
        }
        try {
            const res = await fetch(\`https://viacep.com.br/ws/\${cleanCep}/json/\`);
            const data = await res.json();
            if (data.erro) {
                alert('CEP não encontrado.');
                return;
            }
            setEditUsinaModal(prev => ({
                ...prev,
                ibge_code: data.ibge
            }));
            alert(\`CEP encontrado! IBGE: \${data.ibge} - \${data.localidade}/\${data.uf}\`);
        } catch (err) {
            alert('Erro ao buscar CEP.');
        }
    };

    const handleSaveUsina = async () => {
        if (!editUsinaModal.nome) return;
        const payload = {
            nome: editUsinaModal.nome, 
            tipo_compensacao: editUsinaModal.tipo_compensacao,
            cep: editUsinaModal.cep || null,
            ibge_code: editUsinaModal.ibge_code || null,
            potencia_kwp: editUsinaModal.potencia_kwp ? parseFloat(editUsinaModal.potencia_kwp) : null
        };
        if (editUsinaModal.id) {
            await supabase.from('standalone_usinas').update(payload).eq('id', editUsinaModal.id);
        } else {
            await supabase.from('standalone_usinas').insert(payload);
        }
        setEditUsinaModal(null);
        loadUsinas();
    };`;

content = content.replace(oldSaveUsina, newSaveUsina);

// Add inputs to Edit Usina Modal
const oldUsinaInputs = `                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome da Usina</label>
                                <input type="text" value={editUsinaModal.nome} onChange={e => setEditUsinaModal({...editUsinaModal, nome: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none border" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Método de Compensação</label>
                                <select value={editUsinaModal.tipo_compensacao} onChange={e => setEditUsinaModal({...editUsinaModal, tipo_compensacao: e.target.value})} className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none border">
                                    <option value="prioridade">Prioridade</option>
                                    <option value="porcentagem">Porcentagem</option>
                                </select>
                            </div>`;

const newUsinaInputs = `                            <div>
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
                            </div>`;

content = content.replace(oldUsinaInputs, newUsinaInputs);

// Wait, the "Nova Usina" button needs to init with cep: '', ibge_code: '', potencia_kwp: ''
const oldNewUsinaButton = `<button onClick={() => setEditUsinaModal({ nome: '', tipo_compensacao: 'prioridade' })}`;
const newNewUsinaButton = `<button onClick={() => setEditUsinaModal({ nome: '', tipo_compensacao: 'prioridade', cep: '', ibge_code: '', potencia_kwp: '' })}`;
content = content.replace(oldNewUsinaButton, newNewUsinaButton);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneManagement.jsx updated.');
