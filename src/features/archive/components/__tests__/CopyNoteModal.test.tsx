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

  it('renders with Markdown tab active by default and switches to Text tab', async () => {
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
    expect(await screen.findByRole('button', { name: /скопировано|copied/i })).toBeInTheDocument();
  });

  // 0.11.22: буфер обмена отказал — не «Скопировано». Мутация: вернуть
  // `void navigator.clipboard.writeText(...)` без ожидания — красный.
  it('буфер обмена отказал — ошибка, а не «Скопировано»', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('NotAllowedError'));
    renderWithProviders(
      <ToastProvider>
        <CopyNoteModal open={true} onClose={vi.fn()} session={dummySession} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /скопировать|copy/i }));
    expect(await screen.findByText(/Не удалось скопировать|Couldn’t copy/)).toBeInTheDocument();
    expect(screen.queryByText(/Скопировано в буфер|Copied to clipboard/)).toBeNull();
    expect(screen.queryByRole('button', { name: /скопировано|copied/i })).toBeNull();
  });
});
