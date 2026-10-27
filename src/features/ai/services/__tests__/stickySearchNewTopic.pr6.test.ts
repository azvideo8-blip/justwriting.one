// PR-6 (17.5): липкий поиск склеивал прошлый широкий запрос с новой репликой:
// «главное за октябрь» + «линия сопротивления» искало смесь, и старая тема
// размывала новую. Склейка — только для коротких продолжений; реплика со своей
// темой ищется по себе и становится новой темой липкого поиска.
//
// Мутация: всегда склеивать lastSearchQueryRef с text → (1) красный; не
// обновлять lastSearchQueryRef новой темой → (2) красный.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import * as noteRetriever from '../../utils/noteRetriever';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const searchCalls: string[] = [];

async function ask(
  build: (params: Record<string, unknown>) => Promise<{ searchContext: string }>,
  text: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<void> {
  await build({
    text,
    attached: undefined,
    mood: undefined,
    messageHistory: history,
    isFirstTurn: false,
    scope: 'wide',
  });
}

describe('PR-6: продолжение ищет по новой теме', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchCalls.length = 0;
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
    vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
    vi.spyOn(noteRetriever, 'searchNotesMulti').mockImplementation(async (queries: string[]) => {
      searchCalls.push(queries.join(' | '));
      return { notes: [], failed: false, degraded: false } as never;
    });
  });

  it('новая тема ищется без слов старого запроса; короткое продолжение — с новой темой', async () => {
    const { result } = renderHook(() => useAIChatContext('coach'));
    const build = result.current.buildContext as never;

    const wide = 'поищи в заметках главное за октябрь';
    const h1 = [{ role: 'user' as const, content: wide }];
    await ask(build, wide, h1);
    expect(searchCalls.at(-1)).toContain('главное за октябрь');

    const topic = 'расскажи про линию сопротивления';
    searchCalls.length = 0;
    await ask(build, topic, [...h1, { role: 'assistant', content: 'Октябрь был про подмены.' }, { role: 'user', content: topic }]);
    const topicQuery = searchCalls.at(-1) ?? '';
    expect(topicQuery, `новая тема размыта старым запросом: ${topicQuery}`).not.toContain('главное за октябрь');
    expect(topicQuery).toContain('линию сопротивления');

    searchCalls.length = 0;
    const more = 'подробнее';
    await ask(build, more, [
      ...h1,
      { role: 'assistant', content: 'Октябрь был про подмены.' },
      { role: 'user', content: topic },
      { role: 'assistant', content: 'Линия сопротивления — про отказ.' },
      { role: 'user', content: more },
    ]);
    const moreQuery = searchCalls.at(-1) ?? '';
    expect(moreQuery, `продолжение вернулось к старой теме: ${moreQuery}`).toContain('линию сопротивления');
    expect(moreQuery).not.toContain('главное за октябрь');
  });
});
