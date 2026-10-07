const fs = require('fs');
let content = fs.readFileSync('src/components/ConsumerUnitModal.jsx', 'utf8');

content = content.replace(
    /setSubscribers\(prev => prev\.map\(s =>[\s\S]*?\s*s\.id === formData\.titular_fatura_id[\s\S]*?\? \{ \.\.\.s, portal_credentials: semSenha\(tempCredentials\) \}[\s\S]*?: s\)\);/,
    `if (formData.titular_fornecedor_id) {
                                                setSuppliers(prev => prev.map(s => s.id === formData.titular_fornecedor_id ? { ...s, portal_credentials: semSenha(tempCredentials) } : s));
                                            } else {
                                                setSubscribers(prev => prev.map(s => s.id === formData.titular_fatura_id ? { ...s, portal_credentials: semSenha(tempCredentials) } : s));
                                            }`
);

fs.writeFileSync('src/components/ConsumerUnitModal.jsx', content);
