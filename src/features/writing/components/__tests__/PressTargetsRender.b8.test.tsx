// B-8 (ревью 0.10.1): прежние проверки отклика искали `press` в тексте исходника
// (`MotionTailMq15.test.tsx:119-121` считал теги `<Button`, `PressFeedback.sa9` —
// окном ±300 символов вокруг якоря). Обе проходили, даже если у кнопок панели
// письма отклика не оставалось: проверка измеряла форму записи, а не поведение.
// Здесь то же самое проверяется на рендере — по фактическому списку классов
// кнопки в DOM.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteToolbar } from '../MobileWriteToolbar';
import { MobileNoteReader } from '../../../archive/components/MobileNoteReader';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';
import type { ArchiveSession } from '../../../archive/types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/i18n')>();
  return {
    ...actual,
    useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n?: number) => (n === undefined ? k : `${k}:${n}`), language: 'ru' }),
  };
});
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    quietStats: false,
    setQuietStats: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, toggle: vi.fn(), hasSupport: true, isVaultActive: false, aiNoticeRemaining: null }),
}));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

function renderToolbar() {
  cleanup();
  layoutMode = 'mobile';
  useContentStore.setState({ content: 'Глина сохнет быстрее, чем кажется.', wordCount: 12, wpm: 20, wpmHistory: [] });
  useTimerStore.setState({
    status: 'writing', sessionType: 'free', seconds: 60, wordGoal: 0, timerDuration: 0,
    sessionStartWords: 0, sessionStartSeconds: 0,
  } as Partial<ReturnType<typeof useTimerStore.getState>>);
  return render(<MobileWriteToolbar onStop={vi.fn()} />);
}

const session = {
  id: 'doc_b8', userId: 'u_b8', title: 'Про гончарный круг',
  content: 'Глина сохнет быстрее, чем кажется.', duration: 240, wordCount: 6, charCount: 36, wpm: 5,
  tags: [], createdAt: new Date(2026, 9, 14, 19, 5).getTime(), _isLocal: true,
} as unknown as ArchiveSession;

function renderReader() {
  cleanup();
  layoutMode = 'mobile';
  return renderWithProviders(
    <MemoryRouter>
      <ToastProvider>
        <MobileNoteReader
          session={session}
          onClose={vi.fn()}
          onContinue={vi.fn()}
          summary={null}
          relatedNotes={[{ documentId: 'd_b8_2', title: 'Про печь', date: '2026-10-12', score: 3 }]}
          onSelectRelated={vi.fn()}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('B-8: отклик касания проверяется на рендере', () => {
  beforeEach(() => { cleanup(); });

  it('панель письма: все три цели несут класс отклика', () => {
    renderToolbar();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const b of buttons) {
      expect(b.className.split(/\s+/), `кнопка «${b.getAttribute('aria-label') ?? b.textContent}» без отклика`).toContain('press');
    }
  });

  it('читалка: «Продолжить писать» и строка связанной записи несут отклик', () => {
    renderReader();
    const primary = screen.getByRole('button', { name: 'archive_continue_writing' });
    expect(primary.className.split(/\s+/)).toContain('press');
    const related = screen.getByRole('button', { name: /Про печь/ });
    expect(related.className.split(/\s+/)).toContain('press');
  });
});
