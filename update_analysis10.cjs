const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneAnalysis.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Reorganize top cards to vertical layout
const cardsReplace = [
    {
        old: `<div className="relative bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-sm border border-blue-100 flex items-center hover:shadow-md transition-all h-full">
                            <div className="bg-gradient-to-br from-blue-400 to-indigo-500 p-3 rounded-xl mr-4 shadow-inner shadow-blue-700/20 text-white">
                                <Activity className="w-6 h-6"/>
                            </div>
                            <div>
                                <div className="flex items-center space-x-2 mb-0.5">
                                    <p className="text-[10px] text-blue-600/80 font-bold uppercase tracking-wider">
                                        {isAferida ? 'Geração Aferida' : 'Geração Estimada'}
                                    </p>
                                    {isAferida && <span className="bg-emerald-100 text-emerald-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Real</span>}
                                    {!isAferida && geracaoExibida > 0 && <span className="bg-gray-100 text-gray-500 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Teórica</span>}
                                </div>
                                <h3 className="text-xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-700 bg-clip-text text-transparent flex items-center gap-2">
                                    {geracaoExibida > 0 ? geracaoExibida.toLocaleString('pt-BR') : '--'} <span className="text-[10px] font-semibold text-gray-400">kWh</span>
                                </h3>
                                {showLowGenerationAlert && (
                                    <div className="flex items-center text-[9px] font-bold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded mt-1 mt-0.5">
                                        <AlertCircle className="w-3 h-3 mr-1"/> Baixa Geração (Estimado: {geracaoEstimada})
                                    </div>
                                )}
                                {geracaoExibida > 0 && totalInjetado > 0 && !showLowGenerationAlert && (
                                    <p className="text-[10px] font-semibold mt-1">
                                        PR: <span className={totalInjetado >= geracaoExibida ? 'text-emerald-600' : 'text-red-500'}>
                                            {((totalInjetado / geracaoExibida) * 100).toFixed(1)}%
                                        </span>
                                    </p>
                                )}
                            </div>
                        </div>`,
        new: `<div className="relative bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-sm border border-blue-100 flex flex-col items-center justify-between text-center hover:shadow-md transition-all h-full">
                            <div className="flex flex-col items-center space-y-1 mb-2">
                                <p className="text-[10px] text-blue-600/80 font-bold uppercase tracking-wider">
                                    {isAferida ? 'Geração Aferida' : 'Geração Estimada'}
                                </p>
                                <div className="flex space-x-1">
                                    {isAferida && <span className="bg-emerald-100 text-emerald-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Real</span>}
                                    {!isAferida && geracaoExibida > 0 && <span className="bg-gray-100 text-gray-500 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Teórica</span>}
                                </div>
                            </div>
                            <div className="bg-gradient-to-br from-blue-400 to-indigo-500 p-3 rounded-xl shadow-inner shadow-blue-700/20 text-white mb-2">
                                <Activity className="w-6 h-6"/>
                            </div>
                            <div className="flex flex-col items-center">
                                <h3 className="text-xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-700 bg-clip-text text-transparent flex items-center gap-1 justify-center">
                                    {geracaoExibida > 0 ? geracaoExibida.toLocaleString('pt-BR') : '--'} <span className="text-[10px] font-semibold text-gray-400 mt-1">kWh</span>
                                </h3>
                                {showLowGenerationAlert && (
                                    <div className="flex items-center text-[9px] font-bold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded mt-1">
                                        <AlertCircle className="w-3 h-3 mr-1"/> Baixa (Est: {geracaoEstimada})
                                    </div>
                                )}
                                {geracaoExibida > 0 && totalInjetado > 0 && !showLowGenerationAlert && (
                                    <p className="text-[10px] font-semibold mt-1">
                                        PR: <span className={totalInjetado >= geracaoExibida ? 'text-emerald-600' : 'text-red-500'}>
                                            {((totalInjetado / geracaoExibida) * 100).toFixed(1)}%
                                        </span>
                                    </p>
                                )}
                            </div>
                        </div>`
    },
    {
        old: `<div className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-emerald-100 flex items-center hover:shadow-md transition-all h-full">
                            <div className="bg-gradient-to-br from-emerald-400 to-emerald-600 p-4 rounded-xl mr-5 shadow-inner shadow-emerald-700/20 text-white">
                                <Zap className="w-7 h-7"/>
                            </div>
                            <div>
                                <p className="text-[10px] text-emerald-600/80 font-bold uppercase tracking-wider mb-1">Energia Injetada</p>
                                <h3 className="text-2xl font-extrabold bg-gradient-to-r from-emerald-700 to-teal-800 bg-clip-text text-transparent">{totalInjetado.toLocaleString('pt-BR')} <span className="text-xs font-semibold text-gray-400">kWh</span></h3>
                            </div>
                        </div>`,
        new: `<div className="relative bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-sm border border-emerald-100 flex flex-col items-center justify-between text-center hover:shadow-md transition-all h-full">
                            <p className="text-[10px] text-emerald-600/80 font-bold uppercase tracking-wider mb-2">Energia Injetada</p>
                            <div className="bg-gradient-to-br from-emerald-400 to-emerald-600 p-3 rounded-xl shadow-inner shadow-emerald-700/20 text-white mb-2">
                                <Zap className="w-6 h-6"/>
                            </div>
                            <h3 className="text-xl font-extrabold bg-gradient-to-r from-emerald-700 to-teal-800 bg-clip-text text-transparent flex items-end gap-1 justify-center">{totalInjetado.toLocaleString('pt-BR')} <span className="text-[10px] font-semibold text-gray-400 mb-1">kWh</span></h3>
                        </div>`
    },
    {
        old: `<div className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-blue-100 flex items-center hover:shadow-md transition-all h-full">
                            <div className="bg-gradient-to-br from-blue-400 to-blue-600 p-4 rounded-xl mr-5 shadow-inner shadow-blue-700/20 text-white">
                                <Activity className="w-7 h-7"/>
                            </div>
                            <div>
                                <p className="text-[10px] text-blue-600/80 font-bold uppercase tracking-wider mb-1">Energia Compensada</p>
                                <h3 className="text-2xl font-extrabold bg-gradient-to-r from-blue-700 to-indigo-800 bg-clip-text text-transparent">{totalCompensado.toLocaleString('pt-BR')} <span className="text-xs font-semibold text-gray-400">kWh</span></h3>
                            </div>
                        </div>`,
        new: `<div className="relative bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-sm border border-blue-100 flex flex-col items-center justify-between text-center hover:shadow-md transition-all h-full">
                            <p className="text-[10px] text-blue-600/80 font-bold uppercase tracking-wider mb-2">Energia Compensada</p>
                            <div className="bg-gradient-to-br from-blue-400 to-blue-600 p-3 rounded-xl shadow-inner shadow-blue-700/20 text-white mb-2">
                                <Activity className="w-6 h-6"/>
                            </div>
                            <h3 className="text-xl font-extrabold bg-gradient-to-r from-blue-700 to-indigo-800 bg-clip-text text-transparent flex items-end gap-1 justify-center">{totalCompensado.toLocaleString('pt-BR')} <span className="text-[10px] font-semibold text-gray-400 mb-1">kWh</span></h3>
                        </div>`
    },
    {
        old: `<div className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-orange-100 flex items-center hover:shadow-md transition-all h-full">
                            <div className="bg-gradient-to-br from-orange-400 to-red-500 p-4 rounded-xl mr-5 shadow-inner shadow-orange-700/20 text-white">
                                <LayoutDashboard className="w-7 h-7"/>
                            </div>
                            <div>
                                <p className="text-[10px] text-orange-600/80 font-bold uppercase tracking-wider mb-1">Saldo no Ciclo</p>
                                <h3 className="text-2xl font-extrabold bg-gradient-to-r from-orange-600 to-red-700 bg-clip-text text-transparent">{totalSaldo.toLocaleString('pt-BR')} <span className="text-xs font-semibold text-gray-400">kWh</span></h3>
                            </div>
                        </div>`,
        new: `<div className="relative bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-sm border border-orange-100 flex flex-col items-center justify-between text-center hover:shadow-md transition-all h-full">
                            <p className="text-[10px] text-orange-600/80 font-bold uppercase tracking-wider mb-2">Saldo no Ciclo</p>
                            <div className="bg-gradient-to-br from-orange-400 to-red-500 p-3 rounded-xl shadow-inner shadow-orange-700/20 text-white mb-2">
                                <LayoutDashboard className="w-6 h-6"/>
                            </div>
                            <h3 className="text-xl font-extrabold bg-gradient-to-r from-orange-600 to-red-700 bg-clip-text text-transparent flex items-end gap-1 justify-center">{totalSaldo.toLocaleString('pt-BR')} <span className="text-[10px] font-semibold text-gray-400 mb-1">kWh</span></h3>
                        </div>`
    },
    {
        old: `<div className="relative bg-white/80 backdrop-blur-sm p-6 rounded-2xl shadow-sm border border-purple-100 flex items-center hover:shadow-md transition-all h-full">
                            <div className="bg-gradient-to-br from-purple-400 to-pink-500 p-4 rounded-xl mr-5 shadow-inner shadow-purple-700/20 text-white">
                                <FileText className="w-7 h-7"/>
                            </div>
                            <div>
                                <p className="text-[10px] text-purple-600/80 font-bold uppercase tracking-wider mb-1">Total Faturas</p>
                                <h3 className="text-xl lg:text-2xl font-extrabold bg-gradient-to-r from-purple-700 to-pink-800 bg-clip-text text-transparent truncate w-[120px]" title={\`R$ \${totalValorFaturas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}\`}>R$ {totalValorFaturas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h3>
                            </div>
                        </div>`,
        new: `<div className="relative bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-sm border border-purple-100 flex flex-col items-center justify-between text-center hover:shadow-md transition-all h-full">
                            <p className="text-[10px] text-purple-600/80 font-bold uppercase tracking-wider mb-2">Total Faturas</p>
                            <div className="bg-gradient-to-br from-purple-400 to-pink-500 p-3 rounded-xl shadow-inner shadow-purple-700/20 text-white mb-2">
                                <FileText className="w-6 h-6"/>
                            </div>
                            <h3 className="text-xl font-extrabold bg-gradient-to-r from-purple-700 to-pink-800 bg-clip-text text-transparent truncate w-full text-center px-2" title={\`R$ \${totalValorFaturas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}\`}>R$ {totalValorFaturas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h3>
                        </div>`
    }
];

cardsReplace.forEach(c => {
    content = content.replace(c.old, c.new);
});

// 2. Fio B text inside blue bar (Yellow color + R$)
content = content.replace(
    `<span className="text-[8px] font-bold text-white whitespace-nowrap overflow-hidden opacity-90">Fio B: R$ {(compensado * Number(conta.fio_b_vr_unit)).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`,
    `<span className="text-[9px] font-black text-yellow-300 drop-shadow-md whitespace-nowrap overflow-hidden z-30 tracking-wider">Fio B R$ {(compensado * Number(conta.fio_b_vr_unit)).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`
);

// 3. Move Totals (Fatura OCR & Auditado) below the Breakdown Blocks
const oldCol3 = `                                    <div className="w-[30%] pl-4 flex items-center justify-end space-x-2">
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
                                            <div className="flex flex-col items-end mr-4">
                                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Fatura (OCR)</span>
                                                <span className="text-xs font-bold text-gray-600 mb-1">R$ {valorOcr.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                                                <span className={\`text-[9px] font-bold uppercase tracking-widest \${statusAuditoria === 'contestado' ? 'text-red-500' : 'text-emerald-500'}\`}>
                                                    {statusAuditoria === 'contestado' ? 'Contestado' : 'Auditado'}
                                                </span>
                                                <span className={\`text-sm font-extrabold \${statusAuditoria === 'contestado' ? 'text-red-600' : 'text-emerald-600'}\`}>
                                                    R$ {valorAuditado.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                                </span>
                                            </div>
                                        )}
                                        
                                        <div className="flex flex-col space-y-2">
                                            <button 
                                                onClick={() => setEditContaModal(conta)}
                                                className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                                title="Editar Valores Manuais"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    setDeleteModal({
                                                        id: conta.id,
                                                        type: 'conta',
                                                        title: 'Excluir Leitura',
                                                        message: 'Tem certeza que deseja excluir esta fatura? Isso removerá a conta da análise deste ciclo.'
                                                    });
                                                }}
                                                className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                                title="Excluir Fatura"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>`;

const newCol3 = `                                    <div className="w-[30%] pl-4 flex items-start justify-end space-x-3">
                                        {/* Breakdown Blocks & Totals (Col) */}
                                        {conta && (
                                            <div className="flex space-x-3 mr-2">
                                                {/* Coluna Fatura (Lido) */}
                                                <div className="flex flex-col items-center">
                                                    <div className="border border-gray-200 rounded-lg p-2 w-[120px] bg-white flex flex-col justify-between shadow-sm mb-2">
                                                        <span className="text-[9px] font-bold text-gray-500 uppercase text-center border-b border-gray-100 pb-1 mb-1">Fatura (Lido)</span>
                                                        <div className="flex justify-between text-[8px] text-gray-600"><span className="truncate w-12" title="Consumo">Cons.</span> <span className="font-semibold">{Number(conta.consumo_reais || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                        <div className="flex justify-between text-[8px] text-gray-600"><span className="truncate w-12" title="Fio B">Fio B</span> <span className="font-semibold">{Number(conta.fio_b_total || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                        <div className="flex justify-between text-[8px] text-gray-600"><span className="truncate w-12" title="Ilum. Pub.">Ilum.</span> <span className="font-semibold">{Number(conta.iluminacao_publica || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                        <div className="flex justify-between text-[8px] text-gray-600"><span className="truncate w-12" title="Outros/Parc">Outros</span> <span className="font-semibold">{(Number(conta.parcelamento || 0) + Number(conta.outros_lancamentos || 0)).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                    </div>
                                                    
                                                    {/* Total Fatura */}
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Fatura (OCR)</span>
                                                        <span className="text-xs font-bold text-gray-600">R$ {valorOcr.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                                                    </div>
                                                </div>

                                                {/* Coluna Auditado (Calc) */}
                                                {(() => {
                                                    const fioBCorreto = compensado * Number(conta.fio_b_vr_unit || 0);
                                                    const ilumCorreto = Number(conta.iluminacao_publica || 0);
                                                    const outrosCorreto = Number(conta.parcelamento || 0) + Number(conta.outros_lancamentos || 0);
                                                    const consumoCorreto = Math.max(0, valorAuditado - (fioBCorreto + ilumCorreto + outrosCorreto));
                                                    
                                                    return (
                                                        <div className="flex flex-col items-center">
                                                            <div className="border border-emerald-200 rounded-lg p-2 w-[120px] bg-emerald-50/30 flex flex-col justify-between shadow-sm mb-2">
                                                                <span className="text-[9px] font-bold text-emerald-600 uppercase text-center border-b border-emerald-100 pb-1 mb-1">Auditado (Calc)</span>
                                                                <div className="flex justify-between text-[8px] text-gray-700"><span className="truncate w-12" title="Consumo">Cons.</span> <span className="font-semibold text-emerald-700">{consumoCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                                <div className="flex justify-between text-[8px] text-gray-700"><span className="truncate w-12" title="Fio B">Fio B</span> <span className="font-semibold text-emerald-700">{fioBCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                                <div className="flex justify-between text-[8px] text-gray-700"><span className="truncate w-12" title="Ilum. Pub.">Ilum.</span> <span className="font-semibold text-emerald-700">{ilumCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                                <div className="flex justify-between text-[8px] text-gray-700"><span className="truncate w-12" title="Outros/Parc">Outros</span> <span className="font-semibold text-emerald-700">{outrosCorreto.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span></div>
                                                            </div>
                                                            
                                                            {/* Total Auditado */}
                                                            <div className="flex flex-col items-center">
                                                                <span className={\`text-[9px] font-bold uppercase tracking-widest \${statusAuditoria === 'contestado' ? 'text-red-500' : 'text-emerald-500'} mb-0.5\`}>
                                                                    {statusAuditoria === 'contestado' ? 'Contestado' : 'Auditado'}
                                                                </span>
                                                                <span className={\`text-xs font-extrabold \${statusAuditoria === 'contestado' ? 'text-red-600' : 'text-emerald-600'}\`}>
                                                                    R$ {valorAuditado.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                        
                                        <div className="flex flex-col space-y-2 mt-1">
                                            <button 
                                                onClick={() => setEditContaModal(conta)}
                                                className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                                title="Editar Valores Manuais"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    setDeleteModal({
                                                        id: conta.id,
                                                        type: 'conta',
                                                        title: 'Excluir Leitura',
                                                        message: 'Tem certeza que deseja excluir esta fatura? Isso removerá a conta da análise deste ciclo.'
                                                    });
                                                }}
                                                className="p-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                                title="Excluir Fatura"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>`;

content = content.replace(oldCol3, newCol3);


fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAnalysis.jsx layout updated.');
