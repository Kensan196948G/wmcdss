import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Phase 0 scaffold — keep config minimal. Phase 1 will add:
//   - server.proxy for /api/v1 → backend :8003 (matches docker compose dev port)
//   - resolve.alias for moving the legacy ../*.jsx into ./src
//   - build.rollupOptions.output.manualChunks for vendor splitting once the
//     legacy globals (window.WMCDSS_API, window.SITES) are turned into modules
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
