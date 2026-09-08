import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    isDev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' https://static-cdn.jtvnw.net data:",
    isDev
      ? "connect-src 'self' ws://localhost:5173 ws://127.0.0.1:4173 ws://127.0.0.1:5173 http://localhost:5173 http://127.0.0.1:4173 http://127.0.0.1:5173"
      : "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  return {
    plugins: [
      react(),
      {
        name: 'damplanner-csp',
        transformIndexHtml(html) {
          return html.replace('__DAMPLANNER_CSP__', csp);
        },
      },
    ],
    root: 'src/renderer',
    build: { outDir: '../../dist', emptyOutDir: true },
  };
});
