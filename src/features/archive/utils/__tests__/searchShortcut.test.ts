import { describe, it, expect } from 'vitest';
import { isSearchShortcut } from '../searchShortcut';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('isSearchShortcut', () => {
  it('accepts ⌘K / Ctrl+K regardless of focus', () => {
    const input = document.createElement('input');
    expect(isSearchShortcut(key({ key: 'k', metaKey: true }), input)).toBe(true);
    expect(isSearchShortcut(key({ key: 'k', ctrlKey: true }), null)).toBe(true);
  });

  it('accepts a bare slash when focus is on the body', () => {
    expect(isSearchShortcut(key({ key: '/' }), document.body)).toBe(true);
    expect(isSearchShortcut(key({ key: '/' }), null)).toBe(true);
  });

  it('rejects slash inside inputs, textareas and contenteditable', () => {
    expect(isSearchShortcut(key({ key: '/' }), document.createElement('input'))).toBe(false);
    expect(isSearchShortcut(key({ key: '/' }), document.createElement('textarea'))).toBe(false);
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isSearchShortcut(key({ key: '/' }), editable)).toBe(false);
  });

  it('rejects slash with modifiers', () => {
    expect(isSearchShortcut(key({ key: '/', ctrlKey: true }), null)).toBe(false);
    expect(isSearchShortcut(key({ key: '/', altKey: true }), null)).toBe(false);
  });
});
