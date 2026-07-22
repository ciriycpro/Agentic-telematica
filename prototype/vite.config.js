import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// Vite делает две сборки:
//  · modern — ES2015+ modules (быстро, работает в 95% браузеров)
//  · legacy — с полифилами SystemJS + core-js для древних браузеров
// Правильный бандл выбирает сам браузер через <script type="module"> vs
// <script nomodule>. Никакой конфигурации на стороне сервера не требуется.
export default defineConfig({
  // Локальный запуск из корня. При деплое в подпапку GitHub Pages
  // раскомментировать base и указать путь: base: '/agentic-telematica/',
  plugins: [
    react(),
    legacy({
      // покрытие: всё, что использует хотя бы кто-то (по browserslist из package.json)
      targets: ['defaults', 'not IE 11'],
      // современные фичи, для которых нужны полифилы core-js
      modernPolyfills: ['es.array.at', 'es.string.replace-all', 'es.object.has-own'],
      renderLegacyChunks: true,
      polyfills: [
        'es.symbol',
        'es.array.filter',
        'es.array.for-each',
        'es.array.flat-map',
        'es.array.iterator',
        'es.promise',
        'es.object.assign',
        'es.object.entries',
        'es.object.from-entries',
        'es.regexp.exec',
        'es.string.match',
        'es.string.replace',
        'es.string.starts-with',
        'es.string.ends-with',
        'es.string.pad-start',
        'es.string.pad-end',
        'web.dom-collections.iterator',
      ],
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // build.target здесь не задаём: legacy-плагин управляет им сам
    // (modern-бандл автоматом получит baseline для ES modules).
    cssTarget: ['safari12', 'firefox78', 'chrome87', 'edge88'],
    minify: 'terser',
    terserOptions: {
      format: { comments: false },
      compress: { drop_console: false, drop_debugger: true },
    },
    chunkSizeWarningLimit: 1500,
  },
})
