// Дейлик 29.10 запуск 2, Н-1 (DY9-9): кнопки админки «сбросить дневной лимит»
// звали callAi('resetUserLimit'), а на VPS обработчика не было — 404. Тест
// сверяет ВСЕ имена из callAi('…') в src с диспетчером: следующий забытый
// перенос краснеет здесь же.
// Мутации: убрать resetUserLimit из LOGIC_MAP → (1) и (2) красные;
// убрать проверку isAdmin → (3) красный.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ctx = vi.hoisted(() => ({
  getAiConsent: vi.fn(async () => ({ granted: true, version: 99 })),
  isAdmin: vi.fn(async () => true),
  resetDailyLimit: vi.fn(async () => undefined),
}));
vi.mock('../postgresAiContext', () => ({ postgresAiContext: ctx }));

import { handleAiEndpoint } from '../handlers';

function callAiNames(): string[] {
  const root = resolve(__dirname, '../../src');
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'testing') walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/callAi(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)) names.add(m[1]!);
    }
  };
  walk(root);
  return [...names].sort();
}

beforeEach(() => { ctx.isAdmin.mockResolvedValue(true); ctx.resetDailyLimit.mockClear(); });

describe('DY9-9: resetUserLimit и все имена callAi', () => {
  it('(1) ни одно имя из callAi(…) не висит без серверного обработчика', async () => {
    const names = callAiNames();
    expect(names.length).toBeGreaterThan(5);
    const missing: string[] = [];
    for (const n of names) {
      // Чужой обработчик может упасть на пустом моке — это значит «он есть».
      const out = await handleAiEndpoint(n, 'u_admin', { data: {} }).catch(() => null);
      if (out?.status === 404) missing.push(n);
    }
    expect(missing).toEqual([]);
  });

  it('(2) админ сбрасывает лимит человека', async () => {
    const out = await handleAiEndpoint('resetUserLimit', 'u_admin', { data: { targetUid: 'u_target' } });
    expect(out.status).toBe(200);
    expect(ctx.resetDailyLimit).toHaveBeenCalledWith('u_target');
  });

  it('(3) не админ — отказ, счётчик не тронут', async () => {
    ctx.isAdmin.mockResolvedValue(false);
    const out = await handleAiEndpoint('resetUserLimit', 'u_user', { data: { targetUid: 'u_target' } });
    expect(out.status).toBe(403);
    expect(ctx.resetDailyLimit).not.toHaveBeenCalled();
  });
});
