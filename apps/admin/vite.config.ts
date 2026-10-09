import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // écouter sur toutes les interfaces réseau (accès depuis le téléphone)
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
});
