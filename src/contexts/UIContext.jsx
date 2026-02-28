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
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: '8px'
                        }}>
                            <div style={{
                                padding: '12px',
                                borderRadius: '16px',
                                background: dialog.variant === 'error' ? '#fef2f2' :
                                    dialog.variant === 'success' ? '#f0fdf4' :
                                        dialog.variant === 'warning' ? '#fffbeb' : '#f0f9ff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: 'inset 0 2px 4px 0 rgba(0,0,0,0.05)'
                            }}>
                                {getIcon()}
                            </div>
                            <button
                                onClick={closeDialog}
                                style={{
                                    background: '#f8fafc',
                                    border: '1px solid #f1f5f9',
                                    borderRadius: '8px',
                                    padding: '4px',
                                    cursor: 'pointer',
                                    color: '#94a3b8',
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.background = '#f1f5f9'; }}
                                onMouseOut={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = '#f8fafc'; }}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ marginBottom: '8px' }}>
                            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem', fontWeight: '700', color: '#1e293b', letterSpacing: '-0.025em' }}>
                                {dialog.title}
                            </h3>
                            <p style={{ margin: 0, color: '#64748b', fontSize: '0.95rem', lineHeight: '1.6' }}>
                                {dialog.message}
                            </p>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                            {dialog.type === 'confirm' && (
                                <button
                                    onClick={closeDialog}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '10px',
                                        border: '1px solid #e2e8f0',
                                        background: 'white',
                                        color: '#475569',
                                        fontWeight: '600',
                                        fontSize: '0.9rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
                                    onMouseOut={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
                                >
                                    {dialog.cancelText}
                                </button>
                            )}
                            <button
                                onClick={handleConfirm}
                                style={{
                                    padding: '10px 24px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: dialog.variant === 'error' ? '#ef4444' :
                                        dialog.variant === 'success' ? '#22c55e' : 'var(--color-blue)',
                                    color: 'white',
                                    fontWeight: '600',
                                    fontSize: '0.9rem',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                                    transition: 'all 0.2s',
                                    transform: 'translateY(0)'
                                }}
                                onMouseOver={e => { e.currentTarget.style.filter = 'brightness(1.1)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                onMouseOut={e => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                            >
                                {dialog.confirmText}
                            </button>
                        </div>
                    </div>
                    <style>{`
                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes slideUp { 
                            from { opacity: 0; transform: scale(0.95) translateY(10px); } 
                            to { opacity: 1; transform: scale(1) translateY(0); } 
                        }
                    `}</style>
                </div>
            )}
        </UIContext.Provider>
    );
};
