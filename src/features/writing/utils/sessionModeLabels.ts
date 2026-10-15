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
 * MF-19 (SA-5) / SP-D1: идёт ли часы сессии вниз. Обратный отсчёт — только в
 * «По таймеру» и «Закончить до…»; в свободном потоке и цели по словам время идёт
 * вперёд. `timerDuration` по умолчанию 30 мин стоит в сторе в любом режиме,
 * поэтому само число режимом не считается. На десктопе сессия всегда 'free'
 * (D-10): там цель по времени — это явный выбор в нижней панели
 * (`timeGoalExplicit`); телефон его не передаёт и ведёт себя как в MF-19.
 */
export function timeGoalCountsDown(sessionType: SessionType, timerDuration: number, timeGoalExplicit = false): boolean {
  if (timerDuration <= 0) return false;
  return sessionType === 'timer' || sessionType === 'finish-by' || (sessionType === 'free' && timeGoalExplicit);
}

export function sessionClockSeconds(
  sessionType: SessionType,
  timerDuration: number,
  sessionSeconds: number,
  timeGoalExplicit = false,
): number {
  return timeGoalCountsDown(sessionType, timerDuration, timeGoalExplicit)
    ? Math.max(0, timerDuration - sessionSeconds)
    : sessionSeconds;
}
