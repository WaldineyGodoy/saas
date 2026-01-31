import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Users, UserCog, UserCheck, Search, Edit2, Shield } from 'lucide-react';
import UserEditModal from '../../components/UserEditModal';

export default function UserProfilesSettings() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterRole, setFilterRole] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [editingUser, setEditingUser] = useState(null);

    const roles = [
        { id: 'all', label: 'Todos', color: '#64748b' },
        { id: 'super_admin', label: 'Super Admin', color: '#0f172a' },
        { id: 'admin', label: 'Admin', color: '#1e293b' },
        { id: 'manager', label: 'Gerente', color: '#334155' },
        { id: 'coordinator', label: 'Coord.', color: '#475569' },
        { id: 'supplier', label: 'Fornecedor', color: '#ea580c' }, // Orange
        { id: 'originator', label: 'Originador', color: '#059669' }, // Green
        { id: 'subscriber', label: 'Assinante', color: '#2563eb' }, // Blue
        { id: 'lead', label: 'Lead', color: '#94a3b8' } // Gray
    ];

    // Map role ID to Label for display
    const getRoleLabel = (r) => roles.find(item => item.id === r)?.label || r;
    const getRoleColor = (r) => roles.find(item => item.id === r)?.color || '#94a3b8';

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoading(true);
        const { data } = await supabase.from('profiles').select('*').order('name');
        if (data) setUsers(data);
        setLoading(false);
    };

    const handleSaveUser = (updated) => {
        setUsers(users.map(u => u.id === updated.id ? updated : u));
    };

    // Filter Logic
    const filteredUsers = users.filter(u => {
        const matchesSearch = (u.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
            (u.email?.toLowerCase() || '').includes(searchTerm.toLowerCase());
        const matchesRole = filterRole === 'all' ? true : u.role === filterRole;
        return matchesSearch && matchesRole;
    });

    // Counts for Cards
    const totalUsers = users.length;
    const activeProfiles = users.filter(u => u.role !== 'lead').length; // Arbitrary "Active" definition

    return (
        <div>
            {/* Top Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ background: '#eff6ff', padding: '0.8rem', borderRadius: '8px', color: '#2563eb' }}><Users size={24} /></div>
                    <div>
                        <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1e293b', lineHeight: 1 }}>{totalUsers}</div>
                        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Total de Usuários</div>
                    </div>
                </div>
                <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ background: '#f0fdf4', padding: '0.8rem', borderRadius: '8px', color: '#16a34a' }}><UserCheck size={24} /></div>
                    <div>
                        <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1e293b', lineHeight: 1 }}>{activeProfiles}</div>
                        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Perfis Ativos</div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>

                {/* Header / Tabs */}
                <div style={{ borderBottom: '1px solid #e2e8f0' }}>
                    {/* Search Bar Area */}
                    <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#334155' }}>Lista de Usuários</h3>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                placeholder="Buscar usuário..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{ padding: '0.5rem 1rem 0.5rem 2.2rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.9rem', width: '250px' }}
                            />
                        </div>
                    </div>

                    {/* Tabs */}
                    <div style={{ display: 'flex', gap: '2rem', padding: '0 1rem', overflowX: 'auto' }}>
                        {roles.map(role => (
                            <button
                                key={role.id}
                                onClick={() => setFilterRole(role.id)}
                                style={{
                                    background: 'none', border: 'none', padding: '1rem 0',
                                    color: filterRole === role.id ? '#0284c7' : '#64748b',
                                    fontWeight: filterRole === role.id ? 600 : 400,
                                    borderBottom: filterRole === role.id ? '2px solid #0284c7' : '2px solid transparent',
                                    cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '0.9rem'
                                }}
                            >
                                {role.label}
                                <span style={{ marginLeft: '6px', background: filterRole === role.id ? '#e0f2fe' : '#f1f5f9', padding: '2px 6px', borderRadius: '99px', fontSize: '0.75rem' }}>
                                    {role.id === 'all' ? users.length : users.filter(u => u.role === role.id).length}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table */}
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>
                            <tr>
                                <th style={{ padding: '1rem' }}>Usuário</th>
                                <th style={{ padding: '1rem' }}>Perfil (Role)</th>
                                <th style={{ padding: '1rem' }}>Contato</th>
                                <th style={{ padding: '1rem' }}>Comissões</th>
                                <th style={{ padding: '1rem', textAlign: 'right' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? <tr><td colSpan="5" style={{ padding: '2rem', textAlign: 'center' }}>Carregando...</td></tr> :
                                filteredUsers.length === 0 ? <tr><td colSpan="5" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Nenhum usuário encontrado.</td></tr> :
                                    filteredUsers.map(user => (
                                        <tr key={user.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontWeight: 'bold' }}>
                                                        {user.name?.charAt(0).toUpperCase() || '?'}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{user.name || 'Sem Nome'}</div>
                                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{user.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: '1rem' }}>
                                                <span style={{
                                                    padding: '0.3rem 0.8rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 600,
                                                    background: getRoleColor(user.role) + '20', // 20 hex opacity
                                                    color: getRoleColor(user.role),
                                                    border: `1px solid ${getRoleColor(user.role)}40`
                                                }}>
                                                    {getRoleLabel(user.role)}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1rem', fontSize: '0.9rem', color: '#475569' }}>
                                                {user.phone || '-'}
                                            </td>
                                            <td style={{ padding: '1rem', fontSize: '0.85rem' }}>
                                                {user.commission_split ? (
                                                    <div style={{ display: 'flex', gap: '1rem' }}>
                                                        <div><span style={{ color: '#94a3b8' }}>Start:</span> <strong>{user.commission_split.start}%</strong></div>
                                                        <div><span style={{ color: '#94a3b8' }}>Rec.:</span> <strong>{user.commission_split.recorrente}%</strong></div>
                                                    </div>
                                                ) : '-'}
                                            </td>
                                            <td style={{ padding: '1rem', textAlign: 'right' }}>
                                                <button
                                                    onClick={() => setEditingUser(user)}
                                                    style={{
                                                        background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px',
                                                        padding: '0.4rem 0.8rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                                                        color: '#475569', fontSize: '0.8rem', fontWeight: 500
                                                    }}
                                                >
                                                    <Edit2 size={14} /> Editar
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {editingUser && (
                <UserEditModal
                    user={editingUser}
                    onClose={() => setEditingUser(null)}
                    onSave={handleSaveUser}
                />
            )}
        </div>
    );
}
