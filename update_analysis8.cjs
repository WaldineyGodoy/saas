const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneAnalysis.jsx';
let content = fs.readFileSync(path, 'utf8');

const oldLogic = `        const irrKeys = ['jan.khw', 'fev.khw', 'mar.kwh', 'abr.kwh', 'mai.kwh', 'jun.kwh', 'jul.kwh', 'ago.kwh', 'set.kwh', 'out.kwh', 'nov.kwh', 'dez.khw'];
        
        let geracaoEstimada = 0;
        
        // Find UG conta in this cycle to determine month
        const ugConta = filteredContas.find(c => {
            const u = ucs.find(uc => uc.id === c.uc_id);
            return u && u.tipo === 'ug';
        });

        if (ugConta && ugConta.data_leitura && usinaInfo?.potencia_kwp && irradianciaInfo) {
            const dateObj = new Date(ugConta.data_leitura);
            const monthIdx = dateObj.getUTCMonth(); // 0 to 11
            const irrFactor = irradianciaInfo[irrKeys[monthIdx]];
            if (irrFactor) {
                geracaoEstimada = Math.round(Number(irrFactor) * Number(usinaInfo.potencia_kwp));
            }
        }`;

const newLogic = `        const irrKeys = ['jan.khw', 'fev.khw', 'mar.kwh', 'abr.kwh', 'mai.kwh', 'jun.kwh', 'jul.kwh', 'ago.kwh', 'set.kwh', 'out.kwh', 'nov.kwh', 'dez.khw'];
        
        let geracaoEstimada = 0;
        let geracaoAferida = null;
        let isAferida = false;
        let geracaoExibida = 0;
        let showLowGenerationAlert = false;
        
        // Find UG conta in this cycle to determine month
        const ugConta = filteredContas.find(c => {
            const u = ucs.find(uc => uc.id === c.uc_id);
            return u && u.tipo === 'ug';
        });

        if (ugConta && ugConta.data_leitura && usinaInfo?.potencia_kwp && irradianciaInfo) {
            const dateObj = new Date(ugConta.data_leitura);
            const monthIdx = dateObj.getUTCMonth(); // 0 to 11
            const yearStr = dateObj.getUTCFullYear().toString();
            
            const irrFactor = irradianciaInfo[irrKeys[monthIdx]];
            if (irrFactor) {
                geracaoEstimada = Math.round(Number(irrFactor) * Number(usinaInfo.potencia_kwp));
            }
            
            if (usinaInfo.geracao_aferida && usinaInfo.geracao_aferida[yearStr] && usinaInfo.geracao_aferida[yearStr][monthIdx] !== undefined && usinaInfo.geracao_aferida[yearStr][monthIdx] !== null) {
                geracaoAferida = Number(usinaInfo.geracao_aferida[yearStr][monthIdx]);
                isAferida = true;
                geracaoExibida = geracaoAferida;
                
                // Alert if aferida is more than 10% below estimada
                if (geracaoAferida < (geracaoEstimada * 0.9)) {
                    showLowGenerationAlert = true;
                }
            } else {
                geracaoExibida = geracaoEstimada;
            }
        }`;

content = content.replace(oldLogic, newLogic);

const oldCard = `                            <div>
                                <p className="text-[10px] text-blue-600/80 font-bold uppercase tracking-wider mb-0.5">Geração Estimada</p>
                                <h3 className="text-xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-700 bg-clip-text text-transparent">
                                    {geracaoEstimada > 0 ? geracaoEstimada.toLocaleString('pt-BR') : '--'} <span className="text-[10px] font-semibold text-gray-400">kWh</span>
                                </h3>
                                {geracaoEstimada > 0 && totalInjetado > 0 && (
                                    <p className="text-[10px] font-semibold mt-1">
                                        PR: <span className={totalInjetado >= geracaoEstimada ? 'text-emerald-600' : 'text-red-500'}>
                                            {((totalInjetado / geracaoEstimada) * 100).toFixed(1)}%
                                        </span>
                                    </p>
                                )}
                            </div>`;

const newCard = `                            <div>
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
                            </div>`;

content = content.replace(oldCard, newCard);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAnalysis.jsx updated.');
