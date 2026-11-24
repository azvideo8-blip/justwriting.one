import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLifeLog } from '../useLifeLog';

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

const getVersions = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/services/LocalVersionService', () => ({ LocalVersionService: { getVersions } }));

const stableT = (key: string) => key;
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: stableT, language: 'ru', setLanguage: () => {}, tp: (key: string) => key }),
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// R-2: ошибка списка, какой её бросает DocumentService (модуль здесь замокан — класса нет).
function partialList(docs: unknown[], ids: string[]) {
  const e = new Error(`UNREADABLE_CLOUD_LIST: ${ids.length}`);
  e.name = 'UnreadableCloudListError';
  return Object.assign(e, { docs, ids, uuids: ids });
}

// A cloud read that failed and a cloud that is genuinely empty produce the same
// empty list. Telling them apart is the whole point: the Life Log built from
// local notes alone shows days the owner did write as days they did not.
describe('useLifeLog — unknown is not empty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocumentsByOwner.mockResolvedValue([]);
  });

  it('reports the cloud as unknown when the read fails', async () => {
    mocks.getUserDocuments.mockRejectedValue(new Error('unavailable'));

    const { result } = renderHook(() => useLifeLog('user_1', false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cloudUnknown).toBe(true);
  });

  // R-2: один битый ряд — облако «неизвестно», но прочитанная заметка в журнале.
  // Мутация «не брать e.docs» → красный.
  it('partial cloud list: unknown, yet readable notes are shown', async () => {
    const cloudDoc = { id: 'cloud_ok', userId: 'user_1', title: 'ok', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: new Date('2026-10-01T10:00:00Z'), lastSessionAt: new Date('2026-10-01T10:00:00Z'), tags: [] };
    mocks.getUserDocuments.mockRejectedValue(partialList([cloudDoc], ['cloud_bad']));

    const { result } = renderHook(() => useLifeLog('user_1', false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cloudUnknown).toBe(true);
    expect(JSON.stringify(result.current.unifiedDocuments)).toContain('cloud_ok');
  });

  it('does not report unknown when the cloud is genuinely empty', async () => {
    mocks.getUserDocuments.mockResolvedValue([]);

    const { result } = renderHook(() => useLifeLog('user_1', false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cloudUnknown).toBe(false);
    expect(result.current.unifiedDocuments).toEqual([]);
  });

  // Мутация: убрать catch версий — красный (записи нет). «Облако недоступно» не показываем.
  it('versions of a today note could not be read — the note is still shown, the cloud is not blamed', async () => {
    mocks.getUserDocuments.mockResolvedValue([]);
    mocks.getDocumentsByOwner.mockResolvedValue([{ id: 'l1', guestId: 'user_1', title: 'ok', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: Date.now(), lastSessionAt: Date.now(), tags: [] }]);
    getVersions.mockRejectedValue(new Error('idb down'));

    const { result } = renderHook(() => useLifeLog('user_1', false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unifiedDocuments).toHaveLength(1);
    expect(result.current.cloudUnknown).toBe(false);
  });
});
