import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 3100. API calls go to the backend (VITE_API_URL, default http://localhost:8000/api/v1).
// envDir points at the repo root: one shared .env for the whole project (see ../.env).
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: { port: 3100, strictPort: true },
  preview: { port: 3100 }
});
