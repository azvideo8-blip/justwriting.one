// HA-3 (дейлик 26.11, Н-2): тема скрытой от ИИ заметки предлагалась стартером и по клику
// уходила модели. Настоящий useAIPageData и IndexedDB; подменены соседние хуки и сеть.
// Мутация: снять проверку noteHiddenFromAI перед стартерами — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';

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
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }), onAuthStateChange: () => () => {} }));
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
import { getLocalDb } from '../../../../core/storage/localDb';

const THEME = 'MARKER_HA3_HIDDEN_THEME';
const doc = (id: string, over: object = {}) => ({ id, guestId: 'u1', title: id, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [], ...over });

beforeEach(async () => {
  vi.clearAllMocks();
  prepareAttachment.mockResolvedValue(null);
  const db = await getLocalDb();
  for (const s of ['documents', 'aiSummaries'] as const) await db.clear(s);
  for (const [id, over] of [['n_visible', { uuid: 'uuid_visible' }], ['n_hidden', { excludedFromAI: true }], ['n_trashed', { trashedAt: 1 }], ['n_missing', null]] as const) {
    if (over) await db.put('documents', doc(id, over) as never);
    await db.put('aiSummaries', { documentId: id, summary: 's', themes: [THEME], tone: '', frequentWords: [], insights: [], extractedFacts: [], processedAt: 1 } as never);
  }
});

describe('HA-3: стартеры по теме приложенной заметки', () => {
  it('видимая заметка — стартер по теме (контроль: путь жив)', async () => {
    const { result } = renderHook(() => useAIPageData('n_visible'));
    await waitFor(() => expect(result.current.starters.join(' ')).toContain(THEME));
  });

  // DA-4 (дейлик 27.11): ссылка по постоянному номеру, свод — под локальным id.
  // Мутация: читать свод по присланному номеру — красный.
  it('видимая заметка по uuid — стартер по теме', async () => {
    const { result } = renderHook(() => useAIPageData('uuid_visible'));
    await waitFor(() => expect(result.current.starters.join(' ')).toContain(THEME));
  });

  it.each(['n_hidden', 'n_trashed', 'n_missing'])('%s — темы нет, общие стартеры', async id => {
    const { result } = renderHook(() => useAIPageData(id));
    await new Promise(r => setTimeout(r, 150));
    expect(result.current.starters.join(' ')).not.toContain(THEME);
  });
});
