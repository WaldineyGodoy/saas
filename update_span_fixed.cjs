const fs = require('fs');
const file = 'src/pages/dashboards/LeadsList.jsx';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `<span style={{
                                                            padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: '500',
                                                            background: lead.status === 'simulacao' ? '#f1f5f9' :
                                                                lead.status === 'em_negociacao' ? '#fef9c3' :
                                                                    lead.status === 'ativo' ? '#dcfce7' : '#f1f5f9',
                                                            color: lead.status === 'simulacao' ? '#64748b' :
                                                                lead.status === 'em_negociacao' ? '#a16207' :
                                                                    lead.status === 'ativo' ? '#166534' : '#64748b'
                                                        }}>
                                                            {lead.status.toUpperCase().replace('_', ' ')}
                                                        </span>`;

const replacement = `<span style={{
                                                            padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: '500',
                                                            background: (KANBAN_STATUSES.find(s => s.status === lead.status)?.color || '#94a3b8') + '20',
                                                            color: KANBAN_STATUSES.find(s => s.status === lead.status)?.color || '#94a3b8'
                                                        }}>
                                                            {KANBAN_STATUSES.find(s => s.status === lead.status)?.label || lead.status.toUpperCase().replace('_', ' ')}
                                                        </span>`;

content = content.replace(targetStr, replacement);
fs.writeFileSync(file, content);
console.log('Fixed span successfully.');
