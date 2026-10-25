import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// App-Fenster: strenge Regeln. Die Handy-Seite (remote.html) bekommt ihre Regeln vom Server.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'";

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'csp',
      apply: 'build',
      transformIndexHtml: (html, ctx) =>
        ctx.filename.endsWith('remote.html') ? html : html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        remote: resolve(import.meta.dirname, 'remote.html'),
        overlay: resolve(import.meta.dirname, 'overlay.html'),
      },
    },
  },
  server: { port: 5199, strictPort: true },
});
