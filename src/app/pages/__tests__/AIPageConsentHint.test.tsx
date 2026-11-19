import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../test/utils/render';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

// S-40 (S-31): страница ИИ пробрасывает consentRequired в AIChatMessages, а
// «Открыть настройки» ведёт в тот же раздел, что и архив — /settings#security.
// Раньше это проверял grep по исходнику; теперь — рендер страницы.

const { navigate, pageData } = vi.hoisted(() => ({
  navigate: vi.fn(),
  pageData: { consentRequired: null as string | null },
}));

vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

// Единственное, что страница рисует сама вокруг подсказки, — AIChatMessages;
// остальные блоки и модалки заглушены, их данные здесь не важны.
const visual = { color: '#888', mono: 'E', role: { ru: 'Роль', en: 'Role' } };
vi.mock('../../../features/ai/hooks/useAIPageData', () => ({
  useAIPageData: () => new Proxy({
    dialogueList: { status: 'empty' }, activeDialogueId: null,
    selectedPersonaId: 'coach', inputText: '', pendingAttachments: [],
    messagesEndRef: { current: null }, fileInputRef: { current: null }, attachMenuRef: { current: null },
    isLoading: false, streamingMessage: null, streamingReasoning: null, error: null,
    consentRequired: pageData.consentRequired,
    lastTurnScope: null, crisisActive: false, dialogue: null,
    dailyLimit: { remaining: 10, limit: 10, limitUnknown: false, reasoningRemaining: 0, reasoningLimit: 0 },
    indexingModalOpen: false, responseLength: 'standard', reasoning: false,
    proactiveHint: null, followUps: [], starters: [], allPersonas: [], displayMessages: [],
    activePersona: { id: 'coach', name: 'Coach' }, activeRole: '', headerVisual: visual,
    convPersonaName: 'Coach', convVisual: visual, MAX_INPUT_CHARS: 10_000,
  } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : vi.fn()) }),
}));
vi.mock('../../../features/ai/components/chat/AIChatSidebar', () => ({ AIChatSidebar: () => null }));
vi.mock('../../../features/ai/components/chat/AIChatHeader', () => ({ AIChatHeader: () => null }));
vi.mock('../../../features/ai/components/chat/AIChatComposer', () => ({ AIChatComposer: () => null }));
vi.mock('../../../features/ai/components/DocumentPickerModal', () => ({ DocumentPickerModal: () => null }));
vi.mock('../../../features/ai/components/CreatePersonaModal', () => ({ CreatePersonaModal: () => null }));
vi.mock('../../../features/ai/components/PersonaDetailModal', () => ({ PersonaDetailModal: () => null }));
vi.mock('../../../features/ai/components/MemoryManagerModal', () => ({ MemoryManagerModal: () => null }));
vi.mock('../../../features/ai/components/IndexingConsentModal', () => ({ IndexingConsentModal: () => null }));
vi.mock('../../../features/archive/components/DocumentPreview', () => ({ DocumentPreview: () => null }));
vi.mock('../../../features/ai/components/chat/noteActions', () => ({
  createNoteActions: () => ({ handleCreateNote: vi.fn(), handleApplyToNote: vi.fn() }),
}));
vi.mock('../../../features/auth/contexts/ProfileContext', () => ({ useProfile: () => ({ profile: null }) }));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'desktop' }) }));

import { AIPage } from '../AIPage';

describe('S-40: AIPage wires the consent hint to the settings section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, 'ru');
  });

  it('shows the hint and «Открыть настройки» navigates to /settings#security', () => {
    pageData.consentRequired = 'AI_CONSENT_REQUIRED';
    renderWithProviders(<MemoryRouter><AIPage /></MemoryRouter>);

    expect(screen.getByText(/разреши его использование в настройках/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть настройки' }));
    expect(navigate).toHaveBeenCalledWith('/settings#security');
  });

  it('no hint without the state', () => {
    pageData.consentRequired = null;
    renderWithProviders(<MemoryRouter><AIPage /></MemoryRouter>);
    expect(screen.queryByText(/разреши его использование в настройках/)).not.toBeInTheDocument();
  });
});
