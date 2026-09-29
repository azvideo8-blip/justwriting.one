import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BottomStats } from '../BottomStats';

const mockConfirm = vi.fn();
vi.mock('../../../../shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
  }),
}));

const mockStartListening = vi.fn();
const mockStopListening = vi.fn();
let mockIsListening = false;
let mockHasSupport = true;

vi.mock('../../../../shared/hooks/useSpeechInput', () => ({
  useSpeechInput: () => ({
    isListening: mockIsListening,
    startListening: mockStartListening,
    stopListening: mockStopListening,
    hasSupport: mockHasSupport,
  }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
  }),
}));

vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false,
    zenModeEnabled: false,
    headerVisibility: { sessionTime: true, wpm: true },
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));

describe('D-14: BottomStats uses guarded speech input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockIsListening = false;
    mockHasSupport = true;
  });

  it('prompts user with confirmation dialog before enabling speech input for the first time', async () => {
    mockConfirm.mockResolvedValue(true);

    render(
      <BottomStats
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onStop={vi.fn()}
      />
    );

    const micButton = screen.getByRole('button', { name: 'voice_start' });
    fireEvent.click(micButton);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockStartListening).toHaveBeenCalledTimes(1);
    });
  });

  it('does not start listening if user cancels confirmation dialog', async () => {
    mockConfirm.mockResolvedValue(false);

    render(
      <BottomStats
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onStop={vi.fn()}
      />
    );

    const micButton = screen.getByRole('button', { name: 'voice_start' });
    fireEvent.click(micButton);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockStartListening).not.toHaveBeenCalled();
    });
  });
});
