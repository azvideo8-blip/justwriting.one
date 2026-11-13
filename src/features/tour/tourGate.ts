import type { TourStateRead } from './tourState';

/**
 * TR-1: можно ли знакомству стартовать самому. Чистая функция: все значения
 * собирает вызывающий. Каждое условие — положительное подтверждение. «Нет
 * ответа» (профиль не прочитан, заметки не посчитаны, хранилище молчит) — это
 * `wait`, а не «окна не нужны»: иначе тур встанет поверх окна первого входа.
 */
export interface TourGateInput {
  signedIn: boolean;
  isGuest: boolean;
  path: string;
  tourState: TourStateRead;
  /** Кэш `privacy_accepted_<uid>` равен текущей версии политики. */
  privacyConfirmed: boolean;
  /** На вопрос о синхронизации ответили (есть запись, любой ответ). */
  syncAnswered: boolean;
  recoveryCodePending: boolean;
  /** `EarlierQuestionOpenContext`: открыт вопрос первого входа или оболочка ещё не выбрана. */
  queued: boolean;
  /** Сколько мс подряд на экране нет ни окна, ни степпера. */
  dialogQuietMs: number;
  /** Заметок на устройстве; `null` — посчитать не удалось. */
  noteCount: number | null;
  /** Заметок в облаке; `null` — ещё не прочитано или чтение упало. Старый
   *  человек на новом устройстве: на устройстве пусто, а окно «восстановить из
   *  облака» приходит позже — без этого тур мелькнул бы перед ним. */
  cloudCount: number | null;
  editorEmpty: boolean;
  sessionIdle: boolean;
}

export const TOUR_QUIET_MS = 1500;

export function canAutoStart(i: TourGateInput): 'start' | 'wait' | 'never' {
  if (!i.signedIn || i.isGuest) return 'never';
  if (i.tourState !== null && i.tourState !== 'unknown') return 'never';
  if (i.noteCount !== null && i.noteCount > 0) return 'never';
  if (i.cloudCount !== null && i.cloudCount > 0) return 'never';
  return (
    i.path === '/' &&
    i.tourState === null &&
    i.privacyConfirmed &&
    i.syncAnswered &&
    !i.recoveryCodePending &&
    !i.queued &&
    i.dialogQuietMs >= TOUR_QUIET_MS &&
    i.noteCount === 0 &&
    i.cloudCount === 0 &&
    i.editorEmpty &&
    i.sessionIdle
  ) ? 'start' : 'wait';
}
