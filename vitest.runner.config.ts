import type { ConfigEnv, UserConfig } from 'vite';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig((env: ConfigEnv) => {
  const resolved = typeof viteConfig === 'function' ? viteConfig(env) : viteConfig;
  return mergeConfig(
    resolved as UserConfig,
    defineConfig({
      test: {
        include: ['src/testing/faultHarness/postulatesCli.runner.ts'],
      },
    }),
  );
});
