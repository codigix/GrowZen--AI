import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 3100. API calls go to the backend (VITE_API_URL, default http://localhost:8100/api/v1).
export default defineConfig({
  plugins: [react()],
  server: { port: 3100, strictPort: true },
  preview: { port: 3100 }
});
