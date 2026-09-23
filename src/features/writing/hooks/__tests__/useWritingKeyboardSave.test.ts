// D-9: Ctrl/⌘+S обещана в «Горячих клавишах» как «Сохранить», но раньше
// делала preventDefault только вне поля ввода и не открывала окно завершения.
// Теперь клавиша вызывает тот же обработчик, что кнопка «Сохранить» в шапке,
// в том числе когда фокус в textarea.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useWritingKeyboard } from '../useWritingKeyboard';

function setup(status = 'writing') {
  const finishCalls: number[] = [];
  const playCalls: number[] = [];
  const pauseCalls: number[] = [];
  const utils = renderHook(() => {
    const handleFinishRef = useRef<(() => void) | null>(null);
    const handlePlayRef = useRef<(() => void) | null>(null);
    const handlePauseRef = useRef<(() => void) | null>(null);
    const toggleShortcutsRef = useRef<(() => void) | null>(null);
    handleFinishRef.current = () => { finishCalls.push(1); };
    handlePlayRef.current = () => { playCalls.push(1); };
    handlePauseRef.current = () => { pauseCalls.push(1); };
    useWritingKeyboard({ sessionStatus: status, handlePlayRef, handlePauseRef, handleFinishRef, toggleShortcutsRef });
  });
  return { utils, finishCalls, playCalls, pauseCalls };
}

function pressS(target: HTMLElement, viaMeta = false) {
  const ev = new KeyboardEvent('keydown', {
    key: 's',
    ctrlKey: !viaMeta,
    metaKey: viaMeta,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(ev);
  return ev;
}

describe('useWritingKeyboard: Ctrl/⌘+S (D-9)', () => {
  it('opens the finish flow when focus is in the editor (textarea)', () => {
    const { utils, finishCalls } = setup('writing');
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    const ev = pressS(ta);
    expect(finishCalls).toHaveLength(1);
    expect(ev.defaultPrevented).toBe(true);
    utils.unmount();
    ta.remove();
  });

  it('works with Cmd on macOS and outside any field', () => {
    const { utils, finishCalls } = setup('paused');
    const ev = pressS(document.body, true);
    expect(finishCalls).toHaveLength(1);
    expect(ev.defaultPrevented).toBe(true);
    utils.unmount();
  });
});
