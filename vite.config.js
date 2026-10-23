import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative asset paths so the build works under GitHub Pages' /<repo>/ subpath
  server: { host: '0.0.0.0', port: 3000, strictPort: true },
  preview: { host: '0.0.0.0', port: 3000 },
  build: { chunkSizeWarningLimit: 2000 },
});
