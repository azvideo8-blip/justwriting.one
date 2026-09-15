import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { CopyNoteModal } from '../CopyNoteModal';
import type { ArchiveSession } from '../../types';

describe('CopyNoteModal (UI-07)', () => {
  const dummySession: ArchiveSession = {
    id: 's1',
    userId: 'u1',
    charCount: 0,
    title: 'Testing Copy',
    tags: ['fiction', 'chapter1'],
    content: 'Plain body text without headers',
    duration: 120,
    wordCount: 5,
    wpm: 25,
    createdAt: new Date('2024-05-10T14:30:00Z'),
    sessionStartTime: new Date('2024-05-10T14:30:00Z').getTime(),
  };

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders with Markdown tab active by default and switches to Text tab', () => {
    const onClose = vi.fn();

    renderWithProviders(
      <ToastProvider>
        <CopyNoteModal
          open={true}
          onClose={onClose}
          session={dummySession}
        />
      </ToastProvider>
    );

    const mdTab = screen.getByRole('tab', { name: /markdown/i });
    const textTab = screen.getByRole('tab', { name: /текст|text/i });

    // Active tab has inverted pill styling
    expect(mdTab.className).toMatch(/(?:^|\s)bg-text-main(?:\s|$)/);
    expect(mdTab.className).toContain('text-surface-base');
    expect(textTab.className).not.toMatch(/(?:^|\s)bg-text-main(?:\s|$)/);
    expect(textTab.className).not.toContain('text-surface-base');

    // Pre contains serialized markdown
    const pre = screen.getByText((content) => content.includes('title: "Testing Copy"'));
    expect(pre).toBeInTheDocument();
    expect(pre.textContent).toContain('tags: ["fiction", "chapter1"]');

    // Switch to Text tab
    fireEvent.click(textTab);
    expect(textTab.className).toMatch(/(?:^|\s)bg-text-main(?:\s|$)/);
    expect(textTab.className).toContain('text-surface-base');
    expect(mdTab.className).not.toMatch(/(?:^|\s)bg-text-main(?:\s|$)/);
    expect(mdTab.className).not.toContain('text-surface-base');

    // Pre now contains only plain text
    expect(pre.textContent).toBe('Plain body text without headers');

    // Click copy button
    const copyBtn = screen.getByRole('button', { name: /скопировать|copy/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Plain body text without headers');
    expect(screen.getByRole('button', { name: /скопировано|copied/i })).toBeInTheDocument();
  });
});
