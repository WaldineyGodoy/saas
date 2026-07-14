const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneAnalysis.jsx';
let content = fs.readFileSync(path, 'utf8');

// Update Totals Calculation
const oldTotals = `        // Totals
        let totalInjetado = 0;
        let totalCompensado = 0;

        filteredContas.forEach(c => {
            const isUg = ucs.find(u => u.id === c.uc_id)?.tipo === 'ug';
            if (isUg) totalInjetado += Number(c.energia_injetada || 0);
            totalCompensado += Number(c.energia_compensada || 0);
        });`;

const newTotals = `        // Totals
        let totalInjetado = 0;
        let totalCompensado = 0;
        let totalValorOcr = 0;
        let totalValorAuditado = 0;

        filteredContas.forEach(c => {
            const isUg = ucs.find(u => u.id === c.uc_id)?.tipo === 'ug';
            if (isUg) totalInjetado += Number(c.energia_injetada || 0);
            totalCompensado += Number(c.energia_compensada || 0);
            totalValorOcr += Number(c.valor_concessionaria || 0);
            totalValorAuditado += Number(c.valor_auditado || 0);
        });`;

content = content.replace(oldTotals, newTotals);

// Update Grid and Add Card
const oldGrid = `        return (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">`;

const newGrid = `        return (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">`;

content = content.replace(oldGrid, newGrid);

// Add Card after Saldo no Ciclo
const oldSaldoCard = `                        <div className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-orange-100 flex items-center hover:shadow-md transition-all">
                            <div className="bg-gradient-to-br from-orange-400 to-red-500 p-4 rounded-xl mr-5 shadow-inner shadow-orange-700/20 text-white">
                                <LayoutDashboard className="w-7 h-7"/>
                            </div>
                            <div>
                                <p className="text-[10px] text-orange-600/80 font-bold uppercase tracking-wider mb-1">Saldo no Ciclo</p>
                                <h3 className="text-2xl font-extrabold bg-gradient-to-r from-orange-600 to-red-700 bg-clip-text text-transparent">{totalSaldo.toLocaleString('pt-BR')} <span className="text-xs font-semibold text-gray-400">kWh</span></h3>
                            </div>
                        </div>
                    </div>`;

const newSaldoCard = `                        <div className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-orange-100 flex items-center hover:shadow-md transition-all">
                            <div className="bg-gradient-to-br from-orange-400 to-red-500 p-4 rounded-xl mr-5 shadow-inner shadow-orange-700/20 text-white">
                                <LayoutDashboard className="w-7 h-7"/>
                            </div>
                            <div>
                                <p className="text-[10px] text-orange-600/80 font-bold uppercase tracking-wider mb-1">Saldo no Ciclo</p>
                                <h3 className="text-2xl font-extrabold bg-gradient-to-r from-orange-600 to-red-700 bg-clip-text text-transparent">{totalSaldo.toLocaleString('pt-BR')} <span className="text-xs font-semibold text-gray-400">kWh</span></h3>
                            </div>
                        </div>
                    </div>

                    <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-pink-400 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
                        <div className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-purple-100 flex items-center hover:shadow-md transition-all">
                            <div className="bg-gradient-to-br from-purple-400 to-pink-500 p-4 rounded-xl mr-5 shadow-inner shadow-purple-700/20 text-white">
                                <FileText className="w-7 h-7"/>
                            </div>
                            <div>
                                <p className="text-[10px] text-purple-600/80 font-bold uppercase tracking-wider mb-1">Total Faturas</p>
                                <h3 className="text-2xl font-extrabold bg-gradient-to-r from-purple-700 to-pink-800 bg-clip-text text-transparent">R$ {totalValorAuditado.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h3>
                            </div>
                        </div>
                    </div>`;

content = content.replace(oldSaldoCard, newSaldoCard);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAnalysis.jsx updated with 4th card.');
