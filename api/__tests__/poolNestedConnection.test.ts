// R10-8 (N-77): транзакция обязана оставаться на одном соединении.
// Без живой базы: fake-пул считает запросы, ушедшие через пул, пока хоть одно
// соединение держит незакрытый BEGIN. Роль «админ» здесь отдаёт только client —
// если сверка уйдёт обратно на пул, лимит админа станет пользовательским.
import { describe, it, expect, vi } from 'vitest';

const { tx, poolMock } = vi.hoisted(() => {
  const state = { openClients: 0, nestedWhileInTx: 0 };
  const makeClient = () => ({
    on: () => {},
    removeListener: () => {},
    release: () => {},
    query: async (text: string) => {
      const t = String(text).trim().toUpperCase();
      if (t === 'BEGIN') state.openClients++;
      if (t === 'COMMIT' || t === 'ROLLBACK') state.openClients = Math.max(0, state.openClients - 1);
      if (t.startsWith('SELECT ROLE')) return { rows: [{ role: 'admin' }] };
      return { rows: [{ call_count: Number(process.env.JW_FAKE_COUNT ?? 1) }] };
    },
  });
  return {
    tx: state,
    poolMock: {
      connect: async () => makeClient(),
      // Отдельное соединение внутри транзакции: в реальности это вечное
      // ожидание, здесь — ответ «не админ», чего и хватает красному тесту.
      query: async (text: string) => {
        if (state.openClients > 0) state.nestedWhileInTx++;
        if (String(text).trim().toUpperCase().startsWith('SELECT ROLE')) return { rows: [{ role: 'user' }] };
        return { rows: [{ call_count: 1 }] };
      },
      end: async () => {},
    },
  };
});

vi.mock('../db', () => ({ pool: poolMock }));

const { postgresAiContext } = await import('../postgresAiContext');
const { DAILY_LIMIT } = await import('../ai/pure');

describe('checkDailyLimit держит транзакцию на одном соединении (N-77)', () => {
  it('сверяет роль админа на своём соединении и не берёт второе из пула', async () => {
    // Счётчик заведомо выше пользовательского потолка и ниже админского.
    process.env.JW_FAKE_COUNT = String(DAILY_LIMIT + 1);
    try {
      const verdict = await postgresAiContext.checkDailyLimit('uid-admin-same-client');

      expect(tx.nestedWhileInTx).toBe(0);
      expect(tx.openClients).toBe(0);
      // ok === false здесь означает, что роль читалась не тем соединением:
      // лимит взялся пользовательский, и вызов за потолок ушёл в отказ.
      expect(verdict.ok).toBe(true);
    } finally {
      delete process.env.JW_FAKE_COUNT;
    }
  });
});
