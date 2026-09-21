const fs = require('fs');
const file = 'src/pages/dashboards/LeadsList.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Update Tags Buttons
const oldTagButton = `border: selectedTags.includes(tag) ? '1px solid var(--color-primary)' : '1px solid #cbd5e1',
                                    background: selectedTags.includes(tag) ? 'var(--color-primary)' : 'white',
                                    color: selectedTags.includes(tag) ? 'white' : '#475569',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {tag}
                            </button>`;

const newTagButton = `border: \`1px solid \${selectedTags.includes(tag) ? getTagColor('#' + tag).color : getTagColor('#' + tag).bg}\`,
                                    background: selectedTags.includes(tag) ? getTagColor('#' + tag).color : getTagColor('#' + tag).bg,
                                    color: selectedTags.includes(tag) ? 'white' : getTagColor('#' + tag).color,
                                    fontWeight: selectedTags.includes(tag) ? 600 : 500,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {tag}
                            </button>`;

content = content.replace(oldTagButton, newTagButton);

// 2. Update Status Buttons
const oldStatusButton = `border: \`1px solid \${selectedStatuses.includes(s.status) ? s.color : '#cbd5e1'}\`,
                                    background: selectedStatuses.includes(s.status) ? s.color : 'white',
                                    color: selectedStatuses.includes(s.status) ? 'white' : '#475569',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {s.label}
                            </button>`;

const newStatusButton = `border: \`1px solid \${selectedStatuses.includes(s.status) ? s.color : s.color + '40'}\`,
                                    background: selectedStatuses.includes(s.status) ? s.color : s.color + '15',
                                    color: selectedStatuses.includes(s.status) ? 'white' : s.color,
                                    fontWeight: selectedStatuses.includes(s.status) ? 600 : 500,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {s.label}
                            </button>`;

content = content.replace(oldStatusButton, newStatusButton);

fs.writeFileSync(file, content);
console.log('Colors applied to filter buttons.');
