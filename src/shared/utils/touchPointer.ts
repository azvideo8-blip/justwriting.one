/**
 * Есть ли у устройства только палец. Нужен для строк про мышь: на телефоне,
 * который получает десктопный макет (все, кому мобильный ещё не открыт — MB-1),
 * «двигай мышь» обманывает человека.
 */
export function hasOnlyTouchPointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches === true;
}
