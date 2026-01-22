import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { maskPhone, validatePhone } from '../lib/validators';

export default function UserEditModal({ user, onClose, onSave }) {
    const [formData, setFormData] = useState({
        name: '',
        role: 'lead',
        commission_start: 0,
        commission_recorrente: 0,
        phone: '',
        superior_id: ''
    });
    const [loading, setLoading] = useState(false);
    const [potentialSuperiors, setPotentialSuperiors] = useState([]);

    const roleHierarchy = {
        'super_admin': 1,
        'admin': 2,
        'manager': 3,
        'coordinator': 4,
        'supplier': 5,
        'originator': 6,
        'subscriber': 7,
        'lead': 8
    };

    useEffect(() => {
        if (user) {
            setFormData({
                name: user.name || '',
                role: user.role || 'lead',
                commission_start: user.commission_split?.start || 0,
                commission_recorrente: user.commission_split?.recorrente || 0,
                phone: user.phone || '',
                superior_id: user.superior_id || ''
            });

            fetchPotentialSuperiors(user.role); // Fetch fit superiors based on initial role
        }
    }, [user]);

    const fetchPotentialSuperiors = async (currentRole) => {
        // Fetch all users to filter capable superiors (rank < currentRoleRank)
        // Optimization: In a real app we'd filter in the query, but for now we filter in JS
        const { data } = await supabase.from('profiles').select('id, name, role').neq('id', user.id); // Exclude self

        if (data) {
            const currentRank = roleHierarchy[currentRole] || 99;
            const validSuperiors = data.filter(u => {
                const uRank = roleHierarchy[u.role] || 99;
                return uRank < currentRank; // Only allows stricter superiors
            });
            setPotentialSuperiors(validSuperiors);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (formData.phone && !validatePhone(formData.phone)) {
            alert('Telefone inválido!');
            return;
        }

        setLoading(true);

        try {
            const updates = {
                name: formData.name,
                role: formData.role,
                phone: formData.phone,
                commission_split: {
                    start: Number(formData.commission_start),
                    recorrente: Number(formData.commission_recorrente)
                },
                superior_id: formData.superior_id || null // Handle empty string
            };

            const { error } = await supabase
                .from('profiles')
                .update(updates)
                .eq('id', user.id);

            if (error) throw error;

            onSave({ ...user, ...updates });
            onClose();
        } catch (error) {
            alert('Erro ao atualizar usuário: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (

        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '500px' }}>
                <div className="modal-header">
                    <h3>Editar Usuário</h3>
                    <button onClick={onClose} className="modal-close">&times;</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label className="label">Nome</label>
                        <input
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            className="input"
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Telefone</label>
                        <input
                            value={formData.phone}
                            onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                            className="input"
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label className="label">Função (Role)</label>
                            <select
                                value={formData.role}
                                onChange={e => {
                                    setFormData({ ...formData, role: e.target.value });
                                    fetchPotentialSuperiors(e.target.value); // Re-fetch on role change
                                }}
                                className="select"
                            >
                                <option value="lead">Lead</option>
                                <option value="subscriber">Assinante</option>
                                <option value="originator">Originador</option>
                                <option value="supplier">Fornecedor</option>
                                <option value="coordinator">Coordenador</option>
                                <option value="manager">Gerente</option>
                                <option value="admin">Admin</option>
                                <option value="super_admin">Super Admin</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="label">Superior Imediato</label>
                            <select
                                value={formData.superior_id}
                                onChange={e => setFormData({ ...formData, superior_id: e.target.value })}
                                className="select"
                            >
                                <option value="">Sem superior</option>
                                {potentialSuperiors.map(sup => (
                                    <option key={sup.id} value={sup.id}>
                                        {sup.name} ({sup.role})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                        <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--color-text-medium)' }}>Configuração de Comissões (%)</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label className="label" style={{ fontSize: '0.8rem' }}>Start (1ª Fatura)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={formData.commission_start}
                                    onChange={e => setFormData({ ...formData, commission_start: e.target.value })}
                                    className="input"
                                />
                            </div>
                            <div className="form-group">
                                <label className="label" style={{ fontSize: '0.8rem' }}>Recorrente (Mensal)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={formData.commission_recorrente}
                                    onChange={e => setFormData({ ...formData, commission_recorrente: e.target.value })}
                                    className="input"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
                        <button type="submit" disabled={loading} className="btn btn-primary">
                            {loading ? 'Salvando...' : 'Salvar Alterações'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
