// Ревью 0.11.24, N-4: showToast принимает длительность; без неё — прежние 3 с.
// Мутация: таймер всегда 3000 — тост с durationMs исчезает через 3 с, красный.
// motion подменён простыми элементами: в jsdom анимация ухода не завершается,
// и уходящий тост висел бы в DOM — проверка присутствия ничего бы не значила.
import { type ReactNode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: { div: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div> },
}));

import { ToastProvider, useToast } from '../Toast';

function Fire({ durationMs }: { durationMs?: number }) {
  const { showToast } = useToast();
  return <button type="button" onClick={() => showToast('synthetic toast', 'error', undefined, durationMs ? { durationMs } : undefined)}>fire</button>;
}

afterEach(() => { vi.useRealTimers(); });

describe('Toast: длительность', () => {
  it('без durationMs — уходит через 3 с', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Fire /></ToastProvider>);
    act(() => { screen.getByText('fire').click(); });
    expect(screen.queryByText('synthetic toast')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(3_100); });
    expect(screen.queryByText('synthetic toast')).toBeNull();
  });

  it('durationMs 60 с — через 10 с на месте, через 61 с нет', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Fire durationMs={60_000} /></ToastProvider>);
    act(() => { screen.getByText('fire').click(); });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByText('synthetic toast')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(51_000); });
    expect(screen.queryByText('synthetic toast')).toBeNull();
  });
});
