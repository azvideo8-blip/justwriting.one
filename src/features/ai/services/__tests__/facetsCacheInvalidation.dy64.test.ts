import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { getLocalDb, type AIDialogue, type AIProfileFacet, type LocalDocument } from '../../../../core/storage/localDb';
import { getCurrentUser } from '../../../../core/auth';
import { _resetAuthStateForTesting } from '../../../../core/auth/supabaseAuthProvider';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { useAIChatContext } from '../aiChatContext';
import { AIProfileFacetService } from '../AIProfileFacetService';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { writeFacetStore } from '../../../../core/services/facetLock';
import * as noteRetriever from '../../utils/noteRetriever';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

// DY6-4 (приёмка 26.10, Н-3): facetsCacheRef живёт до resetSession. Заметку или
// диалог-источник скрыли/выбросили/удалили посреди диалога — кэш должен
// протухнуть, и перечитка (страж getAll) обязана отработать. Кейс с диалогом
// до правки красный: страж диалогов живёт в getAll, а кэш его не зовёт.
//
// Мутации: закомментировать инвалидацию — оба dialogue-кейса красные; вернуть
// в W-3 условие без trashed — trashed-кейс красный.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const uid = 'dy64-ctx-user';
const now = Date.UTC(2026, 9, 20);
const NOTE_A = 'dy64_note_a';
const DLG = 'dy64_dlg';
const DLG_SUMMARY = 'ГРАНЬ_ДИАЛОГ_DY64: разговор про прогулку и метроном';
const NOTE_SUMMARY = 'ГРАНЬ_ЗАМЕТКА_DY64: прогулка, метроном, тишина';

const doc = (id: string, extra: Partial<LocalDocument> = {}): LocalDocument => ({
  id, uuid: `uuid-${id}`, guestId: uid, title: id, currentVersion: 1, totalWords: 40,
  totalDuration: 1, sessionsCount: 1, firstSessionAt: now, lastSessionAt: now, tags: [], ...extra,
});

const facet = (id: string, noteIds: string[], summary: string, dialogueIds?: string[]): AIProfileFacet => ({
  id, label: 'Тема', summary, centroid: [1, 0], noteIds, dialogueIds: dialogueIds ?? [],
  noteCount: noteIds.length, firstAt: now, lastAt: now, updatedAt: now, buildId: 'b64',
});

const dialogue = (id: string, extra: Partial<AIDialogue> = {}): AIDialogue => ({
  id, title: id, personaId: 'cbt', personaName: 'Аналитик', personaEmoji: '🙂',
  messages: [{ role: 'user', content: 'Про прогулку?' }, { role: 'assistant', content: 'Да.' }],
  createdAt: now, updatedAt: now, ...extra,
});

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiDialogues', 'aiDialogueEvents', 'aiProfileFacets', 'aiSummaries', 'aiEmbeddings'] as const) {
    await db.clear(store);
  }
  await db.put('documents', doc(NOTE_A));
  await markAllAnalysed(db);
  await db.put('aiDialogues', dialogue(DLG));
  await writeFacetStore(async store => {
    await store.put(facet('f_note', [NOTE_A], NOTE_SUMMARY));
    await store.put(facet('f_dialogue', [NOTE_A], DLG_SUMMARY, [DLG]));
  });
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
}

async function ask(build: (p: Record<string, unknown>) => Promise<{ searchContext?: string }>, text: string): Promise<string> {
  const ctx = await build({ text, attached: undefined, mood: undefined, messageHistory: [], isFirstTurn: false, scope: 'wide' });
  return ctx.searchContext ?? '';
}

describe('DY6-4: кэш граней протухает по скрытию/корзине/удалению источника', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    _resetAuthStateForTesting();
    getCurrentUser();
    // Гость: hasIndexingConsent(undefined) читает ключ 'guest'.
    setIndexingConsent(undefined, 'granted');
  });

  it('скрытие заметки: следующий ход без её пересказа и getAll перечитан', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('coach'));
    const build = result.current.buildContext as never;

    const first = await ask(build, 'собери темы: прогулка метроном');
    expect(first, 'первый ход не увидел грань — тест вакуумный').toContain(NOTE_SUMMARY);

    const db = await getLocalDb();
    await db.put('documents', doc(NOTE_A, { excludedFromAI: true }));
    await markAllAnalysed(db);
    const getAll = vi.spyOn(AIProfileFacetService, 'getAll');
    const second = await ask(build, 'собери темы: прогулка метроном');
    expect(second).not.toContain(NOTE_SUMMARY);
    expect(getAll, 'кэш не инвалидирован — getAll не перечитывался').toHaveBeenCalled();
  });

  it('скрытие диалога-источника: следующий ход без пересказа диалога', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('coach'));
    const build = result.current.buildContext as never;

    const first = await ask(build, 'собери темы: прогулка метроном');
    expect(first, 'первый ход не увидел диалог-грань — тест вакуумный').toContain(DLG_SUMMARY);

    const db = await getLocalDb();
    await db.put('aiDialogues', dialogue(DLG, { deletedAt: now }));
    const second = await ask(build, 'собери темы: прогулка метроном');
    expect(second, 'пересказ удалённого диалога остался в контексте').not.toContain(DLG_SUMMARY);
  });

  it('корзина заметки: тот же сброс кэша', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('coach'));
    const build = result.current.buildContext as never;
    expect(await ask(build, 'собери темы: прогулка метроном')).toContain(NOTE_SUMMARY);

    const db = await getLocalDb();
    await db.put('documents', doc(NOTE_A, { trashedAt: now }));
    await markAllAnalysed(db);
    const getAll = vi.spyOn(AIProfileFacetService, 'getAll');
    const second = await ask(build, 'собери темы: прогулка метроном');
    expect(second).not.toContain(NOTE_SUMMARY);
    expect(getAll).toHaveBeenCalled();
  });

  // Находка самопроверки 26.10: страж разрешает заметку грани по трём ключам
  // (локальный id, uuid, облачный id), а проверка протухания смотрела только
  // локальный id — грань с uuid выглядела удалённой и пересобиралась каждый ход.
  // (W-3 на месте использования читает тот же один ключ, поэтому такая грань
  // наружу всё равно не выходит — спрятав консервативно, дыры нет; расхождение
  // отмечено в отчёте.)
  it('грань с uuid в noteIds не пересобирается на каждом ходе', async () => {
    await seed();
    await writeFacetStore(async store => {
      await store.put(facet('f_uuid', [`uuid-${NOTE_A}`], NOTE_SUMMARY));
    });
    const { result } = renderHook(() => useAIChatContext('coach'));
    const build = result.current.buildContext as never;
    await ask(build, 'собери темы: прогулка метроном'); // холодный кэш

    const getAll = vi.spyOn(AIProfileFacetService, 'getAll');
    await ask(build, 'собери темы: метроном и тишина');
    await ask(build, 'собери темы: прогулка и тишина');
    expect(getAll, 'кэш протухал каждый ход: перечитка граней на каждом').not.toHaveBeenCalled();
  });

  // Вторая находка: проверка диалогов читала ВСЁ хранилище диалогов на каждую
  // грань с `dialogueIds` (замер в комментарии сервиса: 300 диалогов ≈ 2,6 МБ).
  // Один полный список на ход остаётся — его читает proactive (не этот правкой).
  it('протухание по диалогу читает диалог по id, а не список на грань', async () => {
    await seed();
    await writeFacetStore(async store => {
      await store.put(facet('f_dialogue_b', [NOTE_A], 'ГРАНЬ_ДИАЛОГ_B_DY64: второй пересказ того же хода', [DLG]));
    });
    const { result } = renderHook(() => useAIChatContext('coach'));
    const build = result.current.buildContext as never;
    expect(await ask(build, 'собери темы: прогулка метроном')).toContain(DLG_SUMMARY);

    const db = await getLocalDb();
    const getAll = vi.spyOn(db, 'getAll');
    const get = vi.spyOn(db, 'get');
    const second = await ask(build, 'собери темы: прогулка метроном');
    expect(second).toContain(DLG_SUMMARY);
    const listReads = getAll.mock.calls.filter(c => c[0] === 'aiDialogues').length;
    expect(listReads, 'список диалогов читается на каждую грань с dialogueIds').toBeLessThanOrEqual(1);
    expect(
      get.mock.calls.some(c => c[0] === 'aiDialogues' && c[1] === DLG),
      'проверка протухания не читает диалог по id',
    ).toBe(true);
  });
});
