import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileWriteToolbar } from '../components/MobileWriteToolbar';
import { Toolbar } from '../components/Toolbar';
import { Sidebar } from '../../navigation/components/Sidebar';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    tp: (key: string, _count: number) => key,
  }),
}));

vi.mock('../../../shared/components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    fontFamily: 'Inter',
    fontSize: 18,
    isZenActive: false,
    zenModeEnabled: false,
    streamMode: false,
    toggleStreamMode: vi.fn(),
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));

vi.mock('../store/useContentStore', () => ({
  useContentStore: (cb: any) => cb({
    content: 'test',
    setContent: vi.fn(),
    title: 'test note',
    setTitle: vi.fn(),
    wordCount: 10,
    initialWordCount: 0,
    wpm: 25,
    wpmHistory: [20, 25],
  }),
}));

vi.mock('../store/useTimerStore', () => ({
  useTimerStore: (cb: any) => cb({
    status: 'writing',
    seconds: 60,
    timerDuration: 0,
    sessionStartSeconds: 0,
    wordGoal: 0,
    sessionStartWords: 0,
    setWordGoal: vi.fn(),
    setTimerDuration: vi.fn(),
  }),
}));

vi.mock('../../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ isAuthenticated: false, user: null, loading: false }),
}));

vi.mock('../../../core/sync/SyncContext', () => ({
  useSyncStatus: () => ({ syncState: 'synced', pendingCount: 0 }),
}));

describe('L-11: Mobile touch target compliance (WCAG 2.5.5 >= 44x44px)', () => {
  it('MobileWriteToolbar session stats have min-h-[44px]', () => {
    const { container } = render(
      <MobileWriteToolbar
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onStop={vi.fn()}
      />
    );

    const wordsTarget = screen.getByRole('button', { name: 'writing_mode_words' });
    expect(wordsTarget.className).toContain('min-h-[44px]');

    const timeTarget = screen.getByRole('button', { name: 'writing_mode_timer' });
    expect(timeTarget.className).toContain('min-h-[44px]');

    // All icon buttons on mobile toolbar are 44x44 (w-11 h-11)
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const btn of Array.from(buttons)) {
      expect(btn.className).toMatch(/w-11|clickable-target-expansion/);
    }
  });

  it('Toolbar motion buttons include clickable-target-expansion', () => {
    render(
      <Toolbar
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onStop={vi.fn()}
        onSave={vi.fn()}
        onNew={vi.fn()}
        onOpenLog={vi.fn()}
        status="writing"
        wordCount={10}
        title="test"
        setTitle={vi.fn()}
      />
    );

    const saveBtn = screen.getByRole('button', { name: 'topbar_save' });
    expect(saveBtn.className).toContain('clickable-target-expansion');

    const playPauseBtn = screen.getByRole('button', { name: /play|pause/ });
    expect(playPauseBtn.className).toContain('clickable-target-expansion');

    const finishBtn = screen.getByRole('button', { name: 'header_finish' });
    expect(finishBtn.className).toContain('clickable-target-expansion');
  });

  it('Sidebar footer links have min-h-[44px] and clickable-target-expansion', () => {
    render(
      <MemoryRouter>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );

    const aboutBtn = screen.getByRole('button', { name: 'nav_about' });
    expect(aboutBtn.className).toContain('min-h-[44px]');
    expect(aboutBtn.className).toContain('clickable-target-expansion');

    const changelogBtn = screen.getByRole('button', { name: /v0\./ });
    expect(changelogBtn.className).toContain('min-h-[44px]');
    expect(changelogBtn.className).toContain('clickable-target-expansion');
  });
});
