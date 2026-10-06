import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const GATEWAY_WS = GATEWAY.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // доступ с телефона в той же сети — для экрана мастера /master
    host: true,
    proxy: {
      '/api': GATEWAY,
      '/docs': GATEWAY,
      '/asyncapi': GATEWAY,
      '/media': GATEWAY,
      '/ws': { target: GATEWAY_WS, ws: true },
      '/mqtt': { target: GATEWAY_WS, ws: true },
    },
  },
});
