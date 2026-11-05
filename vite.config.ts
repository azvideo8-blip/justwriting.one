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
      // Dev only. callAi() fetches /api/<name> relative to the page, which in
      // production nginx routes to the Node service. Locally there is nothing on
      // that path, so point it at the service: run it yourself, or tunnel to the
      // VPS and set VITE_DEV_API_TARGET.
      proxy: {
        '/api': {
          target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:3111',
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: 'hidden' as const,
      chunkSizeWarningLimit: 300,
      rollupOptions: {
        output: {
          // ВНИМАНИЕ: не переводить обратно на разбиение по путям node_modules.
          // Так делал H1 (0.7.70): vendor-react наполнялся, index худел до
          // 487 кБ — и прод падал с "Cannot access 'vp' before initialization".
          // Разрезание по каталогам разводило по разным чанкам модули, которые
          // ссылаются друг на друга, и получался цикл: чанк исполняется раньше
          // того, от чего зависит. Форма со списком режет по точкам входа,
          // и такого цикла не даёт.
          manualChunks: {
            'vendor-motion': ['motion/react'],
            'vendor-docx': ['docx'],
            'vendor-router': ['react-router-dom'],
            'vendor-markdown': ['react-markdown', 'rehype-sanitize'],
            'vendor-ui': ['lucide-react', 'clsx', 'tailwind-merge'],
            'vendor-ai': ['ai', '@ai-sdk/openai'],
            'vendor-virtuoso': ['react-virtuoso'],
            // Клиент Supabase — самая тяжёлая часть основного куска, и нужен он
            // не на первом экране: письмо работает без сети и без аккаунта.
            // Вынесен отдельно, чтобы редактор открывался, не дожидаясь его.
            'vendor-supabase': ['@supabase/supabase-js'],
            // React меняется раз в месяцы, приложение — раз в день: в своём куске
            // он остаётся в кэше браузера между выкатками (имена с хэшем), а
            // index-кусок не тащит 200 КБ рантайма при каждом релизе. Заодно
            // react-dom 19.3 (+28 КБ) перестал ломать бюджет index-куска в CI.
            'vendor-react': ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'scheduler'],
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      // Владелец 04.11: 5 с под нагрузкой полного прогона давали ложные красные.
      testTimeout: 15_000,
      // Абсолютный путь: относительный резолвился от CWD, и `npx vitest` из
      // api/ искал setup в несуществующем api/src/test/.
      setupFiles: [fileURLToPath(new URL('./src/test/setup.ts', import.meta.url))],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.claude/**',
        '**/coverage/**',
        '**/.git/**',
        'e2e/**',
      ],
      coverage: {
        provider: 'istanbul' as const,
        reporter: ['text', 'html', 'lcov'],
        include: ['src/**/*.{ts,tsx}', 'api/**/*.ts'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/**/*.d.ts',
          'src/test/**',
          'src/types/**',
          'src/**/index.ts',
          'api/**/__tests__/**',
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
          'api/**': { statements: 66, branches: 55, functions: 67, lines: 69 },
          'api/ai/**': { statements: 57, branches: 45, functions: 54, lines: 61 },
        },
      },
    },
  };
});
