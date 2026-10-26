// DY3-3(б): выход по неизменившемуся составу общей базы стоял ДО ветки R-11.
// Если состав записал проход под другим аккаунтом, «застрявший» аккаунт при
// следующем открытии базы молчал — сигнала не было никогда.
// Фальсификация: вернуть выход по составу выше R-11 → красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: 'u_lg' }) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { getLocalDb, cleanLegacySharedDb } from '../localDb';
import { reportError } from '../../../shared/errors/reportError';

describe('DY3-3(б): R-11-сигнал не теряется из-за состава, записанного чужим аккаунтом', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(reportError).mockClear();
  });

  it('аккаунт с застрявшим документом получает сигнал и после прохода другого аккаунта', async () => {
    const shared = await getLocalDb('justwriting-local');
    for (const s of ['documents', 'versions', 'profile', 'aiSummaries'] as const) await shared.clear(s);
    await shared.put('documents', { id: 'stuck', guestId: 'u_lg', title: 'застрял', currentVersion: 1 } as never);
    await shared.put('versions', { id: 'v1', documentId: 'stuck', guestId: 'u_lg', version: 1, content: 'x' } as never);
    localStorage.setItem('jw_legacy_migrated_u_lg', '1');

    // Проход другого аккаунта запоминает состав (документ u_lg при этом на месте).
    await cleanLegacySharedDb('u_other');
    vi.mocked(reportError).mockClear();

    await cleanLegacySharedDb('u_lg');

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
