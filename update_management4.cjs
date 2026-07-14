const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneManagement.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Increase modal width
content = content.replace(
    'className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 p-6"',
    'className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl animate-in fade-in zoom-in-95 p-6"'
);

// 2. Remove max-h from geracao tab container
content = content.replace(
    '<div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">',
    '<div className="space-y-4">'
);

// 3. Fix the label and input structure for months
const oldMonthRender = `                                                <div key={index} className="flex items-center space-x-2">
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
                                                </div>`;

const newMonthRender = `                                                <div key={index} className="flex flex-col">
                                                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 ml-1">{mes}</label>
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
                                                        className="w-full border-gray-200 rounded-lg px-3 py-2 text-sm font-medium border hide-number-spin focus:border-emerald-500 outline-none" 
                                                    />
                                                </div>`;

content = content.replace(oldMonthRender, newMonthRender);

// Also change grid cols to 3 or 4 so it looks better on max-w-xl
content = content.replace(
    '<div className="grid grid-cols-2 gap-3">',
    '<div className="grid grid-cols-3 gap-4">'
);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneManagement.jsx modal sizing and labels updated.');
