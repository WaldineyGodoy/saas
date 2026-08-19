// Superconjunto dos cabeçalhos que as funções declaravam individualmente.
// `Access-Control-Allow-Methods` vinha só de update-asaas-charge; mantê-lo
// aqui garante que centralizar não tire nada de ninguém.
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
