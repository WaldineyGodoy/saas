const fs = require('fs');

const file = 'src/components/LeadModal.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Update Tabs Logic
content = content.replace(
    /\[[\s\S]*?\]\.filter\(tab => lead \|\| \['dados', 'endereco_energia'\]\.includes\(tab\.id\)\)\.map\(tab => \{/,
    `[
                        { id: 'dados', label: 'Dados Cadastrais', icon: User, color: '#003366', bg: '#f0f9ff' },
                        { id: 'endereco', label: 'Endereço', icon: Home, color: '#10b981', bg: '#ecfdf5' },
                        ...(formData.tags?.includes('Energia por Assinatura') ? [{ id: 'energia', label: 'Dados de Energia', icon: Zap, color: '#f59e0b', bg: '#fff7ed' }] : []),
                        { id: 'agendamentos', label: 'Agendamentos', icon: Calendar, color: '#8b5cf6', bg: '#f5f3ff' },
                        { id: 'comunicacao', label: 'Comunicados', icon: MessageCircle, color: '#25D366', bg: '#f0fdf4' }
                    ].map(tab => {`
);

// 2. Fix the layout of "Dados Cadastrais" to put Nome, Telefone, Email first
content = content.replace(
    /<div style=\{\{ gridColumn: '1 \/ -1' \}\}>\s*<label style=\{\{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 \}\}>Status<\/label>[\s\S]*?<\/div>\s*<\/div>\s*<\/form>/,
    `<div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Nome Completo</label>
                                    <input
                                        required
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>
                                
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', gridColumn: '1 / -1' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Telefone</label>
                                        <input
                                            placeholder="55 xx xxxxx xxxx"
                                            value={formData.phone}
                                            onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                            style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Email</label>
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                                            style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                        />
                                    </div>
                                </div>

                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Status</label>
                                    <select
                                        value={formData.status}
                                        onChange={e => setFormData({ ...formData, status: e.target.value })}
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    >
                                        <option value="indicado">Indicado</option>
                                        <option value="simulacao">Simulação</option>
                                        <option value="sem_interacao">Sem Interação</option>
                                        <option value="negociacao">Negociação</option>
                                        <option value="reuniao_agendada">Reunião Agendada/Apresentação</option>
                                        <option value="contrato_enviado">Contrato Enviado</option>
                                        <option value="ativacao">Ativação</option>
                                        <option value="ativo">Ativo</option>
                                        <option value="pago">Pago</option>
                                        <option value="negocio_perdido">Negócio Perdido</option>
                                    </select>
                                </div>

                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Tags</label>
                                    <TagInput 
                                        value={formData.tags || []} 
                                        onChange={(newTags) => setFormData({ ...formData, tags: newTags })} 
                                    />
                                </div>

                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Originador</label>
                                    <select
                                        value={formData.originator_id}
                                        onChange={e => setFormData({ ...formData, originator_id: e.target.value })}
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    >
                                        <option value="">Selecione...</option>
                                        {originators.map(o => (
                                            <option key={o.id} value={o.id}>{o.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </form>`
);

// 3. Split 'endereco_energia' into 'endereco' and 'energia'
// First, find the starting point of 'endereco_energia' and change it to 'endereco'
content = content.replace(
    /\{activeTab === 'endereco_energia' && \(/,
    `{activeTab === 'endereco' && (`
);

// Now, split the content where "Dados de Energia e Oferta" begins.
content = content.replace(
    /<h4 style=\{\{ margin: '0 0 0.5rem 0', color: '#1e293b', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem' \}\}>\s*<Zap size=\{18\} style=\{\{ color: '#f59e0b' \}\} \/> Dados de Energia e Oferta\s*<\/h4>/,
    `</div>
                        </form>
                    )}

                    {activeTab === 'energia' && (
                        <form id="lead-form-energia" onSubmit={handleSubmit}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <h4 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Zap size={18} style={{ color: '#f59e0b' }} /> Dados de Energia e Oferta
                                    </h4>`
);

// 4. Update the save button to submit the correct form ID based on activeTab
content = content.replace(
    /const formId = activeTab === 'dados' \? 'lead-form-dados' : 'lead-form-endereco';/,
    `let formId = 'lead-form-dados';
                                if (activeTab === 'endereco') formId = 'lead-form-endereco';
                                else if (activeTab === 'energia') formId = 'lead-form-energia';
                                else if (activeTab === 'agendamentos' || activeTab === 'comunicacao') {
                                    // if saving from these tabs, just trigger a generic save
                                    formId = 'lead-form-dados';
                                }`
);

// 5. Remove `lead &&` constraints from agendamentos and comunicacao tabs
content = content.replace(
    /\{activeTab === 'agendamentos' && lead && \(/,
    `{activeTab === 'agendamentos' && (`
);
content = content.replace(
    /\{activeTab === 'comunicacao' && lead && \(/,
    `{activeTab === 'comunicacao' && (`
);

// Also need to handle missing lead id when saving appointment or whatsapp.
content = content.replace(
    /const handleSaveAppointment = async \(e\) => \{[\s\S]*?e\.preventDefault\(\);[\s\S]*?setLoading\(true\);/,
    `const handleSaveAppointment = async (e) => {
        e.preventDefault();
        if (!lead?.id) {
            showAlert('Por favor, salve o lead primeiro clicando no botão "Salvar Lead" abaixo.', 'warning');
            return;
        }
        setLoading(true);`
);

content = content.replace(
    /const handleSendManualWhatsApp = async \(\) => \{/,
    `const handleSendManualWhatsApp = async () => {
        if (!lead?.id) {
            showAlert('Por favor, salve o lead primeiro clicando no botão "Salvar Lead" abaixo.', 'warning');
            return;
        }`
);

fs.writeFileSync(file, content);
console.log('LeadModal.jsx updated successfully.');
