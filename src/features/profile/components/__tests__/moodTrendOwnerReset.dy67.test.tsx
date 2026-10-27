import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MoodTrend } from '../MoodTrend';

// DY6-7 (приёмка 26.10, Н-5): при `userId=''` эффект MoodTrend выходил молча,
// и прежний тренд оставался на экране. Тот же класс, что BR-13/BR-15 закрыли
// на «В этот день» и «Продолжить»: состояние живёт с ключом владельца.

const mocks = vi.hoisted(() => ({ getDocumentsByOwner: vi.fn() }));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocumentsByOwner: mocks.getDocumentsByOwner },
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => `«${k}»`, language: 'ru', setLanguage: () => {}, tp: (k: string) => k }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

function moodDoc(id: string) {
  return {
    id, guestId: 'A', title: id, currentVersion: 1, totalWords: 5, totalDuration: 30,
    sessionsCount: 1, firstSessionAt: Date.now() - 86_400_000, lastSessionAt: Date.now() - 86_400_000,
    tags: [], mood: '😊',
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('DY6-7: MoodTrend сбрасывается на пустом владельце', () => {
  it('пустой userId — карточки тренда нет, прежние эмодзи не остались', async () => {
    mocks.getDocumentsByOwner.mockResolvedValue([moodDoc('m1')]);
    const { container, rerender } = render(<MoodTrend userId="A" />);
    await waitFor(() => expect(container.textContent).toContain('«profile_mood_title»'));

    rerender(<MoodTrend userId="" />);
    await waitFor(() => expect(container.textContent).not.toContain('«profile_mood_title»'));
    expect(mocks.getDocumentsByOwner).not.toHaveBeenCalledWith('');
  });
});
