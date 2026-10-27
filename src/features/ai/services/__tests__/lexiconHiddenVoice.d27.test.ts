import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, type AIDocumentSummary } from '../../../../core/storage/localDb';
import { AILexiconService } from '../AILexiconService';
import { AIMemoryAssembler } from '../AIMemoryAssembler';
import { MemoryFlagsService } from '../memoryFlags';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';
import { emitDomainEvent, _resetDomainEventHandlersForTests } from '../../../../core/events/domainEvents';
import { initAiDomainEvents } from '../../subscribeDomainEvents';

// DY6-1 (дейлик 2026-10-26, Н-1): лексикон «своих слов» — единственный читатель
// aiSummaries без стража видимости, и его карта живёт в памяти 10 минут, поэтому
// слово скрытой заметки уходит в модель и после скрытия. Маркеры выдуманные.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

const WORD_VISIBLE = 'обычноесловод27';
const WORD_HIDDEN = 'запретноесловод27';

const doc = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  uuid: `uuid_${id}`,
  guestId: 'guest',
  title: id,
  currentVersion: 1,
  totalWords: 10,
  totalDuration: 100,
  sessionsCount: 1,
  firstSessionAt: Date.UTC(2026, 4, 10),
  lastSessionAt: Date.UTC(2026, 4, 10),
  tags: [],
  ...extra,
});

// Шесть видимых разборов (порог сигнала — 5 строк в 2+ месяцах, signalGate.ts:14),
// чтобы «красный» нельзя было списать на пустой корпус.
const VISIBLE_DATES = ['2026-05-10', '2026-05-20', '2026-06-05', '2026-06-15', '2026-07-01', '2026-07-10'];
const H1 = 'doc_d27_hidden1';
const H2 = 'doc_d27_hidden2';
// Слово скрытой заметки проходит фильтр дисперсии (2 раза в 2 месяцах) — то есть
// без стража оно неизбежно оказывается в подсказке.
const HIDDEN_DATES = ['2026-08-05', '2026-09-05'];

const summary = (documentId: string, eventDate: string, phrases: string[]): AIDocumentSummary => ({
  documentId,
  eventDate,
  processedAt: Date.parse(`${eventDate}T10:00:00Z`),
  tone: 'нейтральный',
  frequentWords: [],
  authorPhrases: phrases,
  insights: [],
  themes: [],
  extractedFacts: [],
});

/** @param hiddenVisible — заметки, которые ещё не скрыты, дают своё слово законно. */
async function seed(hiddenVisible: boolean): Promise<void> {
  const db = await getLocalDb();
  for (let i = 0; i < VISIBLE_DATES.length; i++) {
    const id = `doc_d27_visible${i}`;
    await db.put('documents', doc(id));
    await db.put('aiSummaries', summary(id, VISIBLE_DATES[i]!, [WORD_VISIBLE]));
  }
  for (let i = 0; i < HIDDEN_DATES.length; i++) {
    const id = i === 0 ? H1 : H2;
    await db.put('documents', doc(id, hiddenVisible ? {} : { excludedFromAI: true }));
    await db.put('aiSummaries', summary(id, HIDDEN_DATES[i]!, [WORD_HIDDEN]));
  }
}

async function hiddenWordInVoice(): Promise<boolean> {
  const map = await AILexiconService.getVoiceMap();
  return (map?.formattedPromptSnippet ?? '').includes(WORD_HIDDEN);
}

/** Ждём асинхронного обработчика шины: иначе «не сбросилось» было бы пустой проверкой. */
async function waitUntil(cond: () => Promise<boolean>, ms = 1000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= until) throw new Error('waitUntil: условие не наступило за отведённое время');
    await new Promise(r => setTimeout(r, 5));
  }
}

describe('DY6-1: лексикон «своих слов» — страж видимости и сброс кэша при скрытии', () => {
  beforeEach(async () => {
    localStorage.clear();
    _resetDomainEventHandlersForTests();
    vi.restoreAllMocks();
    AILexiconService.clearCache();
    MemoryFlagsService.resetFlags();
    const db = await getLocalDb();
    for (const store of ['documents', 'aiSummaries', 'aiTimeline', 'aiProfileFacets', 'aiThemeLedger', 'aiChatMemory', 'aiBeliefs'] as const) {
      await db.clear(store);
    }
  });

  it('контроль фикстуры: корпус над порогом сигнала и оба слова в aiSummaries', async () => {
    await seed(false);
    const db = await getLocalDb();
    expect((await db.getAll('aiSummaries')).length).toBe(8);
    const map = await AILexiconService.getVoiceMap({ forceRefresh: true });
    expect(map).not.toBeNull();
    expect(map?.formattedPromptSnippet ?? '').toContain(WORD_VISIBLE);
  });

  it('(а) getVoiceMap не берёт слова заметки, скрытой от ИИ', async () => {
    await seed(false);
    const map = await AILexiconService.getVoiceMap({ forceRefresh: true });
    expect(map?.formattedPromptSnippet ?? '').toContain(WORD_VISIBLE);
    expect(map?.formattedPromptSnippet ?? '').not.toContain(WORD_HIDDEN);
  });

  it('контроль: на чистом корпусе лексикон работает — страж не превращается в «пусто»', async () => {
    await seed(true);
    const map = await AILexiconService.getVoiceMap({ forceRefresh: true });
    expect(map).not.toBeNull();
    expect(map?.formattedPromptSnippet ?? '').toContain(WORD_VISIBLE);
  });

  it('(б) сборщик памяти не отдаёт слово скрытой заметки модели при включённом переключении', async () => {
    await seed(false);
    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    MemoryFlagsService.setFlag('ff_memory_assembler_chat_memory', true);
    const text = await AIMemoryAssembler.assembleMemoryContext({ query: 'привет' });
    expect(text ?? '').toContain('свои слова');
    expect(text ?? '').toContain(WORD_VISIBLE);
    expect(text ?? '').not.toContain(WORD_HIDDEN);
  });

  it('(в) кэш лексикона сбрасывается, когда заметку скрывают', async () => {
    await seed(true);
    const first = await AILexiconService.getVoiceMap();
    expect(first?.formattedPromptSnippet ?? '').toContain(WORD_HIDDEN);

    vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
    const db = await getLocalDb();
    initAiDomainEvents();

    for (const id of [H1, H2]) {
      await db.put('documents', doc(id, { excludedFromAI: true }));
      emitDomainEvent({ type: 'note.excludedFromAI', documentId: id, excluded: true });
    }
    await waitUntil(async () => (await db.get('aiSummaries', H1)) === undefined);

    // Без clearCache() в подписке карта отдаётся из кэша 10 минут — то есть слово
    // скрытой заметки всё ещё уходит в модель после скрытия.
    expect(await hiddenWordInVoice()).toBe(false);
    const map = await AILexiconService.getVoiceMap();
    expect(map?.formattedPromptSnippet ?? '').toContain(WORD_VISIBLE);
  });

  it('(г) сбой снимка видимых заметок — слов не видно, а не «видно всё»', async () => {
    await seed(true);
    const db = await getLocalDb();
    const origGetAll = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation((storeName: string, ...args: unknown[]) => {
      if (storeName === 'documents') return Promise.reject(new Error('IDB documents read error'));
      return origGetAll(storeName as never, ...(args as [never]));
    });

    expect(await AILexiconService.getVoiceMap({ forceRefresh: true })).toBeNull();
  });
});
