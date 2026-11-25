// NB-7 (sus06): режим ответа и рассуждения — запись не прошла, а тумблер
// показывал новое значение, reject из шапки (void) был необработанным.
// Теперь отказ возвращает тумблер на прежнее значение и называется error
// через runMutation (тост — в помощнике, счётчик храповика не растёт).
// Мутации: убрать onFailure-откат / убрать runMutation (снова голый await) —
// красный; откат — зелёный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { sendMessage, updateResponseLength, showToast, confirm, loadDialogues } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  updateResponseLength: vi.fn(),
  showToast: vi.fn(),
  confirm: vi.fn(),
  loadDialogues: vi.fn(),
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
    loadDialogues,
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
vi.mock('../../services/AIDialogueService', () => ({
  AIDialogueService: {
    cleanupEmpty: vi.fn().mockResolvedValue(0),
    updateResponseLength: (...a: unknown[]) => updateResponseLength(...a),
  },
}));
vi.mock('../../services/AIChatMemoryService', () => ({ AIChatMemoryService: { cleanupDuplicates: vi.fn() } }));
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
  useConfirmDialog: () => ({ confirm, alert: vi.fn(), prompt: vi.fn() }),
}));

import { useAIPageData } from '../useAIPageData';

beforeEach(() => {
  vi.clearAllMocks();
  updateResponseLength.mockResolvedValue(undefined);
  loadDialogues.mockResolvedValue(undefined);
  confirm.mockResolvedValue(true);
});

describe('NB-7: тумблеры режима — отказ записи виден', () => {
  it('режим ответа: запись отказала — тумблер вернулся, error назван', async () => {
    updateResponseLength.mockRejectedValue(new Error('IDB down'));
    const { result } = renderHook(() => useAIPageData());
    // микрозадача эффекта синхронизации режима должна отработать до клика
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.handleSetResponseLength('detailed'); });
    expect(updateResponseLength).toHaveBeenCalledWith('dlg_1', 'detailed', false);
    expect(result.current.responseLength).toBe('standard');
    expect(showToast).toHaveBeenCalledWith('error_generic_action', 'error');
  });

  it('режим ответа контроль: запись прошла — новое значение стоит, ошибки нет', async () => {
    const { result } = renderHook(() => useAIPageData());
    // микрозадача эффекта синхронизации режима должна отработать до клика
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.handleSetResponseLength('detailed'); });
    expect(result.current.responseLength).toBe('detailed');
    expect(showToast).not.toHaveBeenCalledWith('error_generic_action', 'error');
    expect(loadDialogues).toHaveBeenCalled();
  });

  it('рассуждения: запись отказала — тумблер вернулся, error назван', async () => {
    updateResponseLength.mockRejectedValue(new Error('IDB down'));
    const { result } = renderHook(() => useAIPageData());
    // микрозадача эффекта синхронизации режима должна отработать до клика
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.handleSetReasoning(true); });
    expect(confirm).toHaveBeenCalled();
    expect(updateResponseLength).toHaveBeenCalledWith('dlg_1', 'standard', true);
    expect(result.current.reasoning).toBe(false);
    expect(showToast).toHaveBeenCalledWith('error_generic_action', 'error');
  });

  it('рассуждения контроль: запись прошла — включено, ошибки нет', async () => {
    const { result } = renderHook(() => useAIPageData());
    // микрозадача эффекта синхронизации режима должна отработать до клика
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.handleSetReasoning(true); });
    expect(result.current.reasoning).toBe(true);
    expect(showToast).not.toHaveBeenCalledWith('error_generic_action', 'error');
  });

  it('окно подтверждения отклонено — записи нет, тумблер не тронут', async () => {
    confirm.mockResolvedValue(false);
    const { result } = renderHook(() => useAIPageData());
    // микрозадача эффекта синхронизации режима должна отработать до клика
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.handleSetReasoning(true); });
    expect(updateResponseLength).not.toHaveBeenCalled();
    expect(result.current.reasoning).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });
});