const fs = require('fs');
const file = 'src/pages/dashboards/LeadsList.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace 1: Import LeadAgenda
content = content.replace(
    /import SubscriberModal from '\.\.\/\.\.\/components\/SubscriberModal';\r?\nimport \{ getTagColor \} from '\.\.\/\.\.\/lib\/tagHelpers';/,
    `import SubscriberModal from '../../components/SubscriberModal';
import { getTagColor } from '../../lib/tagHelpers';
import LeadAgenda from '../../components/LeadAgenda';`
);

// Replace 2: Add Agenda button
content = content.replace(
    /<div className=\"btn-group\" style={{ display: 'flex', border: '1px solid var\(--color-border\)', borderRadius: 'var\(--radius-sm\)', overflow: 'hidden' }}>([\s\S]*?)<\/div>/,
    `<div className="btn-group" style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                        <button
                            onClick={() => setViewMode('list')}
                            className={\`btn \${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}\`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Lista
                        </button>
                        <button
                            onClick={() => setViewMode('kanban')}
                            className={\`btn \${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}\`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Kanban
                        </button>
                        <button
                            onClick={() => setViewMode('agenda')}
                            className={\`btn \${viewMode === 'agenda' ? 'btn-primary' : 'btn-secondary'}\`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Agenda
                        </button>
                    </div>`
);

// Replace 3: Render agenda view
content = content.replace(
    /\{viewMode === 'list' \? \(/,
    `{viewMode === 'agenda' ? (
                        <LeadAgenda onLeadClick={(lead) => { setEditingLead(lead); setIsModalOpen(true); }} />
                    ) : viewMode === 'list' ? (`
);

fs.writeFileSync(file, content);
console.log('Update successful!');
