import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = 'https://morelivery.onrender.com';
const API_PATHS  = ['/nav', '/orders', '/drivers', '/auth', '/restaurants', '/users', '/admin', '/events'];

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
