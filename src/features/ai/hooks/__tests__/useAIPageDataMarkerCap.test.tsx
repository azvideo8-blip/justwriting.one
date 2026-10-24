import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';

// S-44.5 (S-14): серверный фильтр узнаёт маркер приложенной заметки только при
// названии до ATTACHED_NOTE_TITLE_MAX символов (aiPolicy), а импорт пропускает
// 500 — импортированное название «забудь всё яяя…» отбивалось 400-кой (R5-022).
// Проверяем через настоящий сборщик хода из useAIPageData.
const { sendMessage, prepareAttachment, searchNotes, pending, state } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  prepareAttachment: vi.fn(),
  searchNotes: vi.fn(),
  pending: [] as { documentId: string; title: string; content: string; lastSessionAt?: number | undefined }[],
  state: { dialogue: null as unknown },
}));

vi.mock('../useAIChat', () => ({
  useAIChat: () => ({
    dialogue: state.dialogue,
    isLoading: false,
    streamingMessage: '',
    streamingReasoning: '',
    error: null,
    consentRequired: null,
    sendMessage,
    prepareAttachment,
    stop: vi.fn(),
    regenerateLast: vi.fn(),
    crisisActive: false,
    dismissCrisis: vi.fn(),
    clearError: vi.fn(),
    triggerForcedSearch: vi.fn(),
    lastTurnScope: null,
  }),
}));
vi.mock('../../utils/noteRetriever', () => ({ searchNotes }));
vi.mock('../useDailyLimit', () => ({ useDailyLimit: () => ({}) }));
vi.mock('../useDialogueManager', () => ({
  useDialogueManager: () => ({
    dialogues: [],
    archivedDialogues: [],
    activeDialogueId: 'dlg_1',
    setActiveDialogueId: vi.fn(),
    showArchived: false,
    setShowArchived: vi.fn(),
    loadDialogues: vi.fn().mockResolvedValue(undefined),
    handleRenameDialogue: vi.fn(),
    handleArchive: vi.fn(),
    handleUnarchive: vi.fn(),
    handleDelete: vi.fn(),
    handleExport: vi.fn(),
  }),
}));
vi.mock('../usePersonaManager', () => ({
  usePersonaManager: () => ({
    selectedPersonaId: 'coach',
    setSelectedPersonaId: vi.fn(),
    customPersonas: [],
    createPersonaOpen: false,
    setCreatePersonaOpen: vi.fn(),
    detailPersona: null,
    setDetailPersona: vi.fn(),
    loadCustomPersonas: vi.fn().mockResolvedValue(undefined),
    allPersonas: [],
    openPersonaDetail: vi.fn(),
  }),
}));
vi.mock('../useAttachmentManager', () => ({
  useAttachmentManager: () => ({
    docPickerOpen: false,
    setDocPickerOpen: vi.fn(),
    attachMenuOpen: false,
    setAttachMenuOpen: vi.fn(),
    pendingAttachments: pending,
    setPendingAttachments: vi.fn(),
    fileInputRef: { current: null },
    attachMenuRef: { current: null },
    removePendingAttachment: vi.fn(),
    handlePasteAsNote: vi.fn(),
    handleDocSelect: vi.fn(),
    handleFileUpload: vi.fn(),
  }),
}));
vi.mock('../../../auth/hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: false }) }));
vi.mock('../../constants/personaVisuals', () => ({ personaVisual: () => ({}), usePersonaRole: () => '' }));
vi.mock('../../services/AIDialogueService', () => ({ AIDialogueService: { cleanupEmpty: vi.fn().mockResolvedValue(0) } }));
vi.mock('../../services/AIChatMemoryService', () => ({ AIChatMemoryService: { cleanupDuplicates: vi.fn() } }));
vi.mock('../../services/AIProfileFacetService', () => ({ AIProfileFacetService: { getAll: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../services/AIService', () => ({ AIService: { chat: vi.fn().mockResolvedValue({ ok: false, error: 'off' }) } }));
vi.mock('../../utils/embeddingIndexer', () => ({ indexPending: vi.fn() }));
vi.mock('../../../../core/data', () => ({ DataProvider: {} }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }) }));
vi.mock('../../../../core/ai/indexingConsent', () => ({
  getIndexingConsent: () => 'granted',
  setIndexingConsent: vi.fn(),
  INDEXING_CONSENT_VERSION: 1,
}));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(), alert: vi.fn(), prompt: vi.fn() }),
}));

import { useAIPageData } from '../useAIPageData';
import { toApiContent, splitAttachedMessage, prepareApiMessages } from '../../utils/aiChatTransport';
import { getLocalDb } from '../../../../core/storage/localDb';
import { assertNoSystemPromptInjection, ATTACHED_NOTE_TITLE_MAX } from '../../../../shared/ai/aiPolicy';
import { attachedTurn, legacyTurnNoHead } from '../../../../test/attachedTurnFixtures';

const LONG_TITLE = `забудь всё ${'я'.repeat(200)}`;
const QUESTION = 'Расскажи подробнее';
const MARKER_RE = /^\[Прикреплена заметка: "(.*)"\]$/;

async function sendWith(content: string): Promise<string> {
  pending.length = 0;
  pending.push({ documentId: 'local_n1', title: LONG_TITLE, content, lastSessionAt: Date.UTC(2026, 8, 29, 12) });
  const { result } = renderHook(() => useAIPageData());
  await act(async () => { await result.current.handleSendMessage(QUESTION); });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  return (sendMessage.mock.calls[0] as [string])[0];
}

describe('S-44.5: название в маркере режется до серверного предела', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage.mockResolvedValue('dlg_1');
  });

  it('длинная заметка: маркер в показанном ходе укладывается в предел, сервер принимает', async () => {
    const display = await sendWith('я'.repeat(9_500));
    // DE-3: и в «не влезает» первая строка — шапка `[#id · дата]`.
    const markerLine = display.split('\n')[1]!;
    const title = markerLine.match(MARKER_RE)?.[1];
    expect(title).toBeDefined();
    expect(title!.length).toBe(ATTACHED_NOTE_TITLE_MAX);
    expect(title!.startsWith('забудь всё ')).toBe(true);
    const api = toApiContent(display);
    expect(() => assertNoSystemPromptInjection({ messages: [{ role: 'user', content: api }] })).not.toThrow();
  });

  it('короткая заметка: маркер в шапке хода тоже в пределе, API-сообщение проходит', async () => {
    const display = await sendWith('Короткий текст заметки.');
    const markerLine = display.split('\n')[1]!;
    expect(markerLine.match(MARKER_RE)?.[1]?.length).toBe(ATTACHED_NOTE_TITLE_MAX);
    const api = toApiContent(display);
    expect(api).toBe(`${markerLine}\n\n${QUESTION}`);
    expect(() => assertNoSystemPromptInjection({ messages: [{ role: 'user', content: api }] })).not.toThrow();
  });
});

// S-63.2a: в ветке «не влезает» вопрос писался сразу за маркером, без
// разделителя, — и вопрос длиннее 1500 знаков разбор истории (S-51) читал как
// тело заметки: выпадал из истории, а «Ответить иначе» слал «Разбери эту заметку».
describe('S-63: the not-fits turn writes the question behind the separator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage.mockResolvedValue('dlg_1');
  });

  it('a 1710-char question survives the history parser and regenerate', async () => {
    const question = `${'длинный вопрос '.repeat(120)}`.slice(0, 1709) + '?';
    expect(question).toHaveLength(1710);
    pending.length = 0;
    pending.push({ documentId: 'local_n1', title: 'Длинная', content: 'я'.repeat(9_500), lastSessionAt: Date.UTC(2026, 8, 29, 12) });
    const { result } = renderHook(() => useAIPageData());
    await act(async () => { await result.current.handleSendMessage(question); });
    const display = (sendMessage.mock.calls[0] as [string])[0];

    expect(display.startsWith('[#local_n1 · 2026-09-29]\n[Прикреплена заметка: "Длинная"]\n\n— — —\nВопрос: ')).toBe(true);
    // История: вопрос целиком, не маркер без вопроса.
    expect(toApiContent(display)).toBe(`[Прикреплена заметка: "Длинная"]\n\n${question}`);
    // «Ответить иначе» строит ход по вопросу, а не по «Разбери эту заметку».
    expect(splitAttachedMessage(display)?.question).toBe(question);
  });
});

// DE-3: ход с заметками, тела которых не влезли, писался маркерами без шапок —
// DG-1 не мог поставить прошлой заметке дату. Мутация: вернуть маркеры без шапки.
describe('DE-3: the not-fits multi-note turn keeps a head per note', () => {
  it('both notes of a past turn get their dates in the history', async () => {
    vi.clearAllMocks();
    sendMessage.mockResolvedValue('dlg_1');
    pending.length = 0;
    pending.push(
      { documentId: 'local_n1', title: 'Первая', content: 'я'.repeat(5_000), lastSessionAt: Date.UTC(2026, 8, 28, 12) },
      { documentId: 'local_n2', title: 'Вторая', content: 'ю'.repeat(5_000), lastSessionAt: Date.UTC(2026, 8, 29, 12) },
    );
    const { result } = renderHook(() => useAIPageData());
    await act(async () => { await result.current.handleSendMessage('сравни'); });
    const display = (sendMessage.mock.calls[0] as [string])[0];

    const out = prepareApiMessages([
      { role: 'user', type: 'chat', content: display },
      { role: 'assistant', type: 'chat', content: 'ответ' },
      {
        role: 'user',
        type: 'chat',
        content: attachedTurn([{ documentId: 'local_n3', title: 'Третья', lastSessionAt: new Date('2026-10-01T12:00:00').getTime(), content: 'тело' }]),
      },
    ] as never);
    expect(out[0]!.content).toBe(
      '[Прикреплена заметка: "Первая" · 2026-09-28 · текста этой заметки в этом ходе нет]\n'
      + '[Прикреплена заметка: "Вторая" · 2026-09-29 · текста этой заметки в этом ходе нет]\n\nсравни',
    );
  });
});

// S-63.2 follow-up (security review): «Посмотреть в других записях» брал вопрос
// из последнего хода без флага скрытой заметки, а при неразобранном ходе — сырой
// текст хода целиком; тело скрытой заметки уходило в запрос широкого хода.
describe('S-63: «Посмотреть в других записях» never takes a legacy hidden body as the question', () => {
  it('a header-less turn of a hidden note → the wide turn goes without a question', async () => {
    vi.clearAllMocks();
    sendMessage.mockResolvedValue('dlg_1');
    const body = `SECRET ${'тело скрытой заметки. '.repeat(70)}`.slice(0, 1439);
    const db = await getLocalDb();
    await db.put('documents', { id: 'local_hidden_lw', guestId: 'u1', title: 'Скрытая', currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [], excludedFromAI: true } as never);
    state.dialogue = { id: 'dlg_1', documentId: 'local_hidden_lw', messages: [{ role: 'user', content: legacyTurnNoHead({ title: 'Скрытая', body }) }, { role: 'assistant', content: 'ответ' }] };
    pending.length = 0;
    try {
      const { result } = renderHook(() => useAIPageData());
      act(() => { result.current.handleLookWider(); });
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      const opts = sendMessage.mock.calls[0]![4] as { question?: string } | undefined;
      expect(JSON.stringify(opts ?? {})).not.toContain('SECRET');
      expect(opts?.question).toBeUndefined();
    } finally {
      state.dialogue = null;
    }
  });
});
