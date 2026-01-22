import React, { createContext, useContext, useState, useRef } from 'react';
import { X, AlertCircle, CheckCircle, HelpCircle, Info } from 'lucide-react';

const UIContext = createContext();

export const useUI = () => {
    const context = useContext(UIContext);
    if (!context) {
        throw new Error('useUI must be used within a UIProvider');
    }
    return context;
};

export const UIProvider = ({ children }) => {
    const [dialog, setDialog] = useState({
        isOpen: false,
        type: 'alert', // 'alert' | 'confirm'
        variant: 'info', // 'info' | 'success' | 'error' | 'warning'
        title: '',
        message: '',
        confirmText: 'Confirmar',
        cancelText: 'Cancelar',
        onConfirm: () => { },
        onCancel: () => { }
    });

    // Promise-based resolver for confirm dialogs
    const confirmResolver = useRef(null);

    const closeDialog = () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        if (confirmResolver.current) {
            confirmResolver.current(false);
            confirmResolver.current = null;
        }
    };

    const handleConfirm = () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        if (dialog.onConfirm) dialog.onConfirm();
        if (confirmResolver.current) {
            confirmResolver.current(true);
            confirmResolver.current = null;
        }
    };

    const showAlert = (message, variant = 'info', title = '') => {
        if (!title) {
            switch (variant) {
                case 'error': title = 'Erro'; break;
                case 'success': title = 'Sucesso'; break;
                case 'warning': title = 'Atenção'; break;
                default: title = 'Informação';
            }
        }

        setDialog({
            isOpen: true,
            type: 'alert',
            variant,
            title,
            message,
            confirmText: 'OK',
            onConfirm: () => { },
            onCancel: () => { }
        });
    };

    /**
     * Shows a confirmation dialog and returns a Promise that resolves to true (confirmed) or false (cancelled).
     */
    const showConfirm = (message, title = 'Confirmação', confirmText = 'Confirmar', cancelText = 'Cancelar') => {
        return new Promise((resolve) => {
            confirmResolver.current = resolve;
            setDialog({
                isOpen: true,
                type: 'confirm',
                variant: 'warning',
                title,
                message,
                confirmText,
                cancelText,
                onConfirm: () => { }, // Handled by handleConfirm wrapper
                onCancel: () => { }   // Handled by closeDialog wrapper
            });
        });
    };

    const getIcon = () => {
        switch (dialog.variant) {
            case 'error': return <AlertCircle size={32} color="#ef4444" />;
            case 'success': return <CheckCircle size={32} color="#22c55e" />;
            case 'warning': return <HelpCircle size={32} color="#f59e0b" />;
            default: return <Info size={32} color="#3b82f6" />;
        }
    };

    return (
        <UIContext.Provider value={{ showAlert, showConfirm }}>
            {children}
            {dialog.isOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
                    zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center',
                    animation: 'fadeIn 0.2s ease-out'
                }}>
                    <div style={{
                        background: 'white',
                        borderRadius: '12px',
                        padding: '24px',
                        width: '90%',
                        maxWidth: '400px',
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <div style={{
                                    padding: '8px',
                                    borderRadius: '50%',
                                    background: dialog.variant === 'error' ? '#fee2e2' :
                                        dialog.variant === 'success' ? '#dcfce7' :
                                            dialog.variant === 'warning' ? '#fef3c7' : '#dbeafe'
                                }}>
                                    {getIcon()}
                                </div>
                                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '600', color: '#1f2937' }}>{dialog.title}</h3>
                            </div>
                            <button onClick={closeDialog} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <p style={{ margin: 0, color: '#4b5563', fontSize: '1rem', lineHeight: '1.5' }}>
                            {dialog.message}
                        </p>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                            {dialog.type === 'confirm' && (
                                <button
                                    onClick={closeDialog}
                                    style={{
                                        padding: '8px 16px',
                                        borderRadius: '6px',
                                        border: '1px solid #e5e7eb',
                                        background: 'white',
                                        color: '#374151',
                                        fontWeight: '500',
                                        cursor: 'pointer',
                                        transition: 'background 0.2s'
                                    }}
                                    onMouseOver={e => e.currentTarget.style.background = '#f9fafb'}
                                    onMouseOut={e => e.currentTarget.style.background = 'white'}
                                >
                                    {dialog.cancelText}
                                </button>
                            )}
                            <button
                                onClick={handleConfirm}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: dialog.variant === 'error' ? '#dc2626' : 'var(--color-blue)',
                                    color: 'white',
                                    fontWeight: '500',
                                    cursor: 'pointer',
                                    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                                    transition: 'filter 0.2s'
                                }}
                                onMouseOver={e => e.currentTarget.style.filter = 'brightness(0.9)'}
                                onMouseOut={e => e.currentTarget.style.filter = 'brightness(1)'}
                            >
                                {dialog.confirmText}
                            </button>
                        </div>
                    </div>
                    <style>{`
                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                    `}</style>
                </div>
            )}
        </UIContext.Provider>
    );
};
