/**
 * Helper to convert a potentially public/legacy URL or path into a secure Signed URL.
 * 
 * @param {object} supabase - The supabase client instance
 * @param {string} url - The URL or path stored in the database
 * @param {string} defaultBucket - The default bucket to use if not specified in the URL
 * @param {number} expiresIn - Expiration time for the signed URL in seconds (default 1 hora = 3600s)
 * @returns {Promise<string|null>} - The signed URL or null if error/invalid
 */
export const getSecurePdfUrl = async (supabase, url, defaultBucket = 'energy-bills', expiresIn = 3600) => {
    if (!url) return null;

    let bucket = defaultBucket;
    let path = url;

    // Check if it's a legacy public URL
    if (url.startsWith('http')) {
        // Expected format: https://[SUPABASE_URL]/storage/v1/object/public/[bucket_name]/[path]
        const match = url.match(/\/object\/public\/([^\/]+)\/(.+)$/);
        if (match) {
            bucket = match[1];
            path = decodeURIComponent(match[2]);
        } else {
            // Se for um http mas não bater com o regex do Supabase, retorna como está (ex: link externo)
            return url;
        }
    }

    try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
        if (error) {
            console.error('Error generating signed URL:', error);
            return null;
        }
        return data?.signedUrl || null;
    } catch (err) {
        console.error('Exception generating signed URL:', err);
        return null;
    }
};
