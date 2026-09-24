import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { useState } from 'react';
import { ThemeProvider, useTheme } from '../../core/theme/ThemeProvider';
import { AnalyticsProvider, useAnalytics } from '../../features/auth/contexts/AnalyticsContext';
import { LoginModalProvider, useLoginModal } from '../../features/auth/contexts/LoginModalContext';

describe('Context value memoization tests (AU-6)', () => {
  it('ThemeProvider memoizes context value when state does not change', () => {
    let triggerRerender: () => void = () => {};
    function Wrapper({ children }: { children: React.ReactNode }) {
      const [, setTick] = useState(0);
      triggerRerender = () => setTick(t => t + 1);
      return <ThemeProvider>{children}</ThemeProvider>;
    }

    const { result, rerender } = renderHook(() => useTheme(), { wrapper: Wrapper });
    const firstValue = result.current;

    rerender();
    act(() => {
      triggerRerender();
    });
    rerender();

    expect(result.current).toBe(firstValue);
  });

  it('AnalyticsProvider memoizes context value when isConnected does not change', () => {
    let triggerRerender: () => void = () => {};
    function Wrapper({ children }: { children: React.ReactNode }) {
      const [, setTick] = useState(0);
      triggerRerender = () => setTick(t => t + 1);
      return <AnalyticsProvider>{children}</AnalyticsProvider>;
    }

    const { result, rerender } = renderHook(() => useAnalytics(), { wrapper: Wrapper });
    const firstValue = result.current;

    rerender();
    act(() => {
      triggerRerender();
    });
    rerender();

    expect(result.current).toBe(firstValue);
  });

  it('LoginModalProvider memoizes context value when modal state does not change', () => {
    let triggerRerender: () => void = () => {};
    function Wrapper({ children }: { children: React.ReactNode }) {
      const [, setTick] = useState(0);
      triggerRerender = () => setTick(t => t + 1);
      return <LoginModalProvider>{children}</LoginModalProvider>;
    }

    const { result, rerender } = renderHook(() => useLoginModal(), { wrapper: Wrapper });
    const firstValue = result.current;

    rerender();
    act(() => {
      triggerRerender();
    });
    rerender();

    expect(result.current).toBe(firstValue);
  });
});
