import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useWritingKeyboard } from '../useWritingKeyboard';

function setupKeyboard(status = 'writing') {
  const finishCalls: number[] = [];
  const playCalls: number[] = [];
  const pauseCalls: number[] = [];
  const shortcutsCalls: number[] = [];

  const utils = renderHook(() => {
    const handleFinishRef = useRef<(() => void) | null>(null);
    const handlePlayRef = useRef<(() => void) | null>(null);
    const handlePauseRef = useRef<(() => void) | null>(null);
    const toggleShortcutsRef = useRef<(() => void) | null>(null);

    handleFinishRef.current = () => { finishCalls.push(1); };
    handlePlayRef.current = () => { playCalls.push(1); };
    handlePauseRef.current = () => { pauseCalls.push(1); };
    toggleShortcutsRef.current = () => { shortcutsCalls.push(1); };

    useWritingKeyboard({
      sessionStatus: status,
      handlePlayRef,
      handlePauseRef,
      handleFinishRef,
      toggleShortcutsRef,
    });
  });

  return { utils, finishCalls, playCalls, pauseCalls, shortcutsCalls };
}

describe('FU-3: Keyboard shortcuts with Russian layout', () => {
  it('triggers finish/save with Ctrl+S in Russian layout (key: "ы", code: "KeyS")', () => {
    const { utils, finishCalls } = setupKeyboard('writing');
    const ev = new KeyboardEvent('keydown', {
      key: 'ы',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);

    expect(finishCalls).toHaveLength(1);
    expect(ev.defaultPrevented).toBe(true);
    utils.unmount();
  });

  it('triggers finish/save with ⌘+S in Russian layout (key: "Ы", code: "KeyS")', () => {
    const { utils, finishCalls } = setupKeyboard('paused');
    const ev = new KeyboardEvent('keydown', {
      key: 'Ы',
      code: 'KeyS',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);

    expect(finishCalls).toHaveLength(1);
    expect(ev.defaultPrevented).toBe(true);
    utils.unmount();
  });

  it('triggers pause/play with ⌘+P in Russian layout (key: "з", code: "KeyP")', () => {
    const { utils: u1, pauseCalls } = setupKeyboard('writing');
    const evPause = new KeyboardEvent('keydown', {
      key: 'з',
      code: 'KeyP',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(evPause);
    expect(pauseCalls).toHaveLength(1);
    expect(evPause.defaultPrevented).toBe(true);
    u1.unmount();

    const { utils: u2, playCalls } = setupKeyboard('paused');
    const evPlay = new KeyboardEvent('keydown', {
      key: 'з',
      code: 'KeyP',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(evPlay);
    expect(playCalls).toHaveLength(1);
    expect(evPlay.defaultPrevented).toBe(true);
    u2.unmount();
  });

  it('triggers shortcuts modal with ⌘+/ in Russian layout (key: ".", code: "Slash")', () => {
    const { utils, shortcutsCalls } = setupKeyboard('writing');
    const ev = new KeyboardEvent('keydown', {
      key: '.',
      code: 'Slash',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);

    expect(shortcutsCalls).toHaveLength(1);
    expect(ev.defaultPrevented).toBe(true);
    utils.unmount();
  });
});
