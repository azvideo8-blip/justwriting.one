/**
 * Registry for checking the active editor's currently open document ID
 * without creating cross-boundary imports between core and features.
 */
let _activeEditorDocIdGetter: (() => string | null) | null = null;

export function registerActiveEditorDocIdGetter(getter: (() => string | null) | null): void {
  _activeEditorDocIdGetter = getter;
}

export function getActiveEditorDocumentId(): string | null {
  return _activeEditorDocIdGetter ? _activeEditorDocIdGetter() : null;
}
