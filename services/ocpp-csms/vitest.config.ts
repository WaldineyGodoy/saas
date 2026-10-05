import { defineConfig } from 'vitest/config';

export default defineConfig({
  // PostCSS vazio: sem isso o Vite sobe ate o postcss.config.js da raiz (front,
  // Tailwind) e quebra no CI, onde so as dependencias deste servico existem.
  css: { postcss: {} },
  test: { include: ['test/**/*.test.ts'] },
});
