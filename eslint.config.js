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
    ignores: ['dist/**', 'node_modules/**', '.claude/**', '.vercel/**', 'functions/**', 'scripts/**'],
  },
  js.configs.recommended,
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
          { target: './src/features/calendar', from: './src/features', except: ['./calendar'], message: 'calendar is feature-import-free — keep it that way (ARCHITECTURE.md)' },
        ],
      }],
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': { node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] } },
    },
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
    },
  },
  prettier,
];
