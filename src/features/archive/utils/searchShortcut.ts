// Archive search hotkeys: ⌘K/Ctrl+K anywhere, `/` only when nothing editable
// has focus (so typing a slash into a tag rename still works).
export function isSearchShortcut(e: KeyboardEvent, active: Element | null): boolean {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') return true;
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (!active) return true;
  if (['INPUT', 'TEXTAREA'].includes(active.tagName)) return false;
  return !(active as HTMLElement).isContentEditable;
}
