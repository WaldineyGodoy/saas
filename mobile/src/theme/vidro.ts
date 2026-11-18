// Vidro líquido da tela de login: superfícies translúcidas sobre o vídeo.
// Vale nos dois temas (o vídeo é sempre o fundo), por isso não entra na
// paleta clara/escura de tokens.ts. Base azul-marinho da marca (#0B1124),
// acento laranja (#F26B00 / #FF9B52).

export const vidro = {
  /** placa do formulário: azul-marinho translúcido, não branco, para o texto
   *  claro manter contraste mesmo quando o vídeo passa por um céu claro */
  placa: 'rgba(11,17,36,0.42)',
  /** sem desfoque (app nativo, navegador sem backdrop-filter): mais opaca */
  placaSemDesfoque: 'rgba(11,17,36,0.78)',
  borda: 'rgba(255,255,255,0.16)',
  bordaBrilho: 'rgba(255,255,255,0.30)',
  campo: 'rgba(255,255,255,0.07)',
  campoFocado: 'rgba(255,255,255,0.11)',
  botao: 'rgba(255,255,255,0.10)',
  botaoPressionado: 'rgba(255,255,255,0.16)',
  tinta: '#F8FAFC',
  tinta2: 'rgba(241,245,249,0.86)',
  tinta3: 'rgba(226,232,240,0.62)',
  rotulo: 'rgba(226,232,240,0.78)',
  acento: '#FF9B52',
  anel: 'rgba(242,107,0,0.32)',
  erro: '#FCA5A5',
  primario: '#F26B00',
  sombra: '0 30px 80px -24px rgba(2,6,23,0.75), 0 2px 6px rgba(2,6,23,0.25)',
  desfoque: 'blur(26px) saturate(165%)',
  /** texto solto sobre o vídeo (fora da placa) */
  sombraTexto: '0 1px 2px rgba(2,6,23,0.55), 0 0 18px rgba(2,6,23,0.55)',
} as const;
