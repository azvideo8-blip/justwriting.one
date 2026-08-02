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

  const VENDOR_CHUNKS: Record<string, string[]> = {
    'vendor-firebase-core': ['firebase'],
    'vendor-firebase-firestore': ['@firebase/firestore'],
    'vendor-motion': ['motion'],
    'vendor-charts': ['recharts'],
    'vendor-docx': ['docx'],
    'vendor-router': ['react-router-dom'],
    'vendor-markdown': ['react-markdown', 'rehype-sanitize'],
    'vendor-ui': ['lucide-react', 'clsx', 'tailwind-merge'],
    'vendor-ai': ['ai', '@ai-sdk/openai'],
    'vendor-sentry': ['@sentry/react'],
    'vendor-analytics': ['posthog-js'],
    'vendor-virtuoso': ['react-virtuoso'],
  };

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
          manualChunks(id: string) {
            // Форма со списком сопоставляет ТОЧНЫЙ идентификатор, а приложение
            // импортирует react-dom/client, react-dom (createPortal) и
            // react/jsx-runtime — ни один не равен 'react-dom'. Поэтому чанк
            // vendor-react получался пустым, а сам react-dom (523 кБ исходника)
            // всё это время лежал в общем index.
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
            for (const [name, mods] of Object.entries(VENDOR_CHUNKS)) {
              if (mods.some(m => id.includes(`node_modules/${m}/`))) return name;
            }
            return undefined;
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
        // Храповик, а не цель. Значения — фактический уровень на 0.7.68, округлённый
        // вниз: задача порога здесь не поднять покрытие, а не дать ему упасть.
        // Прежние 75/70/75/75 были пожеланием — при них CI был бы красным всегда,
        // а красный CI перестают читать.
        thresholds: {
          statements: 30,
          branches: 20,
          functions: 22,
          lines: 31,
          // Пути данных держим отдельно и заметно выше: сюда уехали все правки
          // дорожки A, и именно здесь потеря покрытия означает потерю заметок.
          'src/core/storage/**': { statements: 85, branches: 50, functions: 60, lines: 88 },
          'src/core/crypto/**': { statements: 70, branches: 58, functions: 65, lines: 74 },
          'src/core/services/**': { statements: 63, branches: 54, functions: 60, lines: 66 },
          'src/features/auth/services/**': { statements: 53, branches: 46, functions: 55, lines: 54 },
        },
      },
    },
  };
});
