import React, { useState, useRef, useEffect } from 'react';
import { getTagColor, DEFAULT_TAGS } from '../lib/tagHelpers';
import { X } from 'lucide-react';

export default function TagInput({ value = [], onChange }) {
    const [inputValue, setInputValue] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const addTag = (tag) => {
        let newTag = tag.trim();
        if (!newTag.startsWith('#')) {
            newTag = '#' + newTag;
        }
        if (!value.includes(newTag)) {
            onChange([...value, newTag]);
        }
        setInputValue('');
        setIsOpen(false);
    };

    const removeTag = (tagToRemove) => {
        onChange(value.filter(tag => tag !== tagToRemove));
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && inputValue.trim()) {
            e.preventDefault();
            addTag(inputValue);
        } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
            removeTag(value[value.length - 1]);
        }
    };

    const filteredDefaults = DEFAULT_TAGS.filter(dt => 
        !value.includes(dt.label) && 
        dt.label.toLowerCase().includes(inputValue.toLowerCase())
    );

    return (
        <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
            <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.4rem',
                padding: '0.4rem',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                backgroundColor: 'white',
                minHeight: '42px',
                alignItems: 'center'
            }}
            onClick={() => setIsOpen(true)}>
                {value.map(tag => {
                    const tagStyle = getTagColor(tag);
                    return (
                        <span key={tag} style={{
                            display: 'flex', alignItems: 'center', gap: '0.3rem',
                            backgroundColor: tagStyle.bg, color: tagStyle.color,
                            padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 500
                        }}>
                            {tag}
                            <X size={12} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); removeTag(tag); }} />
                        </span>
                    );
                })}
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => {
                        setInputValue(e.target.value);
                        setIsOpen(true);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={value.length === 0 ? "Adicionar tags (ex: #Assinante)" : ""}
                    style={{ flex: 1, minWidth: '120px', border: 'none', outline: 'none', fontSize: '0.9rem', padding: '0.2rem' }}
                />
            </div>
            
            {isOpen && (filteredDefaults.length > 0 || inputValue.trim()) && (
                <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0,
                    marginTop: '4px', backgroundColor: 'white', border: '1px solid #cbd5e1',
                    borderRadius: '6px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    zIndex: 1000, maxHeight: '200px', overflowY: 'auto'
                }}>
                    {filteredDefaults.map(dt => (
                        <div key={dt.label} 
                            onClick={() => addTag(dt.label)}
                            style={{ padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ backgroundColor: dt.bg, color: dt.color, padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem' }}>{dt.label}</span>
                        </div>
                    ))}
                    {inputValue.trim() && !DEFAULT_TAGS.some(dt => dt.label.toLowerCase() === (inputValue.startsWith('#') ? inputValue : '#' + inputValue).toLowerCase()) && (
                        <div 
                            onClick={() => addTag(inputValue)}
                            style={{ padding: '0.6rem 1rem', cursor: 'pointer', color: 'var(--color-blue)', fontSize: '0.9rem' }}>
                            Criar nova tag: <strong>{inputValue.startsWith('#') ? inputValue : '#' + inputValue}</strong>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
