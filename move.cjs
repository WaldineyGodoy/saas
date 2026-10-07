const fs = require('fs');

function updateConsumerUnitModalLayout() {
    let content = fs.readFileSync('src/components/ConsumerUnitModal.jsx', 'utf8');

    const regex = /(<div>\s*<label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Tipo de Unidade<\/label>[\s\S]*?Obrigat(?:ó|\ufffd)ria para unidade geradora\.[\s\S]*?<\/div>\s*\)\}\s*<\/div>\s*\)\}\s*<\/div>)/;

    let match = content.match(regex);
    if (!match) {
        // less strict
        const regex2 = /(<div>\s*<label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Tipo de Unidade<\/label>[\s\S]*?<\/div>\s*\)\}\s*<\/div>\s*\)\}\s*<\/div>)/;
        match = content.match(regex2);
        
        if (!match) {
             console.log("Could not find the block");
             return;
        }
    }

    let blockToMove = match[0];
    // Remove it from original location
    content = content.replace(blockToMove, "");

    // Insert before Titular da Fatura Field
    const target = `{/* Titular da Fatura Field */}`;
    content = content.replace(target, `<div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>\n<div style={{ flex: 1 }}>\n` + blockToMove + `\n</div>\n</div>\n\n` + target);
    
    // Update logic for subscribersAndSuppliers filter:
    const oldListDef = `const subscribersAndSuppliers = [...subscribers, ...suppliers.map(s => ({ ...s, isSupplier: true, cpf_cnpj: s.cnpj }))];`;
    const newListDef = `const subscribersAndSuppliers = formData.tipo_unidade === 'geradora'\n                                                            ? suppliers.map(s => ({ ...s, isSupplier: true, cpf_cnpj: s.cnpj }))\n                                                            : formData.tipo_unidade === 'beneficiaria'\n                                                                ? subscribers\n                                                                : [...subscribers, ...suppliers.map(s => ({ ...s, isSupplier: true, cpf_cnpj: s.cnpj }))];`;
    
    content = content.replace(oldListDef, newListDef);

    fs.writeFileSync('src/components/ConsumerUnitModal.jsx', content);
    console.log("Success");
}
updateConsumerUnitModalLayout();
