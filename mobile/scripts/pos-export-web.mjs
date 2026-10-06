// Depois do `expo export -p web`: o webapp e pagina unica (web.output
// "single"), entao o +html.tsx do Expo Router nao vale. Este passo poe no
// dist/index.html o idioma, o manifest e os icones do "Adicionar a tela de
// inicio" (apps.b2wenergia.com.br). Falha alto se o index mudar de forma.
import { readFileSync, writeFileSync } from 'node:fs';

const arquivo = new URL('../dist/index.html', import.meta.url);
let html = readFileSync(arquivo, 'utf8');

if (!html.includes('</head>')) throw new Error('dist/index.html sem </head>');
if (html.includes('rel="manifest"')) {
  console.log('index.html ja preparado');
  process.exit(0);
}

const cabecalho = [
  '<meta name="description" content="Sua energia por assinatura, suas usinas e sua rede de indicações." />',
  '<meta name="theme-color" content="#0B1124" />',
  '<link rel="manifest" href="/manifest.json" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="B2W Energia" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
].join('\n    ');

html = html
  .replace(/<html lang="[^"]*"/, '<html lang="pt-BR"')
  .replace('</head>', `    ${cabecalho}\n  </head>`);

writeFileSync(arquivo, html);
console.log('index.html: idioma, manifest e icones aplicados');
