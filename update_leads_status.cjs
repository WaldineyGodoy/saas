const fs = require('fs');
const file = 'src/pages/dashboards/LeadsList.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add new states
content = content.replace(
    /const \[selectedTags, setSelectedTags\] = useState\(\[\]\);/,
    `const [selectedTags, setSelectedTags] = useState([]);
    const [selectedStatuses, setSelectedStatuses] = useState([]);
    const [hideEmptyStatuses, setHideEmptyStatuses] = useState(false);`
);

// 2. Update filteredLeads
content = content.replace(
    /const filteredLeads = leads\.filter\(lead => \{[\s\S]*?return matchesSearch && matchesTags;\s*\}\);/,
    `const filteredLeads = leads.filter(lead => {
        let matchesSearch = true;
        let matchesTags = true;
        let matchesStatus = true;
        
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
        
        if (selectedStatuses.length > 0) {
            matchesStatus = selectedStatuses.includes(lead.status);
        }

        return matchesSearch && matchesTags && matchesStatus;
    });`
);

// 3. Add UI for Status Filter and "Ocultar Status Vazios" checkbox
content = content.replace(
    /<div className="btn-group"/,
    `<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flex: 1, alignItems: 'center', marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Filtrar Status:</span>
                        {KANBAN_STATUSES.map(s => (
                            <button
                                key={s.status}
                                onClick={() => {
                                    if (selectedStatuses.includes(s.status)) {
                                        setSelectedStatuses(selectedStatuses.filter(st => st !== s.status));
                                    } else {
                                        setSelectedStatuses([...selectedStatuses, s.status]);
                                    }
                                }}
                                style={{
                                    fontSize: '0.75rem',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '16px',
                                    border: \`1px solid \${selectedStatuses.includes(s.status) ? s.color : '#cbd5e1'}\`,
                                    background: selectedStatuses.includes(s.status) ? s.color : 'white',
                                    color: selectedStatuses.includes(s.status) ? 'white' : '#475569',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                    {viewMode === 'kanban' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', marginTop: '0.5rem' }}>
                            <input 
                                type="checkbox" 
                                id="hide-empty" 
                                checked={hideEmptyStatuses}
                                onChange={e => setHideEmptyStatuses(e.target.checked)}
                            />
                            <label htmlFor="hide-empty" style={{ fontSize: '0.85rem', color: '#64748b', cursor: 'pointer' }}>Ocultar colunas vazias</label>
                        </div>
                    )}
                    <div className="btn-group"`
);

// 4. Update Kanban Columns rendering to respect hideEmptyStatuses
content = content.replace(
    /\{KANBAN_STATUSES\.map\(\(\{ status, label, color \}\) => \{[\s\S]*?const leadsInStatus = filteredLeads\.filter\(l => \(l\.status \|\| 'simulacao'\) === status\);[\s\S]*?return \([\s\S]*?<KanbanColumn[\s\S]*?\/>[\s\S]*?\);[\s\S]*?\}\)\}/,
    `{KANBAN_STATUSES.map(({ status, label, color }) => {
                                        const leadsInStatus = filteredLeads.filter(l => (l.status || 'simulacao') === status);
                                        if (hideEmptyStatuses && leadsInStatus.length === 0) return null;
                                        return (
                                            <KanbanColumn
                                                key={status}
                                                status={status}
                                                label={label}
                                                color={color}
                                                leads={leadsInStatus}
                                                onCardClick={(lead) => { setEditingLead(lead); setIsModalOpen(true); }}
                                            />
                                        );
                                    })}`
);

// 5. Fix List view status span
content = content.replace(
    /<span style=\{\{\s*padding: '0\.25rem 0\.75rem', borderRadius: '999px', fontSize: '0\.85rem', fontWeight: '500',\s*background: lead\.status === 'simulacao' \? '#f1f5f9' :[\s\S]*?\{lead\.status\.toUpperCase\(\)\.replace\('_', ' '\)\}\s*<\/span>/,
    `<span style={{
                                                            padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: '500',
                                                            background: (KANBAN_STATUSES.find(s => s.status === lead.status)?.color || '#94a3b8') + '20',
                                                            color: KANBAN_STATUSES.find(s => s.status === lead.status)?.color || '#94a3b8'
                                                        }}>
                                                            {KANBAN_STATUSES.find(s => s.status === lead.status)?.label || lead.status}
                                                        </span>`
);

fs.writeFileSync(file, content);
console.log('LeadsList.jsx updated successfully.');
