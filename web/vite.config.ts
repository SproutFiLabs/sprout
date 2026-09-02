import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      // Overridable so an isolated test stack can point the dev server at a
      // separate API without touching the user's running preview.
      '/api': process.env.SPROUT_API_PROXY ?? 'http://127.0.0.1:4317',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
