const fs = require('fs');

function addPowerPlantModalToConsumerUnit() {
    let content = fs.readFileSync('src/components/ConsumerUnitModal.jsx', 'utf8');

    // 1. Import PowerPlantModal
    if (!content.includes('import PowerPlantModal')) {
        content = content.replace(
            `import SubscriberModal from './SubscriberModal';`,
            `import SubscriberModal from './SubscriberModal';\nimport PowerPlantModal from './PowerPlantModal';`
        );
    }

    // 2. Add state for showNewUsinaModal
    if (!content.includes('showNewUsinaModal')) {
        content = content.replace(
            `const [showZeroInvoiceModal, setShowZeroInvoiceModal] = useState(false);`,
            `const [showZeroInvoiceModal, setShowZeroInvoiceModal] = useState(false);\n    const [showNewUsinaModal, setShowNewUsinaModal] = useState(false);`
        );
    }

    // 3. Add button below Usina Vinculada Field
    if (!content.includes('Nova Usina')) {
        const usinaCard = `{/* Card da Usina Vinculada */}`;
        content = content.replace(
            usinaCard,
            `<div style={{ marginTop: '0.5rem', textAlign: 'right' }}>
                                                      <button
                                                          type="button"
                                                          onClick={() => setShowNewUsinaModal(true)}
                                                          style={{
                                                              background: 'none', border: 'none', color: 'var(--color-blue)', 
                                                              fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                                                              display: 'inline-flex', alignItems: 'center', gap: '0.25rem'
                                                          }}
                                                      >
                                                          <PlusCircle size={14} /> Nova Usina
                                                      </button>
                                                  </div>\n\n                                                  ` + usinaCard
        );
    }

    // 4. Render PowerPlantModal at the bottom
    if (!content.includes('showNewUsinaModal &&')) {
        content = content.replace(
            `{activeSubscriberForModal && (`,
            `{showNewUsinaModal && (
                <PowerPlantModal
                    usina={{
                        supplier_id: formData.titular_fornecedor_id || '',
                        concessionaria: formData.concessionaria || '',
                        unidade_geradora: formData.numero_uc || '',
                        name: \`Usina \${formData.numero_uc || ''}\`.trim()
                    }}
                    onClose={() => setShowNewUsinaModal(false)}
                    onSave={(novaUsina) => {
                        setUsinas(prev => [...prev, novaUsina]);
                        setFormData(prev => ({ ...prev, usina_id: novaUsina.id }));
                        setShowNewUsinaModal(false);
                        showAlert('Usina criada com sucesso e já vinculada à UC.', 'success');
                    }}
                />
            )}

            {activeSubscriberForModal && (`
        );
    }

    fs.writeFileSync('src/components/ConsumerUnitModal.jsx', content);
    console.log("Success");
}
addPowerPlantModalToConsumerUnit();
