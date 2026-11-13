// TR-5: под «Разобрать заметку через ИИ» — постоянная строка о том, что кнопка
// делает. Без согласия на ИИ строка говорит «ИИ выключен». Профиль не прочитан —
// обычная строка: «не знаем» не равно «выключен».
// Мутации (прогнаны, каждая красная):
//  1. перепутать ветки `aiOff ? no_consent : caption` → «согласие есть» и «согласия нет»;
//  2. вынести <p> из ветки кнопки (показывать всегда) → «скрыта от ИИ → строки нет»;
//  3. в useAiConsentOff убрать isProfileLoaded → «профиль не прочитан → обычная строка».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { DocumentPreview } from '../DocumentPreview';
import { useAiConsentStore } from '../../../../core/ai/aiConsent';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import type { ArchiveSession } from '../../types';

let layoutMode: 'desktop' | 'mobile' = 'desktop';
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../core/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/auth')>();
  return { ...actual, getCurrentUser: () => ({ uid: 'user-tr5' }) };
});

const CAPTION = 'Текст заметки уйдёт ИИ на разбор, и собеседник сможет на неё опираться. Пока не нажали — собеседник её не видит.';
const CAPTION_OFF = 'ИИ выключен: согласия на него нет. Включить — в «Настройки → Безопасность».';

const session = {
  id: 'doc-tr5', userId: 'user-tr5', title: 'Суббота, дача', content: 'Красили забор.',
  duration: 60, wordCount: 2, charCount: 14, wpm: 2, tags: [], createdAt: Date.now(), _isLocal: true,
} as unknown as ArchiveSession;

type Props = ComponentProps<typeof DocumentPreview>;
function renderPreview(overrides: Partial<Props> = {}) {
  return renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <DocumentPreview
          session={session}
          onClose={vi.fn()}
          onContinue={vi.fn()}
          onAnalyzeNote={vi.fn(() => new Promise<{ ok: boolean }>(() => {}))}
          fetchSummary={vi.fn().mockResolvedValue(null)}
          fetchRelatedNotes={vi.fn().mockResolvedValue([])}
          {...overrides}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function setAccount(profileLoaded: boolean, consent: boolean | undefined) {
  useEncryptionStore.setState({ profileLoaded: { 'user-tr5': profileLoaded } });
  useAiConsentStore.setState({ consents: consent === undefined ? {} : { 'user-tr5': consent } });
}

async function analyzeButton() {
  if (layoutMode === 'mobile') fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
  return screen.findByRole('button', { name: 'Разобрать заметку через ИИ' });
}

describe.each(['desktop', 'mobile'] as const)('TR-5: строка под «Разобрать» (%s)', (mode) => {
  beforeEach(() => {
    cleanup();
    layoutMode = mode;
    setAccount(true, true);
  });

  it('согласие есть → обычная строка, и кнопка описана ею', async () => {
    renderPreview();
    const btn = await analyzeButton();
    const caption = screen.getByText(CAPTION);
    expect(btn.getAttribute('aria-describedby')).toBe(caption.id);
    expect(caption.id).not.toBe('');
    expect(screen.queryByText(CAPTION_OFF)).toBeNull();
  });

  it('профиль прочитан, согласия нет → «ИИ выключен»', async () => {
    setAccount(true, false);
    renderPreview();
    const btn = await analyzeButton();
    const caption = screen.getByText(CAPTION_OFF);
    expect(btn.getAttribute('aria-describedby')).toBe(caption.id);
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it('профиль не прочитан → обычная строка, а не «выключен»', async () => {
    setAccount(false, undefined);
    renderPreview();
    await analyzeButton();
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
    expect(screen.queryByText(CAPTION_OFF)).toBeNull();
  });

  it('заметка скрыта от ИИ → ни кнопки, ни строки', async () => {
    renderPreview({ session: { ...session, excludedFromAI: true } as ArchiveSession });
    if (mode === 'mobile') fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
    await screen.findAllByText(/Заметка скрыта от ИИ/);
    expect(screen.queryByText(CAPTION)).toBeNull();
    expect(screen.queryByText(CAPTION_OFF)).toBeNull();
  });

  it('идёт разбор → строки нет', async () => {
    renderPreview();
    fireEvent.click(await analyzeButton());
    await screen.findAllByText('анализируется…');
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it('заметка разобрана → строки нет', async () => {
    renderPreview({
      fetchSummary: vi.fn().mockResolvedValue({
        documentId: 'doc-tr5', summary: 'Про дачу', themes: [], tone: 'спокойный',
        insights: [], extractedFacts: [], processedAt: Date.now(),
      }),
    });
    if (mode === 'mobile') fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
    await screen.findAllByText(/Про дачу/);
    expect(screen.queryByText(CAPTION)).toBeNull();
  });
});
