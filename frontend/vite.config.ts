import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Сборка кладётся в static/app/ — FastAPI отдаёт её как есть (git pull + рестарт, без node
// на сервере). Все страницы сайта (/, /login, /admin/…) отдают static/app/index.html,
// дальше маршруты разбирает React Router.
//
// Dev-сервер (npm run dev, :3000) проксирует API на FastAPI (:8000) — запросы идут с того
// же origin, сессионная кука работает без CORS. Цель — NM_API_TARGET.
const target = process.env.NM_API_TARGET || 'http://localhost:8000';
const apiPrefixes = [
  '/api', '/ask', '/session', '/documents', '/folders', '/plans', '/catalog', '/jobs',
  '/users', '/questions', '/staffing', '/knowledge', '/test-messages', '/healthz', '/favicon.ico', '/static/favicon.svg',
];

export default defineConfig({
  base: '/static/app/',
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  build: {
    outDir: '../static/app',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 3000,
    fs: { allow: ['..'] },
    proxy: Object.fromEntries(apiPrefixes.map((p) => [p, { target, changeOrigin: true }])),
  },
});
