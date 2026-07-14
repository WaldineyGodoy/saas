const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneAnalysis.jsx';
let content = fs.readFileSync(path, 'utf8');

const oldTotals = `        let totalInjetado = 0;
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

const newTotals = `        let totalInjetado = 0;
        let totalCompensado = 0;
        let totalValorFaturas = 0;

        filteredContas.forEach(c => {
            const isUg = ucs.find(u => u.id === c.uc_id)?.tipo === 'ug';
            if (isUg) totalInjetado += Number(c.energia_injetada || 0);
            totalCompensado += Number(c.energia_compensada || 0);
            
            const vOcr = Number(c.valor_concessionaria || 0);
            const vAud = Number(c.valor_auditado || 0);
            // Se tiver valor auditado, usa ele. Se não, usa o OCR para não ficar zerado.
            totalValorFaturas += vAud > 0 ? vAud : vOcr;
        });`;

content = content.replace(oldTotals, newTotals);

const oldCard = `                            <div>
                                <p className="text-[10px] text-purple-600/80 font-bold uppercase tracking-wider mb-1">Total Faturas</p>
                                <h3 className="text-2xl font-extrabold bg-gradient-to-r from-purple-700 to-pink-800 bg-clip-text text-transparent">R$ {totalValorAuditado.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h3>
                            </div>`;

const newCard = `                            <div>
                                <p className="text-[10px] text-purple-600/80 font-bold uppercase tracking-wider mb-1">Total Faturas</p>
                                <h3 className="text-2xl font-extrabold bg-gradient-to-r from-purple-700 to-pink-800 bg-clip-text text-transparent">R$ {totalValorFaturas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h3>
                            </div>`;

content = content.replace(oldCard, newCard);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAnalysis.jsx updated with smart sum.');
