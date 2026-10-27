// PA-1 (тикет 26.10): строгий ход (приложена заметка) с периодом в вопросе.
// `buildContext` выходит из строгой ветки до временной (`aiChatContext.ts:483`),
// поэтому окно периода не подменяет строгую область: чужие записи в ход не
// приезжают. Широкий ход с тем же текстом — положительный контроль: записи
// окна правда попадают в перечень, иначе пустой «not.toContain» ничего не доказывает.
//
// Мутация: отключить ранний выход строгого хода (`if (strictNoteTurn)` → `if (false)`)
// → (1) красный; убрать LIST_REQUEST → (2) красный (контроль слепой).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';
import { linkedNote } from '../../../../test/attachedTurnFixtures';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const DAY = 86_400_000;
const OCT_1 = Date.UTC(2026, 9, 1);
const ATTACHED_ID = 'doc_pr1w_attached';
const ATTACHED_TEXT = 'ТЕЛО ПРИЛОЖЕННОЙ ЗАПИСИ про мастерскую';
const WINDOW_TEXT = 'перечисли осознания с 10 по 24 октября 2026';

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  await db.put('documents', {
    id: ATTACHED_ID, guestId: 'u1', title: 'Мастерская', currentVersion: 1,
    firstSessionAt: OCT_1 + 20 * DAY, lastSessionAt: OCT_1 + 20 * DAY, tags: [],
  } as never);
  // Две записи внутри окна (10–24 октября) — их не должно быть в строгом ходе.
  for (const [id, day] of [['local_pr1w_a', 12], ['local_pr1w_b', 19]] as const) {
    await db.put('documents', {
      id, guestId: 'u1', title: `Запись ${day}`, currentVersion: 1, totalWords: 30, totalDuration: 60, sessionsCount: 1,
      firstSessionAt: OCT_1 + (day - 1) * DAY, lastSessionAt: OCT_1 + (day - 1) * DAY, tags: [],
    } as never);
    await db.put('aiSummaries', {
      documentId: id, processedAt: OCT_1, summary: `СУТЬ_${id}`, themes: [],
      insights: [`ОЗАРЕНИЕ_${id}`], extractedFacts: [`ФАКТ_${id}`],
    } as never);
  }
  vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('Тело записи');
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
}

async function build(scope: 'note' | 'wide'): Promise<string> {
  const { result } = renderHook(() => useAIChatContext('coach'));
  const ctx = await result.current.buildContext({
    text: WINDOW_TEXT,
    attached: linkedNote(ATTACHED_ID, ATTACHED_TEXT),
    mood: undefined,
    messageHistory: [],
    isFirstTurn: true,
    scope,
  });
  return ctx.searchContext ?? '';
}

describe('PA-1: окно периода не подменяет строгий ход', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('строгий ход: тело заметки есть, перечня окна и чужих записей нет', async () => {
    await seed();
    const text = await build('note');
    expect(text).toContain(ATTACHED_TEXT);
    expect(text).not.toContain('[Все записи периода');
    expect(text).not.toContain('local_pr1w_a');
    expect(text).not.toContain('ОЗАРЕНИЕ_local_pr1w_a');
  });

  it('контроль: тот же текст широким ходом перечень окна выдаёт', async () => {
    await seed();
    const text = await build('wide');
    expect(text).toContain('[Все записи периода');
    expect(text).toContain('local_pr1w_a');
    expect(text).toContain('local_pr1w_b');
  });
});
