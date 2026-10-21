import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, type AIChatMemory, type LocalDocument } from '../../../../core/storage/localDb';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';
import { AIConsolidationService, type AIBelief } from '../AIConsolidationService';
import { AIMemoryAssembler } from '../AIMemoryAssembler';
import { AIService } from '../AIService';
import { NoteAnalysisService } from '../NoteAnalysisService';
import { MemoryFlagsService } from '../memoryFlags';

const hidden = 'ap2-hidden';
const visible = 'ap2-visible';
const legacyMarker = 'AP2_LEGACY_PRIVATE';
const hiddenMarker = 'AP2_HIDDEN_PRIVATE';
const visibleMarker = 'AP2_VISIBLE_PUBLIC';
const now = Date.now();
const document = (id: string, extra: Partial<LocalDocument> = {}): LocalDocument => ({
  id, uuid: `uuid-${id}`, guestId: 'guest-ap2', title: id, currentVersion: 1,
  totalWords: 20, totalDuration: 100, sessionsCount: 1, firstSessionAt: now,
  lastSessionAt: now, tags: [], ...extra,
});
const memory = (id: string, text: string, sources?: string[]): AIChatMemory => ({
  id, kind: 'fact', text: `синтетическая мысль про прогулку каждый день ${text}`,
  sourceDialogueId: 'ap2-dialogue', createdAt: now, updatedAt: now,
  ...(sources === undefined ? {} : { sourceDocumentIds: sources }),
});
const belief = (id: string, text: string, ids: string[]): AIBelief => ({
  id, belief: text, evidence: ids.map(source => ({ id: source, date: '2026-10-21', snippet: text })),
  unitIds: ids, firstSeenAt: '2026-10-21', clusterSize: ids.length,
  createdAt: now, updatedAt: now, judgeVerdict: 'PASSED',
});

beforeEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  MemoryFlagsService.resetFlags();
  const db = await getLocalDb();
  for (const store of ['documents', 'aiChatMemory', 'aiSummaries', 'aiTimeline', 'aiEmbeddings',
    'aiBeliefs', 'aiBeliefRejections', 'aiThemeLedger', 'aiCommitments', 'lifeStory',
    'aiProfileFacets', 'aiPortrait', 'aiMonthlyDigest'] as const) await db.clear(store);
  await db.put('documents', document(hidden, { excludedFromAI: true }));
  await db.put('documents', document(visible));
  await db.put('aiChatMemory', memory('mem-hidden', hiddenMarker, [`uuid-${hidden}`]));
  await db.put('aiChatMemory', memory('mem-legacy', legacyMarker));
  await db.put('aiChatMemory', memory('mem-visible', visibleMarker, [visible]));
});

afterEach(() => MemoryFlagsService.resetFlags());

describe('AP2-1: реальные пути консолидации, очистки и контекста', () => {
  it('передаёт модели только видимые сводки, факты и просмотренную память', async () => {
    const db = await getLocalDb();
    for (const [id, marker] of [[hidden, hiddenMarker], [visible, visibleMarker], ['missing-ap2', hiddenMarker]] as const) {
      await db.put('aiSummaries', { documentId: id, summary: `синтетическая мысль про прогулку каждый день ${marker}`, tone: 'neutral', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: now, contentHash: 'synthetic' });
      await db.put('aiTimeline', { documentId: id, date: '2026-10-21', month: '2026-10', facts: [`синтетическая мысль про прогулку каждый день ${marker}`], themes: [], tone: 'neutral' });
    }
    const summarize = vi.spyOn(AIService, 'summarizeBeliefCluster').mockResolvedValue({ ok: true, belief: visibleMarker });
    const judge = vi.spyOn(AIService, 'judgeBeliefCandidate').mockResolvedValue({ ok: true, passed: true, reason: 'synthetic' });
    const result = await AIConsolidationService.processConsolidationPass();
    expect(result.publishedBeliefs).toBe(1);
    expect(summarize).toHaveBeenCalledOnce();
    expect(judge).toHaveBeenCalledOnce();
    const sent = JSON.stringify([summarize.mock.calls, judge.mock.calls]);
    expect(sent).toContain(visibleMarker);
    expect(sent).not.toContain(hiddenMarker);
    expect(sent).not.toContain(legacyMarker);
    expect((await db.getAll('aiChatMemory')).map(m => m.id)).toContain('mem-legacy');
  });

  it('clear убирает убеждение, пересказывающее память скрытой заметки, и ставит удаление в синк', async () => {
    const db = await getLocalDb();
    await db.put('aiBeliefs', belief('belief-hidden', hiddenMarker, ['mem-hidden']) as unknown as Record<string, unknown>);
    await db.put('aiBeliefs', belief('belief-mixed', hiddenMarker, ['mem-hidden', `summary-${visible}`]) as unknown as Record<string, unknown>);
    await db.put('aiBeliefs', belief('belief-visible', visibleMarker, ['mem-visible']) as unknown as Record<string, unknown>);
    const deletes = vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete');
    await NoteAnalysisService.clear(hidden);
    const stored = await db.getAll('aiBeliefs');
    expect(JSON.stringify(stored)).not.toContain(hiddenMarker);
    expect(stored.map(b => b.id)).toContain('belief-visible');
    expect(deletes).toHaveBeenCalledWith('aiBeliefs', 'belief-hidden');
    expect(deletes).toHaveBeenCalledWith('aiBeliefs', 'belief-mixed');
    expect(await db.get('aiChatMemory', 'mem-legacy')).toBeDefined();
  });

  it.each(['mem-hidden', 'mem-legacy', 'missing-memory', `summary-${hidden}`, 'timeline-missing-ap2-0'])('контекст не берёт убеждение с невидимой уликой %s', async source => {
    const db = await getLocalDb();
    await db.put('aiBeliefs', belief('belief-unsafe', hiddenMarker, [source, `summary-${visible}`]) as unknown as Record<string, unknown>);
    await db.put('aiBeliefs', belief('belief-safe', visibleMarker, ['mem-visible', `summary-uuid-${visible}`]) as unknown as Record<string, unknown>);
    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    MemoryFlagsService.setFlag('ff_memory_assembler_beliefs', true);
    const context = await AIMemoryAssembler.assembleMemoryContext();
    expect(context).toContain(visibleMarker);
    expect(context).not.toContain(hiddenMarker);
  });
});
