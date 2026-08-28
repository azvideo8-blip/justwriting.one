// Баг с экрана: после импорта заметка показывалась дважды — одна с текстом,
// вторая пустая с тем же названием, и пустую приходилось удалять руками.
//
// Причина не в импорте (он создаёт ровно один документ), а в склейке списка:
// облачные строки отсеивались только по linkedCloudId, а он проставляется
// после выгрузки. Импорт выгрузку не дожидается — и в окне между «облачная
// строка уже есть» и «ссылка записана» список показывал обе.
// Фальсификация: убрать localUuids из фильтра — тест краснеет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const CANON = '11111111-2222-4333-8444-555555555555';

vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: {
    // В облаке id документа — это его канонический uuid.
    getUserDocuments: vi.fn(async () => ([{
      id: CANON, title: 'Моя заметка', totalWords: 4, totalDuration: 0,
      tags: [], lastSessionAt: new Date(), firstSessionAt: new Date(),
    }])),
  },
}));

vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: {
    getLatestContent: vi.fn(async () => 'Текст импортированной заметки.'),
    getLatestVersionMeta: vi.fn(async () => ({ wordsAdded: 4 })),
  },
}));

import { loadAllSessions } from '../../../../core/services/UnifiedSessionLoader';
import { getLocalDb } from '../../../../core/storage/localDb';

describe('импорт не должен показывать заметку дважды', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const rec of await db.getAll('documents')) {
      await db.delete('documents', (rec as { id: string }).id);
    }
    // Свежеимпортированная заметка: uuid уже есть, linkedCloudId ещё нет —
    // выгрузка идёт прямо сейчас.
    await db.put('documents', {
      id: 'local_imported', uuid: CANON, guestId: 'u1', title: 'Моя заметка',
      currentVersion: 1, totalWords: 4, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: Date.now(), lastSessionAt: Date.now(), tags: [],
    } as never);
  });

  it('облачная копия той же заметки не становится второй записью', async () => {
    const { sessions } = await loadAllSessions('u1', { uid: 'u1' } as never, { withContent: true });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.content).not.toBe('');
  });
});
