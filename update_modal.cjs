const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/StandaloneAnalysisModal.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Replace state
content = content.replace(
    /const \[forceConsistent, setForceConsistent\] = useState\(false\);/,
    "const [inconsistencyPopup, setInconsistencyPopup] = useState({ isOpen: false, saveType: null, historicoContent: '' });"
);

// 2. Replace handleReset
content = content.replace(
    /setForceConsistent\(false\);/,
    "setInconsistencyPopup({ isOpen: false, saveType: null, historicoContent: '' });"
);

// 3. Extract getHistoricoContent and rename saveInvoice
const saveInvoiceMatch = content.indexOf('    const saveInvoice = async (saveStatus) => {');
if (saveInvoiceMatch > -1) {
    const newFunctions = `    const getHistoricoContent = () => {
        const autoAlerts = [];
        const consumoVal = Number(formData.consumo_kwh) || 0;
        const compensadoVal = Number(formData.consumo_compensado) || 0;
        const tarifaUCVal = selectedUc ? Number(selectedUc.tarifa_concessionaria) : 0;
        
        const ipVal = typeof formData.iluminacao_publica === 'string' ? parseCurrency(formData.iluminacao_publica) : (Number(formData.iluminacao_publica) || 0);
        const outrosVal = typeof formData.outros_lancamentos === 'string' ? parseCurrency(formData.outros_lancamentos) : (Number(formData.outros_lancamentos) || 0);
        const parcelamentoVal = typeof formData.parcelamento === 'string' ? parseCurrency(formData.parcelamento) : (Number(formData.parcelamento) || 0);
        const concessionariaVal = typeof formData.valor_concessionaria === 'string' ? parseCurrency(formData.valor_concessionaria) : (Number(formData.valor_concessionaria) || Number(formData.consumo_reais) || 0);

        let calcConcessionariaSum = (typeof formData.consumo_reais === 'string' ? parseCurrency(formData.consumo_reais) : (Number(formData.consumo_reais) || 0)) + ipVal + outrosVal + parcelamentoVal;
        
        if (compensadoVal > 0 && selectedUc) {
            const consumoNaoCompensado = Math.max(0, consumoVal - compensadoVal);
            const consumoReaisVal = typeof formData.consumo_reais === 'string' ? parseCurrency(formData.consumo_reais) : (Number(formData.consumo_reais) || 0);
            const tarifaEfetiva = consumoVal > 0 ? (consumoReaisVal / consumoVal) : 0;
            const tarifaFinal = tarifaEfetiva > 0 ? tarifaEfetiva : tarifaUCVal;

            const fioB_real = typeof formData.fio_b_total === 'string' ? parseCurrency(formData.fio_b_total) : (Number(formData.fio_b_total) || 0);
            
            const tipoLigacao = selectedUc?.tipo_ligacao?.toLowerCase() || '';
            const custoDispKwh = tipoLigacao.includes('tri') ? 100 : tipoLigacao.includes('bi') ? 50 : 30;
            const custoDisponibilidade = custoDispKwh * tarifaFinal;

            const encargosEnergia = (consumoNaoCompensado * tarifaFinal) + fioB_real;
            const valorEnergiaCobrado = Math.max(encargosEnergia, custoDisponibilidade);

            calcConcessionariaSum = valorEnergiaCobrado + ipVal + outrosVal + parcelamentoVal;
        }

        const diffSumVal = Math.abs(calcConcessionariaSum - concessionariaVal);
        const diffSumLimitVal = compensadoVal > 0 ? 5.00 : 0.50;
        const baseTariffVal = selectedUc ? Number(selectedUc.tarifa_concessionaria) : 0;
        const diffTariffVal = selectedUc ? Math.abs(simulation.tarifaEfetiva - baseTariffVal) : 0;
        const percentDiffVal = baseTariffVal > 0 ? (diffTariffVal / baseTariffVal) : 0;

        if (compensadoVal === 0) {
            autoAlerts.push(\`Ausência de Compensação: A fatura não apresenta energia compensada.\`);
        } else if (compensadoVal < consumoVal) {
            autoAlerts.push(\`Compensação Parcial: A energia compensada (\${compensadoVal} kWh) é menor que o consumo total (\${consumoVal} kWh).\`);
        }
        if (selectedUc && percentDiffVal > 0.01) {
            autoAlerts.push(\`Divergência de Tarifa: Difere em \${(percentDiffVal * 100).toFixed(2)}%.\`);
        }
        if (concessionariaVal > 0 && diffSumVal > diffSumLimitVal) {
            autoAlerts.push(\`Divergência de Totais: Valores divergem do esperado.\`);
        }

        let historicoContent = '';
        if (autoAlerts.length > 0) {
            historicoContent += \`Alertas Automáticos do Validador:\\n- \${autoAlerts.join('\\n- ')}\\n\\n\`;
        }
        if (formData.observacoes_auditoria && formData.observacoes_auditoria.trim() !== '') {
            historicoContent += \`Observações Manuais:\\n\${formData.observacoes_auditoria.trim()}\`;
        }
        return historicoContent;
    };

    const handleSaveClick = (saveType) => {
        const historico = getHistoricoContent();
        if (historico !== '') {
            setInconsistencyPopup({ isOpen: true, saveType, historicoContent: historico });
        } else {
            executeSave(saveType, false);
        }
    };

    const executeSave = async (saveStatus, isForceConsistent) => {`;
    content = content.replace('    const saveInvoice = async (saveStatus) => {', newFunctions);
}

// 4. In executeSave, remove autoAlerts calculation and replace historicoContent
const autoAlertsStart = content.indexOf('// Recalcular alertas automáticos');
const autoAlertsEnd = content.indexOf('        let finalEnergyBillStatus');
if (autoAlertsStart > -1 && autoAlertsEnd > -1) {
    const sectionToReplace = content.substring(autoAlertsStart, autoAlertsEnd);
    content = content.replace(sectionToReplace, 'const historicoContent = getHistoricoContent();\n        ');
}

// 5. Replace forceConsistent usages in executeSave
content = content.replace(/!forceConsistent/g, '!isForceConsistent');
content = content.replace(/} else if \(forceConsistent\)/g, '} else if (isForceConsistent)');

// 6. Replace the buttons in footer
const footerStr = `<div className="sandbox-footer" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'flex-start', padding: '0.6rem 1rem', background: forceConsistent ? '#f0fdf4' : '#fef2f2', border: \`1px solid \${forceConsistent ? '#bbf7d0' : '#fecaca'}\`, borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }} onClick={() => setForceConsistent(!forceConsistent)}>
                                        <input 
                                            type="checkbox" 
                                            id="forceConsistent" 
                                            checked={forceConsistent} 
                                            onChange={(e) => setForceConsistent(e.target.checked)} 
                                            style={{ width: '18px', height: '18px', accentColor: forceConsistent ? '#16a34a' : '#ef4444', marginRight: '10px', pointerEvents: 'none' }}
                                        />
                                        <label htmlFor="forceConsistent" style={{ fontSize: '0.9rem', color: forceConsistent ? '#166534' : '#991b1b', margin: 0, pointerEvents: 'none', fontWeight: 500 }}>
                                            <strong>Ignorar Auditoria:</strong> Forçar aprovação da fatura (ignorar alertas de divergência e não abrir protocolo)
                                        </label>
                                    </div>
                                    <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <button 
                                            onClick={handleReset} 
                                            disabled={isSubmitting}
                                            className="sandbox-btn sandbox-btn-discard"
                                        >
                                            <X size={16} /> Descartar Análise
                                        </button>

                                        <div className="sandbox-footer-right">
                                            <button 
                                                onClick={() => saveInvoice('sem_faturamento')}
                                                disabled={isSubmitting}
                                                className="sandbox-btn sandbox-btn-secondary"
                                            >
                                                <Ban size={16} /> Registrar Operacional (Sem Faturamento)
                                            </button>
                                            <button 
                                                onClick={() => saveInvoice('a_vencer')}
                                                disabled={isSubmitting}
                                                className="sandbox-btn sandbox-btn-accent"
                                            >
                                                <CheckCircle size={16} /> Gerar Fatura Ativa (Com Cobrança)
                                            </button>
                                        </div>
                                    </div>
                                </div>`;

const newFooter = `<div className="sandbox-footer">
                                    <button 
                                        onClick={handleReset} 
                                        disabled={isSubmitting}
                                        className="sandbox-btn sandbox-btn-discard"
                                    >
                                        <X size={16} /> Descartar Análise
                                    </button>

                                    <div className="sandbox-footer-right">
                                        <button 
                                            onClick={() => handleSaveClick('sem_faturamento')}
                                            disabled={isSubmitting}
                                            className="sandbox-btn sandbox-btn-secondary"
                                        >
                                            <Ban size={16} /> Registrar Operacional (Sem Faturamento)
                                        </button>
                                        <button 
                                            onClick={() => handleSaveClick('a_vencer')}
                                            disabled={isSubmitting}
                                            className="sandbox-btn sandbox-btn-accent"
                                        >
                                            <CheckCircle size={16} /> Gerar Fatura Ativa (Com Cobrança)
                                        </button>
                                    </div>
                                </div>`;

content = content.replace(footerStr, newFooter);

// 7. Add popup at the end
const popupStr = `
            {inconsistencyPopup.isOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fadeIn 0.2s' }}>
                    <div style={{ background: 'white', borderRadius: '16px', padding: '32px', maxWidth: '550px', width: '90%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '16px', color: '#0f172a', fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <AlertCircle color="#f59e0b" size={28} />
                            Inconsistências Detectadas
                        </h3>
                        <p style={{ color: '#475569', fontSize: '0.95rem', marginBottom: '16px' }}>
                            A auditoria encontrou os seguintes alertas de faturamento nesta conta:
                        </p>
                        <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', fontSize: '0.9rem', color: '#334155', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto', marginBottom: '24px', border: '1px solid #e2e8f0' }}>
                            {inconsistencyPopup.historicoContent}
                        </div>
                        <p style={{ fontSize: '1rem', color: '#1e293b', marginBottom: '24px', fontWeight: 600 }}>
                            Como você deseja classificar esta conta?
                        </p>
                        <div style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end' }}>
                            <button 
                                style={{ padding: '12px 24px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.95rem', transition: 'all 0.2s', boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.3)' }}
                                onMouseOver={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                                onMouseOut={e => e.currentTarget.style.filter = 'none'}
                                onClick={() => {
                                    setInconsistencyPopup({ isOpen: false, saveType: null, historicoContent: '' });
                                    executeSave(inconsistencyPopup.saveType, true); // forceConsistent = true
                                }}
                            >
                                <X size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px', marginBottom: '2px' }} />
                                Não Contestar
                            </button>
                            <button 
                                style={{ padding: '12px 24px', background: '#22c55e', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.95rem', transition: 'all 0.2s', boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.3)' }}
                                onMouseOver={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                                onMouseOut={e => e.currentTarget.style.filter = 'none'}
                                onClick={() => {
                                    setInconsistencyPopup({ isOpen: false, saveType: null, historicoContent: '' });
                                    executeSave(inconsistencyPopup.saveType, false); // forceConsistent = false
                                }}
                            >
                                <CheckCircle size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px', marginBottom: '2px' }} />
                                Contestar (Gerar Protocolo)
                            </button>
                        </div>
                        <button 
                            style={{ position: 'absolute', top: '24px', right: '24px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                            onClick={() => setInconsistencyPopup({ isOpen: false, saveType: null, historicoContent: '' })}
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
`;

content = content.replace(/        <\/div>\n    \);\n}$/, popupStr);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated StandaloneAnalysisModal.jsx');
