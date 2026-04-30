import { useState } from 'react';
import { Users, Code, CreditCard, Palette, Mail, Zap, Bell } from 'lucide-react';

import UserProfilesSettings from '../settings/UserProfilesSettings';
import IntegrationSettings from '../settings/IntegrationSettings';
import CustomizationSettings from '../settings/CustomizationSettings';
import EnergyAccountSettings from '../settings/EnergyAccountSettings';
import NotificationHubSettings from '../settings/NotificationHubSettings';

export default function SettingsLayout() {
    const [activeTab, setActiveTab] = useState('users');

    const menuItems = [
        { id: 'users', label: 'Perfil de Usuários', icon: Users, desc: 'Gerenciar usuários e acesso' },
        { id: 'notifications', label: 'Central de Notificações', icon: Bell, desc: 'Configuração de WhatsApp e Gatilhos' },

        { id: 'financial', label: 'Integração Financeira', icon: CreditCard, desc: 'Gateways de Pagamento' },
        { id: 'energy', label: 'Conta de Energia', icon: Zap, desc: 'Regras de Faturamento' },
        { id: 'branding', label: 'Padronização', icon: Palette, desc: 'Identidade Visual e Marca' },
        { id: 'autentique', label: 'Assinatura Eletrônica', icon: Code, desc: 'Configuração Autentique' },
    ];

    const renderContent = () => {
        switch (activeTab) {
            case 'users':
                return <UserProfilesSettings />;
            case 'notifications':
                return <NotificationHubSettings />;

            case 'financial':
                return <IntegrationSettings serviceName="financial_api" title="Integração Financeira" description="Gateways de Pagamento (Asaas, etc)" />;
            case 'energy':
                return <EnergyAccountSettings />;
            case 'branding':
                return <CustomizationSettings />;
            case 'autentique':
                return <IntegrationSettings serviceName="autentique_api" title="Assinatura Eletrônica" description="Configuração da API Autentique (GraphQL)" />;
            default:
                return null;
        }
    };

    return (
        <div style={{ padding: '2rem', height: '100%' }}>
            <h2 style={{ marginBottom: '0.5rem', color: '#1e293b' }}>Configurações</h2>
            <p style={{ color: '#64748b', marginBottom: '2rem' }}>Gerencie as configurações gerais e integrações do sistema.</p>

            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '2rem', alignItems: 'start' }}>
                {/* Internal Sidebar */}
                <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                    <div style={{ padding: '1rem', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Menu</span>
                    </div>
                    <div>
                        {menuItems.map(item => (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.75rem',
                                    padding: '1rem 1.5rem',
                                    border: 'none',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    color: activeTab === item.id ? '#0284c7' : '#475569',
                                    background: activeTab === item.id ? '#f0f9ff' : 'transparent',
                                    borderLeft: activeTab === item.id ? '3px solid #0284c7' : '3px solid transparent',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <item.icon size={18} />
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.label}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{item.desc}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content Area */}
                <div style={{ minHeight: '500px', minWidth: 0 }}>
                    {renderContent()}
                </div>
            </div>
        </div>
    );
}
