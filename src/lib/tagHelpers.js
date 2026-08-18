export const DEFAULT_TAGS = [
    { label: '#Assinante', color: '#3b82f6', bg: '#eff6ff' },
    { label: '#Investidor', color: '#10b981', bg: '#ecfdf5' },
    { label: '#Proprietario de Usina', color: '#eab308', bg: '#fefce8' },
    { label: '#Originador', color: '#8b5cf6', bg: '#f5f3ff' },
    { label: '#Fornecedor', color: '#f97316', bg: '#fff7ed' }
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
