import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { Clock, Send, User, Calendar as CalendarIcon, X, Search } from 'lucide-react';

// Reusable CollapsibleSection Component
export const CollapsibleSection = ({ title, icon: Icon, children, defaultOpen = false, noGrid = false }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div style={{
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            overflow: 'visible',
            marginBottom: '1rem',
            background: 'white'
        }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    background: '#f8fafc',
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontWeight: 600,
                    color: '#1e293b'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {Icon && <Icon size={18} style={{ color: 'var(--color-blue)' }} />}
                    <span>{title}</span>
                </div>
                <span style={{
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    fontSize: '0.8rem'
                }}>▼</span>
            </div>
            {isOpen && (
                <div style={{
                    padding: '1.25rem',
                    borderTop: '1px solid #e2e8f0',
                    display: noGrid ? 'block' : 'grid',
                    gridTemplateColumns: noGrid ? 'none' : '1fr 1fr',
                    gap: '1.25rem'
                }}>
                    {children}
                </div>
            )}
        </div>
    );
};
export default function HistoryTimeline({ entityType, entityId, entityName, onClose, isInline = false, compact = false, hideHeader = false }) {
    const { profile } = useAuth();
    const { showAlert } = useUI();
    const [history, setHistory] = useState([]);
    const [newComment, setNewComment] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [expandedItems, setExpandedItems] = useState({});
    const CHARACTER_LIMIT = compact ? 80 : 150;

    useEffect(() => {
        fetchHistory();
    }, [entityId]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('v_crm_history')
                .select('*')
                .eq('entity_type', entityType)
                .eq('entity_id', entityId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setHistory(data || []);
        } catch (error) {
            console.error('Error fetching history:', error);
            showAlert('Erro ao carregar histórico', 'error');
        } finally {
            setLoading(false);
        }
    };

    const filteredHistory = history.filter(item => {
        if (!searchTerm) return true;
        const lower = searchTerm.toLowerCase();
        const dateStr = new Date(item.created_at).toLocaleString('pt-BR').toLowerCase();
        return (
            item.content?.toLowerCase().includes(lower) ||
            item.author_name?.toLowerCase().includes(lower) ||
            item.event_type?.toLowerCase().includes(lower) ||
            dateStr.includes(lower)
        );
    });

    const handleAddComment = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (!newComment.trim()) return;

        setSubmitting(true);
        try {
            const { error } = await supabase
                .from('crm_history')
                .insert({
                    entity_type: entityType,
                    entity_id: entityId,
                    content: newComment.trim(),
                    created_by: profile.id
                });

            if (error) throw error;

            setNewComment('');
            fetchHistory();
            showAlert('Comentário adicionado!', 'success');
        } catch (error) {
            console.error('Error adding comment:', error);
            showAlert('Erro ao adicionar comentário', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const containerStyle = isInline ? {
        background: 'white',
        padding: '0',
        borderRadius: compact ? '0' : '12px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: compact ? 'none' : '1px solid #e2e8f0',
        height: '100%'
    } : {
        background: 'white',
        padding: '0',
        borderRadius: '12px',
        width: '90%',
        maxWidth: '600px',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        animation: 'modalSlideUp 0.3s ease-out'
    };

    const wrapperStyle = isInline ? {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
    } : {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000,
        backdropFilter: 'blur(8px)'
    };

    return (
        <div style={wrapperStyle}>
            <div style={containerStyle}>
                {/* Header */}
                {!hideHeader && (
                    <div style={{
                        padding: compact ? '0.75rem 1rem' : '1.25rem 1.5rem',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: '#f8fafc',
                        borderTopLeftRadius: compact ? '0' : '12px',
                        borderTopRightRadius: compact ? '0' : '12px'
                    }}>
                        <div>
                            <h3 style={{ margin: 0, fontSize: compact ? '1rem' : '1.25rem', color: '#1e293b', fontWeight: 700 }}>Histórico / Timeline</h3>
                            {!compact && <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>{entityName}</p>}
                        </div>
                        {onClose && (
                            <button onClick={onClose} style={{
                                background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#64748b', padding: '0.6rem',
                                borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.2s',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                            }}
                            onMouseOver={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                            onMouseOut={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                            >
                                <X size={20} />
                            </button>
                        )}
                    </div>
                )}

                {/* Search Bar */}
                {!compact && (
                    <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid #e2e8f0', background: 'white' }}>
                        <div style={{ position: 'relative' }}>
                            <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Pesquisar por tipo, data ou texto..."
                                style={{
                                    width: '100%',
                                    padding: '0.6rem 1rem 0.6rem 2.5rem',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '8px',
                                    fontSize: '0.9rem',
                                    outline: 'none',
                                    transition: 'all 0.2s',
                                    background: '#f8fafc'
                                }}
                                onFocus={(e) => {
                                    e.target.style.borderColor = 'var(--color-blue)';
                                    e.target.style.background = 'white';
                                    e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                                }}
                                onBlur={(e) => {
                                    e.target.style.borderColor = '#e2e8f0';
                                    e.target.style.background = '#f8fafc';
                                    e.target.style.boxShadow = 'none';
                                }}
                            />
                            {searchTerm && (
                                <button 
                                    onClick={() => setSearchTerm('')}
                                    style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Timeline content */}
                <div style={{ 
                    flex: 1, 
                    overflowY: 'auto', 
                    padding: '1.5rem', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '1.5rem',
                    maxHeight: isInline ? '400px' : 'none'
                }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>Carregando histórico...</div>
                    ) : filteredHistory.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '3rem' }}>
                            <Search size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                            <p>{searchTerm ? 'Nenhum resultado para sua busca.' : 'Nenhum registro encontrado.'}</p>
                        </div>
                    ) : (
                        <div style={{ position: 'relative', paddingLeft: '2rem' }}>
                            {/* Line */}
                            <div style={{
                                position: 'absolute', left: '7px', top: '0', bottom: '0',
                                width: '2px', background: '#e2e8f0'
                            }} />

                            {filteredHistory.map((item, index) => (
                                <div key={item.id} style={{ position: 'relative', marginBottom: '2rem' }}>
                                    {/* Dot */}
                                    <div style={{
                                        position: 'absolute', left: '-29px', top: '4px',
                                        width: '16px', height: '16px', borderRadius: '50%',
                                        background: index === 0 ? 'var(--color-blue)' : '#cbd5e1',
                                        border: '4px solid white',
                                        boxShadow: '0 0 0 1px #e2e8f0'
                                    }} />

                                    <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.75rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: '#475569' }}>
                                                <User size={14} />
                                                {item.author_name || 'Sistema'}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#94a3b8' }}>
                                                <CalendarIcon size={14} />
                                                {new Date(item.created_at).toLocaleString('pt-BR')}
                                            </div>
                                        </div>
                                        <div style={{ color: '#334155', fontSize: '0.9rem', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                                            {(() => {
                                                // Priorizar a mensagem completa que costuma estar no metadata (visto na lógica de addHistory)
                                                const fullMessage = item.metadata?.message || item.metadata?.text || item.content;
                                                const isLong = fullMessage.length > CHARACTER_LIMIT;
                                                const isExpanded = expandedItems[item.id];
                                                const displayContent = isExpanded ? fullMessage : (isLong ? fullMessage.substring(0, CHARACTER_LIMIT) + '...' : fullMessage);

                                                return (
                                                    <>
                                                        {displayContent}
                                                        {isLong && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    setExpandedItems(prev => ({ ...prev, [item.id]: !isExpanded }));
                                                                }}
                                                                style={{
                                                                    display: 'inline-block',
                                                                    marginLeft: '0.5rem',
                                                                    background: 'none',
                                                                    border: 'none',
                                                                    padding: 0,
                                                                    color: 'var(--color-blue)',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: 700,
                                                                    cursor: 'pointer',
                                                                    textDecoration: 'underline'
                                                                }}
                                                            >
                                                                {isExpanded ? 'Ver menos' : 'Ver mais'}
                                                            </button>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer / Input area */}
                <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid #e2e8f0', background: 'white', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <textarea
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleAddComment();
                                }
                            }}
                            placeholder="Escreva um comentário ou atualização..."
                            style={{
                                flex: 1, padding: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                resize: 'none', height: '60px', fontSize: '0.9rem', outline: 'none',
                                transition: 'border-color 0.2s'
                            }}
                            onFocus={(e) => e.target.style.borderColor = 'var(--color-blue)'}
                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                        />
                        <button
                            type="button"
                            onClick={() => handleAddComment()}
                            disabled={submitting || !newComment.trim()}
                            style={{
                                background: 'var(--color-blue)', color: 'white', border: 'none',
                                borderRadius: '8px', padding: '0 1.25rem', cursor: submitting ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600,
                                opacity: !newComment.trim() ? 0.5 : 1,
                                transition: 'transform 0.1s'
                            }}
                            onMouseDown={(e) => !submitting && (e.currentTarget.style.transform = 'scale(0.95)')}
                            onMouseUp={(e) => !submitting && (e.currentTarget.style.transform = 'scale(1)')}
                        >
                            <Send size={18} />
                            {submitting ? '...' : 'Postar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
