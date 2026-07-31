export const SEARCH_MARKER_RE = /\[\[ПОИСК:\s*([^\]]+?)\]\]/gi;
export const CITATION_RE = /\[\[ПОИСК:\s*([^\]]+?)\]\]|\[#?([a-zA-Z0-9_-]+)\]/gi;

export function isRecognisedCitation(rawMatch: string, id: string, injectedIds?: Set<string>): boolean {
  if (rawMatch.toLowerCase().startsWith('[[поиск:')) return false; // Always strip the search marker from text
  if (injectedIds && injectedIds.has(id)) return true;
  if (id.startsWith('local_')) return true;
  if (rawMatch.startsWith('[#')) return true;
  return false;
}

export function extractSearchRequest(text: string): string | null {
  SEARCH_MARKER_RE.lastIndex = 0;
  const match = SEARCH_MARKER_RE.exec(text);
  return match ? match[1]!.trim() : null;
}
