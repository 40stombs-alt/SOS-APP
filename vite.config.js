import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // ── Multi-page build: all 5 HTML pages included in dist ──
    build: {
      rollupOptions: {
        input: {
          main:       resolve(__dirname, 'index.html'),
          dashboard:  resolve(__dirname, 'dashboard.html'),
          service:    resolve(__dirname, 'service_operations.html'),
          discussion: resolve(__dirname, 'discussion_portal.html'),
          profile:    resolve(__dirname, 'profile.html'),
        },
      },
    },
    // ── Dev proxy: forwards /api/claude → Anthropic (keeps key server-side) ──
    server: {
      proxy: {
        '/api/claude': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/claude/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-api-key', env.ANTHROPIC_API_KEY || '');
              proxyReq.setHeader('anthropic-version', '2023-06-01');
            });
          },
        },
      },
    },
  };
});
