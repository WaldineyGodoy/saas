const fs = require('fs');
let content = fs.readFileSync('src/pages/dashboards/LeadsList.jsx', 'utf8');

content = content.replace("import SubscriberModal from '../../components/SubscriberModal';", "import SubscriberModal from '../../components/SubscriberModal';\nimport SupplierModal from '../../components/SupplierModal';");

content = content.replace("const [isSubscriberModalOpen, setIsSubscriberModalOpen] = useState(false);", "const [isSubscriberModalOpen, setIsSubscriberModalOpen] = useState(false);\n    const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);");

content = content.replace("const handleSubscriberSaved = async (newSubscriber) => {", `const handleSupplierSaved = async () => {
        try {
            fetchLeads();
            alert('Lead convertido em Fornecedor!');
        } catch (e) {
            console.error('Erro ao converter', e);
        }
    };

    const handleSubscriberSaved = async (newSubscriber) => {`);

const modalBlock = `
            {isSupplierModalOpen && (
                <SupplierModal
                    supplier={leadToConvert ? {
                        name: leadToConvert.name,
                        email: leadToConvert.email,
                        phone: leadToConvert.phone,
                        cnpj: leadToConvert.cpf_cnpj,
                        lead_id: leadToConvert.id,
                        address: {
                            cep: leadToConvert.cep,
                            logradouro: leadToConvert.rua,
                            rua: leadToConvert.rua,
                            numero: leadToConvert.numero,
                            complemento: leadToConvert.complemento,
                            bairro: leadToConvert.bairro,
                            municipio: leadToConvert.cidade,
                            cidade: leadToConvert.cidade,
                            uf: leadToConvert.uf
                        }
                    } : null}
                    onClose={() => setIsSupplierModalOpen(false)}
                    onSave={handleSupplierSaved}
                />
            )}
        </div>
    );
}`;

content = content.replace("        </div>\n    );\n}", modalBlock);

fs.writeFileSync('src/pages/dashboards/LeadsList.jsx', content);
