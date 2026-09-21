const fs = require('fs');

const file = 'src/components/LeadModal.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Fix the "Converter em Assinante" button inside LeadModal footer
content = content.replace(
    /\{lead && \!\['ativacao', 'ativo', 'pago', 'negocio_perdido'\]\.includes\(lead\.status\) && onConvert && \([\s\S]*?Converter em Assinante\s*<\/button>\s*\)\}/,
    `{lead && !['ativacao', 'ativo', 'pago', 'negocio_perdido'].includes(lead.status) && onConvert && (
                            <select
                                onChange={(e) => {
                                    if (e.target.value) {
                                        if (e.target.value === 'assinante') {
                                            onConvert(lead);
                                            onClose();
                                        } else {
                                            alert('Conversão para ' + e.target.value + ' em desenvolvimento!');
                                        }
                                        e.target.value = '';
                                    }
                                }}
                                style={{ padding: '0.6rem 1.25rem', background: '#ecfdf5', color: '#047857', border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: 600, outline: 'none' }}
                            >
                                <option value="">Converter...</option>
                                <option value="embaixador">Embaixador</option>
                                <option value="assinante">Assinante</option>
                                <option value="fornecedor">Fornecedor</option>
                                <option value="dono_areas">Dono de Áreas/Vagas</option>
                            </select>
                        )}`
);

// 2. Fix the Save Lead button visibility condition
content = content.replace(
    /\{\['dados', 'endereco_energia'\]\.includes\(activeTab\) && \(/g,
    `{['dados', 'endereco', 'energia', 'agendamentos', 'comunicacao'].includes(activeTab) && (`
);

fs.writeFileSync(file, content);
console.log('LeadModal footer updated.');
