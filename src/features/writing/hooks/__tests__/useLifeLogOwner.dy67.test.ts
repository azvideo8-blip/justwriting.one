import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLifeLog } from '../useLifeLog';

// DY6-7 (приёмка 26.10, Н-5): отмену держит только флаг монтирования, а экран
// при смене человека не перемонтируется (вход — модалка поверх, см. BR-15).
// Значит поздний ответ прежнего владельца ложился поверх чужого списка, а на
// пустом id прежний список оставался наружу, пока читается новый.
// Правка та же, что у BR-13/BR-15: снимок живёт вместе с владельцем, поздний
// ответ сверяется с настоящим, а наружу идёт только снимок своего владельца.

const mocks = vi.hoisted(() => ({
  getUserDocuments: vi.fn(),
  getDocumentsByOwner: vi.fn(),
}));

vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: mocks.getUserDocuments },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocumentsByOwner: mocks.getDocumentsByOwner },
}));
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: { getVersions: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../../core/services/VersionService', () => ({
  VersionService: { getVersions: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru', setLanguage: () => {}, tp: (k: string) => k }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

function doc(id: string, owner: string) {
  const at = Date.now() - 3 * 86_400_000;
  return {
    id, uuid: `uuid-${id}`, guestId: owner, title: `Запись ${id}`, currentVersion: 1, totalWords: 10,
    totalDuration: 60, sessionsCount: 1, firstSessionAt: at, lastSessionAt: at, tags: [], linkedCloudId: `c-${id}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserDocuments.mockResolvedValue([]);
  mocks.getDocumentsByOwner.mockResolvedValue([]);
});

describe('DY6-7: useLifeLog ключует снимок владельцем', () => {
  it('поздний ответ прежнего владельца не затирает экран нового', async () => {
    let releaseA: (v: unknown[]) => void = () => {};
    const slowA = new Promise<unknown[]>(res => { releaseA = res; });
    mocks.getDocumentsByOwner.mockImplementation((uid: string) => (uid === 'A' ? slowA : Promise.resolve([doc('b1', 'B')])));

    let uid = 'A';
    const { result, rerender } = renderHook(() => useLifeLog(uid, false));
    uid = 'B';
    rerender();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unifiedDocuments.map(d => d.localId)).toEqual(['b1']);

    // Прежний владелец доответил ПОСЛЕ смены: его снимок помечен «A» и наружу
    // не выйдет, а сам ход отбрасывается по сверке с настоящим владельцем.
    await act(async () => {
      releaseA([doc('a9', 'A')]);
      await new Promise(r => setTimeout(r, 30));
    });
    const ids = result.current.unifiedDocuments.map(d => d.localId);
    expect(ids, 'чужой ответ затёр экран B').toEqual(['b1']);
    expect(result.current.loading, 'чужой ход снял флаг загрузки').toBe(false);
  });

  it('на пустом id прежний список не остаётся наружу, пока читается новый', async () => {
    let releaseEmpty: (v: unknown[]) => void = () => {};
    const pendingEmpty = new Promise<unknown[]>(res => { releaseEmpty = res; });
    mocks.getDocumentsByOwner.mockImplementation((uid: string) => (uid === 'A' ? Promise.resolve([doc('a1', 'A')]) : pendingEmpty));

    const { result, rerender } = renderHook(({ u }: { u: string }) => useLifeLog(u, false), { initialProps: { u: 'A' } });
    await waitFor(() => expect(result.current.unifiedDocuments.map(d => d.localId)).toEqual(['a1']));

    rerender({ u: '' });
    expect(result.current.unifiedDocuments, 'прежний список виден пустому владельцу').toEqual([]);
    expect(result.current.sessionGroups, 'прежние группы видны пустому владельцу').toEqual([]);

    await act(async () => { releaseEmpty([]); });
    expect(result.current.unifiedDocuments).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('контроль: своё чтение отдаёт список и группы', async () => {
    mocks.getDocumentsByOwner.mockResolvedValue([doc('a1', 'A')]);
    const { result } = renderHook(() => useLifeLog('A', false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unifiedDocuments.map(d => d.localId)).toEqual(['a1']);
    expect(result.current.sessionGroups).toHaveLength(1);
  });
});
