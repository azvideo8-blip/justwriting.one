// TR-9: поиск по имени в ходе чата — только по разобранным заметкам. До правки
// блок П-5 намеренно читал до 200 заметок БЕЗ вектора и клал совпавшие в запрос
// целиком, а заметки с вектором искал по сохранённым кускам — разбор не спрашивал.
//
// Как в П-5, фикстура подобрана так, что заметки достаёт только имя: векторы
// ортогональны запросу, слов запроса в текстах нет.
//
// На этом пути три рубежа подряд: отбор кандидатов (векторные куски и скан без
// вектора), загрузка текста кандидата и общий отсев выдачи хода. Мутации
// (прогнаны, см. отчёт): снять любой ОДИН рубеж — тест зелёный, держат остальные;
// снять все три (`analysedIds.has` ×3 и `!analysedNow.has` в excludedSet) —
// красные оба теста про неразобранные.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { useAiLimitStore } from '../../store/useAiLimitStore';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/aiDegradationReporter')>();
  return { ...actual, reportAIDegradation: vi.fn() };
});

const DONE = 'local_tr9n_done';
const RAW_VEC = 'local_tr9n_raw_vec';
const RAW_NOVEC = 'local_tr9n_raw_novec';
const TEXT: Record<string, string> = {
  [DONE]: 'Вечером созвонились с Мариной и всё решили. ЭТО_РАЗОБРАНО',
  [RAW_VEC]: 'Днём виделись с Мариной у вокзала. СТАРЫЙ_ВЕКТОР_БЕЗ_РАЗБОРА',
  [RAW_NOVEC]: 'Утром Мариной занималась вся семья. БЕЗ_ВЕКТОРА_И_РАЗБОРА',
};

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

describe('TR-9: поиск по имени не достаёт неразобранные заметки', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) await db.clear(store);
    for (const id of [DONE, RAW_VEC, RAW_NOVEC]) {
      await db.put('documents', {
        id, guestId: 'u1', title: `Запись ${id}`, currentVersion: 1, totalWords: 9, totalDuration: 0,
        sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
      } as never);
    }
    await db.put('aiSummaries', {
      documentId: DONE, summary: '', tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1,
    } as never);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => TEXT[id] ?? '');
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([DONE, RAW_VEC].map(id => ({
      documentId: id, vectors: [[0, 1, 0]], chunkTexts: [TEXT[id]!], contentHash: id, processedAt: 1, model: 'm', dim: 3,
    })) as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);
    vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'HARNESS_NO_RERANK' } as never);
  });

  it('контроль: разобранная заметка с именем в запросе есть', async () => {
    const ctx = await runTurn();
    expect(ctx.searchContext ?? '').toContain('ЭТО_РАЗОБРАНО');
    expect(ctx.injectedDocumentIds ?? []).toContain(DONE);
  });

  it('неразобранная со старым вектором по имени не находится', async () => {
    const ctx = await runTurn();
    expect(ctx.injectedDocumentIds ?? []).not.toContain(RAW_VEC);
    expect(JSON.stringify(ctx)).not.toContain('СТАРЫЙ_ВЕКТОР_БЕЗ_РАЗБОРА');
  });

  it('неразобранная без вектора по имени не находится', async () => {
    const ctx = await runTurn();
    expect(ctx.injectedDocumentIds ?? []).not.toContain(RAW_NOVEC);
    expect(JSON.stringify(ctx)).not.toContain('БЕЗ_ВЕКТОРА_И_РАЗБОРА');
  });

  it('после разбора обе находятся', async () => {
    const db = await getLocalDb();
    for (const id of [RAW_VEC, RAW_NOVEC]) await db.put('aiSummaries', { documentId: id, summary: '', processedAt: 1 } as never);
    const text = JSON.stringify(await runTurn());
    expect(text).toContain('СТАРЫЙ_ВЕКТОР_БЕЗ_РАЗБОРА');
    expect(text).toContain('БЕЗ_ВЕКТОРА_И_РАЗБОРА');
  });
});
