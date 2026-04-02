import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Carga variables de entorno según el modo (dev/prod)
  const env = loadEnv(mode, process.cwd());

  const ROUTER_BRAND = (env.VITE_ROUTER_BRAND || 'morelivery').trim().toLowerCase();
  const API_TARGET = env.VITE_API_TARGET || `https://${ROUTER_BRAND}.onrender.com`;
  const UI_BRAND = env.VITE_UI_BRAND || 'Morelivery';

  const API_PATHS = [
    '/nav', '/orders', '/drivers', '/auth', '/restaurants',
    '/users', '/admin', '/events', '/payments', '/support',
    '/push', '/sync', '/voice',
  ];

  return {
    plugins: [
      react(),
                            // Hook nativo para reemplazar variables en index.html
                            {
                              name: 'html-transform',
                            transformIndexHtml(html) {
                              return html.replace(/%VITE_UI_BRAND%/g, UI_BRAND);
                            },
                            },
    ],

    server: {
      proxy: Object.fromEntries(
        API_PATHS.map(path => [
          path,
          {
            target: API_TARGET,
            changeOrigin: true,
            secure: true
          },
        ])
      ),
    },

    // Define para que estén disponibles en el código cliente si se necesita
    define: {
      __APP_ENV__: JSON.stringify(env.APP_ENV),
    },
  };
});
