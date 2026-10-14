// MC-3 §7: стрик в окне завершения склоняется. ⊕ десктоп — только строки.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LanguageProvider, useLanguage } from '../../../../shared/i18n';

const wrapper = ({ children }: { children: ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

describe('MC-3: склонение серии в «Записано.»', () => {
  it('русская форма согласуется с числом', () => {
    const { result } = renderHook(() => useLanguage(), { wrapper });
    const tp = result.current.tp;
    expect(tp('finish_streak_days', 1)).toBe('1 день подряд');
    expect(tp('finish_streak_days', 2)).toBe('2 дня подряд');
    expect(tp('finish_streak_days', 5)).toBe('5 дней подряд');
    expect(tp('finish_streak_days', 21)).toBe('21 день подряд');
    expect(tp('finish_streak_days', 111)).toBe('111 дней подряд');
  });
});
