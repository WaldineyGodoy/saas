const fs = require('fs');

function updateSupplierModal() {
    let content = fs.readFileSync('src/components/SupplierModal.jsx', 'utf8');

    if (!content.includes('salvarSenhaPortal')) {
        content = content.replace(
            `import { fetchAddressByCep, fetchCpfCnpjData, sendWhatsapp, mergePdf, sendCombinedNotification } from '../lib/api';`,
            `import { fetchAddressByCep, fetchCpfCnpjData, sendWhatsapp, mergePdf, sendCombinedNotification, salvarSenhaPortal, semSenha } from '../lib/api';`
        );
    }
    if (!content.includes('Eye, EyeOff')) {
        content = content.replace(
            `import { X, Upload, FileText, CheckCircle, Search, Save, AlertCircle, Ban, ArrowLeft, Loader2, Link, Printer, Download, Clock, History as HistoryIcon, MapPin, ExternalLink, RefreshCcw } from 'lucide-react';`,
            `import { X, Upload, FileText, CheckCircle, Search, Save, AlertCircle, Ban, ArrowLeft, Loader2, Link, Printer, Download, Clock, History as HistoryIcon, MapPin, ExternalLink, RefreshCcw, Key, Eye, EyeOff } from 'lucide-react';`
        );
    }

    if (!content.includes('showCredentialsModal')) {
        content = content.replace(
            `const [activeTab, setActiveTab] = useState('geral');`,
            `const [activeTab, setActiveTab] = useState('geral');\n    const [showCredentialsModal, setShowCredentialsModal] = useState(false);\n    const [showPassword, setShowPassword] = useState(false);\n    const [senhaPortal, setSenhaPortal] = useState('');\n    const [temSenhaGuardada, setTemSenhaGuardada] = useState(false);`
        );
    }

    if (!content.includes('portal_credentials: { url:')) {
        content = content.replace(
            `cidade: '',\n        uf: '',\n        lead_id: ''`,
            `cidade: '',\n        uf: '',\n        lead_id: '',\n        portal_credentials: { url: '', login: '' }`
        );
    }
    
    if (!content.includes(`semSenha(supplier.portal_credentials)`)) {
        content = content.replace(
            `lead_id: supplier.lead_id || ''\n            });`,
            `lead_id: supplier.lead_id || '',\n                portal_credentials: semSenha(supplier.portal_credentials) || { url: '', login: '' }\n            });\n            setSenhaPortal('');\n            setTemSenhaGuardada(!!supplier.portal_password_secret_id);`
        );
    }

    if (!content.includes(`portal_credentials: semSenha(formData.portal_credentials)`)) {
        content = content.replace(
            `legal_partner_name: formData.legal_partner_name,`,
            `portal_credentials: semSenha(formData.portal_credentials),\n          legal_partner_name: formData.legal_partner_name,`
        );
    }

    if (!content.includes(`salvarSenhaPortal('suppliers'`)) {
        content = content.replace(
            `if (result.error) throw result.error;`,
            `if (result.error) throw result.error;\n\n            if (senhaPortal) {\n                try {\n                    await salvarSenhaPortal('suppliers', result.data.id, senhaPortal);\n                    setSenhaPortal('');\n                    setTemSenhaGuardada(true);\n                } catch (err) {\n                    console.warn('Erro ao salvar senha do portal:', err);\n                }\n            }`
        );
    }

    if (!content.includes('Credenciais')) {
        content = content.replace(
            `<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>`,
            `<div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                                  <button
                                      type="button"
                                      onClick={() => setShowCredentialsModal(true)}
                                      style={{
                                          padding: '0.6rem 1rem', background: '#f8fafc', color: '#1e293b', border: '1px solid #cbd5e1',
                                          borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                                      }}
                                  >
                                      <Key size={16} /> Credenciais
                                  </button>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>`
        );
    }

    if (!content.includes('Modal de Credenciais')) {
        content = content.replace(
            `{/* Footer */}`,
            `{/* Modal de Credenciais */}
            {showCredentialsModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: 'white', borderRadius: '24px', width: '90%', maxWidth: '500px', padding: '2rem', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0ea5e9' }}>
                                <Key size={24} />
                            </div>
                            <div>
                                <h4 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Credenciais</h4>
                                <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>Acesso ao portal da concessionária</p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>CPF / CNPJ do titular</label>
                                <input
                                    type="text"
                                    value={formData.portal_credentials?.login || ''}
                                    onChange={e => setFormData({ ...formData, portal_credentials: { ...formData.portal_credentials, login: e.target.value } })}
                                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>Senha</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={senhaPortal}
                                        onChange={e => setSenhaPortal(e.target.value)}
                                        placeholder={temSenhaGuardada ? 'Senha guardada - preencha só para trocar' : 'Senha do portal'}
                                        style={{ width: '100%', padding: '0.7rem', paddingRight: '2.5rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.2rem' }}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '2rem', display: 'flex', gap: '0.8rem' }}>
                            <button
                                type="button"
                                onClick={() => setShowCredentialsModal(false)}
                                style={{ flex: 1, padding: '0.75rem', background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Footer */}`
        );
    }

    fs.writeFileSync('src/components/SupplierModal.jsx', content);
    console.log("SupplierModal.jsx updated");
}

updateSupplierModal();
