import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 3100. API calls go to the backend (VITE_API_URL; default http://localhost:8000/api/v1 in dev,
// same-origin /api/v1 in a production build).
// VITE_* variables come from frontend/.env (the backend has its own backend/.env).
export default defineConfig({
  plugins: [react()],
  envDir: '.',
  build: {
    rollupOptions: {
      output: {
        // Heavy libraries get their own files: they download only when a page that needs them opens, and stay cached when app code changes.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'charts';
          if (id.includes('leaflet')) return 'maps';
          if (id.includes('react-router') || id.includes('/react/') || id.includes('react-dom') || id.includes('scheduler')) return 'react';
          return undefined;
        }
      }
    }
  },
  // Pre-bundle the big libraries once so the dev server does not load hundreds of small files on every page.
  optimizeDeps: { include: ['react', 'react-dom', 'react-router-dom', 'recharts', 'lucide-react', 'leaflet'] },
  // host: true = listen on every address, so the app also opens at http://<this PC's IP>:3100 (not only localhost).
  // The page and the API share one origin: the browser calls /api/v1 on this same address and Vite forwards it to the backend. That keeps the
  // login cookie working whether the app is opened as localhost:3100 or as http://<this PC's IP>:3100, with no CORS in between.
  server: { host: true, port: 3100, strictPort: true, proxy: { '/api': { target: process.env.BACKEND_URL || 'http://127.0.0.1:8000', changeOrigin: false } } },
  preview: { host: true, port: 3100, proxy: { '/api': { target: process.env.BACKEND_URL || 'http://127.0.0.1:8000', changeOrigin: false } } }
});
