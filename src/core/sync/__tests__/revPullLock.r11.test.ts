// Ревью 0.11.0 (R11-1): две вкладки забирали по rev одновременно — каждая
// читала список отложенных себе и записывала его целиком. Строка, отложенная
// вкладкой B, пропадала после записи вкладки A, а курсор уже прошёл её.
// Теперь забор идёт под Web Lock на аккаунт: вторая вкладка ждёт и читает
// список заново.
// Мутации: withSyncRevPullLock зовёт fn() без замка → (a) красный;
// pullNotesByRev зовёт run() без обёртки → (b) красный.
import { describe, it, expect, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { getLocalDb, syncRevCursorKey } from '../../storage/localDb';
import { getSyncRevDeferred, setSyncRevDeferred, withSyncRevPullLock } from '../revCursor';

const A = 'u_r11_lock';

/** Замок «как в браузере»: одно имя — по очереди. */
function installFakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const request = vi.fn((name: string, cb: () => Promise<unknown>) => {
    const prev = tails.get(name) ?? Promise.resolve();
    const next = prev.then(() => cb());
    tails.set(name, next.catch(() => undefined));
    return next;
  });
  Object.defineProperty(globalThis.navigator, 'locks', { value: { request }, configurable: true });
  return request;
}

afterEach(() => {
  Object.defineProperty(globalThis.navigator, 'locks', { value: undefined, configurable: true });
});

describe('R11-1: забор по rev — один на аккаунт во всём браузере', () => {
  it('(a) отложенная строка второй вкладки не теряется', async () => {
    installFakeLocks();
    const db = await getLocalDb(A);
    await db.delete('profile', syncRevCursorKey(A));

    let releaseA!: () => void;
    const gateA = new Promise<void>(r => { releaseA = r; });

    // Вкладка A: прочитала список, долго работает со страницей, пишет своё.
    const tabA = withSyncRevPullLock(A, async () => {
      const rows = await getSyncRevDeferred(A);
      await gateA;
      await setSyncRevDeferred(A, [...rows, { uuid: 'x', rev: 5, reason: 'decrypt' }]);
    });
    // Вкладка B: откладывает свою строку.
    const tabB = withSyncRevPullLock(A, async () => {
      const rows = await getSyncRevDeferred(A);
      await setSyncRevDeferred(A, [...rows, { uuid: 'y', rev: 9, reason: 'schema' }]);
    });
    await new Promise(r => setTimeout(r, 10));
    releaseA();
    await Promise.all([tabA, tabB]);

    expect((await getSyncRevDeferred(A)).map(r => r.uuid).sort()).toEqual(['x', 'y']);
  });

  it('(b) pullNotesByRev идёт под замком с uid в имени', async () => {
    const request = installFakeLocks();
    const { CloudSyncService } = await import('../../services/CloudSyncService');
    // Сам забор здесь не нужен — достаточно, что он вошёл в замок.
    request.mockImplementationOnce(async () => ({ downloaded: 0 }) as never);
    await CloudSyncService.pullNotesByRev('u_r11_wired');
    expect(request).toHaveBeenCalledWith('jw-sync-rev-pull:u_r11_wired', expect.any(Function));
  });
});
