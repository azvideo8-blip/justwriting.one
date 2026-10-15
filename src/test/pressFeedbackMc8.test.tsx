// MC-8: отклик на нажатие пальцем — класс `press` на общих контролах и правила
// в `index.css` под `(hover: none)`. Мышью поведение не меняется.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Button } from '../shared/components/Button';
import { IconButton } from '../shared/components/IconButton';
import { NoteRow } from '../features/archive/components/NoteRow';
import { BottomNav } from '../features/navigation/components/BottomNav';
import { AIChatComposer, type AIChatComposerProps } from '../features/ai/components/chat/AIChatComposer';
import type { ArchiveSession } from '../features/archive/types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../app/useAuthStatus', () => ({ useAuthStatus: () => ({ profile: null, user: null, isGuest: false }) }));
vi.mock('../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));
vi.mock('../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }) }));
vi.mock('../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) => cb({ entries: [], setPanelOpen: vi.fn() }),
}));
vi.mock('../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));
vi.mock('../features/writing/hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, toggle: vi.fn(), hasSupport: false, isVaultActive: false, aiNoticeRemaining: null }),
}));
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useLocation: () => ({ pathname: '/' }), useNavigate: () => vi.fn() };
});

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
const touched = [
  'src/shared/components/Button.tsx',
  'src/shared/components/IconButton.tsx',
  'src/features/archive/components/NoteRow.tsx',
  'src/features/navigation/components/BottomNav.tsx',
  'src/features/ai/components/chat/AIChatComposer.tsx',
  'src/features/ai/components/chat/MobileDialogueListSheet.tsx',
];
const repoRoot = resolve(__dirname, '../..');

const ROW_TITLE = 'Ряд';

const session = {
  id: 'doc_mc8', userId: 'u1', content: 'Текст ряда.', duration: 60, wordCount: 3, charCount: 12, wpm: 3,
  tags: [], title: ROW_TITLE, createdAt: new Date(2026, 9, 14, 10, 0).getTime(), _isLocal: true,
} as unknown as ArchiveSession;

describe('MC-8: класс press', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('Button и IconButton несут press', () => {
    render(<Button onClick={vi.fn()}>ok</Button>);
    expect(screen.getByText('ok').className).toContain('press');
    render(<IconButton onClick={vi.fn()} label="mc8_icon" icon={null} />);
    expect(screen.getByRole('button', { name: 'mc8_icon' }).className).toContain('press');
  });

  it('мобильный ряд заметки — press, десктопный нет', () => {
    render(
      <NoteRow session={session} onOpen={vi.fn()} t={(k: string) => k} language="ru" userId="u1" onTagsChange={vi.fn()} onDelete={vi.fn()} />,
    );
    const row = screen.getByText('Ряд').closest('div[class*="grid-cols"]') as HTMLElement;
    expect(row.className).toContain('press');

    cleanup();
    layoutMode = 'desktop';
    render(
      <NoteRow session={session} onOpen={vi.fn()} t={(k: string) => k} language="ru" userId="u1" onTagsChange={vi.fn()} onDelete={vi.fn()} />,
    );
    const desk = screen.getByText('Ряд').closest('div[class*="grid-cols"]') as HTMLElement;
    expect(desk.className).not.toContain('press');
  });

  it('вкладки низа и кнопка отправки — тоже press', () => {
    render(<BottomNav />);
    const nav = screen.getByTestId('mobile-bottom-nav');
    expect(nav.querySelectorAll('button.press').length).toBeGreaterThanOrEqual(4);

    const composerProps = {
      isMobile: true, keyboardHeight: 0, inputText: 'текст', setInputText: vi.fn(), inputRef: { current: null },
      isLoading: false, onStop: vi.fn(), onSend: vi.fn(), pendingAttachments: [], removePendingAttachment: vi.fn(),
      onPasteAsNote: vi.fn(), attachMenuOpen: false, setAttachMenuOpen: vi.fn(), attachMenuRef: { current: null },
      fileInputRef: { current: null }, onFileUpload: vi.fn(), onOpenDocPicker: vi.fn(),
      dailyLimitRemaining: 10, dailyLimitTotal: 30, reasoning: false, maxInputChars: 1000,
      personaName: 'Гп', crisisActive: false, dismissCrisis: vi.fn(),
    } as unknown as AIChatComposerProps;
    render(<AIChatComposer {...composerProps} />);
    const send = screen.getByRole('button', { name: /ai_send/ });
    expect(send.className).toContain('press');
  });

  it('в index.css есть блок (hover: none) с 160 мс и override для reduced-motion', () => {
    expect(css).toMatch(/@media \(hover: none\)/);
    expect(css).toMatch(/transform 160ms var\(--ease-out-strong\)/);
    expect(css).toMatch(/--ease-out-strong: cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
    expect(css).toMatch(/\.press:active \{\s*transform: scale\(0\.97\);/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.\press,\s*\.\press:active \{\s*transform: none;/);
  });

  it('в затронутых файлах нет transition-all', () => {
    for (const rel of touched) {
      expect(readFileSync(resolve(repoRoot, rel), 'utf8'), rel).not.toContain('transition-all');
    }
  });
});
