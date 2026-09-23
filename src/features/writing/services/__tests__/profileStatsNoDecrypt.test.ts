// AUD-24: открытие профиля расшифровывало весь архив — getLatestContent читал
// и расшифровывал последнюю версию каждой заметки ради счётчиков, которые и так
// лежат в записи документа. Тексты теперь опциональны; статистика их не зовёт.
// Фальсификация: убрать проверку флага — счёт вызовов становится равен числу
// документов и тест краснеет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const mockGetGuestDocuments = vi.fn();
const mockGetLatestContent = vi.fn();
const mockGetLatestVersionMeta = vi.fn();

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getDocumentsByOwner: (...a: unknown[]) => mockGetGuestDocuments(...a),
  },
}));

vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: {
    getLatestContent: (...a: unknown[]) => mockGetLatestContent(...a),
    getLatestVersionMeta: (...a: unknown[]) => mockGetLatestVersionMeta(...a),
  },
}));

vi.mock('../../../../core/services/VersionService', () => ({
  VersionService: { getLatestVersion: vi.fn().mockResolvedValue(null) },
  isVersionContentTooLarge: vi.fn().mockReturnValue(false),
}));

import { loadAllSessions } from '../../../../core/services/UnifiedSessionLoader';

const doc = (id: string) => ({
  id, guestId: 'u_prof_1', title: `n-${id}`, currentVersion: 1,
  totalWords: id.length, totalDuration: 10, sessionsCount: 1,
  firstSessionAt: Date.now(), lastSessionAt: Date.now(), tags: [],
});

describe('AUD-24 profile stats do not decrypt the archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGuestDocuments.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => doc(`doc_${i}`)),
    );
    // Если текст всё же запросят — пусть каждый вызов будет заметен.
    mockGetLatestContent.mockResolvedValue('текст заметки');
    mockGetLatestVersionMeta.mockResolvedValue({ wordsAdded: 3 });
  });

  it('makes zero content reads when withContent is not requested', async () => {
    const { sessions } = await loadAllSessions('u_prof_1', null);
    expect(mockGetLatestContent).toHaveBeenCalledTimes(0);
    expect(sessions).toHaveLength(50);
    // Счётчики берутся из записи документа, а не из расшифрованного текста.
    expect(sessions[0]!.wordCount).toBeGreaterThan(0);
    expect(sessions[0]!.sessionWordsAdded).toBe(3);
    // «Не читали» — не «не смогли прочитать»: _contentError остаётся false.
    expect(sessions.every(s => !s._contentError)).toBe(true);
    expect(sessions.every(s => s._contentNotLoaded === true)).toBe(true);
  });

  it('still reads every note when the caller asks for content', async () => {
    await loadAllSessions('u_prof_1', null, { withContent: true });
    expect(mockGetLatestContent).toHaveBeenCalledTimes(50);
  });
});
