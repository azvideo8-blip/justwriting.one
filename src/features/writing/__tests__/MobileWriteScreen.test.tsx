import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileWriteScreen } from '../components/MobileWriteScreen';

// Mock shared/i18n
vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    tp: (key: string) => key,
    language: 'ru',
    setLanguage: vi.fn(),
  }),
}));

// Mock useToast
vi.mock('../../../shared/components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

// Mock zustand stores
vi.mock('../store/useContentStore', () => ({
  useContentStore: (cb: any) => cb({
    content: 'Hello world',
    setContent: vi.fn(),
    title: 'Untitled',
    setTitle: vi.fn(),
    wordCount: 2,
    initialWordCount: 0,
    wpm: 0,
    wpmHistory: [],
  })
}));

const timer = vi.hoisted(() => ({ status: 'writing' }));
vi.mock('../store/useTimerStore', () => ({
  useTimerStore: (cb: any) => cb({
    status: timer.status,
    seconds: 10,
    timerDuration: 0,
    sessionStartSeconds: 0,
    wordGoal: 0,
    sessionStartWords: 0,
  })
}));

// MR-5: «Aa» в шапке письма открывает панель настроек редактора.
const openSettingsSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../core/settings/SettingsContext', () => ({
  useSettings: () => ({ openSettings: openSettingsSpy }),
}));

vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    fontFamily: 'Inter',
    fontSize: 18,
    isZenActive: false,
    zenModeEnabled: false,
    streamMode: true, // Enable streamMode to test locks
    toggleStreamMode: vi.fn(),
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));

describe('MobileWriteScreen - Stream Mode & Keystrokes', () => {
  it('should block backspace and delete keydowns in Stream Mode', () => {
    render(<MobileWriteScreen onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    const textarea = screen.getByPlaceholderText('writing_placeholder_mobile');

    const backspaceEvent = fireEvent.keyDown(textarea, { key: 'Backspace' });
    expect(backspaceEvent).toBe(false); // default was prevented

    const deleteEvent = fireEvent.keyDown(textarea, { key: 'Delete' });
    expect(deleteEvent).toBe(false); // default was prevented

    const normalKeyEvent = fireEvent.keyDown(textarea, { key: 'a' });
    expect(normalKeyEvent).toBe(true); // default was NOT prevented
  });

  it('MR-5: «Aa» в шапке открывает панель настроек редактора', () => {
    openSettingsSpy.mockClear();
    render(<MobileWriteScreen onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    const aa = screen.getByRole('button', { name: /settings_title/ });
    expect(aa.className).toContain('w-11');
    fireEvent.click(aa);
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  });


  it('MR-6: в idle редактор открыт, но не в фокусе, а «Готово» выключена', () => {
    timer.status = 'idle';
    try {
      render(<MobileWriteScreen onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
      const area = screen.getByRole('textbox');
      expect(area).toBeTruthy();
      // Без автофокуса: на Android он выбрасывал клавиатуру на пол-экрана при каждом входе.
      expect(document.activeElement).not.toBe(area);
      const done = screen.getByRole('button', { name: /writing_done/ });
      expect(done.hasAttribute('disabled')).toBe(true);
    } finally {
      timer.status = 'writing';
    }
  });

  // Ревью 0.9.39: жетон режима говорил «Поток» всегда, а первая буква запускает
  // режим, оставшийся от прошлой сессии. Мутация: вернуть постоянный
  // writing_mode_flow → красный.
  it('MR-6: жетон режима называет режим, с которым стартует сессия', () => {
    timer.status = 'idle';
    try {
      const { unmount } = render(<MobileWriteScreen sessionType="timer" onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'writing_mode_token' }).textContent).toContain('writing_mode_timer');
      unmount();
      render(<MobileWriteScreen onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'writing_mode_token' }).textContent).toContain('writing_mode_flow');
    } finally {
      timer.status = 'writing';
    }
  });

  it('MR-6: первый символ запускает сессию ровно один раз', () => {
    timer.status = 'idle';
    const onPlay = vi.fn();
    try {
      render(<MobileWriteScreen onPlay={onPlay} onPause={vi.fn()} onStop={vi.fn()} />);
      const area = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.input(area, { target: { value: 'первые слова' } });
      expect(onPlay).toHaveBeenCalledTimes(1);
    } finally {
      timer.status = 'writing';
    }
  });

});
