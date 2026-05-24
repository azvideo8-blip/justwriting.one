import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileWriteScreen } from '../components/MobileWriteScreen';

// Mock core/i18n
vi.mock('../../../core/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
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

vi.mock('../store/useTimerStore', () => ({
  useTimerStore: (cb: any) => cb({
    status: 'writing',
    seconds: 10,
    timerDuration: 0,
    sessionStartSeconds: 0,
    wordGoal: 0,
    sessionStartWords: 0,
  })
}));

vi.mock('../contexts/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    fontFamily: 'Inter',
    fontSize: 18,
    isZenActive: false,
    zenModeEnabled: false,
    streamMode: true, // Enable streamMode to test locks
    toggleStreamMode: vi.fn(),
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));

describe('MobileWriteScreen - Stream Mode & Keystrokes', () => {
  it('should block backspace and delete keydowns in Stream Mode', () => {
    render(<MobileWriteScreen onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    const textarea = screen.getByPlaceholderText('writing_placeholder');

    const backspaceEvent = fireEvent.keyDown(textarea, { key: 'Backspace' });
    expect(backspaceEvent).toBe(false); // default was prevented

    const deleteEvent = fireEvent.keyDown(textarea, { key: 'Delete' });
    expect(deleteEvent).toBe(false); // default was prevented

    const normalKeyEvent = fireEvent.keyDown(textarea, { key: 'a' });
    expect(normalKeyEvent).toBe(true); // default was NOT prevented
  });
});
