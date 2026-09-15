import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Archive search / shortcut logic', () => {
  let focusCalled = false;
  let selectCalled = false;

  const mockInput = {
    focus: () => { focusCalled = true; },
    select: () => { selectCalled = true; },
  };

  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      mockInput.focus();
      mockInput.select();
    } else if (
      e.key === '/' &&
      !e.metaKey && !e.ctrlKey && !e.altKey &&
      !(document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) &&
      !(document.activeElement as HTMLElement | null)?.isContentEditable
    ) {
      e.preventDefault();
      mockInput.focus();
      mockInput.select();
    }
  };

  beforeEach(() => {
    focusCalled = false;
    selectCalled = false;
    document.addEventListener('keydown', handler);
  });

  afterEach(() => {
    document.removeEventListener('keydown', handler);
  });

  it('triggers search focus and select on "/" when focus is on body', () => {
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(focusCalled).toBe(true);
    expect(selectCalled).toBe(true);
  });

  it('does not intercept "/" when focus is inside an input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(focusCalled).toBe(false);
    input.remove();
  });

  it('does not trigger search when modifier keys are pressed with "/"', () => {
    const event = new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(focusCalled).toBe(false);
  });
});
