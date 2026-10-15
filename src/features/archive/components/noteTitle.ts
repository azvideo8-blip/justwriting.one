import { isBlankTitle } from '../../../shared/utils/titleUtils';

/** Десктопная строка: своё название, а без него — первая непустая строка. */
export function deriveNoteTitle(title: string | undefined | null, content: string | undefined | null): string | null {
  const own = title?.trim();
  if (own && !isBlankTitle(own)) return own;
  return content?.split('\n').map(l => l.trim()).find(l => !isBlankTitle(l)) ?? null;
}

/** Телефон (MF-12/MF-16): название — своё или первое предложение первой
 *  строки; превью начинается после выведенного названия, текст из одного
 *  предложения превью не даёт. Один источник для строки, карточки и шапки
 *  листа действий. */
export function splitNoteTitle(title: string | undefined | null, content: string | undefined | null): { title: string | null; preview: string } {
  const body = content ?? '';
  const own = title?.trim();
  if (own && !isBlankTitle(own)) return { title: own, preview: body };
  const start = body.search(/\S/);
  if (start < 0) return { title: null, preview: '' };
  const lineEnd = body.indexOf('\n', start);
  const line = body.slice(start, lineEnd < 0 ? undefined : lineEnd);
  const sentence = line.match(/^.*?[.!?…]+(?=\s|$)/u)?.[0] ?? line;
  return { title: sentence.trim(), preview: body.slice(start + sentence.length).trim() };
}
