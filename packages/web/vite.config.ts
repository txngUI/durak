import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/socket.io': { target: `http://localhost:${process.env.DURAK_SERVER_PORT ?? 3000}`, ws: true },
      '/config.json': { target: `http://localhost:${process.env.DURAK_SERVER_PORT ?? 3000}` },
    },
  },
});
