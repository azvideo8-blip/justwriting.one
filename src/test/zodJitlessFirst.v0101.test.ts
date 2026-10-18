// 0.10.1: zod 4 пробует `new Function("")` при создании схемы, а наш CSP
// (script-src без unsafe-eval) шлёт отчёт о нарушении с каждой страницы.
// jitless должен встать раньше любой схемы — то есть первым импортом main.tsx;
// вызов в теле main.tsx приходил поздно (проба уже прошла в vendor-ai).
// Мутация: перенести импорт ниже или убрать config → красный.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globalConfig } from 'zod/v4/core';

describe('zod jitless до первой схемы', () => {
  it("main.tsx начинается с import './zodJitless'", () => {
    const first = readFileSync('src/main.tsx', 'utf8').split('\n').find(l => l.trim().startsWith('import'));
    expect(first?.trim()).toBe("import './zodJitless';");
  });

  it('модуль включает jitless', async () => {
    await import('../zodJitless');
    expect(globalConfig.jitless).toBe(true);
  });
});
