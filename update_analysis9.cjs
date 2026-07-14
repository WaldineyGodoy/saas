const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneAnalysis.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add Reload Button next to "Demonstrativo por Unidade"
content = content.replace(
    `<h3 className="font-bold text-gray-800 flex items-center">
                            <LayoutDashboard className="w-5 h-5 mr-2 text-emerald-500"/>
                            Demonstrativo por Unidade
                        </h3>`,
    `<h3 className="font-bold text-gray-800 flex items-center">
                            <LayoutDashboard className="w-5 h-5 mr-2 text-emerald-500"/>
                            Demonstrativo por Unidade
                            <button onClick={loadData} className="ml-4 p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors" title="Atualizar Dados">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                            </button>
                        </h3>`
);

// 2. Fix Card heights
content = content.replace(
    'className="relative bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-sm border border-blue-100 flex items-center hover:shadow-md transition-all"',
    'className="relative bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-sm border border-blue-100 flex items-center hover:shadow-md transition-all h-full"'
);
content = content.replace(
    'className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-emerald-100 flex items-center hover:shadow-md transition-all"',
    'className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-emerald-100 flex items-center hover:shadow-md transition-all h-full"'
);
content = content.replace(
    'className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-blue-100 flex items-center hover:shadow-md transition-all"',
    'className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-blue-100 flex items-center hover:shadow-md transition-all h-full"'
);
content = content.replace(
    'className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-orange-100 flex items-center hover:shadow-md transition-all"',
    'className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-orange-100 flex items-center hover:shadow-md transition-all h-full"'
);
content = content.replace(
    'className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-purple-100 flex items-center hover:shadow-md transition-all"',
    'className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-purple-100 flex items-center hover:shadow-md transition-all h-full"'
);

// Fix Total Faturas overflow
content = content.replace(
    '<h3 className="text-2xl font-extrabold bg-gradient-to-r from-purple-700 to-pink-800 bg-clip-text text-transparent">R$ {totalValorFaturas.toLocaleString(\'pt-BR\', {minimumFractionDigits: 2})}</h3>',
    '<h3 className="text-xl lg:text-2xl font-extrabold bg-gradient-to-r from-purple-700 to-pink-800 bg-clip-text text-transparent truncate w-[120px]" title={`R$ ${totalValorFaturas.toLocaleString(\'pt-BR\', {minimumFractionDigits: 2})}`}>R$ {totalValorFaturas.toLocaleString(\'pt-BR\', {minimumFractionDigits: 2})}</h3>'
);

// 3. Inject Auto Consumo Bar and Breakdowns in mappedUcs
const oldCol2 = `                                    <div className="w-[50%] px-4 border-l border-gray-100 flex flex-col justify-center space-y-4">
                                        {/* Primeira Barra: Compensado vs Injetado */}
                                        <div className="flex items-center group/bar cursor-default w-full">`;

const newCol2 = `                                    <div className="w-[50%] px-4 border-l border-gray-100 flex flex-col justify-center space-y-4">
                                        {/* Auto Consumo Bar (Only UG) */}
                                        {uc.tipo === 'ug' && (
                                            <div className="flex items-center group/autoconsumo cursor-default w-full">
                                                <div className="flex flex-col items-end mr-3 min-w-[70px]">
                                                    <span className="text-[10px] uppercase font-bold text-red-500 mb-0.5 tracking-wider">Auto Consumo</span>
                                                    <span className="text-[13px] font-extrabold text-red-600 leading-none">{Math.max(0, geracaoExibida - injetado)} <span className="text-[10px] opacity-70">kWh</span></span>
                                                </div>
                                                <div className="flex-1 bg-gray-100/80 rounded-full h-4 flex overflow-hidden relative shadow-inner border border-gray-200">
                                                    <div 
                                                        style={{ width: \`\${geracaoExibida > 0 ? Math.min(100, (Math.max(0, geracaoExibida - injetado) / geracaoExibida) * 100) : 0}%\` }} 
                                                        className="bg-gradient-to-r from-red-400 to-red-500 h-full transition-all duration-1000 ease-out z-20 relative"
                                                    ></div>
                                                </div>
                                                <div className="flex flex-col items-start ml-3 min-w-[70px]">
                                                    <span className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 tracking-wider">Total Gerado</span>
                                                    <span className="text-[13px] font-extrabold text-gray-600 leading-none">{geracaoExibida} <span className="text-[10px] opacity-70">kWh</span></span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Primeira Barra: Compensado vs Injetado */}
                                        <div className="flex items-center group/bar cursor-default w-full">`;

content = content.replace(oldCol2, newCol2);

// Inject Fio B text after Compensado width div
const oldCompBar = `                                                <div 
                                                    style={{ width: \`\${totalInjetado > 0 ? Math.min(100, (compensado / totalInjetado) * 100) : 0}%\` }} 
                                                    className="bg-gradient-to-r from-blue-400 to-blue-500 h-full transition-all duration-1000 ease-out z-20 relative"
                                                ></div>`;

const newCompBar = `                                                <div 
                                                    style={{ width: \`\${totalInjetado > 0 ? Math.min(100, (compensado / totalInjetado) * 100) : 0}%\` }} 
                                                    className="bg-gradient-to-r from-blue-400 to-blue-500 h-full transition-all duration-1000 ease-out z-20 relative flex items-center justify-end pr-1"
                                                >
                                                    {conta && conta.fio_b_vr_unit && compensado > 0 && (
                                                        <span className="text-[8px] font-bold text-white whitespace-nowrap overflow-hidden opacity-90">Fio B: R$ {(compensado * Number(conta.fio_b_vr_unit)).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                                                    )}
                                                </div>`;
content = content.replace(oldCompBar, newCompBar);

// Inject Breakdown blocks
const oldCol3 = `                                    <div className="w-[30%] pl-6 flex items-center justify-end space-x-4">
                                        {/* Valores Auditados e OCR */}
                                        {conta && (
                                            <div className="flex flex-col items-end mr-4">`;

const newCol3 = `                                    <div className="w-[30%] pl-4 flex items-center justify-end space-x-2">
                                        {/* Breakdown Blocks */}
                                        {conta && (
                                            <div className="flex space-x-2 mr-2">
                                                {/* Fatura Block */}
                                                <div className="border border-gray-200 rounded-lg p-2 w-[120px] bg-white flex flex-col justify-between">
                                                    <span className="text-[9px] font-bold text-gray-500 uppercase text-center border-b border-gray-100 pb-1 mb-1">Fatura (Lido)</span>
                                                    <div className="flex justify-between text-[8px] text-gray-600"><span className="truncate w-12" title="Consumo">Cons.</span> <span className="font-semibold">{Number(conta.consumo_reais || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                    <div className="flex justify-between text-[8px] text-gray-600"><span className="truncate w-12" title="Fio B">Fio B</span> <span className="font-semibold">{Number(conta.fio_b_total || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                    <div className="flex justify-between text-[8px] text-gray-600"><span className="truncate w-12" title="Ilum. Pub.">Ilum.</span> <span className="font-semibold">{Number(conta.iluminacao_publica || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                    <div className="flex justify-between text-[8px] text-gray-600"><span className="truncate w-12" title="Outros/Parc">Outros</span> <span className="font-semibold">{(Number(conta.parcelamento || 0) + Number(conta.outros_lancamentos || 0)).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                </div>

                                                {/* Auditado Block */}
                                                {(() => {
                                                    const fioBCorreto = compensado * Number(conta.fio_b_vr_unit || 0);
                                                    const ilumCorreto = Number(conta.iluminacao_publica || 0);
                                                    const outrosCorreto = Number(conta.parcelamento || 0) + Number(conta.outros_lancamentos || 0);
                                                    const consumoCorreto = Math.max(0, valorAuditado - (fioBCorreto + ilumCorreto + outrosCorreto));
                                                    
                                                    return (
                                                        <div className="border border-emerald-200 rounded-lg p-2 w-[120px] bg-emerald-50/30 flex flex-col justify-between shadow-sm">
                                                            <span className="text-[9px] font-bold text-emerald-600 uppercase text-center border-b border-emerald-100 pb-1 mb-1">Auditado (Calc)</span>
                                                            <div className="flex justify-between text-[8px] text-gray-700"><span className="truncate w-12" title="Consumo">Cons.</span> <span className="font-semibold text-emerald-700">{consumoCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                            <div className="flex justify-between text-[8px] text-gray-700"><span className="truncate w-12" title="Fio B">Fio B</span> <span className="font-semibold text-emerald-700">{fioBCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                            <div className="flex justify-between text-[8px] text-gray-700"><span className="truncate w-12" title="Ilum. Pub.">Ilum.</span> <span className="font-semibold text-emerald-700">{ilumCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                            <div className="flex justify-between text-[8px] text-gray-700"><span className="truncate w-12" title="Outros/Parc">Outros</span> <span className="font-semibold text-emerald-700">{outrosCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}

                                        {/* Valores Auditados e OCR */}
                                        {conta && (
                                            <div className="flex flex-col items-end mr-4">`;

content = content.replace(oldCol3, newCol3);

// 4. Alerts Summary in footer
// Add a footer after the mappedUcs list
const oldListEnd = `                    </div>
                </div>
            </div>
        );
    };`;

const newListEnd = `                    </div>
                    {/* Alertas Summary */}
                    {filteredContas.some(c => c.alertas && Array.isArray(c.alertas) && c.alertas.length > 0) && (
                        <div className="p-5 bg-orange-50/50 border-t border-orange-100">
                            <h4 className="text-sm font-bold text-orange-700 flex items-center mb-3">
                                <AlertCircle className="w-4 h-4 mr-2" /> Resumo de Divergências (Auditoria)
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {mappedUcs.filter(m => m.conta && m.conta.alertas && Array.isArray(m.conta.alertas) && m.conta.alertas.length > 0).map(m => (
                                    <div key={m.uc.id} className="bg-white border border-orange-200 rounded-lg p-3 shadow-sm">
                                        <h5 className="text-xs font-bold text-gray-800 mb-2 border-b border-gray-100 pb-1">{m.uc.numero_uc} - {m.uc.tipo === 'ug' ? 'Geradora' : 'Consumidora'}</h5>
                                        <ul className="space-y-1">
                                            {m.conta.alertas.map((al, idx) => (
                                                <li key={idx} className="text-[10px] text-gray-600 flex items-start">
                                                    <span className="text-orange-500 mr-1.5 mt-0.5">•</span> 
                                                    <span>{typeof al === 'string' ? al : (al.message || JSON.stringify(al))}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };`;

content = content.replace(oldListEnd, newListEnd);


fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAnalysis.jsx updated with Auto Consumo, Fio B, and Audit blocks.');
