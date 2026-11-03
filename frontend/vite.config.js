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
  server: { port: 3100, strictPort: true },
  preview: { port: 3100 }
});
