import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../../services/aiChatContext';
import { useAIChat } from '../useAIChat';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIProfileService } from '../../services/AIProfileService';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { useActivityLogStore } from '../../../../shared/activity/useActivityLogStore';
import { resetAIDegradationSession } from '../../utils/aiDegradationReporter';
import { LanguageProvider } from '../../../../shared/i18n';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

vi.mock('../../utils/aiChatTransport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/aiChatTransport')>();
  return {
    ...actual,
    streamChat: vi.fn().mockImplementation(async (params: { onChunk: (chunk: string, reasoning: string | null) => void }) => {
      params.onChunk('Ответ без поиска по заметкам.', null);
      return 'Ответ без поиска по заметкам.';
    }),
  };
});

describe('useAIChat degradation reporting (AI-3)', () => {
  const NOTE_ID = 'local_test_doc';

  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetAIDegradationSession();
    useActivityLogStore.getState().clearLog();
    setIndexingConsent('guest', 'granted');
    vi.spyOn(AIProfileService, 'getPortrait').mockResolvedValue(null);

    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('aiDialogues');
    await db.clear('aiSummaries');
    await db.clear('aiEmbeddings');

    await db.put('documents', {
      id: NOTE_ID,
      title: 'Заметка про проект',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      excludedFromAI: false,
    } as never);

    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
      { documentId: NOTE_ID, vectors: [[0.5, 0.5, 0.5]], contentHash: 'h1', processedAt: 1, model: 'm', dim: 3 },
    ] as never);
  });

  it('buildContext returns degradedReason: daily_limit and logs exactly once when embed hits daily limit', async () => {
    vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: false,
      error: 'DAILY_LIMIT',
    });

    const { result } = renderHook(() => useAIChatContext('coach'));

    const ctx = await result.current.buildContext({
      text: 'Что я писал про проект в заметках?',
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      forcedSearchQuery: 'проект',
    });

    expect(ctx.degradedReason).toBe('daily_limit');

    const entries = useActivityLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toContain('Дневной лимит ИИ исчерпан');
    expect(entries[0]?.level).toBe('error');
  });

  it('stores degradedReason: daily_limit in message record in DB without localized text in degradedReason', async () => {
    // Note search embed fails with daily limit
    vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: false,
      error: 'DAILY_LIMIT',
    });

    // Auto-name also fails with daily limit
    vi.spyOn(AIService, 'chat').mockResolvedValue({
      ok: false,
      error: 'DAILY_LIMIT',
    });

    const { result } = renderHook(() => useAIChat(null, 'coach'), { wrapper: LanguageProvider });

    let dialogueId: string | null = null;
    await act(async () => {
      dialogueId = await result.current.sendMessage('Найди мои заметки про планы');
    });

    expect(dialogueId).toBeTruthy();

    const db = await getLocalDb();
    const savedDialogue = await db.get('aiDialogues', dialogueId!);
    expect(savedDialogue).toBeDefined();
    expect(savedDialogue!.messages).toHaveLength(2);

    const assistantMsg = savedDialogue!.messages[1];
    expect(assistantMsg?.role).toBe('assistant');
    expect(assistantMsg?.degradedReason).toBe('daily_limit');
    // Stored reason is only the code 'daily_limit', not a localized string
    expect(typeof assistantMsg?.degradedReason).toBe('string');
    expect(assistantMsg?.degradedReason).not.toContain('исчерпан');
    expect(assistantMsg?.degradedReason).not.toContain('Daily limit');

    // Activity log deduplicated
    let entries = useActivityLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toContain('Дневной лимит ИИ исчерпан');
    const initialCount = entries[0]!.count;

    // Second message in the same session with daily limit
    localStorage.removeItem('jw_ai_cooldown_until');
    await act(async () => {
      await result.current.sendMessage('Ещё один вопрос про планы');
    });

    entries = useActivityLogStore.getState().entries;
    expect(entries).toHaveLength(1); // Still exactly 1 entry
    expect(entries[0]!.count).toBeGreaterThan(initialCount); // Count incremented
  });
});
