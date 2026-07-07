import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  const plugins: import('vite').PluginOption[] = [
    react() as import('vite').PluginOption,
    tailwindcss() as import('vite').PluginOption,
    ...(process.env.ANALYZE ? [visualizer({ open: true, gzipSize: true, filename: 'bundle-stats.html' }) as import('vite').PluginOption] : []),
  ];
  const serverHmr = process.env.DISABLE_HMR !== 'true'
    ? (process.env.VITE_HMR_SECURE === 'true'
      ? { clientPort: 443, protocol: 'wss' as const }
      : true)
    : false;
  return {
    plugins,
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
      hmr: serverHmr,
    },
    build: {
      target: 'es2022',
      sourcemap: 'hidden' as const,
      chunkSizeWarningLimit: 300,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-firebase-core': ['firebase/app', 'firebase/auth'],
            'vendor-firebase-firestore': ['firebase/firestore'],
            'vendor-motion': ['motion/react'],
            'vendor-charts': ['recharts'],
            'vendor-docx': ['docx'],
            'vendor-router': ['react-router-dom'],
            'vendor-markdown': ['react-markdown', 'rehype-sanitize'],
            'vendor-ui': ['lucide-react', 'clsx', 'tailwind-merge'],
            'vendor-ai': ['ai', '@ai-sdk/openai'],
            'vendor-sentry': ['@sentry/react'],
            'vendor-analytics': ['posthog-js'],
            'vendor-virtuoso': ['react-virtuoso'],
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
        '**/functions/lib/**',
        '**/functions/src/**',
        'e2e/**',
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
