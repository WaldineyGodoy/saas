import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { Clock, Send, User, Calendar as CalendarIcon, X } from 'lucide-react';

// Reusable CollapsibleSection Component
export const CollapsibleSection = ({ title, icon: Icon, children, defaultOpen = false }) => {
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
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1.25rem'
                }}>
                    {children}
                </div>
            )}
        </div>
    );
};

export default function HistoryTimeline({ entityType, entityId, entityName, onClose }) {
    const { profile } = useAuth();
    const { showAlert } = useUI();
    const [history, setHistory] = useState([]);
    const [newComment, setNewComment] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

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

    const handleAddComment = async (e) => {
        e.preventDefault();
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

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100,
            backdropFilter: 'blur(4px)'
        }}>
            <div style={{
                background: 'white',
                padding: '0',
                borderRadius: '12px',
                width: '90%',
                maxWidth: '600px',
                height: '80vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.25rem 1.5rem',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#f8fafc',
                    borderTopLeftRadius: '12px',
                    borderTopRightRadius: '12px'
                }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Histórico / Timeline</h3>
                        <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>{entityName}</p>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: '0.5rem',
                        transition: 'color 0.2s'
                    }}>
                        <X size={24} />
                    </button>
                </div>

                {/* Timeline content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>Carregando histórico...</div>
                    ) : history.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '3rem' }}>
                            <Clock size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                            <p>Nenhum registro encontrado.</p>
                        </div>
                    ) : (
                        <div style={{ position: 'relative', paddingLeft: '2rem' }}>
                            {/* Line */}
                            <div style={{
                                position: 'absolute', left: '7px', top: '0', bottom: '0',
                                width: '2px', background: '#e2e8f0'
                            }} />

                            {history.map((item, index) => (
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
                                            {item.content}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer / Input area */}
                <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid #e2e8f0', background: 'white', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
                    <form onSubmit={handleAddComment} style={{ display: 'flex', gap: '0.75rem' }}>
                        <textarea
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
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
                            type="submit"
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
                    </form>
                </div>
            </div>
        </div>
    );
}
