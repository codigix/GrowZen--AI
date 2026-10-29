import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 3100. API calls go to the backend (VITE_API_URL; default http://localhost:8000/api/v1 in dev,
// same-origin /api/v1 in a production build).
// VITE_* variables come from frontend/.env (the backend has its own backend/.env).
export default defineConfig({
  plugins: [react()],
  envDir: '.',
  server: { port: 3100, strictPort: true },
  preview: { port: 3100 }
});
