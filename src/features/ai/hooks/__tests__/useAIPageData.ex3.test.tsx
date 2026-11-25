// EX-3 (PIN-1, страница ИИ): закрепить ветки отказа в useAIPageData — оценка ответа
// и возврат неотправленного. Хук настоящий; подменяются сеть (AIService через useAIChat),
// запись памяти (AIChatMemoryService.addManual) и тост. Харнесс — как в useAIPageData.sus06.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { sendMessage, addManual, showToast, attachState, promptDialog } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  addManual: vi.fn(),
  showToast: vi.fn(),
  attachState: { pending: [] as unknown[], setPending: vi.fn() },
  promptDialog: vi.fn(),
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
    prepareAttachment: vi.fn(),
    stop: vi.fn(),
    regenerateLast: vi.fn(),
    crisisActive: false,
    dismissCrisis: vi.fn(),
    clearError: vi.fn(),
    triggerForcedSearch: vi.fn(),
    lastTurnScope: null,
  }),
}));
vi.mock('../../utils/noteRetriever', () => ({ searchNotes: vi.fn() }));
vi.mock('../useDailyLimit', () => ({ useDailyLimit: () => ({}) }));
vi.mock('../useDialogueManager', () => ({
  useDialogueManager: () => ({
    dialogueList: { status: 'empty' },
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
    pendingAttachments: attachState.pending,
    setPendingAttachments: attachState.setPending,
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
vi.mock('../../services/AIDialogueService', () => ({
  AIDialogueService: {
    cleanupEmpty: vi.fn().mockResolvedValue(0),
    updateResponseLength: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../services/AIChatMemoryService', () => ({
  AIChatMemoryService: { cleanupDuplicates: vi.fn(), addManual: (...a: unknown[]) => addManual(...a) },
}));
vi.mock('../../services/AIProfileFacetService', () => ({ AIProfileFacetService: { getAll: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../services/AIService', () => ({ AIService: { chat: vi.fn() } }));
vi.mock('../../utils/embeddingIndexer', () => ({ indexPending: vi.fn() }));
vi.mock('../../../../core/data', () => ({ DataProvider: {} }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }), onAuthStateChange: () => () => {} }));
vi.mock('../../../../core/ai/indexingConsent', () => ({
  getIndexingConsent: () => 'granted',
  setIndexingConsent: vi.fn(),
  INDEXING_CONSENT_VERSION: 1,
}));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn(), prompt: promptDialog }),
}));

import { useAIPageData } from '../useAIPageData';

beforeEach(() => {
  vi.clearAllMocks();
  attachState.pending = [];
  promptDialog.mockResolvedValue(null);
});

describe('EX-3: страница ИИ — отказ записи оценки и возврат неотправленного', () => {
  it('👍: запись памяти отказала — error «Что-то пошло не так», не «Учту»', async () => {
    addManual.mockResolvedValue(false);
    const { result } = renderHook(() => useAIPageData());
    await act(async () => { await result.current.handleFeedback('up'); });
    expect(addManual).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('error_generic_action', 'error');
    expect(showToast).not.toHaveBeenCalledWith('Учту — продолжу в этом стиле', 'success');
  });

  it('👎: запись памяти отказала — error «Что-то пошло не так», не «Учту»', async () => {
    addManual.mockResolvedValue(false);
    const { result } = renderHook(() => useAIPageData());
    await act(async () => { await result.current.handleFeedback('down'); });
    expect(showToast).toHaveBeenCalledWith('error_generic_action', 'error');
    expect(showToast).not.toHaveBeenCalledWith('Учту — скорректирую стиль', 'success');
  });

  it('контроль 👍: запись прошла — успех «Учту», ошибки нет', async () => {
    addManual.mockResolvedValue(true);
    const { result } = renderHook(() => useAIPageData());
    await act(async () => { await result.current.handleFeedback('up'); });
    expect(showToast).toHaveBeenCalledWith('Учту — продолжу в этом стиле', 'success');
    expect(showToast).not.toHaveBeenCalledWith('error_generic_action', 'error');
  });

  it('отправка не удалась (ответ null): текст возвращается в поле ввода', async () => {
    sendMessage.mockResolvedValue(null);
    const { result } = renderHook(() => useAIPageData());
    act(() => { result.current.setInputText('вопрос про глину'); });
    await act(async () => { await result.current.handleSendMessage(); });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result.current.inputText).toBe('вопрос про глину');
  });

  it('отправка не удалась: вложения возвращаются в ожидание', async () => {
    sendMessage.mockResolvedValue(null);
    const att = { documentId: 'doc_att_1', title: 'Синтетическая заметка', content: 'текст', lastSessionAt: 1000 };
    attachState.pending = [att];
    const { result } = renderHook(() => useAIPageData());
    act(() => { result.current.setInputText('вопрос с заметкой'); });
    await act(async () => { await result.current.handleSendMessage(); });
    expect(attachState.setPending).toHaveBeenLastCalledWith([att]);
  });

  it('контроль отправки: ответ получен — поле пустое, вложения не возвращаются', async () => {
    sendMessage.mockResolvedValue('dlg_msg_ok');
    const { result } = renderHook(() => useAIPageData());
    act(() => { result.current.setInputText('вопрос'); });
    await act(async () => { await result.current.handleSendMessage(); });
    expect(result.current.inputText).toBe('');
    expect(attachState.setPending).not.toHaveBeenCalledWith([expect.anything()]);
  });
});
