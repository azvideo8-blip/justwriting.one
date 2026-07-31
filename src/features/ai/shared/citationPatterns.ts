export const SEARCH_MARKER_RE = /\[\[ПОИСК:\s*([^\]]+?)\]\]/gi;

// Document ids are not all `local_<uuid>`: imported notes are keyed by their
// source timestamp, e.g. `1720194283.716586`. Without the dot those citations
// matched nothing at all — neither cleaned up nor turned into a chip — so the
// raw id was printed into the reply as text. The 8-character minimum keeps
// ordinary bracketed numbers like [1.5] from being mistaken for an id.
export const CITATION_RE = /\[\[ПОИСК:\s*([^\]]+?)\]\]|\[#?((?:[a-zA-Z0-9_.-]{8,}|[a-zA-Z0-9_-]+))\]/gi;

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

// The prompt used to show the marker with a placeholder query, and the model
// copied it verbatim — producing a chip that offered to search for the words
// "краткий запрос". A placeholder is not a query.
const MARKER_PLACEHOLDERS = new Set(['краткий запрос', 'запрос', 'query', 'краткий запрос сюда']);

export function extractSearchRequest(text: string): string | null {
  SEARCH_MARKER_RE.lastIndex = 0;
  const match = SEARCH_MARKER_RE.exec(text);
  if (!match) return null;
  const query = match[1]!.trim();
  if (!query || MARKER_PLACEHOLDERS.has(query.toLowerCase())) return null;
  return query;
}
