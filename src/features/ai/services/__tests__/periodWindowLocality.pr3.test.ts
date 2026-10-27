// PA-3 (тикет 26.10): где живёт запомненное окно перечня.
// `lastPeriodWindowRef` — ref внутри хука `useAIChatContext`, который
// `useAIChat` держит на экран разговора (`useAIChat.ts:266`), и `useEffect` по
// `dialogueId` зовёт `resetSession` (`useAIChat.ts:278-295`). Значит окно не
// уезжает в другой диалог, к другой персоне и другому человеку: каждое — новый
// экземпляр хука (смена учётки — перезагрузка страницы, `accountReload.ts:73`).
// Третье отделение: окно берётся из разбора прошлой реплики, а не из ответа
// модели — ответ с другим периодом не должен переключать перечень.
//
// Мутации: вынести ref на уровень модуля → (2) красный; не чистить его в
// resetSession → (1) красный; читать окно из последней реплики ассистента →
// (3) красный.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const DAY = 86_400_000;
const OCT_1 = Date.UTC(2026, 9, 1);
const MAR_1 = Date.UTC(2026, 2, 1);
const CARRIED = '[Записи периода, о котором шла речь]';

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  const notes = [
    { id: 'local_pr3l_oct_a', at: OCT_1 + 2 * DAY, mark: 'ОКТЯБРЬ_А' },
    { id: 'local_pr3l_oct_b', at: OCT_1 + 11 * DAY, mark: 'ОКТЯБРЬ_Б' },
    { id: 'local_pr3l_mar_a', at: MAR_1 + 4 * DAY, mark: 'МАРТ_А' },
  ];
  for (const n of notes) {
    await db.put('documents', {
      id: n.id, guestId: 'u1', title: `Запись ${n.mark}`, currentVersion: 1,
      totalWords: 30, totalDuration: 60, sessionsCount: 1,
      firstSessionAt: n.at, lastSessionAt: n.at, tags: [],
    } as never);
    await db.put('aiSummaries', {
      documentId: n.id, processedAt: n.at, summary: `СУТЬ_${n.mark}`, themes: [],
      insights: [`ОЗАРЕНИЕ_${n.mark}`], extractedFacts: [`ФАКТ_${n.mark}`],
    } as never);
  }
  vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('Тело записи');
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
}

type History = { role: 'user' | 'assistant'; content: string }[];

const FIRST = 'перечисли все мои осознания за октябрь 2026';
const CONT = 'перечитай по одной';

async function ask(build: (p: Record<string, unknown>) => Promise<{ searchContext: string }>, text: string, history: History): Promise<string> {
  const ctx = await build({
    text, attached: undefined, mood: undefined, messageHistory: history, isFirstTurn: false, scope: 'wide',
  });
  return ctx.searchContext ?? '';
}

function fresh(personaId = 'coach') {
  const { result } = renderHook(() => useAIChatContext(personaId));
  return result.current;
}

describe('PA-3: запомненное окно живёт в этом разговоре', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('после resetSession продолжение окно не тянет', async () => {
    await seed();
    const ctx = fresh();
    const build = ctx.buildContext as never;
    const h1: History = [{ role: 'user', content: FIRST }];
    await ask(build, FIRST, h1);
    expect(await ask(build, CONT, [...h1, { role: 'assistant', content: 'Вот записи октября.' }, { role: 'user', content: CONT }])).toContain(CARRIED);

    ctx.resetSession();
    const text = await ask(build, CONT, [...h1, { role: 'assistant', content: 'Вот записи октября.' }, { role: 'user', content: CONT }]);
    expect(text, 'окно пережило resetSession').not.toContain(CARRIED);
  });

  it('другой экземпляр хука (другой диалог, персона, человек) окна не видит', async () => {
    await seed();
    const build1 = fresh('coach').buildContext as never;
    const h1: History = [{ role: 'user', content: FIRST }];
    await ask(build1, FIRST, h1);

    for (const persona of ['coach', 'editor', 'cbt']) {
      const build2 = fresh(persona).buildContext as never;
      const text = await ask(build2, CONT, [...h1, { role: 'assistant', content: 'Вот записи октября.' }, { role: 'user', content: CONT }]);
      expect(text, `окно приехало в экземпляр персоны ${persona}`).not.toContain(CARRIED);
      expect(text).not.toContain('ОЗАРЕНИЕ_ОКТЯБРЬ_А');
    }
  });

  it('окно берётся из разбора прошлой реплики, а не из ответа модели', async () => {
    await seed();
    const build = fresh().buildContext as never;
    const h1: History = [{ role: 'user', content: FIRST }];
    await ask(build, FIRST, h1);

    // Ответ врет о периоде: перечень октябрьского окна не должен переехать на март.
    const lying = 'я перечислил записи за март 2026';
    const text = await ask(build, CONT, [...h1, { role: 'assistant', content: lying }, { role: 'user', content: CONT }]);
    expect(text).toContain(CARRIED);
    expect(text).toContain('ОЗАРЕНИЕ_ОКТЯБРЬ_А');
    expect(text).toContain('ОЗАРЕНИЕ_ОКТЯБРЬ_Б');
    expect(text, 'окно переехало на период из ответа модели').not.toContain('МАРТ_А');
  });

  it('контроль: мартовская реплика переводит перечень на март (метрика двигается)', async () => {
    await seed();
    const build = fresh().buildContext as never;
    const firstMarch = 'перечисли все мои осознания за март 2026';
    const h1: History = [{ role: 'user', content: firstMarch }];
    await ask(build, firstMarch, h1);
    const text = await ask(build, CONT, [...h1, { role: 'assistant', content: 'Вот записи марта.' }, { role: 'user', content: CONT }]);
    expect(text).toContain(CARRIED);
    expect(text).toContain('МАРТ_А');
    expect(text).not.toContain('ОКТЯБРЬ_А');
  });
});
