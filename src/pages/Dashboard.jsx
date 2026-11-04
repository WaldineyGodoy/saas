import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useBranding } from '../contexts/BrandingContext';
import { ehPapelInterno } from '../lib/papeis';

// Dashboards Existing
import AdminDashboard from './dashboards/AdminDashboard';
import SubscriberDashboard from './dashboards/SubscriberDashboard';
import SubscriberBillingDashboard from './dashboards/SubscriberBillingDashboard';
import OriginatorDashboard from './dashboards/OriginatorDashboard';
import SupplierDashboard from './dashboards/SupplierDashboard';

// New CRUD Lists
import LeadsList from './dashboards/LeadsList';
import SubscriberList from './dashboards/SubscriberList';
import OriginatorList from './dashboards/OriginatorList';
import SupplierList from './dashboards/SupplierList';
import PowerPlantList from './dashboards/PowerPlantList';
import EletropostoList from './dashboards/EletropostoList';
import InvoiceListManager from './dashboards/InvoiceListManager';
import ConsumerUnitList from './dashboards/ConsumerUnitList';
import BillingList from './dashboards/BillingList';
import SettingsLayout from './dashboards/SettingsLayout';
import GridMap from './dashboards/GridMap';
import GraphNodeView from './dashboards/GraphNodeView';
import RateioList from './dashboards/RateioList';
import Arrendamento from './dashboards/Arrendamento';
import ProtocolList from './dashboards/ProtocolList';

const ROLE_LABELS = {
    super_admin: 'Super admin',
    admin: 'Administrador',
    manager: 'Gestor',
    coordinator: 'Coordenador',
    originator: 'Originador',
    broker: 'Corretor',
    supplier: 'Fornecedor',
    subscriber: 'Assinante',
    lead: 'Lead'
};

function iniciaisPerfil(nome) {
    if (!nome) return 'U';
    const partes = String(nome).trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return 'U';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function rotuloPapel(role) {
    if (!role) return 'Usuário';
    if (ROLE_LABELS[role]) return ROLE_LABELS[role];
    const limpo = String(role).replace(/_/g, ' ').toLowerCase();
    return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

export default function Dashboard() {
    const { profile, signOut } = useAuth();
    const { branding } = useBranding();
    const navigate = useNavigate();
    const [activeView, setActiveView] = useState(localStorage.getItem('dashboard_active_view') || 'default');

    // Mobile sidebar state
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    // Desktop sidebar state
    const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
    // Fallback if external logo URL is blocked by OpaqueResponseBlocking
    const [logoFailed, setLogoFailed] = useState(false);

    useEffect(() => {
        setLogoFailed(false);
    }, [branding?.logo_url]);

    // Reset view when profile loads (only if checking for the first time)
    useEffect(() => {
        if (profile && activeView === 'default') {
            if (profile.role === 'subscriber') setActiveView('subscriber_dashboard');
            else if (profile.role === 'supplier') setActiveView('supplier_dashboard');
            // For all other roles (admin, super_admin, originator, broker, coordinator, manager), default to Graph Node View
            else setActiveView('graph_node_view');
        }
    }, [profile, activeView]);

    // Persist view whenever it changes
    useEffect(() => {
        if (activeView !== 'default') {
            localStorage.setItem('dashboard_active_view', activeView);
        }
    }, [activeView]);

    // Listen to open-protocol event from HistoryTimeline
    useEffect(() => {
        const handleOpenProtocol = (e) => {
            if (e.detail?.protocolId) {
                localStorage.setItem('open_protocol_id_on_load', e.detail.protocolId);
                setActiveView('protocols');
            }
        };
        window.addEventListener('open-protocol', handleOpenProtocol);
        return () => window.removeEventListener('open-protocol', handleOpenProtocol);
    }, []);

    const handleLogout = async () => {
        await signOut();
        localStorage.removeItem('dashboard_active_view');
        navigate('/login');
    };

    const getMenuItems = (role) => {
        if (!role) return [];

        const items = [];

        // 0. Graph Node View (Obsidian Graph View)
        if (role !== 'subscriber' && role !== 'supplier' && role !== 'lead') {
            items.push({ id: 'graph_node_view', label: 'Graph Node View', icon: 'bi-share', group: 'Comercial' });
        }

        // 1. Leads
        if (role !== 'subscriber') {
            items.push({ id: 'leads', label: 'Leads', icon: 'bi-megaphone', group: 'Comercial' });
        }

        // 2. Originadores
        const originatorsAllowed = ['originator', 'coordinator', 'manager', 'admin', 'super_admin'];
        if (originatorsAllowed.includes(role)) {
            if (role === 'originator') {
                items.push({ id: 'originator_dashboard', label: 'Minhas Comissões', icon: 'bi-speedometer2', group: 'Comercial' });
                items.push({ id: 'originators_list', label: 'Equipe', icon: 'bi-briefcase', group: 'Comercial' });
            } else {
                items.push({ id: 'originators_list', label: 'Originadores', icon: 'bi-briefcase', group: 'Comercial' });
            }
        }

        // 3. Assinantes
        if (role !== 'lead') {
            if (role === 'subscriber') {
                items.push({ id: 'subscriber_dashboard', label: 'Meu Painel', icon: 'bi-speedometer2', group: 'Comercial' });
            } else {
                items.push({ id: 'subscribers_list', label: 'Assinantes', icon: 'bi-person-check', group: 'Comercial' });
            }
        }

        // 4. Unidades Consumidoras
        if (role !== 'lead' && role !== 'subscriber') {
            items.push({ id: 'consumer_units', label: 'Unidades Consumidoras', icon: 'bi-house', group: 'Faturamento' });
        }

        // 5 e 6. Contas de Energia e Faturas (InvoiceListManager)
        //
        // Ate 22/09/2026 estes dois itens entravam para TODOS os papeis — lead,
        // assinante, embaixador, fornecedor. E a tela nao e de consulta: tem
        // arrastar-para-Pago, apagar fatura e baixar conta de concessionaria.
        // Era o caminho literal da regra do dono, "embaixador nao pode marcar
        // fatura como paga". Desde a migracao 20260922h o banco recusa essa
        // escrita (RLS de invoices), e o menu deixa de oferecer a tela a quem
        // nao pode usa-la. O assinante continua vendo as proprias faturas em
        // "Meu Painel" (SubscriberDashboard), que e a tela feita para isso.
        if (ehPapelInterno(role)) {
            items.push({ id: 'energy_bills', label: 'Contas de Energia', icon: 'bi-file-earmark-text', group: 'Faturamento' });
            items.push({ id: 'invoices', label: 'Faturas', icon: 'bi-receipt', group: 'Faturamento' });
            // Posicao de cobranca do assinante: doze ciclos por UC, so leitura.
            // Nao substitui "Meu Painel", que e a tela do proprio assinante.
            items.push({ id: 'subscriber_billing', label: 'Posição do Assinante', icon: 'bi-table', group: 'Faturamento' });
        }

        // 6. Fornecedores
        const suppliersAllowed = ['supplier', 'manager', 'admin', 'super_admin'];
        if (suppliersAllowed.includes(role)) {
            if (role === 'supplier') {
                items.push({ id: 'supplier_dashboard', label: 'Meu Painel', icon: 'bi-speedometer2', group: 'Ativos e rede' });
            } else {
                items.push({ id: 'suppliers_list', label: 'Fornecedores', icon: 'bi-truck', group: 'Ativos e rede' });
            }
        }

        // 7. Usinas
        if (suppliersAllowed.includes(role)) {
            items.push({ id: 'power_plants', label: 'Usinas', icon: 'bi-lightning-charge', group: 'Ativos e rede' });
            items.push({ id: 'eletropostos', label: 'Eletropostos', icon: 'bi-ev-station', group: 'Ativos e rede' });
            items.push({ id: 'rateio_list', label: 'Lista de Rateio', icon: 'bi-list-check', group: 'Ativos e rede' });
            items.push({ id: 'protocols', label: 'Protocolos', icon: 'bi-clipboard-check', group: 'Ativos e rede' });
            items.push({ id: 'grid_map', label: 'Rede (Mapa)', icon: 'bi-map', group: 'Ativos e rede' });
        }

        // 8. Billing
        const billingAllowed = ['supplier', 'manager', 'admin', 'super_admin'];
        if (billingAllowed.includes(role)) {
            items.push({ id: 'billing', label: 'Billing', icon: 'bi-currency-dollar', group: 'Faturamento' });
        }

        // 9. Repasse de arrendamento — move dinheiro, e a pay-asaas-bill exige
        //    admin do lado do servidor de qualquer forma.
        if (['admin', 'super_admin'].includes(role)) {
            items.push({ id: 'arrendamento_pagamentos', label: 'Arrendamento', icon: 'bi-signpost-2', group: 'Faturamento' });
        }

        // 10. Gestão de Usuários
        if (['admin', 'super_admin'].includes(role)) {
            items.push({ id: 'settings', label: 'Configurações', icon: 'bi-gear', group: 'Sistema' });
        }

        return items;
    };

    const currentMenu = getMenuItems(profile?.role);

    // Agrupa os itens preservando a ordem natural das seções
    const GROUP_ORDER = ['Comercial', 'Faturamento', 'Ativos e rede', 'Sistema'];
    const groupedMenu = GROUP_ORDER
        .map(groupName => ({
            group: groupName,
            items: currentMenu.filter(item => (item.group || 'Comercial') === groupName)
        }))
        .filter(section => section.items.length > 0);

    const renderContent = () => {
        if (!profile) return <p>Carregando perfil...</p>;

        // `activeView` vem do localStorage: quem ja tinha a tela Faturas aberta
        // continuaria caindo nela depois do logout/login, mesmo sem o item no
        // menu. Aqui o caminho tambem fecha.
        if (['invoices', 'energy_bills', 'subscriber_billing'].includes(activeView) && !ehPapelInterno(profile.role)) {
            return (
                <div style={{ padding: '2rem' }}>
                    <h2>Bem-vindo, {profile?.name}</h2>
                    <p>Selecione uma opção no menu.</p>
                </div>
            );
        }

        switch (activeView) {
            case 'admin': return <AdminDashboard />;
            case 'subscriber_dashboard': return <SubscriberDashboard />;
            case 'subscriber_billing': return <SubscriberBillingDashboard />;
            case 'originator_dashboard': return <OriginatorDashboard />;
            case 'supplier_dashboard': return <SupplierDashboard />;
            case 'graph_node_view': return <GraphNodeView />;
            case 'leads': return <LeadsList />;
            case 'subscribers_list': return <SubscriberList />;
            case 'originators_list': return <OriginatorList />;
            case 'suppliers_list': return <SupplierList />;
            case 'power_plants': return <PowerPlantList />;
            case 'eletropostos': return <EletropostoList />;
            case 'consumer_units': return <ConsumerUnitList />;
            case 'energy_bills': return <InvoiceListManager key="energy_bills" initialTab="contas_energia" hideTabs={true} />;
            case 'invoices': return <InvoiceListManager key="invoices" initialTab="faturas" hideTabs={true} />;
            case 'billing': return <BillingList />;
            case 'settings': return <SettingsLayout />;
            case 'grid_map': return <GridMap />;
            case 'rateio_list': return <RateioList />;
            case 'arrendamento_pagamentos': return <Arrendamento />;
            case 'protocols': return <ProtocolList />;

            default:
                return <div style={{ padding: '2rem' }}><h2>Bem-vindo, {profile?.name}</h2><p>Selecione uma opção no menu.</p></div>;
        }
    };

    return (
        <div className="dashboard-container">
            {/* Mobile Menu Toggle */}
            <button
                type="button"
                className="menu-toggle"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                aria-label={isSidebarOpen ? 'Fechar menu lateral' : 'Abrir menu lateral'}
            >
                <i className="bi bi-list" style={{ fontSize: '22px' }}></i>
            </button>

            {/* Mobile Overlay */}
            {isSidebarOpen && (
                <div
                    className="modal-overlay"
                    style={{ zIndex: 999, backdropFilter: 'none' }}
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''} ${isDesktopCollapsed ? 'collapsed' : ''}`}>
                <div className="sidebar-header">
                    <div className="sidebar-brand-group" title={branding.company_name || 'B2W Energia'}>
                        <div className="sidebar-brand-mark">
                            {branding?.logo_url && !logoFailed ? (
                                <img
                                    src={branding.logo_url}
                                    alt={branding.company_name || 'B2W Energia'}
                                    onError={() => setLogoFailed(true)}
                                    style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                                />
                            ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path
                                        d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"
                                        fill="var(--color-orange)"
                                        stroke="var(--color-blue)"
                                        strokeWidth="1.5"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            )}
                        </div>
                        {!isDesktopCollapsed && (
                            <div className="sidebar-brand-text">
                                <span className="sidebar-brand-title">{branding.company_name || 'B2W Energia'}</span>
                                <span className="sidebar-brand-scope">CRM Operacional</span>
                            </div>
                        )}
                    </div>

                    {/* Desktop Collapse Button */}
                    <button
                        type="button"
                        onClick={() => setIsDesktopCollapsed(!isDesktopCollapsed)}
                        style={{ display: isSidebarOpen ? 'none' : 'inline-flex' }}
                        className="sidebar-collapse-btn"
                        title={isDesktopCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
                        aria-label={isDesktopCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
                    >
                        <i className={`bi ${isDesktopCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`} style={{ fontSize: '12px' }}></i>
                    </button>
                </div>

                <nav className="sidebar-nav" aria-label="Menu principal do CRM">
                    {groupedMenu.map((section, idx) => (
                        <div key={section.group} className="sidebar-group">
                            {!isDesktopCollapsed ? (
                                groupedMenu.length > 1 && (
                                    <div className="sidebar-group-label">{section.group}</div>
                                )
                            ) : (
                                idx > 0 && <div className="sidebar-group-rule" aria-hidden />
                            )}
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {section.items.map(item => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setActiveView(item.id);
                                                setIsSidebarOpen(false);
                                            }}
                                            title={isDesktopCollapsed ? item.label : undefined}
                                            aria-label={isDesktopCollapsed ? item.label : undefined}
                                            aria-current={activeView === item.id ? 'page' : undefined}
                                            className={`sidebar-link ${activeView === item.id ? 'active' : ''}`}
                                        >
                                            <i className={`bi ${item.icon}`} aria-hidden="true"></i>
                                            {!isDesktopCollapsed && <span>{item.label}</span>}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <div
                        className="sidebar-user-row"
                        style={{ justifyContent: isDesktopCollapsed ? 'center' : 'flex-start' }}
                        title={isDesktopCollapsed ? `${profile?.name || ''} · ${rotuloPapel(profile?.role)}` : undefined}
                    >
                        <span className="sidebar-user-avatar" aria-hidden="true">
                            {iniciaisPerfil(profile?.name)}
                        </span>
                        {!isDesktopCollapsed && (
                            <div className="sidebar-user-meta">
                                <span className="sidebar-user-name">{profile?.name || 'Usuário'}</span>
                                <span className="sidebar-user-role">{rotuloPapel(profile?.role)}</span>
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={handleLogout}
                        title="Sair"
                        aria-label="Sair da conta"
                        className="sidebar-footer-btn"
                        style={{ justifyContent: isDesktopCollapsed ? 'center' : 'flex-start' }}
                    >
                        <i className="bi bi-box-arrow-right" aria-hidden="true"></i>
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
