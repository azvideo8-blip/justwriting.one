// Открытый вопрос 5: вкладка, не начинавшая стирание, не пишет черновик обратно после
// «выйти и стереть». Вторая вкладка — свежая загрузка модуля: память у неё своя, localStorage общий.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realNow = Date.now;

async function freshTab() {
  vi.resetModules();
  return import('../accountReload');
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  Date.now = realNow;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flushRanInOtherTab(): Promise<boolean> {
  const other = await freshTab();
  const flusher = vi.fn(async () => {});
  other.onBeforeAccountReload(flusher);
  const done = other.reloadForAccountChange();
  await vi.advanceTimersByTimeAsync(2000);
  await done;
  return flusher.mock.calls.length > 0;
}

describe('стирание в соседней вкладке', () => {
  it('метка свежая: вторая вкладка черновик не сохраняет', async () => {
    (await freshTab()).skipFlushOnAccountReload();
    expect(await flushRanInOtherTab()).toBe(false);
  });

  it('обычный выход без метки: сохранение идёт', async () => {
    expect(await flushRanInOtherTab()).toBe(true);
  });

  it('выход не состоялся: метка снята, сохранение идёт', async () => {
    const first = await freshTab();
    first.skipFlushOnAccountReload();
    first.skipFlushOnAccountReload(false);
    expect(await flushRanInOtherTab()).toBe(true);
  });

  it('метка устарела: сохранение идёт', async () => {
    (await freshTab()).skipFlushOnAccountReload();
    const later = realNow() + 61_000;
    Date.now = () => later;
    expect(await flushRanInOtherTab()).toBe(true);
  });
});
