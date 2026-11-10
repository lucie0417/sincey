import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: { '^/api(?:/|$)': 'http://127.0.0.1:3001' } },
  build: { outDir: '../dist/client', emptyOutDir: true },
});
