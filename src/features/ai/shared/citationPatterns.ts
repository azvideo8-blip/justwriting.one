export const SEARCH_MARKER_RE = /\[\[ПОИСК:\s*([^\]]+?)\]\]/gi;
export const CITATION_RE = /\[\[ПОИСК:\s*([^\]]+?)\]\]|\[#?([a-zA-Z0-9_-]+)\]/gi;

/**
 * Two stages ask this, and they have different authorities.
 *
 * **Sanitising** passes `injectedIds`: the notes actually put in front of the
 * model this turn. That set is the whole answer — a citation the model invented
 * must not survive merely because it is shaped like one. Trusting the `[#`
 * prefix here would make the check meaningless, since `[#` is what the model
 * writes; an id absent from the prompt would render as a real, clickable
 * citation, which is worse than the raw id it replaced: a fabricated source
 * becomes indistinguishable from a real one.
 *
 * **Rendering** passes nothing: sanitising has already run, so anything still
 * carrying `[#` was vouched for upstream.
 */
export function isRecognisedCitation(rawMatch: string, id: string, injectedIds?: Set<string>): boolean {
  if (rawMatch.toLowerCase().startsWith('[[поиск:')) return false; // the search marker is never shown
  if (injectedIds) return injectedIds.has(id);
  return rawMatch.startsWith('[#') || id.startsWith('local_');
}

export function extractSearchRequest(text: string): string | null {
  SEARCH_MARKER_RE.lastIndex = 0;
  const match = SEARCH_MARKER_RE.exec(text);
  return match ? match[1]!.trim() : null;
}
