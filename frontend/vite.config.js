import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ROUTER_BRAND = (process.env.VITE_ROUTER_BRAND || 'encorto').trim().toLowerCase();
const API_TARGET = process.env.VITE_API_TARGET || `https://${ROUTER_BRAND}.onrender.com`;
const API_PATHS  = [
  '/nav', '/orders', '/drivers', '/auth', '/restaurants',
  '/users', '/admin', '/events', '/payments', '/support',
  '/push', '/sync', '/voice',
];

export default defineConfig({
  plugins: [react()],

  server: {
    proxy: Object.fromEntries(
      API_PATHS.map(path => [
        path,
        { target: API_TARGET, changeOrigin: true, secure: true },
      ])
    ),
  },
});
