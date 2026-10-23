import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    // MB-12: после локального e2e в дереве лежат playwright-report/ и test-results/
    // со минифицированными бандлами трассировки — `eslint .` спотыкается о них,
    // а не о код. В CI порядок шагов этого не показывает (lint раньше e2e).
    ignores: ['dist/**', 'node_modules/**', '.claude/**', '.vercel/**', 'deploy/**',
              'playwright-report/**', 'test-results/**'],
  },
  {
    // LS-1: scripts/stand/dist — собранный стенд (vite build), не исходник.
    ignores: ['scripts/stand/dist/**'],
  },
  js.configs.recommended,
  // N-59: public/ — загрузочный скрипт и сервис-воркер, выполняются до React;
  // их ошибки не видел ни один гейт.
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker, sourceType: 'script' },
  },
  {
    files: ['public/**/*.js'],
    ignores: ['public/sw.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'react': react,
      'react-hooks': reactHooks,
      'import': importPlugin,
    },
    rules: {
      ...typescript.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/strict-boolean-expressions': ['error', { allowString: true, allowNumber: true, allowNullableObject: true, allowNullableBoolean: true, allowNullableString: true, allowNullableNumber: true, allowAny: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'import/no-duplicates': 'error',
      'import/no-cycle': 'error',
      // Layer boundaries (ARCHITECTURE.md). Cross-feature imports between the
      // remaining features are grandfathered (~80 as of 2026-06) — extend the
      // zones as features get untangled.
      'import/no-restricted-paths': ['error', {
        zones: [
          { target: './src/core', from: './src/features', message: 'core must not import from features/ (ARCHITECTURE.md)' },
          { target: './src/shared', from: './src/features', message: 'shared must not import from features/ (ARCHITECTURE.md)' },
          { target: './src/shared', from: './src/core', message: 'shared must stay dependency-free of core (ARCHITECTURE.md)' },
          { target: './src/features/auth', from: './src/features', except: ['./auth'], message: 'auth is feature-import-free — keep it that way (ARCHITECTURE.md)' },
          { target: './src/features/admin', from: './src/features', except: ['./admin', './auth'], message: 'cross-feature imports forbidden (ARCHITECTURE.md)' },
          { target: './src/features/ai', from: './src/features', except: ['./ai', './auth'], message: 'cross-feature imports forbidden (ARCHITECTURE.md)' },
          { target: './src/features/archive', from: './src/features', except: ['./archive', './auth'], message: 'cross-feature imports forbidden (ARCHITECTURE.md)' },
          { target: './src/features/encryption', from: './src/features', except: ['./encryption', './auth'], message: 'cross-feature imports forbidden (ARCHITECTURE.md)' },
          { target: './src/features/navigation', from: './src/features', except: ['./navigation', './auth'], message: 'cross-feature imports forbidden (ARCHITECTURE.md)' },
          { target: './src/features/profile', from: './src/features', except: ['./profile', './auth'], message: 'cross-feature imports forbidden (ARCHITECTURE.md)' },
          { target: './src/features/settings', from: './src/features', except: ['./settings', './auth'], message: 'cross-feature imports forbidden (ARCHITECTURE.md)' },
          { target: './src/features/writing', from: './src/features', except: ['./writing', './auth'], message: 'cross-feature imports forbidden (ARCHITECTURE.md)' },
        ],
      }],
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
    settings: {
      react: { version: 'detect' },
      // Без этого eslint-plugin-import не умеет разбирать .ts при построении
      // карты экспортов, и правила, которым нужен обход графа (import/no-cycle),
      // молча не находят ничего. Резолвер сам по себе не помогает: он отвечает
      // на вопрос «где файл», а не «что он экспортирует».
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
      },
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
  },
  {
    // LS-1: scripts/ — ворота CI, стенд и разовые замеры. Это CLI, а не src:
    // Node-глобалы (process, Buffer, __dirname) законны, console — их штатный
    // вывод. JS-скрипты подчиняются js.configs.recommended; TS-скрипты
    // дополнительно попадают под блок **/*.ts выше (типизированные правила —
    // они входят в tsconfig, кроме scripts/stand/dist).
    files: ['scripts/**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: { globals: { ...globals.node, NodeJS: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
  {
    // LS-1: не модуль, а вставка в консоль браузера — см. шапку файла.
    files: ['scripts/embed-bench/*.browser.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}', '**/tests/**/*.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'import/no-restricted-paths': 'off',
      // AUDIT-L13: новые хардкоды русской строки в JSX — предупреждение.
      // Существующий долг (163 литерала, в основном админ-страницы) выключен
      // точечными override ниже; миграция в i18n — по мере касания.
      'no-restricted-syntax': [
        'warn',
        {
          selector: "JSXText[value=/[\\u0410-\\u044F\\u0401\\u0451]/]",
          message: 'Hardcoded Russian text in JSX — use i18n keys instead',
        },
      ],
    },
  },
  {
    // AG-LINT-1: React-Compiler-сюита (v7 recommended тянет её через спред
    // выше) уходит в экспоненту по памяти на распиленном aiChatContext.ts —
    // ESLint OOM на 6 и 12 ГБ даже как одиночный файл. Классика
    // (rules-of-hooks/exhaustive-deps) остаётся. Снять override, когда файл
    // перестанет взрывать компиляторный анализ (кандидат — пункт 7, переезд
    // buildContext). Полный список правил сюиты и таблица доказательства —
    // в отчёте AG-LINT-1.
    files: ['src/features/ai/services/aiChatContext.ts'],
    rules: Object.fromEntries([
      'react-hooks/static-components',
      'react-hooks/use-memo',
      'react-hooks/component-hook-factories',
      'react-hooks/preserve-manual-memoization',
      'react-hooks/incompatible-library',
      'react-hooks/immutability',
      'react-hooks/globals',
      'react-hooks/refs',
      'react-hooks/set-state-in-effect',
      'react-hooks/error-boundaries',
      'react-hooks/purity',
      'react-hooks/set-state-in-render',
      'react-hooks/unsupported-syntax',
      'react-hooks/config',
      'react-hooks/gating',
    ].map(rule => [rule, 'off'])),
  },
  {
    // DUP-1: Direct calls to refundDailyLimit, refundBulkLimit, and refundGlobalRequest are prohibited
    // in API handlers and logic. All refunds must go through refundCall or callReservation.settle().
    files: ['api/**/*.logic.ts', 'api/chat.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name=/^(refundDailyLimit|refundBulkLimit|refundGlobalRequest)$/]",
          message: 'Direct calls to refundDailyLimit, refundBulkLimit, and refundGlobalRequest are forbidden. Use refundCall or callReservation.settle().',
        },
      ],
    },
  },
  {
    // Два аккаунта в одном браузере: getLocalDb() без аргумента открывает базу
    // того, кто вошёл СЕЙЧАС. Фоновая работа, начатая для одного человека и
    // пережившая смену аккаунта, писала его текст в базу другого (тест
    // accountSwitch.test.ts). Функция, которая знает владельца, обязана
    // передавать его дальше — в базу и во все локальные помощники.
    files: ['src/core/services/**/*.ts', 'src/core/sync/**/*.ts', 'src/features/*/services/**/*.ts'],
    ignores: ['**/*.test.ts', '**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: ":function:has(> Identifier[name=/^(userId|uid|ownerId|guestId|targetUserId)$/]) CallExpression[callee.name='getLocalDb'][arguments.length=0]",
          message: 'Владелец известен — передайте его: getLocalDb(userId). Без него откроется база того, кто вошёл сейчас.',
        },
        {
          selector: ":function:has(> Identifier[name=/^(userId|uid|ownerId|guestId|targetUserId)$/]) CallExpression:matches([callee.object.name=/^Local(Document|Storage|Version)Service$/], [callee.name=/^(addToSyncQueue|requeueDocumentTask|bumpAttempts|_clearQueueItems|dropQueueTasksFor)$/], [callee.property.name=/^(addToQueue|removeQueueTasksForDocument)$/]):not([callee.property.name=/^(saveVersionToLocal|getDocumentsByOwner|createDocument)$/]):not(:has(> Identifier[name=/^uid$|[oO]wner|[uU]serId|guestId/])):not(:has(> MemberExpression[property.name=/^uid$|[oO]wner|[uU]serId|guestId/]))",
          message: 'Владелец известен — передайте его последним аргументом, иначе помощник откроет базу того, кто вошёл сейчас.',
        },
        {
          selector: ":function:has(> Identifier[name=/^(userId|uid|ownerId|guestId|targetUserId)$/]) CallExpression[callee.name='withDocumentLock']:not(:has(Property[key.name='ownerId']))",
          message: 'Владелец известен — передайте { ownerId } в withDocumentLock: замок и очередь лежат в его базе.',
        },
      ],
    },
  },
  prettier,
];
