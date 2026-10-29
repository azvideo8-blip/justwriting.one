// R-7 (S1-12): порча записи отложенных строк молча давала пустой список —
// отложенные пропадали навсегда (курсор их уже прошёл). Теперь порча читается
// как нечитаемый курсор: предупреждение и забор с нуля, как у parseCursor.
// Мутации: вернуть [] без readable → (a) красный (курсор не сброшен, нет warning).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { getLocalDb, syncRevCursorKey } from '../../storage/localDb';
import { advanceSyncRevCursor, getSyncRevCursor, getSyncRevDeferred, setSyncRevDeferred } from '../revCursor';
import { reportError } from '../../../shared/errors/reportError';

const A = 'u_r7_deferred';

async function corruptDeferred(value: unknown) {
  const db = await getLocalDb(A);
  const key = syncRevCursorKey(A);
  const rec = (await db.get('profile', key)) as unknown as Record<string, unknown>;
  await db.put('profile', { ...rec, syncRevDeferred: value } as never);
}

describe('R-7: порча отложенных = нечитаемый курсор', () => {
  beforeEach(async () => {
    vi.mocked(reportError).mockClear();
    const db = await getLocalDb(A);
    await db.delete('profile', syncRevCursorKey(A));
  });

  it('(a) строка вместо массива → курсор с нуля, warning; отложенных нет', async () => {
    await advanceSyncRevCursor(A, 'documents', 40);
    await setSyncRevDeferred(A, [{ uuid: 'x', rev: 7, reason: 'schema' }]);
    expect((await getSyncRevCursor(A)).documents).toBe(40);

    await corruptDeferred('{broken');
    expect(await getSyncRevCursor(A)).toEqual({ documents: 0, versions: 0 });
    expect(await getSyncRevDeferred(A)).toEqual([]);
    expect(vi.mocked(reportError).mock.calls.some(c => String((c[0] as Error).message).includes('DEFERRED_UNREADABLE'))).toBe(true);
  });

  it('(b) элемент без uuid/rev → тоже порча, не «пропустить одну»', async () => {
    await advanceSyncRevCursor(A, 'documents', 40);
    await corruptDeferred([{ uuid: 'ok', rev: 1, reason: '' }, { uuid: '', rev: 'два' }]);
    expect((await getSyncRevCursor(A)).documents).toBe(0);
  });

  it('(c) отсутствие поля и пустой массив — читаемо, курсор на месте, без warning', async () => {
    await advanceSyncRevCursor(A, 'documents', 40);
    expect((await getSyncRevCursor(A)).documents).toBe(40);
    await setSyncRevDeferred(A, []);
    expect((await getSyncRevCursor(A)).documents).toBe(40);
    expect(await getSyncRevDeferred(A)).toEqual([]);
    expect(reportError).not.toHaveBeenCalled();
  });

  // Ревью 0.11.0 (R11-5): первый забор отложил строку до первого сдвига курсора —
  // запись есть, курсора нет. Это «с нуля», но не порча: без предупреждения.
  // Мутация: readable = record === undefined → красный (warning есть).
  it('R11-5: запись только с отложенными — курсор с нуля без предупреждения', async () => {
    await setSyncRevDeferred(A, [{ uuid: 'z', rev: 3, reason: 'schema' }]);
    expect(await getSyncRevCursor(A)).toEqual({ documents: 0, versions: 0 });
    expect(reportError).not.toHaveBeenCalled();
    expect((await getSyncRevDeferred(A)).map(r => r.uuid)).toEqual(['z']);
  });
});
