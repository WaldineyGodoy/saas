import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

import UserEditModal from '../../components/UserEditModal';

export default function AdminDashboard() {
    const { user } = useAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingUser, setEditingUser] = useState(null); // Now stores the entire user object or null
    const [searchTerm, setSearchTerm] = useState('');
    const [roleFilter, setRoleFilter] = useState('');

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

    const getRoleRank = (role) => roleHierarchy[role] || 99;

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .order('name');

            if (error) throw error;
            setUsers(data || []);
        } catch (error) {
            console.error('Error fetching users:', error);
            alert('Erro ao buscar usuários');
        } finally {
            setLoading(false);
        }
    };

    const handleUserUpdated = (updatedUser) => {
        setUsers(users.map(u => u.id === updatedUser.id ? updatedUser : u));
        alert('Perfil atualizado com sucesso!');
    };



    // Filter and Sort
    const filteredUsers = users.filter(user => {
        const matchesSearch = (user.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            (user.email?.toLowerCase() || '').includes(searchTerm.toLowerCase());
        const matchesRole = roleFilter ? user.role === roleFilter : true;
        return matchesSearch && matchesRole;
    }).sort((a, b) => getRoleRank(a.role) - getRoleRank(b.role));

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Painel Administrativo</h2>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <h3 style={{ margin: 0 }}>Gestão de Usuários</h3>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <input
                            placeholder="Buscar por nome ou email..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="input"
                            style={{ width: '250px' }}
                        />
                        <select
                            value={roleFilter}
                            onChange={e => setRoleFilter(e.target.value)}
                            className="select"
                            style={{ width: 'auto' }}
                        >
                            <option value="">Todos os Perfis</option>
                            <option value="super_admin">Super Admin</option>
                            <option value="admin">Admin</option>
                            <option value="manager">Gerente</option>
                            <option value="coordinator">Coordenador</option>
                            <option value="supplier">Fornecedor</option>
                            <option value="originator">Originador</option>
                            <option value="subscriber">Assinante</option>
                            <option value="lead">Lead</option>
                        </select>
                    </div>
                </div>

                {loading ? <p style={{ padding: '1.5rem' }}>Carregando...</p> : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Hierarquia</th>
                                    <th>Nome</th>
                                    <th>Email</th>
                                    <th>Perfil (Role)</th>
                                    <th>Comissão (Start/Rec.)</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map(u => (
                                    <tr key={u.id}>
                                        <td style={{ fontWeight: 'bold', color: 'var(--color-text-light)' }}>#{getRoleRank(u.role)}</td>
                                        <td>{u.name || '-'}</td>
                                        <td>{u.email}</td>
                                        <td>
                                            <span className="badge badge-neutral">
                                                {u.role}
                                            </span>
                                        </td>
                                        <td style={{ fontSize: '0.9rem', color: 'var(--color-text-medium)' }}>
                                            {u.commission_split?.start || 0}% / {u.commission_split?.recorrente || 0}%
                                        </td>
                                        <td>
                                            <button
                                                onClick={() => setEditingUser(u)}
                                                className="btn btn-secondary"
                                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                                            >
                                                Editar
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {editingUser && (
                <UserEditModal
                    user={editingUser}
                    onClose={() => setEditingUser(null)}
                    onSave={handleUserUpdated}
                />
            )}
        </div>
    );
}
