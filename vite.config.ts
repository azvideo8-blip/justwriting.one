import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // VitePWA disabled temporarily to fix connection issues in iframe
      /*
      VitePWA({
        registerType: 'autoUpdate',
        ...
      })
      */
    ],
    define: {
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true'
        ? { clientPort: 443, protocol: 'wss' }
        : false,
    },
    build: {
      sourcemap: false,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  };
});
