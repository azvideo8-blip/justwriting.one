// A-3/A-4: длины в полях считались в UTF-16 code units, и `slice` на границе
// разрезал эмодзи на одиночный суррогат. Считаем и режем по графемам: человек
// видит один эмодзи — один символ, а составные (ZWJ, флаги) остаются целыми.
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

export function textUnits(text: string): string[] {
  if (!text) return [];
  if (segmenter) return Array.from(segmenter.segment(text), part => part.segment);
  // Нет Segmenter — хотя бы не режем суррогатную пару пополам.
  return Array.from(text);
}

export function textLength(text: string): number {
  return textUnits(text).length;
}

/** `maxCodeUnits` — для полей, чей предел сервер считает в UTF-16 (`zod max`):
 *  графемы добавляются целиком, пока строка в него влезает. */
export function truncateText(text: string, max: number, opts?: { maxCodeUnits?: number }): string {
  if (max <= 0) return '';
  const units = textUnits(text).slice(0, max);
  const cap = opts?.maxCodeUnits;
  if (cap === undefined) return units.join('');
  let out = '';
  for (const u of units) {
    if (out.length + u.length > cap) break;
    out += u;
  }
  return out;
}

export function firstTextUnit(text: string): string {
  return textUnits(text)[0] ?? '';
}
