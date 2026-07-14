const fs = require('fs');
const path = 'c:/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/src/pages/StandaloneManagement.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Import useUI
if (!content.includes('import { useUI }')) {
    content = content.replace(
        "import { LayoutDashboard, Trash2, Edit, Plus, AlertCircle, Save, X, Building2, Zap, FileText } from 'lucide-react';",
        "import { LayoutDashboard, Trash2, Edit, Plus, AlertCircle, Save, X, Building2, Zap, FileText } from 'lucide-react';\nimport { useUI } from '../contexts/UIContext';"
    );
}

// 2. Destructure useUI
if (!content.includes('const { showAlert } = useUI();')) {
    content = content.replace(
        "export default function StandaloneManagement() {",
        "export default function StandaloneManagement() {\n    const { showAlert } = useUI();"
    );
}

// 3. Replace alerts
content = content.replace(
    "alert('Erro ao excluir: ' + error.message);",
    "showAlert('Erro ao excluir: ' + error.message, 'error');"
);

content = content.replace(
    "alert('CEP inválido.');",
    "showAlert('CEP inválido.', 'warning');"
);

content = content.replace(
    "alert('CEP não encontrado.');",
    "showAlert('CEP não encontrado.', 'warning');"
);

content = content.replace(
    "alert(`CEP encontrado! IBGE: ${data.ibge} - ${data.localidade}/${data.uf}`);",
    "showAlert(`CEP encontrado! IBGE: ${data.ibge} - ${data.localidade}/${data.uf}`, 'success');"
);

content = content.replace(
    "alert('Erro ao buscar CEP.');",
    "showAlert('Erro ao buscar CEP.', 'error');"
);

fs.writeFileSync(path, content, 'utf8');
console.log('StandaloneManagement.jsx updated to use showAlert.');
