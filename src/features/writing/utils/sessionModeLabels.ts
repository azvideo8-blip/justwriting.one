import type { SessionType } from '../store/types';

/** Подпись режима сессии — i18n-ключ. Общий для токена в шапке письма и для
 *  левого ячейка панели (MC-1): две поверхности не могут разойтись по названию. */
export const MODE_LABEL: Record<SessionType, string> = {
  free: 'writing_mode_flow',
  stopwatch: 'writing_mode_flow',
  timer: 'writing_mode_timer',
  words: 'writing_mode_words',
  'finish-by': 'writing_mode_deadline',
};

/**
 * MF-19 (SA-5): что показывают часы сессии. Обратный отсчёт — только в «По
 * таймеру» и «Закончить до…»; в свободном потоке и цели по словам время идёт
 * вперёд. `timerDuration` по умолчанию 30 мин стоит в сторе в любом режиме,
 * поэтому само число режимом не считается.
 */
export function sessionClockSeconds(sessionType: SessionType, timerDuration: number, sessionSeconds: number): number {
  const countsDown = (sessionType === 'timer' || sessionType === 'finish-by') && timerDuration > 0;
  return countsDown ? Math.max(0, timerDuration - sessionSeconds) : sessionSeconds;
}
