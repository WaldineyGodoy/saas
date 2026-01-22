import {
    LayoutDashboard, Users, Megaphone, Home, Briefcase, Factory, Zap, FileText, Settings,
    Menu, ChevronLeft, ChevronRight, LogOut, UserCheck, Truck, DollarSign
} from 'lucide-react';

import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

// Dashboards Existing
import AdminDashboard from './dashboards/AdminDashboard';
import SubscriberDashboard from './dashboards/SubscriberDashboard';
import OriginatorDashboard from './dashboards/OriginatorDashboard';
import SupplierDashboard from './dashboards/SupplierDashboard';

// New CRUD Lists
import LeadsList from './dashboards/LeadsList';
import SubscriberList from './dashboards/SubscriberList';
import OriginatorList from './dashboards/OriginatorList';
import SupplierList from './dashboards/SupplierList';
import PowerPlantList from './dashboards/PowerPlantList';
import InvoiceListManager from './dashboards/InvoiceListManager';
import ConsumerUnitList from './dashboards/ConsumerUnitList';
import BillingList from './dashboards/BillingList';

export default function Dashboard() {
    const { profile, signOut } = useAuth();
    const navigate = useNavigate();
    const [activeView, setActiveView] = useState('default');

    // Mobile sidebar state
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    // Desktop sidebar state
    const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

    // Reset view when profile loads
    useEffect(() => {
        if (profile) {
            if (profile.role === 'subscriber') setActiveView('subscriber_dashboard');
            else if (profile.role === 'supplier') setActiveView('supplier_dashboard');
            // For all other roles (admin, super_admin, originator, broker, coordinator, manager), default to LEADS
            else setActiveView('leads');
        }
    }, [profile]);

    const handleLogout = async () => {
        await signOut();
        navigate('/login');
    };

    const getMenuItems = (role) => {
        if (!role) return [];

        const items = [];

        // 1. Leads
        if (role !== 'subscriber') {
            items.push({ id: 'leads', label: 'Leads', icon: Megaphone });
        }

        // 2. Originadores
        const originatorsAllowed = ['originator', 'coordinator', 'manager', 'admin', 'super_admin'];
        if (originatorsAllowed.includes(role)) {
            if (role === 'originator') {
                items.push({ id: 'originator_dashboard', label: 'Minhas Comissões', icon: LayoutDashboard });
                items.push({ id: 'originators_list', label: 'Equipe', icon: Briefcase });
            } else {
                items.push({ id: 'originators_list', label: 'Originadores', icon: Briefcase });
            }
        }

        // 3. Assinantes
        if (role !== 'lead') {
            if (role === 'subscriber') {
                items.push({ id: 'subscriber_dashboard', label: 'Meu Painel', icon: LayoutDashboard });
            } else {
                items.push({ id: 'subscribers_list', label: 'Assinantes', icon: UserCheck });
            }
        }

        // 4. Unidades Consumidoras
        if (role !== 'lead' && role !== 'subscriber') {
            items.push({ id: 'consumer_units', label: 'Unidades Consumidoras', icon: Home });
        }

        // 5. Faturas
        items.push({ id: 'invoices', label: 'Faturas', icon: FileText });

        // 6. Fornecedores
        const suppliersAllowed = ['supplier', 'manager', 'admin', 'super_admin'];
        if (suppliersAllowed.includes(role)) {
            if (role === 'supplier') {
                items.push({ id: 'supplier_dashboard', label: 'Meu Painel', icon: LayoutDashboard });
            } else {
                items.push({ id: 'suppliers_list', label: 'Fornecedores', icon: Truck });
            }
        }

        // 7. Usinas
        if (suppliersAllowed.includes(role)) {
            items.push({ id: 'power_plants', label: 'Usinas', icon: Zap });
        }

        // 8. Billing
        const billingAllowed = ['supplier', 'manager', 'admin', 'super_admin'];
        if (billingAllowed.includes(role)) {
            items.push({ id: 'billing', label: 'Billing', icon: DollarSign });
        }

        // 9. Gestão de Usuários
        if (['admin', 'super_admin'].includes(role)) {
            items.push({ id: 'admin', label: 'Gestão de Usuários', icon: Settings });
        }

        return items;
    };

    const currentMenu = getMenuItems(profile?.role);

    const renderContent = () => {
        if (!profile) return <p>Carregando perfil...</p>;

        switch (activeView) {
            case 'admin': return <AdminDashboard />;
            case 'subscriber_dashboard': return <SubscriberDashboard />;
            case 'originator_dashboard': return <OriginatorDashboard />;
            case 'supplier_dashboard': return <SupplierDashboard />;
            case 'leads': return <LeadsList />;
            case 'subscribers_list': return <SubscriberList />;
            case 'originators_list': return <OriginatorList />;
            case 'suppliers_list': return <SupplierList />;
            case 'power_plants': return <PowerPlantList />;
            case 'consumer_units': return <ConsumerUnitList />;
            case 'invoices': return <InvoiceListManager />;
            case 'billing': return <BillingList />;
            default:
                return <div style={{ padding: '2rem' }}><h2>Bem-vindo, {profile?.name}</h2><p>Selecione uma opção no menu.</p></div>;
        }
    };

    return (
        <div className="dashboard-container">
            {/* Mobile Menu Toggle */}
            <button
                className="menu-toggle"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
                <Menu size={24} />
            </button>

            {/* Mobile Overlay */}
            {isSidebarOpen && (
                <div
                    className="modal-overlay"
                    style={{ zIndex: 999, backdropFilter: 'none' }} /* Lower z-index than modal but high enough */
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''} ${isDesktopCollapsed ? 'collapsed' : ''}`}>
                <div className="sidebar-header" style={{ justifyContent: isDesktopCollapsed ? 'center' : 'space-between' }}>
                    {!isDesktopCollapsed && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <img
                                src="https://b2wenergia.com.br/wp-content/uploads/2025/12/Logo-Laranja-estreito.png"
                                alt="B2W Energia"
                                style={{ height: '35px', objectFit: 'contain' }}
                            />
                            <span style={{ color: 'white', fontWeight: 'bold', fontSize: '1.2rem' }}>B2W Energia</span>
                        </div>
                    )}

                    {/* Desktop Collapse Button */}
                    <button
                        onClick={() => setIsDesktopCollapsed(!isDesktopCollapsed)}
                        style={{ background: 'transparent', color: 'white', border: 'none', cursor: 'pointer', display: isSidebarOpen ? 'none' : 'block' }} // Hide on mobile open
                        className="desktop-only-btn" // Add class if needed for media query, or keep inline for now since media query handles sidebar width
                    >
                        {isDesktopCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                    </button>
                </div>

                <nav style={{ flex: 1, overflowY: 'auto' }}>
                    <ul style={{ listStyle: 'none' }}>
                        {currentMenu.map(item => {
                            const Icon = item.icon;
                            return (
                                <li key={item.id} style={{ marginBottom: '0.25rem' }}>
                                    <button
                                        onClick={() => {
                                            setActiveView(item.id);
                                            setIsSidebarOpen(false);
                                        }}
                                        title={isDesktopCollapsed ? item.label : ''}
                                        className={`sidebar-link ${activeView === item.id ? 'active' : ''}`}
                                        style={{ justifyContent: isDesktopCollapsed ? 'center' : 'flex-start' }}
                                    >
                                        <Icon size={20} style={{ marginRight: isDesktopCollapsed ? 0 : '0.75rem', flexShrink: 0 }} />
                                        {!isDesktopCollapsed && <span>{item.label}</span>}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                <div className="sidebar-footer">
                    {!isDesktopCollapsed && (
                        <div style={{ marginBottom: '1rem', padding: '0 0.5rem' }}>
                            <p style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{profile?.name}</p>
                            <p style={{ opacity: 0.7, fontSize: '0.75rem' }}>{profile?.role?.replace('_', ' ').toUpperCase()}</p>
                        </div>
                    )}
                    <button
                        onClick={handleLogout}
                        title="Sair"
                        className="sidebar-footer-btn"
                        style={{ justifyContent: isDesktopCollapsed ? 'center' : 'flex-start' }}
                    >
                        <LogOut size={20} style={{ marginRight: isDesktopCollapsed ? 0 : '0.5rem' }} />
                        {!isDesktopCollapsed && <span>Sair</span>}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                {renderContent()}
            </main>
        </div>
    );
}
