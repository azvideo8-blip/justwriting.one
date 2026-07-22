/**
 * Smart Russian typography substitution function.
 * Transforms raw typed text according to Russian rules:
 * - Straight quotes (") -> Guillemets (« ») based on context
 * - Double dash (--) -> Em-dash (—)
 * - Triple dot (...) -> Ellipsis (…)
 * - Space-dash-space (" - ") -> Space-em-dash-space (" — ")
 */
export function formatRussianTypography(
  text: string,
  cursorPos: number
): { text: string; newCursorPos: number } {
  if (!text) return { text, newCursorPos: cursorPos };

  let result = text;
  let newCursor = cursorPos;

  // 1. Triple dot -> Ellipsis (...) -> …
  let idx = 0;
  while ((idx = result.indexOf('...', idx)) !== -1) {
    result = result.slice(0, idx) + '…' + result.slice(idx + 3);
    if (cursorPos > idx) {
      newCursor -= 2;
    }
    idx += 1;
  }

  // 2. Double dash -> Em-dash (--) -> —
  idx = 0;
  while ((idx = result.indexOf('--', idx)) !== -1) {
    result = result.slice(0, idx) + '—' + result.slice(idx + 2);
    if (cursorPos > idx) {
      newCursor -= 1;
    }
    idx += 1;
  }

  // 3. Space-dash-space (" - ") -> " — "
  idx = 0;
  while ((idx = result.indexOf(' - ', idx)) !== -1) {
    result = result.slice(0, idx) + ' — ' + result.slice(idx + 3);
    idx += 3;
  }

  // 4. Smart quotes "..." -> «...»
  let quoteIdx = 0;
  while ((quoteIdx = result.indexOf('"', quoteIdx)) !== -1) {
    const prevChar = quoteIdx > 0 ? (result[quoteIdx - 1] ?? '') : '';
    const isOpen = quoteIdx === 0 || /[\s([{<«—]/.test(prevChar);
    const replacement = isOpen ? '«' : '»';
    result = result.slice(0, quoteIdx) + replacement + result.slice(quoteIdx + 1);
    quoteIdx += 1;
  }

  return { text: result, newCursorPos: Math.max(0, Math.min(newCursor, result.length)) };
}
