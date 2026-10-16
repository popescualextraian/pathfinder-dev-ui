import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: '../dist/frontend', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
