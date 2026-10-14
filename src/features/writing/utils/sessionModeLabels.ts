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
