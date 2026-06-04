import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLayoutMode } from '../useLayoutMode';

// Layout mode is MANUAL-ONLY — no auto-detection from viewport or media queries.
// These tests verify the manual behaviour after the revert from auto-detection.
describe('useLayoutMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should initialize with desktop by default regardless of viewport', () => {
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('desktop');
  });

  it('should provide a setLayoutMode function', () => {
    const { result } = renderHook(() => useLayoutMode());
    expect(typeof result.current.setLayoutMode).toBe('function');
  });

  it('should switch to mobile when setLayoutMode is called', () => {
    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setLayoutMode('mobile');
    });
    expect(result.current.layoutMode).toBe('mobile');
  });

  it('should persist layoutMode to localStorage under the v3 key', () => {
    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setLayoutMode('mobile');
    });
    expect(localStorage.getItem('layout-mode-v3')).toBe('"mobile"');
  });

  it('should read layoutMode from localStorage v3 key on init', () => {
    localStorage.setItem('layout-mode-v3', '"mobile"');
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('mobile');
  });

  it('should ignore stale layout-mode key from pre-v3 (defaults to desktop)', () => {
    // Simulate a user stuck in mobile from the old auto-detection key
    localStorage.setItem('layout-mode', '"mobile"');
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('desktop');
  });

  it('should switch back to desktop when setLayoutMode is called with desktop', () => {
    localStorage.setItem('layout-mode-v3', '"mobile"');
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('mobile');
    act(() => {
      result.current.setLayoutMode('desktop');
    });
    expect(result.current.layoutMode).toBe('desktop');
  });
});
