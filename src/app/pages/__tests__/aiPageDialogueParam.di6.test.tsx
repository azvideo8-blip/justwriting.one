// DI-6: /ai?dialogue=<id> — архивный открывается тем же путём, что из списка
// архива (настоящий useDialogueManager поверх fake-indexeddb), параметр снят
// после чтения; удалённый диалог — названный отказ, страница как обычно.
// Край страницы заглушен по образцу AIPageConsentHint; менеджер диалогов настоящий.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import 'fake-indexeddb/auto';

const h = vi.hoisted(() => ({
  show: vi.fn(),
  setPersona: vi.fn(),
  last: null as { activeDialogueId: string | null } | null,
}));
vi.mock('@/shared/components/Toast', () => ({ useToast: () => ({ showToast: h.show }) }));
vi.mock('@/features/ai/hooks/useAIPageData', async () => {
  const { useDialogueManager } = await import('@/features/ai/hooks/useDialogueManager');
  const visual = { color: '#888', mono: 'K', role: { ru: 'Роль', en: 'Role' } };
  return {
    useAIPageData: () => {
      const dm = useDialogueManager({ confirmDialog: async () => true });
      const base = {
        ...dm,
        setSelectedPersonaId: h.setPersona,
        dialogueList: { status: 'empty' }, selectedPersonaId: 'coach', inputText: '',
        pendingAttachments: [], messagesEndRef: { current: null }, fileInputRef: { current: null },
        attachMenuRef: { current: null }, isLoading: false, streamingMessage: null,
        streamingReasoning: null, error: null, consentRequired: null, lastTurnScope: null,
        crisisActive: false, dialogue: null,
        dailyLimit: { remaining: 10, limit: 10, limitUnknown: false, reasoningRemaining: 0, reasoningLimit: 0 },
        indexingModalOpen: false, responseLength: 'standard', reasoning: false,
        proactiveHint: null, followUps: [], starters: [], allPersonas: [], displayMessages: [],
        activePersona: { id: 'coach', name: 'Коуч' }, activeRole: '', headerVisual: visual,
        convPersonaName: 'Коуч', convVisual: visual, convPersonaId: 'coach', MAX_INPUT_CHARS: 10_000,
        insightsButtonVisible: false, saveInsightBusy: false,
      } as Record<string, unknown>;
      h.last = base as { activeDialogueId: string | null };
      return new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : vi.fn()) });
    },
  };
});
vi.mock('@/features/ai/components/chat/AIChatSidebar', () => ({ AIChatSidebar: () => null }));
vi.mock('@/features/ai/components/chat/AIChatHeader', () => ({ AIChatHeader: () => null }));
vi.mock('@/features/ai/components/chat/AIChatComposer', () => ({ AIChatComposer: () => null }));
vi.mock('@/features/ai/components/DocumentPickerModal', () => ({ DocumentPickerModal: () => null }));
vi.mock('@/features/ai/components/CreatePersonaModal', () => ({ CreatePersonaModal: () => null }));
vi.mock('@/features/ai/components/PersonaDetailModal', () => ({ PersonaDetailModal: () => null }));
vi.mock('@/features/ai/components/MemoryManagerModal', () => ({ MemoryManagerModal: () => null }));
vi.mock('@/features/ai/components/IndexingConsentModal', () => ({ IndexingConsentModal: () => null }));
vi.mock('@/features/archive/components/DocumentPreview', () => ({ DocumentPreview: () => null }));
vi.mock('@/features/ai/components/chat/noteActions', () => ({
  createNoteActions: () => ({ handleCreateNote: vi.fn(), handleApplyToNote: vi.fn() }),
}));
vi.mock('@/features/auth/contexts/ProfileContext', () => ({ useProfile: () => ({ profile: null }) }));
vi.mock('@/shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'desktop' }) }));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AIPage } from '@/app/pages/AIPage';
import { AIDialogueService } from '@/features/ai/services/AIDialogueService';
import { LocalStoreSyncService } from '@/core/services/LocalStoreSyncService';
import { getLocalDb } from '@/core/storage/localDb';
import { renderWithProviders } from '@/test/utils/render';

function SearchProbe() {
  const [sp] = useSearchParams();
  return <div data-testid="search">{sp.toString()}</div>;
}

function renderAt(path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <AIPage />
      <SearchProbe />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  cleanup();
  localStorage.setItem('language', 'ru');
  vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
  vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
  const db = await getLocalDb();
  await db.clear('aiDialogues');
});

describe('DI-6: /ai?dialogue=', () => {
  it('архивный диалог открывается, параметр снят с адреса', async () => {
    const d = await AIDialogueService.create({
      title: 'Синтетический архивный', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🧭', messages: [],
    });
    await AIDialogueService.archive(d.id);
    renderAt('/ai?dialogue=' + d.id);
    await waitFor(() => expect(h.last?.activeDialogueId).toBe(d.id));
    expect(h.setPersona).toHaveBeenCalledWith('coach');
    expect(screen.getByTestId('search').textContent).not.toContain('dialogue');
    // Мутация: не читать параметр (ранний return в эффекте AIPage) — красный.
  });

  it('удалённый диалог — названный отказ, страница открывается как обычно', async () => {
    const d = await AIDialogueService.create({
      title: 'Синтетический удалённый', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🧭', messages: [],
    });
    await AIDialogueService.delete(d.id);
    renderAt('/ai?dialogue=' + d.id);
    await waitFor(() => expect(h.show).toHaveBeenCalledWith('Этого разговора больше нет', 'info'));
    expect(h.last?.activeDialogueId).toBeNull();
    expect(screen.getByTestId('search').textContent).not.toContain('dialogue');
  });
});