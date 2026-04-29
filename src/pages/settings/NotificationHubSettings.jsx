import { useState } from 'react';
import { MessageSquare, Zap, Settings, Mail } from 'lucide-react';
import IntegrationSettings from './IntegrationSettings';
import TriggerMessageDashboard from './TriggerMessageDashboard';

export default function NotificationHubSettings() {
    const [activeSubTab, setActiveSubTab] = useState('evolution');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
            {/* Horizontal Tabs */}
            <div style={{ 
                display: 'flex', 
                gap: '1rem', 
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '0.5rem',
                marginBottom: '0.5rem'
            }}>
                <button
                    onClick={() => setActiveSubTab('evolution')}
                    style={{
                        padding: '0.75rem 1.5rem',
                        border: 'none',
                        background: 'none',
                        color: activeSubTab === 'evolution' ? '#0284c7' : '#64748b',
                        borderBottom: activeSubTab === 'evolution' ? '2px solid #0284c7' : '2px solid transparent',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.2s'
                    }}
                >
                    <Settings size={18} /> Evolution API
                </button>
                <button
                    onClick={() => setActiveSubTab('triggers')}
                    style={{
                        padding: '0.75rem 1.5rem',
                        border: 'none',
                        background: 'none',
                        color: activeSubTab === 'triggers' ? '#0284c7' : '#64748b',
                        borderBottom: activeSubTab === 'triggers' ? '2px solid #0284c7' : '2px solid transparent',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.2s'
                    }}
                >
                    <Zap size={18} /> Trigger Message
                </button>
                <button
                    onClick={() => setActiveSubTab('email')}
                    style={{
                        padding: '0.75rem 1.5rem',
                        border: 'none',
                        background: 'none',
                        color: activeSubTab === 'email' ? '#0284c7' : '#64748b',
                        borderBottom: activeSubTab === 'email' ? '2px solid #0284c7' : '2px solid transparent',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.2s'
                    }}
                >
                    <Mail size={18} /> Serviço de e-mail
                </button>
            </div>

            {/* Sub-tab Content */}
            <div style={{ flex: 1 }}>
                {activeSubTab === 'evolution' && (
                    <IntegrationSettings 
                        serviceName="evolution_api" 
                        title="Evolution API (WhatsApp)" 
                        description="Configure a conexão técnica com a API Evolution para envio de mensagens."
                    />
                )}
                {activeSubTab === 'triggers' && <TriggerMessageDashboard />}
                {activeSubTab === 'email' && (
                    <IntegrationSettings 
                        serviceName="resend_api" 
                        title="Serviço de E-mail" 
                        description="Configuração de envio via Resend" 
                    />
                )}
            </div>
        </div>
    );
}
