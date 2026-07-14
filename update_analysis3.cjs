const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneAnalysis.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add totalCompensadoAteAqui logic in mappedUcs
const oldMapStart = `        let currentCascadeBalance = 0;
        const mappedUcs = sortedUcs.map(uc => {
            const conta = filteredContas.find(c => c.uc_id === uc.id);`;

const newMapStart = `        let currentCascadeBalance = 0;
        let totalCompensadoAteAqui = 0;
        const mappedUcs = sortedUcs.map(uc => {
            const conta = filteredContas.find(c => c.uc_id === uc.id);`;

content = content.replace(oldMapStart, newMapStart);

// 2. Add totalCompensadoAteAqui accumulation
const oldMapReturn = `            return { uc, conta, compensado, consumo, injetado, uncompensated, saldo: saldoCascata, saldoAnterior, dataLeitura, valorOcr, valorAuditado, statusAuditoria, hasAlerts };
        });`;

const newMapReturn = `            totalCompensadoAteAqui += compensado;

            return { uc, conta, compensado, consumo, injetado, uncompensated, saldo: saldoCascata, saldoAnterior, dataLeitura, valorOcr, valorAuditado, statusAuditoria, hasAlerts, totalCompensadoAteAqui };
        });`;

content = content.replace(oldMapReturn, newMapReturn);

// 3. Update map render loop destructuring
const oldDestructure = `{mappedUcs.map(({ uc, conta, compensado, consumo, injetado, uncompensated, saldo, saldoAnterior, dataLeitura, valorOcr, valorAuditado, statusAuditoria, hasAlerts }) => {`;

const newDestructure = `{mappedUcs.map(({ uc, conta, compensado, consumo, injetado, uncompensated, saldo, saldoAnterior, dataLeitura, valorOcr, valorAuditado, statusAuditoria, hasAlerts, totalCompensadoAteAqui }) => {`;

content = content.replace(oldDestructure, newDestructure);

// 4. Update UI block to include second progress bar
const oldBarUI = `                                    <div className="w-[50%] px-4 border-l border-gray-100 flex flex-col justify-center">
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

const newBarUI = `                                    <div className="w-[50%] px-4 border-l border-gray-100 flex flex-col justify-center space-y-4">
                                        {/* Primeira Barra: Compensado vs Saldo */}
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

                                        {/* Segunda Barra: Total Compensado vs Injetado */}
                                        {totalInjetado > 0 && (
                                            <div className="flex items-center group/bar2 cursor-default w-full">
                                                <div className="flex flex-col items-end mr-3 min-w-[70px]">
                                                    <span className="text-[10px] uppercase font-bold text-red-500 mb-0.5 tracking-wider">Total</span>
                                                    <span className="text-[13px] font-extrabold text-red-600 leading-none">{totalCompensadoAteAqui}</span>
                                                </div>

                                                <div className="flex-1 rounded-sm h-4 flex relative border border-red-500 bg-white shadow-sm overflow-hidden p-0.5">
                                                    <div 
                                                        style={{ width: \`\${Math.min(100, (totalCompensadoAteAqui / totalInjetado) * 100)}%\` }} 
                                                        className="bg-gradient-to-r from-orange-400 to-orange-500 h-full transition-all duration-1000 ease-out"
                                                    ></div>
                                                </div>
                                                
                                                <div className="flex flex-col items-start ml-3 min-w-[70px]">
                                                    <span className="text-[10px] uppercase font-bold text-red-500 mb-0.5 tracking-wider">Injetado</span>
                                                    <span className="text-[13px] font-extrabold text-red-600 leading-none">{totalInjetado}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>`;

content = content.replace(oldBarUI, newBarUI);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAnalysis.jsx updated with second bar.');
