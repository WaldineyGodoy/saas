import re

with open('src/pages/dashboards/SupplierList.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# find {/ * Toolbar * /} and end at {loading
start_idx = content.find('{/* Toolbar */}')
end_idx = content.find('{loading ?', start_idx)

if start_idx != -1 and end_idx != -1:
    toolbar_replacement = '''
            {/* Toolbar */}
            <div style={{ 
                display: 'flex', 
                gap: '1rem', 
                marginBottom: '1.5rem',
                background: 'white',
                padding: '1rem',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                    <Search size={18} color="#94a3b8" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                    <input 
                        type="text" 
                        placeholder="Buscar por nome, CNPJ ou email..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ 
                            width: '100%', 
                            padding: '0.8rem 1rem 0.8rem 2.8rem', 
                            borderRadius: '12px', 
                            border: '1px solid #e2e8f0',
                            fontSize: '0.9rem',
                            outline: 'none',
                            transition: 'all 0.2s',
                            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
                        }}
                        onFocus={e => e.target.style.borderColor = '#3b82f6'}
                        onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                    />
                </div>
                
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <div className="btn-group">
                        <button 
                            onClick={() => setViewMode('list')} 
                            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Lista
                        </button>
                        <button 
                            onClick={() => setViewMode('kanban')} 
                            className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Kanban
                        </button>
                    </div>

                    <button 
                        onClick={fetchSuppliers}
                        className="btn btn-secondary"
                        style={{ padding: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Atualizar"
                    >
                        <RefreshCw size={18} className={loading ? 'spin' : ''} />
                    </button>
                    <button 
                        onClick={() => { setEditingSupplier(null); setIsModalOpen(true); }}
                        className="btn btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 1.5rem', fontWeight: 600, letterSpacing: '0.025em' }}
                    >
                        <Plus size={18} />
                        Novo Fornecedor
                    </button>
                </div>
            </div>
            
'''
    new_content = content[:start_idx] + toolbar_replacement + content[end_idx:]
    with open('src/pages/dashboards/SupplierList.jsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('Toolbar replaced successfully')
else:
    print('Boundaries not found')
