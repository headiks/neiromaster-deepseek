import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-сервер проксирует API-пути на FastAPI (:8000), поэтому запросы идут с того же
// origin — session-cookie работает без CORS. Цель настраивается через NM_API_TARGET.
const target = process.env.NM_API_TARGET || 'http://localhost:8000';

// Все НЕ-страничные префиксы бэкенда (страницы обслуживает React Router).
const apiPrefixes = [
  '/api', '/ask', '/session', '/documents', '/folders', '/plans',
  '/catalog', '/jobs', '/chunks', '/users', '/questions', '/staffing', '/sse',
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: Object.fromEntries(
      apiPrefixes.map((p) => [p, { target, changeOrigin: true }]),
    ),
  },
});
