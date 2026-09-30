import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '../index';

// R4-022: модовые 1/2/5 уже покрыты в profileStreakPlurals; 11–14 и 21–22 —
// классические ловушки русской плюрализации (mod100 против mod10).
describe('ru plurals at 11–14 and 21–22 (R4-022)', () => {
  localStorage.setItem('language', 'ru');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <LanguageProvider>{children}</LanguageProvider>
  );

  it.each([
    [11, 'дней'],
    [12, 'дней'],
    [14, 'дней'],
    [21, 'день'],
    [22, 'дня'],
  ])('tp(home_streak_days, %i) → %s', (count, expected) => {
    const { result } = renderHook(() => useLanguage().tp, { wrapper });
    expect(result.current('home_streak_days', count)).toBe(expected);
  });
});
