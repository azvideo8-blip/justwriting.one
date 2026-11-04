// Дейлик 04.11 Н-3: лента под числом серии красит и день, поставленный заметке вручную.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n: number) => `${n} ${k}`, language: 'ru' }),
}));
vi.mock('../../../../shared/hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

import { StreakRibbon } from '../StreakRibbon';
import type { Session } from '../../../../shared/types/common';

describe('Н-3: лента серии', () => {
  it('день подхода и день, поставленный заметке, — оба с записью', () => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const earlier = new Date(today); earlier.setDate(today.getDate() - 3);
    const session = {
      userId: 'u1', content: 'x', duration: 1, charCount: 0, wpm: 0, wordCount: 5,
      createdAt: today, sessionStartTime: today.getTime(),
      sittings: [{ savedAt: earlier.getTime(), wordsAdded: 5 }],
    } as unknown as Session;
    const { container } = render(<StreakRibbon sessions={[session]} />);
    const withEntry = container.querySelectorAll('.bg-\\[var\\(--text-subtle\\)\\], .bg-\\[var\\(--flow-pulse-color\\)\\]');
    expect(withEntry).toHaveLength(2);
  });
});
