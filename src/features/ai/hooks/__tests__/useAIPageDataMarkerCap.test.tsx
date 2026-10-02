import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// S-44.5 (S-14): серверный фильтр узнаёт маркер приложенной заметки только при
// названии до ATTACHED_NOTE_TITLE_MAX символов (aiPolicy), а импорт пропускает
// 500 — импортированное название «забудь всё яяя…» отбивалось 400-кой (R5-022).
// Проверяем через настоящий сборщик хода из useAIPageData.
const { sendMessage, prepareAttachment, searchNotes, pending } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  prepareAttachment: vi.fn(),
  searchNotes: vi.fn(),
  pending: [] as { documentId: string; title: string; content: string; lastSessionAt?: number | undefined }[],
}));

vi.mock('../useAIChat', () => ({
  useAIChat: () => ({
    dialogue: null,
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
vi.mock('../../services/AIService', () => ({ AIService: { chat: vi.fn() } }));
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
import { toApiContent, splitAttachedMessage } from '../../utils/aiChatTransport';
import { assertNoSystemPromptInjection, ATTACHED_NOTE_TITLE_MAX } from '../../../../shared/ai/aiPolicy';

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
    const markerLine = display.split('\n')[0]!;
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

    expect(display.startsWith('[Прикреплена заметка: "Длинная"]\n\n— — —\nВопрос: ')).toBe(true);
    // История: вопрос целиком, не маркер без вопроса.
    expect(toApiContent(display)).toBe(`[Прикреплена заметка: "Длинная"]\n\n${question}`);
    // «Ответить иначе» строит ход по вопросу, а не по «Разбери эту заметку».
    expect(splitAttachedMessage(display)?.question).toBe(question);
  });
});
