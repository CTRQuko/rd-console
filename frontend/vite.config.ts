import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// rd-console frontend — Vite scaffold for the Claude Design transplant.
// Accepts both .jsx (from the design ZIP, untyped) and .tsx (future ports).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/admin/api': 'http://localhost:8080',
    },
  },
});
