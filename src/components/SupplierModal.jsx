import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { fetchCpfCnpjData } from '../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone } from '../lib/validators';

export default function SupplierModal({ supplier, onClose, onSave, onDelete }) {
    const { showAlert, showConfirm } = useUI();
    const [loading, setLoading] = useState(false);
    const [usinas, setUsinas] = useState([]); // To display linked usinas

    const [formData, setFormData] = useState({
        name: '',
        cnpj: '',
        email: '',
        phone: '',
        status: 'ativacao',
        legal_partner_name: '',
        legal_partner_cpf: '',
        pix_key: '',
        pix_key_type: 'cpf', // Default
        // Address fields
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: ''
    });

    useEffect(() => {
        if (supplier) {
            setFormData({
                name: supplier.name || '',
                cnpj: supplier.cnpj || '',
                email: supplier.email || '',
                phone: supplier.phone || '',
                status: supplier.status || 'ativacao',
                legal_partner_name: supplier.legal_partner_name || '',
                legal_partner_cpf: supplier.legal_partner_cpf || '',
                pix_key: supplier.pix_key || '',
                pix_key_type: supplier.pix_key_type || 'cpf',
                cep: supplier.address?.cep || '',
                rua: supplier.address?.logradouro || supplier.address?.rua || '',
                numero: supplier.address?.numero || '',
                complemento: supplier.address?.complemento || '',
                bairro: supplier.address?.bairro || '',
                cidade: supplier.address?.municipio || supplier.address?.cidade || '',
                uf: supplier.address?.uf || ''
            });

            // Fetch linked usinas
            fetchLinkedUsinas(supplier.id);
        }
    }, [supplier]);

    const fetchLinkedUsinas = async (supplierId) => {
        const { data } = await supabase.from('usinas').select('id, name, status').eq('supplier_id', supplierId);
        setUsinas(data || []);
    };

    const handleCnpjBlur = async () => {
        const cleanDoc = formData.cnpj.replace(/\D/g, '');
        if (cleanDoc.length === 14) {
            setLoading(true);
            try {
                const data = await fetchCpfCnpjData(cleanDoc);
                if (data) {
                    setFormData(prev => ({
                        ...prev,
                        name: data.nome || prev.name,
                        email: data.email || prev.email,
                        phone: data.telefone || prev.phone,
                        legal_partner_name: data.legal_partner?.nome || prev.legal_partner_name,
                        legal_partner_cpf: data.legal_partner?.cpf || prev.legal_partner_cpf,
                        // Address
                        cep: data.address?.cep || prev.cep,
                        rua: data.address?.logradouro || prev.rua,
                        numero: data.address?.numero || prev.numero,
                        complemento: data.address?.complemento || prev.complemento,
                        bairro: data.address?.bairro || prev.bairro,
                        cidade: data.address?.municipio || prev.cidade,
                        uf: data.address?.uf || prev.uf
                    }));
                }
            } catch (e) {
                console.error('Erro CNPJ', e);
                showAlert('Erro ao buscar CNPJ. Verifique se o número está correto.', 'error');
            } finally {
                setLoading(false);
            }
        }
    };

    const handlePixTypeChange = (e) => {
        const type = e.target.value;
        let autoValue = formData.pix_key;

        switch (type) {
            case 'telefone':
                autoValue = formData.phone;
                break;
            case 'email':
                autoValue = formData.email;
                break;
            case 'cnpj':
                autoValue = formData.cnpj;
                break;
            case 'cpf':
                // If we had a specific CPF field for the company (usually CNPJ), or use partner CPF?
                // Assuming maybe legal_partner_cpf if it's a person? 
                // Let's stick to what we have.
                if (formData.legal_partner_cpf) autoValue = formData.legal_partner_cpf;
                break;
            default:
                break;
        }

        setFormData(prev => ({
            ...prev,
            pix_key_type: type,
            pix_key: autoValue
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validate using correct field names
        if (formData.cnpj && !validateDocument(formData.cnpj)) {
            showAlert('CNPJ inválido!', 'warning');
            return;
        }
        if (formData.phone && !validatePhone(formData.phone)) {
            showAlert('Telefone inválido!', 'warning');
            return;
        }


        setLoading(true);

        try {
            console.log('Submitting payload:', formData); // Debug log
            const payload = {
                name: formData.name,
                cnpj: formData.cnpj,
                email: formData.email,
                phone: formData.phone,
                status: formData.status,
                legal_partner_name: formData.legal_partner_name,
                legal_partner_cpf: formData.legal_partner_cpf,
                pix_key: formData.pix_key,
                pix_key_type: formData.pix_key_type,
                address: {
                    cep: formData.cep,
                    logradouro: formData.rua,
                    rua: formData.rua,
                    numero: formData.numero,
                    complemento: formData.complemento,
                    bairro: formData.bairro,
                    municipio: formData.cidade,
                    cidade: formData.cidade,
                    uf: formData.uf
                }
            };

            console.log('Payload ready:', payload); // Debug log

            let result;
            if (supplier?.id) {
                result = await supabase.from('suppliers').update(payload).eq('id', supplier.id).select().single();
            } else {
                result = await supabase.from('suppliers').insert(payload).select().single();
            }

            console.log('Supabase result:', result); // Debug log

            if (result.error) throw result.error;
            onSave(result.data);
            onClose();
        } catch (error) {
            console.error('Save error details:', error);
            const msg = error.message || JSON.stringify(error);
            if (msg.includes('JWT expired')) {
                showAlert('Sua sessão expirou. Por favor, faça login novamente.', 'error');
                await supabase.auth.signOut();
                window.location.href = '/login';
            } else {
                showAlert('Erro ao salvar fornecedor: ' + msg, 'error');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (usinas.length > 0) {
            showAlert('Não é possível excluir fornecedor com usinas vinculadas.', 'warning');
            return;
        }
        const confirm = await showConfirm('Excluir este fornecedor?');
        if (!confirm) return;

        setLoading(true);
        try {
            const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id);
            if (error) throw error;
            if (onDelete) onDelete(supplier.id);
            onClose();
        } catch (error) {
            showAlert('Erro ao excluir: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
                <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
                    {supplier ? 'Editar Fornecedor' : 'Novo Fornecedor'}
                </h3>

                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>CNPJ * (Busca Automática)</label>
                        <input
                            value={formData.cnpj}
                            onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
                            onBlur={handleCnpjBlur}
                            placeholder="00.000.000/0000-00"
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#f8fafc' }}
                        />
                    </div>

                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Razão Social / Nome *</label>
                        <input
                            required
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Nome Sócio Adm</label>
                        <input
                            value={formData.legal_partner_name}
                            onChange={e => setFormData({ ...formData, legal_partner_name: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>CPF Sócio Adm</label>
                        <input
                            value={formData.legal_partner_cpf}
                            onChange={e => setFormData({ ...formData, legal_partner_cpf: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Contato e Financeiro</div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>CPF/CNPJ</label>
                        <input
                            value={formData.cnpj}
                            onChange={e => setFormData({ ...formData, cnpj: maskCpfCnpj(e.target.value) })}
                            onBlur={handleCnpjBlur}
                            placeholder="00.000.000/0000-00"
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#f8fafc' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Telefone</label>
                        <input
                            value={formData.phone}
                            onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                            placeholder="(00) 00000-0000"
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Email</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Tipo Chave Pix</label>
                        <select
                            value={formData.pix_key_type}
                            onChange={handlePixTypeChange}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            <option value="cpf">CPF</option>
                            <option value="cnpj">CNPJ</option>
                            <option value="email">Email</option>
                            <option value="telefone">Telefone</option>
                            <option value="aleatoria">Aleatória</option>
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Chave Pix</label>
                        <input
                            value={formData.pix_key}
                            onChange={e => setFormData({ ...formData, pix_key: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Status</label>
                        <select
                            value={formData.status}
                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            <option value="ativacao">Em Ativação</option>
                            <option value="ativo">Ativo</option>
                            <option value="inativo">Inativo</option>
                        </select>
                    </div>

                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Endereço</div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>CEP</label>
                        <input
                            value={formData.cep}
                            onChange={e => setFormData({ ...formData, cep: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Rua</label>
                        <input
                            value={formData.rua}
                            onChange={e => setFormData({ ...formData, rua: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Número</label>
                        <input
                            value={formData.numero}
                            onChange={e => setFormData({ ...formData, numero: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Complemento</label>
                        <input
                            value={formData.complemento}
                            onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Bairro</label>
                        <input
                            value={formData.bairro}
                            onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Cidade/Estado</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                                value={formData.cidade}
                                onChange={e => setFormData({ ...formData, cidade: e.target.value })}
                                placeholder="Cidade"
                                style={{ flex: 2, padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                            <input
                                value={formData.uf}
                                onChange={e => setFormData({ ...formData, uf: e.target.value })}
                                placeholder="UF"
                                style={{ flex: 1, padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                        </div>
                    </div>

                    {supplier && usinas.length > 0 && (
                        <div style={{ gridColumn: '1 / -1', marginTop: '1rem', background: '#f0f9ff', padding: '1rem', borderRadius: '8px' }}>
                            <h4 style={{ fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#0369a1' }}>Usinas Vinculadas</h4>
                            <ul style={{ paddingLeft: '1.5rem', fontSize: '0.9rem' }}>
                                {usinas.map(u => (
                                    <li key={u.id}>{u.name} - <span style={{ opacity: 0.7 }}>{u.status}</span></li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
                        <div>
                            {supplier && onDelete && (
                                <button type="button" onClick={handleDelete} style={{ padding: '0.5rem 1rem', background: '#fee2e2', color: '#dc2626', borderRadius: '4px', border: '1px solid #fecaca' }}>
                                    Excluir
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', background: '#ccc', borderRadius: '4px' }}>Cancelar</button>
                            <button type="submit" disabled={loading} style={{ padding: '0.5rem 1rem', background: 'var(--color-blue)', color: 'white', borderRadius: '4px' }}>
                                {loading ? 'Salvando...' : 'Salvar'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
