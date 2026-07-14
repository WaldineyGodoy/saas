const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneAnalysis.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Replace the sortedUcs.map inside the render with a pre-calculation
const currentMapLogic = `                    <div className="divide-y divide-gray-100/80">
                        {sortedUcs.map(uc => {
                            // Find conta for this UC in the cycle
                            const conta = filteredContas.find(c => c.uc_id === uc.id);
                            const compensado = conta ? Number(conta.energia_compensada || 0) : 0;
                            const injetado = conta && uc.tipo === 'ug' ? Number(conta.energia_injetada || 0) : 0;
                            // Saldo da UG é Injetado - Compensado
                            const saldo = uc.tipo === 'ug' ? Math.max(0, injetado - compensado) : (conta ? Number(conta.saldo_kwh || 0) : 0);
                            const hasAlerts = conta && conta.alertas && conta.alertas.length > 0;

                            // Calcular Saldo de Ciclos Anteriores
                            let saldoAnterior = 0;
                            if (cycle && selectedCycleId !== 'all') {
                                const contasAnteriores = contas.filter(c => {
                                    if (c.uc_id !== uc.id || !c.data_leitura) return false;
                                    const d = new Date(c.data_leitura);
                                    return d < cycle.startDate;
                                });
                                contasAnteriores.forEach(c => {
                                    if (uc.tipo === 'ug') {
                                        const inj = Number(c.energia_injetada || 0);
                                        const comp = Number(c.energia_compensada || 0);
                                        saldoAnterior += Math.max(0, inj - comp);
                                    } else {
                                        saldoAnterior += Number(c.saldo_kwh || 0);
                                    }
                                });
                            }`;

const preCalculation = `
        let currentCascadeBalance = 0;
        const mappedUcs = sortedUcs.map(uc => {
            const conta = filteredContas.find(c => c.uc_id === uc.id);
            const compensado = conta ? Number(conta.energia_compensada || 0) : 0;
            const injetado = conta && uc.tipo === 'ug' ? Number(conta.energia_injetada || 0) : 0;

            let saldoCascata = 0;
            if (uc.tipo === 'ug') {
                currentCascadeBalance += injetado;
                currentCascadeBalance -= compensado;
                saldoCascata = Math.max(0, currentCascadeBalance);
            } else {
                currentCascadeBalance -= compensado;
                saldoCascata = Math.max(0, currentCascadeBalance);
            }

            let saldoAnterior = 0;
            if (cycle && selectedCycleId !== 'all') {
                const contasAnteriores = contas.filter(c => {
                    if (c.uc_id !== uc.id || !c.data_leitura) return false;
                    const d = new Date(c.data_leitura);
                    return d < cycle.startDate;
                });
                contasAnteriores.forEach(c => {
                    if (uc.tipo === 'ug') {
                        const inj = Number(c.energia_injetada || 0);
                        const comp = Number(c.energia_compensada || 0);
                        saldoAnterior += Math.max(0, inj - comp);
                    } else {
                        saldoAnterior += Number(c.saldo_kwh || 0);
                    }
                });
            }

            const dataLeituraObj = conta?.data_leitura ? new Date(conta.data_leitura) : null;
            let dataLeitura = '';
            if (dataLeituraObj) {
                // Ensure date is shown as DD/MM without timezone shift bugs
                const d = dataLeituraObj.getUTCDate().toString().padStart(2, '0');
                const m = (dataLeituraObj.getUTCMonth() + 1).toString().padStart(2, '0');
                dataLeitura = \`\${d}/\${m}\`;
            }

            const valorOcr = conta ? Number(conta.valor_concessionaria || 0) : 0;
            const valorAuditado = conta ? Number(conta.valor_auditado || 0) : 0;
            const statusAuditoria = conta?.status_auditoria || '';
            const hasAlerts = conta && conta.alertas && conta.alertas.length > 0;

            return { uc, conta, compensado, injetado, saldo: saldoCascata, saldoAnterior, dataLeitura, valorOcr, valorAuditado, statusAuditoria, hasAlerts };
        });

        // Find max values for progress bar scaling
        let maxVal = Math.max(totalInjetado, 1);
        mappedUcs.forEach(c => {
            if (c.compensado > maxVal) maxVal = c.compensado;
            if (c.saldo > maxVal) maxVal = c.saldo;
        });

        return (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">`;

// Replace the return up to the maxVal calculation with our pre-calculation
content = content.replace(/        \/\/ Find max values for progress bar scaling[\s\S]*?duration-500">/, preCalculation);

// Now update the render map
const newMapRender = `                    <div className="divide-y divide-gray-100/80">
                        {mappedUcs.map(({ uc, conta, compensado, injetado, saldo, saldoAnterior, dataLeitura, valorOcr, valorAuditado, statusAuditoria, hasAlerts }) => {`;

content = content.replace(currentMapLogic, newMapRender);

// 2. Add Leitura Date to Tags
const oldTags = `{uc.tipo === 'uc' && usinaInfo.tipo_compensacao === 'prioridade' && <span className="bg-blue-50 px-2 py-0.5 rounded text-blue-600">Prio: {uc.prioridade}</span>}
                                            {uc.tipo === 'uc' && usinaInfo.tipo_compensacao === 'porcentagem' && <span className="bg-purple-50 px-2 py-0.5 rounded text-purple-600">Cota: {uc.porcentagem}%</span>}`;
const newTags = `{uc.tipo === 'uc' && usinaInfo.tipo_compensacao === 'prioridade' && <span className="bg-blue-50 px-2 py-0.5 rounded text-blue-600">Prio: {uc.prioridade} {dataLeitura && \`| \${dataLeitura}\`}</span>}
                                            {uc.tipo === 'uc' && usinaInfo.tipo_compensacao === 'porcentagem' && <span className="bg-purple-50 px-2 py-0.5 rounded text-purple-600">Cota: {uc.porcentagem}% {dataLeitura && \`| \${dataLeitura}\`}</span>}
                                            {uc.tipo === 'ug' && dataLeitura && <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">{dataLeitura}</span>}`;
content = content.replace(oldTags, newTags);

// 3. Add Auditoria Finance values to the right side
const oldRightSide = `{/* Saldo Anterior */}
                                        {saldoAnterior > 0 && (`;
const newRightSide = `{/* Valores Auditados e OCR */}
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
                                        
                                        {/* Saldo Anterior */}
                                        {saldoAnterior > 0 && (`
content = content.replace(oldRightSide, newRightSide);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAnalysis.jsx updated successfully.');
