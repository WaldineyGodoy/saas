export const DEFAULT_TAGS = [
    { label: '#Embaixador', color: '#8b5cf6', bg: '#f5f3ff' },
    { label: '#Energia por Assinatura', color: '#3b82f6', bg: '#eff6ff' },
    { label: '#Investidor', color: '#10b981', bg: '#ecfdf5' },
    { label: '#Eletropostos', color: '#14b8a6', bg: '#f0fdfa' },
    { label: '#Cotas', color: '#6366f1', bg: '#eef2ff' },
    { label: '#Consorcio', color: '#f43f5e', bg: '#fff1f2' },
    { label: '#Financiamento', color: '#0ea5e9', bg: '#f0f9ff' },
    { label: '#Arrendamento de area', color: '#84cc16', bg: '#ecfccb' },
    { label: '#Locação de Vagas', color: '#64748b', bg: '#f8fafc' },
    { label: '#Comercializadora', color: '#eab308', bg: '#fefce8' }
];

export function getTagColor(tagLabel) {
    const defaultTag = DEFAULT_TAGS.find(t => t.label.toLowerCase() === tagLabel.toLowerCase());
    if (defaultTag) return defaultTag;

    // Hash string to color
    let hash = 0;
    for (let i = 0; i < tagLabel.length; i++) {
        hash = tagLabel.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = hash % 360;
    return {
        label: tagLabel,
        color: `hsl(${h}, 70%, 40%)`,
        bg: `hsl(${h}, 70%, 95%)`
    };
}
