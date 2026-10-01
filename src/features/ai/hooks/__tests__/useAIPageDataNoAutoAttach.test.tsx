import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Регрессия 0.9.25: кнопка «Посмотри в других моих записях» (и любой текст с
// «посмотр/разбер…» + «запис/заметк…») сама искала по корню «запис» и цепляла
// случайную заметку. Прикрепляет заметку только человек.

const { sendMessage, prepareAttachment, searchNotes } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  prepareAttachment: vi.fn(),
  searchNotes: vi.fn(),
}));

vi.mock('../useAIChat', () => ({
  useAIChat: () => ({
    dialogue: null,
    isLoading: false,
    streamingMessage: '',
    streamingReasoning: '',
    error: null,
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
    pendingAttachments: [],
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

describe('useAIPageData: no note auto-attach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage.mockResolvedValue('dlg_1');
    searchNotes.mockResolvedValue([{ documentId: 'doc_test', score: 1 }]);
    prepareAttachment.mockResolvedValue({ title: 'тест', content: 'случайная заметка', lastSessionAt: 1 });
  });

  it('«Посмотри в других моих записях» sends the plain question, no note attached', async () => {
    const { result } = renderHook(() => useAIPageData());
    act(() => { result.current.handleLookWider(); });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]![0]).toBe('Посмотри в других моих записях — как это связано?');
    expect(sendMessage.mock.calls[0]![1]).toBeUndefined();
    expect(searchNotes).not.toHaveBeenCalled();
    expect(prepareAttachment).not.toHaveBeenCalled();
  });

  it('typed «разбери мою последнюю запись» without a pending note attaches nothing', async () => {
    const { result } = renderHook(() => useAIPageData());
    await act(async () => { await result.current.handleSendMessage('разбери мою последнюю запись'); });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toBe('разбери мою последнюю запись');
    expect(sendMessage.mock.calls[0]![1]).toBeUndefined();
    expect(searchNotes).not.toHaveBeenCalled();
  });
});
