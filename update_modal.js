const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/components/StandaloneAccountModal.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add CheckCircle icon
content = content.replace(
    "import { FileText, Calculator, Plus, X, Loader2, AlertCircle } from 'lucide-react';",
    "import { FileText, Calculator, Plus, X, Loader2, AlertCircle, CheckCircle } from 'lucide-react';"
);

// 2. Add expected tariffs states
content = content.replace(
    "const [alertas, setAlertas] = useState([]);",
    `const [alertas, setAlertas] = useState([]);
    const [expectedTariff, setExpectedTariff] = useState(0);
    const [expectedFioB, setExpectedFioB] = useState(0);
    const [calculatedAudit, setCalculatedAudit] = useState(0);`
);

// 3. Update formData reset
content = content.replace(
    "consumo_kwh: '', energia_injetada: '', energia_compensada: '', saldo_kwh: '', valor_concessionaria: '', numero_uc: '', pdf_url: ''",
    "consumo_kwh: '', energia_injetada: '', energia_compensada: '', saldo_kwh: '', valor_concessionaria: '', numero_uc: '', pdf_url: '', iluminacao_publica: '', outros_lancamentos: '', parcelamento: '', fio_b_vr_unit: '', fio_b_total: '', consumo_reais: '', valor_auditado: '', status_auditoria: 'pendente'"
);

// 4. Update extractedData in triggerUpload
const extractedDataStr = `
                    // Extrações adicionais
                    let fioBTotal = 0;
                    let fioBUnit = 0;
                    try {
                        let consumoTusdUnit = 0;
                        let compTusdUnit = 0;
                        let qtdCompTusd = 0;
                        const parseUnitValue = (v) => {
                            if (!v) return 0;
                            let cleaned = v.trim();
                            if (cleaned.includes(',')) cleaned = cleaned.replace(/\\./g, '').replace(',', '.');
                            else cleaned = cleaned.replace(',', '.');
                            return parseFloat(cleaned) || 0;
                        };
                        const consumoTusdMatches = [
                            cleanText.match(/Consumo[\\s-]*(?:Energia[\\s-]+)?TUSD[\\s-]*kWh\\s+([\\d.,]+)-?\\s+([\\d.,]+)-?\\s+([\\d.,]+)-?/i),
                            cleanText.match(/(?:Consumo[\\s-]*(?:Energia[\\s-]+)?TUSD|Uso[\\s-]+Sist\\.?[\\s-]+Distr\\.?).{0,20}?(?:kWh)?\\s*([\\d.,]+)-?\\s+([\\d.,]+)-?\\s+([\\d.,]+)-?/i)
                        ];
                        const consumoTusdExato = consumoTusdMatches.find(m => m);
                        if (consumoTusdExato) consumoTusdUnit = parseUnitValue(consumoTusdExato[2]);

                        const compGdMatches = [
                            cleanText.match(/(?:Energia[\\s-]+Compensada|Energia[\\s-]+Injetada|GX[\\s-]*COMP|GXCOMP|G\\dComp).{0,40}?(?:TUSD)?\\s*kWh\\s+([\\d.,]+)-?\\s+([\\d.,]+)-?\\s+([\\d.,]+)-?/i),
                            cleanText.match(/(?:Energia[\\s-]+Compensada|Energia[\\s-]+Injetada|GX[\\s-]*COMP|GXCOMP|G\\dComp)(?:(?!(?:LINHA|NOME|CNPJ)).){1,60}?([\\d.,]+)-?\\s+([\\d.,]+)-?\\s+([\\d.,]+)-?/is)
                        ];
                        const compGdMatch = compGdMatches.find(m => m);
                        if (compGdMatch) {
                            qtdCompTusd = parseConsumption(compGdMatch[1]);
                            compTusdUnit = parseUnitValue(compGdMatch[2]);
                        }
                        if (consumoTusdUnit > 0 && compTusdUnit > 0) {
                            const diff = consumoTusdUnit - compTusdUnit;
                            if (diff > 0.01 && diff < 0.50) { 
                                fioBUnit = diff;
                                const qtyFinal = extractedCompensado > 0 ? extractedCompensado : (qtdCompTusd || 0);
                                fioBTotal = diff * qtyFinal;
                            }
                        }
                    } catch(e) { console.warn('Erro Fio B local', e) }

                    const extractedData = {
                        mes_referencia: parsedData.mes_referencia ? parsedData.mes_referencia.substring(0, 7) : '',
                        data_leitura: parsedData.data_leitura ? parsedData.data_leitura.split('T')[0] : '',
                        data_leitura_anterior: parsedData.data_leitura_anterior ? parsedData.data_leitura_anterior.split('T')[0] : '',
                        vencimento: parsedData.vencimento ? parsedData.vencimento.split('T')[0] : '',
                        consumo_kwh: parsedData.consumo_kwh || 0,
                        energia_injetada: extractedInjetada || 0,
                        energia_compensada: extractedCompensado || 0,
                        saldo_kwh: extractedSaldo || 0,
                        valor_concessionaria: parsedData.valor_a_pagar || parsedData.valorTotal || 0,
                        numero_uc: extractedUcNumber || '',
                        iluminacao_publica: parsedData.iluminacao_publica || 0,
                        outros_lancamentos: parsedData.outros_lancamentos || 0,
                        parcelamento: parsedData.parcelamento || 0,
                        consumo_reais: parsedData.consumo_reais || (parsedData.valorTotal || 0),
                        fio_b_vr_unit: fioBUnit,
                        fio_b_total: fioBTotal,
                        status_auditoria: 'pendente'
                    };
`;
content = content.replace(
    /const extractedData = \{[\s\S]*?numero_uc: extractedUcNumber \|\| ''\n\s*\};\n/,
    extractedDataStr
);

// 5. Update UC matching block to fetch Tariff
const ucMatchingBlockStr = `if (extractedUcNumber) {
                        const { data: uc } = await supabase
                            .from('standalone_ucs')
                            .select('*')
                            .eq('numero_uc', extractedUcNumber)
                            .maybeSingle();

                        if (uc) {
                            setMatchedUc(uc);
                            // Busca tarifa na tabela Concessionaria do CRM
                            if (uc.concessionaria) {
                                const { data: tarifaData } = await supabase.from('Concessionaria').select('*').ilike('Concessionaria', \`%\${uc.concessionaria}%\`).limit(1).maybeSingle();
                                if (tarifaData) {
                                    const t = Number(tarifaData['Tarifa Concessionaria']) || 0;
                                    const fb = Number(tarifaData['Fio B']) || 0;
                                    setExpectedTariff(t);
                                    setExpectedFioB(fb);
                                }
                            }
                            setStep('sandbox');`;

content = content.replace(
    /if \(extractedUcNumber\) \{\s*const \{ data: uc \} = await supabase[\s\S]*?if \(uc\) \{\s*setMatchedUc\(uc\);\s*setStep\('sandbox'\);/,
    ucMatchingBlockStr
);

// 6. Update handleSaveInvoice to include new fields
const invoiceDataStr = `const invoiceData = {
                uc_id: matchedUc.id,
                mes_referencia: formData.mes_referencia,
                data_leitura: formData.data_leitura || null,
                data_leitura_anterior: formData.data_leitura_anterior || null,
                vencimento: formData.vencimento || null,
                consumo_kwh: formData.consumo_kwh,
                energia_injetada: formData.energia_injetada,
                energia_compensada: formData.energia_compensada,
                saldo_kwh: formData.saldo_kwh,
                valor_concessionaria: formData.valor_concessionaria,
                pdf_url: pdfUrl,
                alertas: alertas,
                iluminacao_publica: formData.iluminacao_publica || 0,
                parcelamento: formData.parcelamento || 0,
                outros_lancamentos: formData.outros_lancamentos || 0,
                consumo_reais: formData.consumo_reais || 0,
                fio_b_total: formData.fio_b_total || 0,
                fio_b_vr_unit: formData.fio_b_vr_unit || 0,
                valor_auditado: calculatedAudit,
                status_auditoria: alertas.some(a => a.type === 'error' || a.type === 'warning') ? 'contestado' : 'validado'
            };`;

content = content.replace(
    /const invoiceData = \{[\s\S]*?alertas: alertas\n\s*\};/,
    invoiceDataStr
);

// 7. Add validator logic in a useEffect
const validatorStr = `
    // Validador Inteligente Automático
    useEffect(() => {
        if (step !== 'sandbox') return;
        const parseNum = (v) => typeof v === 'string' ? parseFloat(String(v).replace('.', '').replace(',', '.')) || 0 : (Number(v) || 0);
        
        const ip = parseNum(formData.iluminacao_publica);
        const outros = parseNum(formData.outros_lancamentos);
        const parcelamentoVal = parseNum(formData.parcelamento);
        const consumoReaisVal = parseNum(formData.consumo_reais);
        const totalFaturaVal = parseNum(formData.valor_concessionaria);
        const fioBTotal = parseNum(formData.fio_b_total);
        const fioBUnit = parseNum(formData.fio_b_vr_unit);
        
        const consumo = Number(formData.consumo_kwh) || 0;
        const compensado = Number(formData.energia_compensada) || 0;

        let tarifaFinal = expectedTariff > 0 ? expectedTariff : (consumo > 0 ? consumoReaisVal / consumo : 0);
        
        let custoNaoCompensado = 0;
        let encargosEnergia = 0;
        let valorEnergiaCobrado = consumoReaisVal;

        if (compensado > 0) {
            const consumoNaoCompensado = Math.max(0, consumo - compensado);
            custoNaoCompensado = consumoNaoCompensado * tarifaFinal;
            encargosEnergia = custoNaoCompensado + fioBTotal;
            // Se o encargosEnergia for menor que CD, a concessionaria cobra CD, mas vamos simplificar aqui usando max(encargosEnergia, consumoReaisVal) se bater.
            valorEnergiaCobrado = Math.max(encargosEnergia, consumoReaisVal); 
        }

        const calculatedSum = valorEnergiaCobrado + ip + parcelamentoVal + outros;
        setCalculatedAudit(calculatedSum);
        
        const diffSum = Math.abs(calculatedSum - totalFaturaVal);
        const newAlerts = [];

        if (totalFaturaVal > 0) {
            const hasError = diffSum > (compensado > 0 ? 5.00 : 0.50);
            newAlerts.push({
                type: hasError ? 'error' : 'success',
                message: hasError 
                    ? \`A matemática não bate: o total da fatura é R$ \${totalFaturaVal.toFixed(2)}, mas o sistema calculou R$ \${calculatedSum.toFixed(2)}.\`
                    : \`Matemática validada: a soma do sistema bate com o total da fatura (R$ \${totalFaturaVal.toFixed(2)}).\`
            });
        }
        
        if (expectedTariff > 0 && tarifaFinal > 0) {
            const diffTariff = Math.abs(tarifaFinal - expectedTariff);
            if ((diffTariff / expectedTariff) > 0.05) {
                newAlerts.push({ type: 'tariff', message: \`Tarifa aplicada diferente da esperada (\${tarifaFinal.toFixed(4)} vs \${expectedTariff.toFixed(4)})\` });
            }
        }

        if (parcelamentoVal > 0) {
            newAlerts.push({ type: 'warning', message: \`Cobrança de Parcelamento detectada: R$ \${parcelamentoVal.toFixed(2)}.\` });
        }
        
        if (Math.abs(outros) > 0) {
            newAlerts.push({ type: 'warning', message: \`Lançamentos Extras detectados (multas, juros, etc): R$ \${outros.toFixed(2)}.\` });
        }

        if (fioBTotal > 0 && expectedFioB > 0) {
            if (fioBUnit > (expectedFioB * 1.2)) {
                newAlerts.push({ type: 'warning', message: \`O Fio B cobrado (R$ \${fioBUnit.toFixed(4)}) parece estar acima da tarifa base da concessionária (R$ \${expectedFioB.toFixed(4)}).\` });
            }
        }

        setAlertas(newAlerts);
    }, [formData, expectedTariff, expectedFioB, step]);
`;
content = content.replace(
    "const handleCreateUc = async () => {",
    validatorStr + "\n    const handleCreateUc = async () => {"
);

// 8. Render Alerts Box in UI
const alertsUIStr = `
                            {alertas.length > 0 && (
                                <div className={\`p-4 rounded-xl border shadow-sm mt-6 \${alertas.some(a => a.type === 'error' || a.type === 'warning') ? 'bg-amber-50/80 border-amber-200' : 'bg-emerald-50/80 border-emerald-200'}\`}>
                                    <h4 className={\`font-bold text-sm mb-3 flex items-center \${alertas.some(a => a.type === 'error' || a.type === 'warning') ? 'text-amber-700' : 'text-emerald-700'}\`}>
                                        {alertas.some(a => a.type === 'error' || a.type === 'warning') ? <AlertCircle className="w-5 h-5 mr-2"/> : <CheckCircle className="w-5 h-5 mr-2"/>}
                                        Auditoria do Validador
                                    </h4>
                                    <ul className="text-sm space-y-2">
                                        {alertas.map((a, i) => (
                                            <li key={i} className={\`flex items-start \${a.type === 'error' ? 'text-red-600 font-medium' : a.type === 'warning' ? 'text-amber-700' : a.type === 'success' ? 'text-emerald-700 font-medium' : 'text-gray-600'}\`}>
                                                <span className={\`w-1.5 h-1.5 rounded-full mr-2 mt-1.5 shrink-0 \${a.type === 'error' ? 'bg-red-500' : a.type === 'warning' ? 'bg-amber-500' : a.type === 'success' ? 'bg-emerald-500' : 'bg-gray-400'}\`}></span>
                                                {a.message}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
`;
content = content.replace(
    /\{alertas\.length > 0 && \([\s\S]*?Alertas do Validador OCR[\s\S]*?<\/ul>\s*<\/div>\s*\)\}/,
    alertsUIStr
);

// 9. Add inputs for new fields (IP, Parcelamento, Outros, Fio B, Consumo R$, Total)
const inputsUIStr = `
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Consumo (R$)</label>
                                        <input type="number" value={formData.consumo_reais} onChange={e => setFormData({...formData, consumo_reais: parseFloat(e.target.value)})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Fio B Total (R$)</label>
                                        <input type="number" value={formData.fio_b_total} onChange={e => setFormData({...formData, fio_b_total: parseFloat(e.target.value)})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Ilum. Pública (R$)</label>
                                        <input type="number" value={formData.iluminacao_publica} onChange={e => setFormData({...formData, iluminacao_publica: parseFloat(e.target.value)})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-amber-600 uppercase mb-1.5">Parcelamento</label>
                                        <input type="number" value={formData.parcelamento} onChange={e => setFormData({...formData, parcelamento: parseFloat(e.target.value)})} className="w-full text-sm border-amber-200 rounded-lg p-2 focus:ring-1 focus:ring-amber-500 bg-amber-50 shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Outros Lanc.</label>
                                        <input type="number" value={formData.outros_lancamentos} onChange={e => setFormData({...formData, outros_lancamentos: parseFloat(e.target.value)})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-indigo-600 uppercase mb-1.5">Total Fatura</label>
                                        <input type="number" value={formData.valor_concessionaria} onChange={e => setFormData({...formData, valor_concessionaria: parseFloat(e.target.value)})} className="w-full text-sm border-indigo-200 rounded-lg p-2 focus:ring-1 focus:ring-indigo-500 bg-indigo-50 shadow-sm font-bold" />
                                    </div>
`;
content = content.replace(
    /<div>\s*<label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Saldo Kwh<\/label>[\s\S]*?<\/div>/,
    `<div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Saldo Kwh</label>
                                        <input type="number" value={formData.saldo_kwh} onChange={e => setFormData({...formData, saldo_kwh: parseFloat(e.target.value)})} className="w-full text-sm border-gray-200 rounded-lg p-2 focus:ring-1 focus:ring-emerald-500 bg-white shadow-sm" />
                                    </div>` + "\n" + inputsUIStr
);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneAccountModal.jsx updated successfully.');
