// AUD-23: правка одной заметки пересобирала MiniSearch по всему архиву —
// квадратично от сессий в день. Теперь точечное обновление: discard+add одной
// записи, полный rebuild остаётся импорту/восстановлению/выходу.
// Фальсификация: заменить refresh на invalidateMiniSearchCache — счётчик
// чтений контента станет равен числу документов и тест краснеет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { searchNotes } from '../noteRetriever';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const NOTE_ID = 'local_inc_note';

async function seed(contentText: string) {
  const db = await getLocalDb();
  for (const store of ['documents', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) await db.delete(store, (rec as { id: string }).id);
  }
  await db.put('documents', {
    id: NOTE_ID, guestId: 'u1', title: 'Заметка', currentVersion: 1,
    totalWords: 10, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
  } as never);
  await markAllAnalysed(db);
  vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue(contentText);
}

describe('AUD-23 incremental index update on edit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('picks up an edited note without re-reading the whole archive', async () => {
    // Полный пересбор индекса читает ВСЕ документы — следим за чтениями.
    await seed('Текст про работу и дедлайны.');

    // Строим индекс.
    await searchNotes('дедлайны', 5);

    // Правка: новая версия с новым словом. Счётчик чтений сбрасываем —
    // точечное обновление должно прочитать только правленную заметку,
    // а не по одному чтению на весь архив.
    (LocalVersionService.getLatestContent as ReturnType<typeof vi.fn>).mockClear();
    (LocalVersionService.getLatestContent as ReturnType<typeof vi.fn>).mockResolvedValue(
      'Совершенно новый текст про керамическую мастерскую.',
    );

    window.dispatchEvent(new CustomEvent('doc-version-saved', { detail: { documentId: NOTE_ID } }));
    // Даём обработчику события доработать.
    await new Promise(r => setTimeout(r, 20));

    const readsAfterEvent = (LocalVersionService.getLatestContent as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(readsAfterEvent).toBe(1); // одна заметка, не весь архив

    const results = await searchNotes('керамическую', 5);
    expect(results.map(r => r.documentId)).toContain(NOTE_ID);
  });
});
