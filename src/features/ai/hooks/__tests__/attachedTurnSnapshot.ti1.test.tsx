// TI-1: снимок хода, который реально собирает useAIPageData. Тест написан до
// выноса писателя и обязан остаться зелёным после — это доказательство
// «поведение побайтно прежнее». Тексты заметок синтетические.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { sendMessage, pending } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
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

const DAY = Date.UTC(2026, 8, 29, 12);
const Q = 'разбери, что тут важно';
const body = (mark: string, n = 80) => `${mark}: ${'спокойный текст заметки. '.repeat(n)}`;
const note = (id: string, title: string, content: string) => ({ documentId: id, title, content, lastSessionAt: DAY });

async function displayOf(turnNotes: typeof pending, question: string): Promise<string> {
  pending.length = 0;
  pending.push(...turnNotes);
  sendMessage.mockClear();
  const { result } = renderHook(() => useAIPageData());
  await act(async () => { await result.current.handleSendMessage(question); });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  return (sendMessage.mock.calls[0] as [string])[0];
}

describe('TI-1: снимок хода из useAIPageData', () => {
  it('одна заметка, тело влезло, с вопросом', async () => {
    const display = await displayOf([note('local_a', 'Утро', body('ТЕЛО_A'))], Q);
    expect(display).toBe(`[#local_a · 2026-09-29]\n[Прикреплена заметка: "Утро"]\n${body('ТЕЛО_A')}\n\n— — —\nВопрос: ${Q}`);
  });

  it('две заметки, тела влезли, с вопросом', async () => {
    const display = await displayOf([
      note('local_a', 'Утро', body('ТЕЛО_A')),
      note('local_b', 'Вечер', body('ТЕЛО_B')),
    ], Q);
    expect(display).toBe(
      `[#local_a · 2026-09-29]\n[Прикреплена заметка: "Утро"]\n${body('ТЕЛО_A')}\n\n---\n\n`
      + `[#local_b · 2026-09-29]\n[Прикреплена заметка: "Вечер"]\n${body('ТЕЛО_B')}\n\n— — —\nВопрос: ${Q}`,
    );
  });

  it('одна заметка не влезла: только шапка, тело не в ходе', async () => {
    const big = 'ОЧЕНЬ ДЛИННО. '.repeat(800); // 9600 знаков > 9000
    const display = await displayOf([note('local_big', 'Длинная', big)], Q);
    expect(display).toBe(`[#local_big · 2026-09-29]\n[Прикреплена заметка: "Длинная"]\n\n— — —\nВопрос: ${Q}`);
    expect(display).not.toContain('ОЧЕНЬ ДЛИННО');
  });

  it('две заметки не влезли: шапки через перевод строки, тел нет', async () => {
    const half = 'ДЛИННО. '.repeat(650); // 2 × 5200 > 9000
    const display = await displayOf([
      note('local_a', 'Утро', half),
      note('local_b', 'Вечер', half),
    ], Q);
    expect(display).toBe(
      `[#local_a · 2026-09-29]\n[Прикреплена заметка: "Утро"]\n`
      + `[#local_b · 2026-09-29]\n[Прикреплена заметка: "Вечер"]\n\n— — —\nВопрос: ${Q}`,
    );
    expect(display).not.toContain('ДЛИННО');
  });

  it('вставленный текст pasted-… — такая же шапка с датой', async () => {
    const display = await displayOf([note('pasted-1759392000000', 'Вставленный текст', 'ВСТАВЛЕННЫЙ ТЕКСТ')], Q);
    expect(display).toBe(
      `[#pasted-1759392000000 · 2026-09-29]\n[Прикреплена заметка: "Вставленный текст"]\nВСТАВЛЕННЫЙ ТЕКСТ\n\n— — —\nВопрос: ${Q}`,
    );
  });
});
