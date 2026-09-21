const fs = require('fs');

const file = 'src/pages/dashboards/LeadsList.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace the specific span correctly
content = content.replace(
    /<span style=\{\{[\s\S]*?lead\.status === 'simulacao' \? '#f1f5f9' :[\s\S]*?\{lead\.status\.toUpperCase\(\)\.replace\('_', ' '\)\}\s*<\/span>/,
    `<span style={{
                                                            padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: '500',
                                                            background: KANBAN_STATUSES.find(s => s.status === lead.status)?.color + '20' || '#f1f5f9',
                                                            color: KANBAN_STATUSES.find(s => s.status === lead.status)?.color || '#64748b'
                                                        }}>
                                                            {KANBAN_STATUSES.find(s => s.status === lead.status)?.label || lead.status}
                                                        </span>`
);

fs.writeFileSync(file, content);
console.log('LeadsList.jsx status span updated correctly.');
