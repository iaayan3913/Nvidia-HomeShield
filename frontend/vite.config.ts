import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { applyStoredTheme } from './src/shared/theme/prepaint';

/** Inlines the theme script into <head> so `data-theme` is set before first paint (no flash). */
const themePrepaint = (): Plugin => ({
  name: 'homeshield-theme-prepaint',
  transformIndexHtml: (html) => html.replace('<!-- theme-prepaint -->', `<script>(${applyStoredTheme.toString()})()</script>`),
});

// Modes: `resident` and `staff` build the two applications; anything else (dev, test) is the combined app.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = mode === 'resident' || mode === 'staff' ? mode : 'all';
  const https = process.env.npm_lifecycle_event === 'dev:resident:https';
  // The frontend only calls relative /api URLs; this forwards them (SSE included) to FastAPI.
  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: env.VITE_BACKEND_URL || 'http://127.0.0.1:8001',
      changeOrigin: true,
      // Keep the event stream unbuffered and uncompressed through the proxy.
      configure: (server) => server.on('proxyReq', (request) => { if (request.path.startsWith('/api/stream')) request.setHeader('Accept-Encoding', 'identity'); }),
    },
  };
  const port = target === 'staff' ? 5174 : 5173;
  return {
    plugins: [react(), themePrepaint(), ...(https ? [basicSsl()] : [])],
    define: { __APP_TARGET__: JSON.stringify(target) },
    // The resident server is exposed on the LAN for phones. Staff stays on this computer (no login yet).
    server: { port, strictPort: target !== 'all', host: target === 'resident' ? true : undefined, proxy },
    preview: { port, strictPort: true, host: target === 'resident' ? true : undefined, proxy },
    build: { outDir: target === 'all' ? 'dist/all' : `dist/${target}`, emptyOutDir: true },
  };
});
