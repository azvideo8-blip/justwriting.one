// П-5 (замер 08.10.2026): имя в косвенном падеже и заметки без вектора.
//
// Три дыры, которые закрывает этот тест:
//  1) поиск по имени строил регэксп «граница + Имя + граница» и видел только
//     именительный: «что я писал про Марину» не находил запись, где имя стоит в
//     творном («с Мариной»);
//  2) блок поиска по имени читал только chunkTexts, то есть заметки с вектором:
//     без вектора заметка для имени была невидима;
//  3) кусок заметки вырезался по `indexOf(имя)` — запись, найденную по форме,
//     вставляли с начала, и имени в куске не оставалось.
//
// Подобрано так, чтобы ни один канал, кроме имени, эти заметки не достал: вектор
// кандидатов ортогонален вектору запроса (косинус 0 — ниже RESURFACE_FLOOR), а в
// тексте кандидатов нет слов запроса и слов, которые начинались бы с них:
// MiniSearch ищет с `prefix: true`, и одно «проекта» в подкладке открывало доступ
// обычному «про» из запроса (проверено прогоном на базе: тест про заметку с вектором
// был зелёный без правки). «Мариной» от «Марину» дальше одного редактирования,
// поэтому fuzzy 0,2 тоже мимо.
//
// Мутации, проверенные посадкой: вернуть прежний регэксп имени → (1) и (2)
// красные; убрать скан заметок без вектора → (2) красная; вернуть `indexOf` →
// (3) красная. Снять фильтр «не показывать ИИ» внутри нового скана — мутация
// выжила: скрытую заметку не включает уже то, что она отсекается на включении.
// Тест про скрытую остаётся: он страхует от утечки любым путём, а не только этим
// сканом.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/aiDegradationReporter')>();
  return { ...actual, reportAIDegradation: vi.fn() };
});

const WITH_VECTOR = 'local_p5_with_vector';
const NO_VECTOR = 'local_p5_no_vector';
const HIDDEN = 'local_p5_hidden';

const NAME_LINE = 'Вечером созвонились с Мариной и всё решили.';
// Уникальная голова + повтор, длиннее куска (PER_NOTE_CHARS = 2000): по голове
// видно, вырезан ли кусок вокруг имени или взят с начала заметки.
const HEAD_MARK = 'Запись со льдинки';
const FILLER = 'рабочие планы и заметки вокруг огорода; '.repeat(70);
const NO_VECTOR_LINE = 'Утром договаривались созвониться, вечером Мариной занималась вся семья.';
const HIDDEN_MARK = 'ЭТОТ АБЗАЦ НЕЛЬЗЯ ПОКАЗЫВАТЬ ИИ';

async function runTurn() {
  const { result } = renderHook(() => useAIChatContext('coach'));
  return await result.current.buildContext({
    text: 'Что я писал про Марину?',
    attached: null,
    mood: undefined,
    messageHistory: [],
    isFirstTurn: true,
    forcedSearchQuery: 'что я писал про Марину',
  });
}

// Блок результатов поиска по архиву — то, что собирает ветка с именем. Без него
// тест проходил бы на блоке цитат Q-9, где те же id появляются по другой причине.
const searchBlock = (ctx: { searchContext?: string | undefined }) =>
  (ctx.searchContext ?? '').split('Результаты поиска по архиву')[1] ?? '';

describe('П-5: поиск по имени в чате видит падежные формы и заметки без вектора', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) {
      for (const rec of await db.getAll(store)) {
        await db.delete(store, (rec as { id?: string; documentId?: string }).id || (rec as { documentId: string }).documentId);
      }
    }
    for (const [id, excluded] of [[WITH_VECTOR, false], [NO_VECTOR, false], [HIDDEN, true]] as const) {
      await db.put('documents', {
        id, guestId: 'u1', title: `Запись ${id}`, currentVersion: 1, totalWords: 90, totalDuration: 0,
        sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [], excludedFromAI: excluded,
      } as never);
      await markAllAnalysed(db);
    }
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => {
      if (id === HIDDEN) return `Мариной не делюсь. ${HIDDEN_MARK}`;
      if (id === NO_VECTOR) return NO_VECTOR_LINE;
      return `${HEAD_MARK}. ${FILLER}${NAME_LINE}`;
    });
    // Вектор есть только у первой заметки, и он ортогонален вектору запроса.
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
      { documentId: WITH_VECTOR, vectors: [[0, 1, 0]], chunkTexts: [`${HEAD_MARK}. ${FILLER}${NAME_LINE}`], contentHash: 'h1', processedAt: 1, model: 'm', dim: 3 },
    ] as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);
    vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'HARNESS_NO_RERANK' } as never);
  });

  it('заметка с именем в творном попадает в результаты поиска', async () => {
    const block = searchBlock(await runTurn());
    expect(block, 'имя в косвенном падеже не найдено').toContain(`[#${WITH_VECTOR}`);
  });

  it('заметка без вектора находится по имени', async () => {
    const ctx = await runTurn();
    expect(searchBlock(ctx), 'заметка без записи aiEmbeddings не попала в поиск').toContain(`[#${NO_VECTOR}`);
    expect(ctx.searchContext).toContain('Мариной занималась вся семья');
  });

  it('скрытая заметка не попадает в контекст ни одним путём', async () => {
    const ctx = await runTurn();
    expect(ctx.injectedDocumentIds ?? []).not.toContain(HIDDEN);
    expect(ctx.searchContext ?? '').not.toContain(HIDDEN_MARK);
    expect(ctx.searchContext ?? '').not.toContain('Мариной не делюсь');
  });

  it('кусок заметки вырезается вокруг формы имени, а не с её начала', async () => {
    const block = searchBlock(await runTurn());
    const noteBlock = block.split(`[#${WITH_VECTOR}`)[1]?.split('[#')[0] ?? '';
    expect(noteBlock, 'в контексте нет куска этой заметки').toContain(NAME_LINE);
    expect(noteBlock.includes(HEAD_MARK), 'в куске снова только начало заметки').toBe(false);
  });
});
