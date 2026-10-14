// T-6: первый символ начинает сессию — один закон для телефона и десктопа.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useStartOnFirstInput } from '../useStartOnFirstInput';

function setup(status: string) {
  const played = vi.fn();
  const { result } = renderHook(() => {
    const play = useRef(() => played());
    return useStartOnFirstInput({ status, play });
  });
  return { result, played };
}

describe('useStartOnFirstInput', () => {
  it('idle + печатная клавиша → старт', () => {
    const { result, played } = setup('idle');
    result.current.handleEditorKeyDown({ key: 'а', metaKey: false, ctrlKey: false, altKey: false });
    expect(played).toHaveBeenCalledTimes(1);
  });

  it('служебная клавиша (Backspace) не стартует', () => {
    const { result, played } = setup('idle');
    result.current.handleEditorKeyDown({ key: 'Backspace', metaKey: false, ctrlKey: false, altKey: false });
    expect(played).not.toHaveBeenCalled();
  });

  it('комбо с мета-клавишей не стартует', () => {
    const { result, played } = setup('idle');
    result.current.handleEditorKeyDown({ key: 's', metaKey: true, ctrlKey: false, altKey: false });
    expect(played).not.toHaveBeenCalled();
  });

  it('ввод текста в paused тоже стартует', () => {
    const { result, played } = setup('paused');
    result.current.handleEditorInput({ target: { value: 'текст' } as unknown as EventTarget });
    expect(played).toHaveBeenCalledTimes(1);
  });

  it('в writing-состоянии ничего не вызывается', () => {
    const { result, played } = setup('writing');
    result.current.handleEditorKeyDown({ key: 'а', metaKey: false, ctrlKey: false, altKey: false });
    result.current.handleEditorInput({ target: { value: 'текст' } as unknown as EventTarget });
    expect(played).not.toHaveBeenCalled();
  });
});
