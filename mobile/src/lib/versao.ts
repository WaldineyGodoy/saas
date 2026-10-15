/**
 * O que mudou na versão, mostrado no rodapé de "Mais" junto do número
 * (app.json > expo.version). Atualizar os dois a cada versão publicada.
 *
 * Critério do número X.Y.Z (decisão do dono, 11/10/2026):
 *   X  mudança de layout, UI ou UX (tela nova, tela redesenhada, fluxo
 *      de navegação diferente);
 *   Y  funcionalidade nova sem mudar layout, UI ou UX;
 *   Z  correção de bug, sem funcionalidade nova e sem mudar layout.
 * Vale o maior nível que a versão tiver (layout + correção = X). Subir um
 * nível zera os da direita: 1.6.1 -> 2.0.0 (X), 1.7.0 (Y) ou 1.6.2 (Z).
 */
export const NOVIDADES_DA_VERSAO = 'Correção: no cadastro de novo assinante, CPF/CNPJ que já é assinante B2W mostra uma orientação clara em vez de um erro técnico.';
