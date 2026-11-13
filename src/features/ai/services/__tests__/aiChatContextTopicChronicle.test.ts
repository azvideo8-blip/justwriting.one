// Хроника по вопросу в ходе чата (стенд ai-memory-base-fable-2026-11): проверяется
// сам вход прода — useAIChatContext.buildContext, а не только сборщик блока.
//
// Мутации, на которых тест краснеет:
//  - убрать вызов buildTopicChronicleBlock в aiChatContext.ts → нет «[Хроника по вопросу»;
//  - убрать `...chronicleDatesOut` из allowedFirstSeenDates → страж дат вырежет
//    верную дату ответа на «когда впервые» (allowedFirstSeenDates пуст);
//  - убрать `!chronicleBuilt` у лёгкого поиска → блок «Возможно релевантные заметки» дважды;
//  - вернуть `QUESTION_RE.test(text) ? 'fact' : null` в chronicleModeOf → совет
//    «что мне делать с этой тревогой?» получает хронику вместо лёгкого поиска.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { sanitizeFirstSeenDates } from '../../utils/dateGuard';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const vec = (c: number): number[] => [c, Math.sqrt(Math.max(0, 1 - c * c)), 0];

describe('ход чата: хроника по вопросу', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    setIndexingConsent(undefined, 'granted');
    const db = await getLocalDb();
    for (const s of ['documents', 'aiEmbeddings'] as const) await db.clear(s);
    const rows = [
      // далёкая по смыслу и самая ранняя: в ленту не входит, но задаёт начало архива в шапке блока —
      // иначе дата ранней записи попала бы стражу из шапки, а не из ленты
      { id: 'local_far', iso: '2025-01-05', cos: 0.1, text: 'Про погоду.' },
      { id: 'local_early', iso: '2025-07-03', cos: 0.55, text: 'Сегодня подумала, что могла бы сменить работу.' },
      // Близость между порогами хроники (0.4) и лёгкого поиска (0.5): лёгкий поиск
      // её не берёт, хроника в режиме fact взяла бы. Маркер того, каким путём шёл ход.
      { id: 'local_mid', iso: '2026-01-01', cos: 0.45, text: 'Нейтральная запись про середину.' },
      { id: 'local_late', iso: '2026-09-01', cos: 0.8, text: 'Опять думаю про смену работы, уже всерьёз.' },
    ];
    for (const r of rows) {
      await db.put('documents', { id: r.id, guestId: 'guest', title: `Заметка ${r.id}`, currentVersion: 1, totalWords: 9, totalDuration: 0, sessionsCount: 1, firstSessionAt: day(r.iso), lastSessionAt: day(r.iso), tags: [] } as never);
      await markAllAnalysed(db);
    }
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(rows.map(r => ({ documentId: r.id, vectors: [vec(r.cos)], chunkTexts: [r.text], contentHash: r.id, processedAt: 1, model: 'm', dim: 3 })) as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]], chunks: ['q'], model: 'm', dim: 3 } as never);
  });

  it('«когда впервые…» получает ленту по датам, а дата ранней записи разрешена стражу дат', async () => {
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'когда я впервые начала думать о смене работы?',
      attached: null,
      mood: undefined,
      messageHistory: [
        { role: 'user', content: 'помоги составить план на неделю' },
        { role: 'assistant', content: 'Давай.' },
        { role: 'user', content: 'когда я впервые начала думать о смене работы?' },
      ] as never,
      isFirstTurn: false,
    });
    const sc = ctx.searchContext ?? '';
    const timeline = sc.slice(sc.indexOf('[Хроника по вопросу'));
    expect(sc).toContain('[Хроника по вопросу');
    expect(timeline.indexOf('#local_early')).toBeGreaterThan(-1);
    expect(timeline.indexOf('#local_early')).toBeLessThan(timeline.indexOf('#local_late'));
    expect(sc.split('[Возможно релевантные заметки]').length - 1).toBe(1);
    expect(ctx.injectedDocumentIds).toEqual(expect.arrayContaining(['local_early', 'local_late']));
    // Верный ответ модели переживает стража дат «впервые».
    const answer = 'Впервые ты написала об этом 3 июля 2025 года [#local_early].';
    expect(sanitizeFirstSeenDates(answer, ctx.allowedFirstSeenDates ?? [])).toBe(answer);
  });

  it('совет «что мне делать с этой тревогой?» идёт как в 0.11.8: лёгкий поиск, без хроники', async () => {
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'что мне делать с этой тревогой?',
      attached: null,
      mood: undefined,
      messageHistory: [
        { role: 'user', content: 'помоги составить план на неделю' },
        { role: 'assistant', content: 'Давай.' },
        { role: 'user', content: 'что мне делать с этой тревогой?' },
      ] as never,
      isFirstTurn: false,
    });
    const sc = ctx.searchContext ?? '';
    expect(sc).not.toContain('[Хроника по вопросу');
    expect(sc.split('[Возможно релевантные заметки]').length - 1).toBe(1);
    // Лёгкий поиск (порог 0.5) не берёт запись с близостью 0.45; хроника в режиме
    // fact (порог 0.4) взяла бы. Её отсутствие = ход шёл лёгким поиском, как в 0.11.8.
    expect(sc).not.toContain('#local_mid');
  });
});
