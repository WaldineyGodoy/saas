import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const BrandingContext = createContext();

export const BrandingProvider = ({ children }) => {
    const [branding, setBranding] = useState({
        company_name: 'B2W Energia',
        logo_url: 'https://b2wenergia.com.br/wp-content/uploads/2025/12/Logo-Laranja-estreito.png',
        primary_color: '#003366',
        secondary_color: '#FF6600',
    });
    const [loading, setLoading] = useState(true);

    const fetchBranding = async () => {
        try {
            const { data, error } = await supabase
                .from('branding_settings')
                .select('*')
                .single();

            if (error && error.code !== 'PGRST116') throw error;
            if (data) {
                setBranding(data);
                applyColors(data.primary_color, data.secondary_color);
            } else {
                // Apply defaults if no data
                applyColors(branding.primary_color, branding.secondary_color);
            }
        } catch (error) {
            console.error('Error fetching branding settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const applyColors = (primary, secondary) => {
        document.documentElement.style.setProperty('--color-blue', primary);
        document.documentElement.style.setProperty('--color-orange', secondary);

        // Generate hover versions (approximate by darkening)
        const darken = (hex, percent) => {
            let num = parseInt(hex.replace("#", ""), 16),
                amt = Math.round(2.55 * percent),
                R = (num >> 16) - amt,
                B = (num >> 8 & 0x00FF) - amt,
                G = (num & 0x0000FF) - amt;
            return "#" + (0x1000000 + (R < 255 ? R < 0 ? 0 : R : 255) * 0x10000 + (B < 255 ? B < 0 ? 0 : B : 255) * 0x100 + (G < 255 ? G < 0 ? 0 : G : 255)).toString(16).slice(1);
        };

        document.documentElement.style.setProperty('--color-blue-hover', darken(primary, 10));
        document.documentElement.style.setProperty('--color-orange-hover', darken(secondary, 10));
    };

    useEffect(() => {
        fetchBranding();
    }, []);

    const updateBrandingState = (newData) => {
        setBranding(prev => ({ ...prev, ...newData }));
        if (newData.primary_color || newData.secondary_color) {
            applyColors(
                newData.primary_color || branding.primary_color,
                newData.secondary_color || branding.secondary_color
            );
        }
    };

    return (
        <BrandingContext.Provider value={{ branding, loading, refreshBranding: fetchBranding, updateBrandingState }}>
            {children}
        </BrandingContext.Provider>
    );
};

export const useBranding = () => {
    const context = useContext(BrandingContext);
    if (!context) {
        throw new Error('useBranding must be used within a BrandingProvider');
    }
    return context;
};
