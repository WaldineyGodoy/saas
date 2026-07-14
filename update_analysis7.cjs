const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneAnalysis.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add irradianciaInfo state
const oldState = `    const [usinaInfo, setUsinaInfo] = useState(null);
    const [ucs, setUcs] = useState([]);
    const [contas, setContas] = useState([]);
    const [cycles, setCycles] = useState([]);
    const [selectedCycleId, setSelectedCycleId] = useState('all');
    const [loading, setLoading] = useState(true);`;
    
const newState = `    const [usinaInfo, setUsinaInfo] = useState(null);
    const [irradianciaInfo, setIrradianciaInfo] = useState(null);
    const [ucs, setUcs] = useState([]);
    const [contas, setContas] = useState([]);
    const [cycles, setCycles] = useState([]);
    const [selectedCycleId, setSelectedCycleId] = useState('all');
    const [loading, setLoading] = useState(true);`;
content = content.replace(oldState, newState);

// 2. Fetch irradiance in loadData
const oldLoadData = `            const { data: usinaData } = await supabase.from('standalone_usinas').select('*').eq('id', selectedUsinaId).single();
            setUsinaInfo(usinaData);`;

const newLoadData = `            const { data: usinaData } = await supabase.from('standalone_usinas').select('*').eq('id', selectedUsinaId).single();
            setUsinaInfo(usinaData);
            
            if (usinaData && usinaData.ibge_code) {
                const { data: irrData } = await supabase.from('irradiancia').select('*').eq('"cod.ibge"', usinaData.ibge_code).single();
                setIrradianciaInfo(irrData);
            } else {
                setIrradianciaInfo(null);
            }`;
content = content.replace(oldLoadData, newLoadData);

// 3. Calculate geracaoEstimada and add Card in renderDashboard
const oldTotals = `        // Totals
        let totalInjetado = 0;
        let totalCompensado = 0;
        let totalValorFaturas = 0;`;

const newTotals = `        // Month Keys for Irradiance
        const irrKeys = ['jan.khw', 'fev.khw', 'mar.kwh', 'abr.kwh', 'mai.kwh', 'jun.kwh', 'jul.kwh', 'ago.kwh', 'set.kwh', 'out.kwh', 'nov.kwh', 'dez.khw'];
        
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
        }

        // Totals
        let totalInjetado = 0;
        let totalCompensado = 0;
        let totalValorFaturas = 0;`;
content = content.replace(oldTotals, newTotals);

const oldGrid = `        return (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">`;

const newGrid = `        return (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Dashboard Stats */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    {/* Geração Estimada Card */}
                    <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-400 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
                        <div className="relative bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-sm border border-blue-100 flex items-center hover:shadow-md transition-all">
                            <div className="bg-gradient-to-br from-blue-400 to-indigo-500 p-3 rounded-xl mr-4 shadow-inner shadow-blue-700/20 text-white">
                                <Activity className="w-6 h-6"/>
                            </div>
                            <div>
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
                            </div>
                        </div>
                    </div>`;

content = content.replace(oldGrid, newGrid);

// Because I changed md:grid-cols-4 to md:grid-cols-5, the rest of the cards will adapt nicely.
// Wait! `Activity` icon is used but maybe not imported?
// Let's add Activity to imports if it's not there.
if (!content.includes('Activity')) {
    content = content.replace('import { LayoutDashboard, Plus, Zap, AlertCircle', 'import { LayoutDashboard, Plus, Zap, AlertCircle, Activity');
}

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAnalysis.jsx updated with geracao estimada logic.');
