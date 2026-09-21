const fs = require('fs');

const file = 'src/pages/dashboards/LeadsList.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Update KANBAN_STATUSES
content = content.replace(
    /const KANBAN_STATUSES = \[[\s\S]*?\];/,
    `const KANBAN_STATUSES = [
    { status: 'indicado', label: 'Indicado', color: '#0ea5e9' },
    { status: 'simulacao', label: 'Simulação', color: '#64748b' },
    { status: 'sem_interacao', label: 'Sem Interação', color: '#a8a29e' },
    { status: 'negociacao', label: 'Negociação', color: '#eab308' },
    { status: 'reuniao_agendada', label: 'Reunião Agendada/Apresentação', color: '#f97316' },
    { status: 'contrato_enviado', label: 'Contrato Enviado', color: '#8b5cf6' },
    { status: 'ativacao', label: 'Ativação', color: '#7c3aed' },
    { status: 'ativo', label: 'Ativo', color: '#22c55e' },
    { status: 'pago', label: 'Pago', color: '#06b6d4' },
    { status: 'negocio_perdido', label: 'Negócio Perdido', color: '#ef4444' }
];`
);

// 2. Add selectedTags state
content = content.replace(
    /const \[searchTerm, setSearchTerm\] = useState\(''\);/,
    `const [searchTerm, setSearchTerm] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);`
);

// 3. Update filteredLeads
content = content.replace(
    /const filteredLeads = leads\.filter\(lead => \{[\s\S]*?\}\);/,
    `const filteredLeads = leads.filter(lead => {
        let matchesSearch = true;
        let matchesTags = true;
        
        if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase();
            const hasTagMatch = lead.tags?.some(tag => tag.toLowerCase().includes(lowerTerm));
            matchesSearch = (
                lead.name?.toLowerCase().includes(lowerTerm) ||
                lead.email?.toLowerCase().includes(lowerTerm) ||
                lead.phone?.includes(lowerTerm) ||
                lead.concessionaria?.toLowerCase().includes(lowerTerm) ||
                hasTagMatch
            );
        }

        if (selectedTags.length > 0) {
            if (!lead.tags || lead.tags.length === 0) {
                matchesTags = false;
            } else {
                matchesTags = selectedTags.some(t => lead.tags.includes(t));
            }
        }

        return matchesSearch && matchesTags;
    });`
);

// 4. Update the tag filter UI in the top header
content = content.replace(
    /<input[\s]*type="text"[\s]*placeholder="Buscar por nome, email, telefone ou concessionária..."[\s]*value=\{searchTerm\}[\s]*onChange=\{\(e\) => setSearchTerm\(e\.target\.value\)\}[\s]*className="input"[\s]*style=\{\{ maxWidth: '400px' \}\}[\s]*\/>/,
    `<input
                        type="text"
                        placeholder="Buscar por nome, email, telefone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input"
                        style={{ maxWidth: '300px' }}
                    />
                    
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flex: 1, alignItems: 'center' }}>
                        {['Embaixador', 'Energia por Assinatura', 'Investidor', 'Eletropostos', 'Cotas', 'Consorcio', 'Financiamento', 'Arrendamento de area', 'Locação de Vagas', 'Comercializadora'].map(tag => (
                            <button
                                key={tag}
                                onClick={() => {
                                    if (selectedTags.includes(tag)) {
                                        setSelectedTags(selectedTags.filter(t => t !== tag));
                                    } else {
                                        setSelectedTags([...selectedTags, tag]);
                                    }
                                }}
                                style={{
                                    fontSize: '0.75rem',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '16px',
                                    border: selectedTags.includes(tag) ? '1px solid var(--color-primary)' : '1px solid #cbd5e1',
                                    background: selectedTags.includes(tag) ? 'var(--color-primary)' : 'white',
                                    color: selectedTags.includes(tag) ? 'white' : '#475569',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>`
);

// 5. Replace Converter button in list view
content = content.replace(
    /\{\!\['ativacao', 'ativo', 'pago', 'negocio_perdido'\]\.includes\(lead\.status\) && \([\s\S]*?<button[\s\S]*?onClick=\{\(\) => handleConvert\(lead\)\}[\s\S]*?>[\s\S]*?Converter[\s\S]*?<\/button>[\s\S]*?\)\}/,
    `{!['ativacao', 'ativo', 'pago', 'negocio_perdido'].includes(lead.status) && (
        <select
            onChange={(e) => {
                if (e.target.value) {
                    if (e.target.value === 'assinante') {
                        handleConvert(lead);
                    } else {
                        alert('Conversão para ' + e.target.value + ' em desenvolvimento!');
                    }
                    e.target.value = '';
                }
            }}
            className="input"
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', border: '1px solid var(--color-success)', color: 'var(--color-success)', background: 'white', maxWidth: '120px' }}
        >
            <option value="">Converter...</option>
            <option value="embaixador">Embaixador</option>
            <option value="assinante">Assinante</option>
            <option value="fornecedor">Fornecedor</option>
            <option value="dono_areas">Dono de Áreas/Vagas</option>
        </select>
    )}`
);

fs.writeFileSync(file, content);
console.log('LeadsList.jsx updated');
