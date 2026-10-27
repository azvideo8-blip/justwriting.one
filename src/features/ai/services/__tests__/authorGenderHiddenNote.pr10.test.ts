import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { detectAuthorGender } from '../../../../shared/ai/authorGender';

// PA-6 (PR-10, тикетный пункт 2): род считается только из того, что и так
// уходит модели. Скрытая от ИИ заметка не должна задавать род: её мужские
// формы не приезжают в searchContext, и смешение «видимая женская + скрытая
// мужская» не превращает детектор в null/m.
//
// Мутация: брать род из сырых attached.blocks (включая скрытые) — (2) красный;
// hideExcludedNotes перестать фильтровать — (1) красный.
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const VIS_ID = 'doc_pr10_visible';
const HID_ID = 'doc_pr10_hidden';

async function seed(db: Awaited<ReturnType<typeof getLocalDb>>) {
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  const at = Date.UTC(2026, 9, 20);
  await db.put('documents', { id: VIS_ID, guestId: 'u1', title: 'Видимая', currentVersion: 1, firstSessionAt: at, lastSessionAt: at, tags: [] } as never);
  await db.put('documents', { id: HID_ID, guestId: 'u1', title: 'Скрытая', currentVersion: 1, firstSessionAt: at, lastSessionAt: at, tags: [], excludedFromAI: true } as never);
  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) =>
    id === VIS_ID
      ? 'Я назвала сумму и потом весь день прокручивала этот разговор.'
      : 'Я согласился с ценой и подписал договор.');
}

describe('PR-10: скрытая заметка род не задаёт', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('в searchContext строгого хода мужских форм скрытой заметки нет', async () => {
    const db = await getLocalDb();
    await seed(db);
    const { result } = renderHook(() => useAIChatContext('editor'));
    const ctx = await result.current.buildContext({
      text: 'собери пост',
      attached: { blocks: [
        { documentId: VIS_ID, title: 'Видимая', content: 'Я назвала сумму и потом весь день прокручивала этот разговор.' },
        { documentId: HID_ID, title: 'Скрытая', content: 'Я согласился с ценой и подписал договор.' },
      ] },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      scope: 'note',
    });
    const sc = ctx.searchContext ?? '';
    expect(sc).toContain('Я назвала сумму');
    expect(sc, 'текст скрытой заметки уехал в модель').not.toContain('Я согласился');
    expect(detectAuthorGender(sc), 'смешанный род из-за скрытой заметки').toBe('f');
  });

  it('детектор по сырому смешанному тексту даёт null, по видимому — f', () => {
    expect(detectAuthorGender('Я назвала сумму. Я согласился с ценой.')).toBeNull();
    expect(detectAuthorGender('Я назвала сумму и прокручивала разговор.')).toBe('f');
  });
});
