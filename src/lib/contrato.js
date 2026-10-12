import { gerarPdfBase64 } from './contratoBase';

/**
 * Termo de adesão do assinante. O texto mora em
 * supabase/functions/_shared/termo-adesao.js, fonte única com a Edge Function
 * que gera o contrato no servidor (adesão pelo app). Aqui fica só a captura
 * do PDF no navegador (CRM e página pública).
 */
export * from '../../supabase/functions/_shared/termo-adesao.js';

/**
 * Captura as páginas montadas e devolve o PDF em base64.
 * Lança se nenhuma página estiver no DOM — sem isso o Autentique recebia
 * um documento vazio e ninguém percebia até o cliente abrir o link.
 */
export const gerarPdfContratoBase64 = () => gerarPdfBase64('[data-contract="adesao"]');
