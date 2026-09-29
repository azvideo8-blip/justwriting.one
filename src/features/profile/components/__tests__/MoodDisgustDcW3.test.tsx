// DC-W3: в выборе настроения 😖 сменил 🤢. Старые заметки с 🤢 уже лежат в
// облаке, поэтому они должны остаться валидными и попасть в тренд тем же
// «Отвращением», а не исчезнуть из него.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MoodTrend } from '../MoodTrend';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { VALID_MOOD_EMOJIS, isKnownMoodEmoji } from '../../../../core/crypto/cryptoHelpers';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocumentsByOwner: vi.fn() },
}));

const mockGetDocs = vi.mocked(LocalDocumentService.getDocumentsByOwner);

describe('DC-W3: отвращение — 😖 вместо 🤢 без потери старых данных', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('🤢 и 😖 оба проходят проверку сохранённого настроения', () => {
    expect(isKnownMoodEmoji('🤢')).toBe(true);
    expect(isKnownMoodEmoji('😖')).toBe(true);
    expect(VALID_MOOD_EMOJIS.has('😖')).toBe(true);
  });

  it('заметка с 🤢 считается в тренде как 😖', async () => {
    mockGetDocs.mockResolvedValue([
      { id: 'a', mood: '🤢', lastSessionAt: Date.now() },
      { id: 'b', mood: '😖', lastSessionAt: Date.now() - 86_400_000 },
    ] as never);

    render(<MoodTrend userId="u1" />);

    await waitFor(() => expect(screen.getAllByText('😖').length).toBeGreaterThan(0));
    expect(screen.queryByText('🤢')).toBeNull();
    // Оба значения свернуты в одну строку распределения: счётчик = 2.
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
