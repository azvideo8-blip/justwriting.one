import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(process.env.ANALYZE ? [visualizer({ open: true, gzipSize: true, filename: 'bundle-stats.html' })] : []),
    ],
    define: {
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    optimizeDeps: {
      include: ['lucide-react'],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true'
        ? (process.env.VITE_HMR_SECURE === 'true'
          ? { clientPort: 443, protocol: 'wss' }
          : true)
        : false,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-firebase-core': ['firebase/app', 'firebase/auth'],
            'vendor-firebase-firestore': ['firebase/firestore'],
            'vendor-motion': ['motion/react'],
            'vendor-charts': ['recharts'],
            'vendor-docx': ['docx'],
            'vendor-router': ['react-router-dom'],
            'vendor-markdown': ['react-markdown', 'rehype-sanitize'],
            'vendor-ui': ['lucide-react', 'clsx', 'tailwind-merge'],
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.claude/**',
        '**/coverage/**',
        '**/.git/**',
        '**/.firebase/**',
      ],
      coverage: {
        provider: 'istanbul',
        reporter: ['text', 'html', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/**/*.d.ts',
          'src/test/**',
          'src/types/**',
          'src/**/index.ts',
        ],
        thresholds: {
          statements: 75,
          branches: 70,
          functions: 75,
          lines: 75,
        },
      },
    },
  };
});
