import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
// 0.10.0: макет открыт всем; D-15 проверяет аварийный режим (флажок false).
vi.mock('../mobileLayoutFlag', () => ({ MOBILE_LAYOUT_ENABLED: false }));
import { useLayoutMode } from '../useLayoutMode';
import { useLayoutKeyboardShortcut } from '../../../app/useLayoutKeyboardShortcut';

describe('D-15: useLayoutMode and mobile layout disabled enforcement', () => {
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

  it('should preserve mobile in localStorage but enforce desktop in layoutMode (D-15)', () => {
    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setLayoutMode('mobile');
    });
    // Stored in localStorage for when mobile is eventually re-enabled
    expect(localStorage.getItem('layout-mode-v4')).toBe('"mobile"');
    // But returns desktop while mobile layout is disabled
    expect(result.current.layoutMode).toBe('desktop');
  });

  it('should ignore stored mobile in localStorage without deleting it (D-15)', () => {
    localStorage.setItem('layout-mode-v4', '"mobile"');
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('desktop');
    expect(localStorage.getItem('layout-mode-v4')).toBe('"mobile"');
  });

  it('should ignore stale layout-mode key from pre-v3 (defaults to desktop)', () => {
    localStorage.setItem('layout-mode', '"mobile"');
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('desktop');
  });

  it('useLayoutKeyboardShortcut should be a no-op while mobile is disabled (D-15)', () => {
    renderHook(() => useLayoutKeyboardShortcut());
    const ev = new KeyboardEvent('keydown', {
      code: 'KeyM',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);

    expect(localStorage.getItem('layout-mode-v4')).toBeNull();
  });
});
