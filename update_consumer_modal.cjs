const fs = require('fs');

function updateConsumerUnitModal() {
    let content = fs.readFileSync('src/components/ConsumerUnitModal.jsx', 'utf8');

    // 1. Initial State
    if (!content.includes(`titular_fornecedor_id: ''`)) {
        content = content.replace(
            `titular_fatura_id: '',`,
            `titular_fatura_id: '',\n        titular_fornecedor_id: '',`
        );
    }
    
    // 2. Load from consumerUnit
    if (!content.includes(`titular_fornecedor_id: consumerUnit.titular_fornecedor_id || null,`)) {
        content = content.replace(
            `titular_fatura_id: consumerUnit.titular_fatura_id || '',`,
            `titular_fatura_id: consumerUnit.titular_fatura_id || '',\n                titular_fornecedor_id: consumerUnit.titular_fornecedor_id || null,`
        );
    }

    // 3. Payload
    if (!content.includes(`titular_fornecedor_id: formData.titular_fornecedor_id || null,`)) {
        content = content.replace(
            `titular_fatura_id: formData.titular_fatura_id || null,`,
            `titular_fatura_id: formData.titular_fatura_id || null,\n                  titular_fornecedor_id: formData.titular_fornecedor_id || null,`
        );
    }
    
    // 4. Update titularTermo
    content = content.replace(
        `const titularTermo = subscribers.find(sub => sub.id === formData.titular_fatura_id) || null;`,
        `const titularTermo = subscribers.find(sub => sub.id === formData.titular_fatura_id) || suppliers.find(sup => sup.id === formData.titular_fornecedor_id) || null;`
    );

    // 5. Replace subscribers.find for titular everywhere safely.
    // Instead of doing it everywhere via regex, let's find the places.
    // "subscribers.find(s => s.id === formData.titular_fatura_id)" -> 
    // "(subscribers.find(s => s.id === formData.titular_fatura_id) || suppliers.find(s => s.id === formData.titular_fornecedor_id))"
    content = content.replace(
        /subscribers\.find\(s => s\.id === formData\.titular_fatura_id\)/g,
        `(subscribers.find(s => s.id === formData.titular_fatura_id) || suppliers.find(s => s.id === formData.titular_fornecedor_id))`
    );

    // 6. Fix Dropdown rendering
    // {subscribers -> {subscribersAndSuppliers
    // But first, we define subscribersAndSuppliers
    if (!content.includes('const subscribersAndSuppliers =')) {
        content = content.replace(
            `{/* Titular da Fatura Field */}`,
            `{/* Titular da Fatura Field */}\n                                                  {(() => {\n                                                      const subscribersAndSuppliers = [...subscribers, ...suppliers.map(s => ({ ...s, isSupplier: true, cpf_cnpj: s.cnpj }))];\n                                                      return (\n                                                          <>`
        );
        content = content.replace(
            `{/* Card do Titular da Fatura */}`,
            `</>\n                                                      );\n                                                  })()}\n                                                  {/* Card do Titular da Fatura */}`
        );
        
        // Inside this new block, we replace subscribers.filter with subscribersAndSuppliers.filter
        // But only for the titular dropdown
        content = content.replace(
            `{subscribers\n                                                                  .filter(s => {`,
            `{subscribersAndSuppliers\n                                                                  .filter(s => {`
        );
        
        content = content.replace(
            `{subscribers.filter(s => {`,
            `{subscribersAndSuppliers.filter(s => {`
        );

        // Update the onClick inside the map
        content = content.replace(
            `titular_fatura_id: s.id,\n                                                                              cpf_cnpj_fatura: prev.titular_fatura_id ? prev.cpf_cnpj_fatura : (prev.cpf_cnpj_fatura || (s ? s.cpf_cnpj : '')),`,
            `titular_fatura_id: s.isSupplier ? null : s.id,\n                                                                              titular_fornecedor_id: s.isSupplier ? s.id : null,\n                                                                              cpf_cnpj_fatura: (s.isSupplier ? s.cnpj : s.cpf_cnpj) || prev.cpf_cnpj_fatura,`
        );

        // Update clear button
        content = content.replace(
            `setFormData(prev => ({ ...prev, titular_fatura_id: '' }));`,
            `setFormData(prev => ({ ...prev, titular_fatura_id: '', titular_fornecedor_id: '' }));`
        );
        
        // The condition for showing clear button
        content = content.replace(
            `{formData.titular_fatura_id && (`,
            `{(formData.titular_fatura_id || formData.titular_fornecedor_id) && (`
        );
        
        // Placeholder condition
        content = content.replace(
            `formData.titular_fatura_id \n                                                                          ? (subscribers.find(s => s.id === formData.titular_fatura_id) || suppliers.find(s => s.id === formData.titular_fornecedor_id))?.name || "Buscar para trocar titular..." `,
            `(formData.titular_fatura_id || formData.titular_fornecedor_id)\n                                                                          ? ((subscribers.find(s => s.id === formData.titular_fatura_id) || suppliers.find(s => s.id === formData.titular_fornecedor_id))?.name || "Buscar para trocar titular...")`
        );
    }
    
    // 7. Fix Salvar Senha Portal
    // await salvarSenhaPortal('subscribers', formData.titular_fatura_id, tempSenha);
    content = content.replace(
        `await salvarSenhaPortal('subscribers', formData.titular_fatura_id, tempSenha);`,
        `await salvarSenhaPortal(formData.titular_fornecedor_id ? 'suppliers' : 'subscribers', formData.titular_fornecedor_id || formData.titular_fatura_id, tempSenha);`
    );
    
    // if (!formData.titular_fatura_id) return;
    content = content.replace(
        `if (!formData.titular_fatura_id) return;`,
        `if (!formData.titular_fatura_id && !formData.titular_fornecedor_id) return;`
    );
    
    // .eq('id', formData.titular_fatura_id);
    content = content.replace(
        `.from('subscribers')\n                                                .select('portal_password_secret_id')\n                                                .eq('id', formData.titular_fatura_id);`,
        `.from(formData.titular_fornecedor_id ? 'suppliers' : 'subscribers')\n                                                .select('portal_password_secret_id')\n                                                .eq('id', formData.titular_fornecedor_id || formData.titular_fatura_id);`
    );
    
    fs.writeFileSync('src/components/ConsumerUnitModal.jsx', content);
    console.log("ConsumerUnitModal.jsx updated");
}

updateConsumerUnitModal();
