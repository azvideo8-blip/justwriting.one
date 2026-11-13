import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../../core/storage/localDb';
import { localDayKey } from '../../../../../core/utils/dateUtils';
import { buildProactiveBlock } from '../proactive';
import { markAllAnalysed } from '../../../../../test/utils/markAnalysed';

vi.mock('../../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

// TH-3 (дейлик 27.10, тезис 3): блок «Изменения за последнее время» строится из
// `aiTimeline` целиком и отсекает только те заметки, что лежат в `documents` с
// флагом «скрыть» или в корзине. Заметки, которой на устройстве уже нет
// (удалена на другом, чистка производных не дошла), в этом списке не бывает —
// и её темы уходят модели. Правило читателей хронологии — обратное:
// `loadVisibleNoteKeys` перечисляет видимые, «нет заметки» = «нельзя» (S-51).
//
// Маркеры выдуманные, живых формулировок здесь нет.

const DOC_OK = 'doc_ok_th3';
const DOC_GONE = 'doc_gone_th3';
const THEME_OK = 'тема-видимая-th3';
const THEME_GONE = 'тема-удалённой-заметки-th3';

const day = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return localDayKey(d);
};

describe('TH-3: тема удалённой заметки не попадает в блок «Изменения за последнее время»', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of [
      'documents', 'aiSummaries', 'aiTimeline', 'aiMonthlyDigest', 'aiDialogues',
      'aiDialogueEvents', 'aiCommitments', 'lifeStory', 'aiThreads', 'aiChatMemory',
    ] as const) {
      await db.clear(store);
    }

    await db.put('documents', {
      id: DOC_OK,
      guestId: 'guest',
      title: 'видимая',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 100,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
    } as never);
    await markAllAnalysed(db);

    // Базовая линия — заметка, которой в `documents` нет вовсе: удалена и не
    // вернулась, а строка хронологии осталась.
    await db.put('aiTimeline', {
      documentId: DOC_GONE,
      date: day(30),
      month: day(30).slice(0, 7),
      themes: [THEME_GONE],
    } as never);

    await db.put('aiTimeline', {
      documentId: DOC_OK,
      date: day(0),
      month: day(0).slice(0, 7),
      themes: [THEME_OK],
    } as never);
  });

  it('контроль фикстуры: строка хронологии удалённой заметки лежит, документа нет', async () => {
    const db = await getLocalDb();
    expect(await db.get('documents', DOC_GONE)).toBeUndefined();
    expect(await db.get('aiTimeline', DOC_GONE)).toBeDefined();
  });

  it('блок не несёт тему заметки, которой нет на устройстве', async () => {
    const block = await buildProactiveBlock({ personaId: 'coach' });
    // Контроль: блок действительно собрался и видимую тему назвал — иначе
    // проверка ниже зеленела бы на пустой строке.
    expect(block).toContain(THEME_OK);
    expect(block).not.toContain(THEME_GONE);
  });
});
