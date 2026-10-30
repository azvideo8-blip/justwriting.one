import { describe, it, expect, vi } from 'vitest';

// Дейлик 29.10 запуск 2, Н-3 (DY9-11): чатовый вход двигал ai_cooldown отдельным
// запросом до проверки дневного лимита. Отказ DAILY_LIMIT ничего не списывал, но
// отметка оставалась — следующий запрос в пределах 10 с получал «слишком часто»
// вместо «лимит до завтра». Тот же класс, что R7Q-024(a) в фоновом входе.
// Мутация: убрать resetCooldown на отказе → красный.
const poolQueries: string[] = [];
let dailyFails = false;
const client = {
  query: vi.fn(async (sql: string) => {
    if (String(sql).includes('ai_daily_limit')) {
      if (dailyFails) throw new Error('db down');
      return { rows: [{ call_count: 100_000 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }),
  on: vi.fn(),
  removeListener: vi.fn(),
  release: vi.fn(),
};

vi.mock('../db', () => ({
  pool: {
    on: vi.fn(),
    query: vi.fn(async (sql: string) => {
      poolQueries.push(String(sql).replace(/\s+/g, ' ').trim().slice(0, 50));
      if (String(sql).includes('INSERT INTO public.ai_cooldown')) return { rows: [{ uid: 'u' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    connect: async () => client,
  },
}));

const { postgresAiContext } = await import('../postgresAiContext');

describe('DY9-11: отказ по дневному лимиту не оставляет кулдаун', () => {
  it('DAILY_LIMIT → отметка ai_cooldown снята', async () => {
    expect(await postgresAiContext.checkAndIncrementLimit('u_dy9_cd')).toBe('DAILY_LIMIT');
    expect(poolQueries.some(q => q.startsWith('DELETE FROM public.ai_cooldown'))).toBe(true);
  });

  // Дейлик 30.10 (подозрение): БД не ответила — это не отказ по лимиту, окно остаётся.
  // Мутация: сбрасывать кулдаун до разбора вердикта → красный.
  it('UNAVAILABLE → отметка ai_cooldown не снимается', async () => {
    poolQueries.length = 0;
    dailyFails = true;
    expect(await postgresAiContext.checkAndIncrementLimit('u_dy9_cd2')).toBe('UNAVAILABLE');
    expect(poolQueries.some(q => q.startsWith('DELETE FROM public.ai_cooldown'))).toBe(false);
    dailyFails = false;
  });
});
