import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import React from 'react';
import { subYears } from 'date-fns';
import { renderWithProviders } from '../../../../test/utils/render';
import { OnThisDayCard } from '../../../../core/components/OnThisDayCard';
import type { ArchiveSession } from '../../types';

describe('OnThisDayCard — excerpt rendering for locked/unloaded/normal sessions (RC-6)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const oneYearAgo = subYears(new Date(), 1).getTime();

  function makeSession(overrides: Partial<ArchiveSession>): ArchiveSession {
    return {
      id: 'session_otd_1',
      userId: 'u1',
      title: 'Год назад',
      content: 'Текст заметки годовой давности для проверки выдержки.',
      createdAt: oneYearAgo,
      duration: 120,
      wordCount: 8,
      charCount: 50,
      wpm: 4,
      tags: [],
      _isLocal: true,
      ...overrides,
    };
  }

  it('renders archive_note_locked («Заметка заперта») when _locked: true', () => {
    const session = makeSession({ _locked: true, content: '' });
    renderWithProviders(<OnThisDayCard sessions={[session]} onOpen={vi.fn()} />);

    expect(screen.getByText(/Заметка заперта|archive_note_locked/)).toBeInTheDocument();
  });

  it('renders archive_no_content («Содержимое недоступно») when _contentNotLoaded: true', () => {
    const session = makeSession({ _contentNotLoaded: true, content: '' });
    renderWithProviders(<OnThisDayCard sessions={[session]} onOpen={vi.fn()} />);

    expect(screen.getByText(/Содержимое недоступно|archive_no_content/)).toBeInTheDocument();
  });

  it('renders trimmed content excerpt when session has readable text', () => {
    const session = makeSession({
      content: 'Утренний чай с лимоном и размышления о планах на лето.',
    });
    renderWithProviders(<OnThisDayCard sessions={[session]} onOpen={vi.fn()} />);

    expect(
      screen.getByText('Утренний чай с лимоном и размышления о планах на лето.')
    ).toBeInTheDocument();
  });
});
