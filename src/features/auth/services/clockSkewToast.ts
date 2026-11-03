/**
 * Как показать расхождение человеку: единицу выбираем здесь, а текст единицы —
 * перевод (в русском «2 ч», в английском «2 h»). Порог в 5 минут означает, что
 * секунд здесь не бывает: меньше порога мы не показываем.
 */
export function clockSkewParts(sec: number | null): { unit: 'hours' | 'minutes'; value: number } | null {
  if (sec === null) return null;
  const abs = Math.abs(sec);
  const hours = Math.round(abs / 3600);
  if (abs >= 2 * 3600) return { unit: 'hours', value: Math.max(1, hours) };
  return { unit: 'minutes', value: Math.max(1, Math.round(abs / 60)) };
}

type ShowToast = (message: string, type: 'warning') => void;
type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * CK-2/CK-3: тост про часы. Отдельный модуль грузится по требованию — у почти
 * всех людей часы в порядке, и стартовому чанку этот код не нужен (бюджет ci.yml).
 */
export function showClockSkewToast(showToast: ShowToast, t: T, skewSec: number | null, signInAgain: boolean): void {
  const parts = clockSkewParts(skewSec);
  if (!parts) {
    if (signInAgain) showToast(t('auth_clock_skew_sign_in_again'), 'warning');
    return;
  }
  const duration = t(parts.unit === 'hours' ? 'auth_clock_skew_hours' : 'auth_clock_skew_minutes', { count: parts.value });
  const notice = t('auth_clock_skew_notice', { duration });
  showToast(signInAgain ? `${notice} ${t('auth_clock_skew_sign_in_again')}` : notice, 'warning');
}
