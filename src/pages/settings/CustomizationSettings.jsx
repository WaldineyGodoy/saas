import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Save, Upload, Palette, Building2, Image as ImageIcon, Check } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';
import { useBranding } from '../../contexts/BrandingContext';

export default function CustomizationSettings() {
    const { showAlert } = useUI();
    const { branding, updateBrandingState } = useBranding();
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef(null);

    const [formData, setFormData] = useState({
        company_name: '',
        logo_url: '',
        primary_color: '#003366',
        secondary_color: '#FF6600'
    });

    useEffect(() => {
        if (branding) {
            setFormData({
                company_name: branding.company_name || '',
                logo_url: branding.logo_url || '',
                primary_color: branding.primary_color || '#003366',
                secondary_color: branding.secondary_color || '#FF6600'
            });
        }
    }, [branding]);

    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { error } = await supabase
                .from('branding_settings')
                .upsert({
                    id: branding.id, // Keep the same ID if exists
                    ...formData,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;

            updateBrandingState(formData);
            showAlert('Configurações de marca atualizadas com sucesso!', 'success');
        } catch (error) {
            console.error('Error saving branding:', error);
            showAlert('Erro ao salvar: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleLogoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            showAlert('Por favor, selecione uma imagem JPEG, PNG ou WebP.', 'error');
            return;
        }

        setUploading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `logo_${Date.now()}.${fileExt}`;
            const filePath = `logos/${fileName}`;

            // 1. Upload file to 'branding' bucket
            const { error: uploadError } = await supabase.storage
                .from('branding')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('branding')
                .getPublicUrl(filePath);

            setFormData(prev => ({ ...prev, logo_url: publicUrl }));
            showAlert('Logo carregada com sucesso! Lembre-se de salvar as alterações.', 'success');
        } catch (error) {
            console.error('Error uploading logo:', error);
            showAlert('Erro no upload: ' + error.message, 'error');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ padding: '0.5rem', background: '#fff', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        <Palette size={20} color="#475569" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#1e293b' }}>Padronização e Marca</h3>
                        <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>Personalize a identidade visual do seu CRM.</p>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSave} style={{ padding: '2rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
                    {/* Basic Info */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>
                                <Building2 size={16} /> Nome da Empresa
                            </label>
                            <input
                                type="text"
                                value={formData.company_name}
                                onChange={e => setFormData({ ...formData, company_name: e.target.value })}
                                placeholder="Ex: B2W Energia"
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                                required
                            />
                            <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>Este nome será exibido no menu lateral e em títulos.</p>
                        </div>

                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>
                                <Palette size={16} /> Paleta de Cores
                            </label>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {/* Primary Color */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{ flex: 1 }}>
                                        <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.3rem' }}>Cor Primária</span>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <input
                                                type="color"
                                                value={formData.primary_color}
                                                onChange={e => setFormData({ ...formData, primary_color: e.target.value })}
                                                style={{ width: '40px', height: '40px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                                            />
                                            <input
                                                type="text"
                                                value={formData.primary_color.toUpperCase()}
                                                onChange={e => setFormData({ ...formData, primary_color: e.target.value })}
                                                style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', textTransform: 'uppercase' }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: formData.primary_color, border: '1px solid #e2e8f0', marginTop: '1.2rem' }} title="Preview"></div>
                                </div>

                                {/* Secondary Color */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{ flex: 1 }}>
                                        <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.3rem' }}>Cor Secundária</span>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <input
                                                type="color"
                                                value={formData.secondary_color}
                                                onChange={e => setFormData({ ...formData, secondary_color: e.target.value })}
                                                style={{ width: '40px', height: '40px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                                            />
                                            <input
                                                type="text"
                                                value={formData.secondary_color.toUpperCase()}
                                                onChange={e => setFormData({ ...formData, secondary_color: e.target.value })}
                                                style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', textTransform: 'uppercase' }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: formData.secondary_color, border: '1px solid #e2e8f0', marginTop: '1.2rem' }} title="Preview"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Logo Section */}
                    <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontWeight: 600, color: '#334155', fontSize: '0.9rem' }}>
                            <ImageIcon size={16} /> Logo da Empresa
                        </label>
                        <div style={{
                            border: '2px dashed #e2e8f0',
                            borderRadius: '12px',
                            padding: '2rem',
                            textAlign: 'center',
                            background: '#f8fafc',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '1rem'
                        }}>
                            {formData.logo_url ? (
                                <div style={{ position: 'relative' }}>
                                    <img
                                        src={formData.logo_url}
                                        alt="Logo Preview"
                                        style={{ maxHeight: '100px', maxWidth: '100%', objectFit: 'contain', background: 'white', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                                    />
                                    <div style={{ position: 'absolute', top: '-10px', right: '-10px', background: '#10b981', color: 'white', borderRadius: '50%', padding: '2px' }}>
                                        <Check size={14} />
                                    </div>
                                </div>
                            ) : (
                                <div style={{ width: '80px', height: '80px', background: '#f1f5f9', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <ImageIcon size={32} color="#94a3b8" />
                                </div>
                            )}

                            <div>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleLogoUpload}
                                    style={{ display: 'none' }}
                                    accept="image/jpeg,image/png,image/webp"
                                />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current.click()}
                                    disabled={uploading}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.6rem 1.2rem',
                                        background: 'white',
                                        border: '1px solid #cbd5e1',
                                        borderRadius: '6px',
                                        fontSize: '0.9rem',
                                        fontWeight: 600,
                                        color: '#475569',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <Upload size={16} /> {uploading ? 'Enviando...' : 'Alterar Logo'}
                                </button>
                                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>PNG, JPG ou WebP. Recomendado: 200x60px.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: '1.5rem' }}>
                    <button
                        type="submit"
                        disabled={loading || uploading}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.8rem 2.5rem',
                            background: '#0284c7',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                            cursor: 'pointer',
                            boxShadow: '0 4px 6px -1px rgba(2, 132, 199, 0.2)',
                            transition: 'all 0.2s'
                        }}
                    >
                        {loading ? 'Salvando...' : <><Save size={20} /> Salvar Alterações</>}
                    </button>
                </div>
            </form>
        </div>
    );
}
