/**
 * MC-6: чем заменять стек окон первого входа на телефоне.
 *
 * Право на мобильный макет даёт база, и ответ приходит уже после входа. Пока
 * ответа нет, человек на телефоне увидел бы десктопные окна, а через секунду —
 * степпер: окна не должны успевать мелькнуть. Поэтому решение трёхзначное, а
 * «неизвестно» держится ограниченное время — `FIRST_RUN_ACCESS_WAIT_MS`.
 */
export type FirstRunShell = 'hold' | 'dialogs' | 'stepper';

export const FIRST_RUN_ACCESS_WAIT_MS = 3000;

// Рубильник степпера. В ревью 0.9.40 он был выключен: шаг «Облако» зацикливался,
// затирал выбор синхронизации, код восстановления мог проскочить. Исправлено в
// `FirstRunFlow` (очередь пройденных шагов, «Облако» только до ответа о синхронизации,
// закрытие после последнего шага). `false` — на телефоне прежние окна.
export const FIRST_RUN_STEPPER_ENABLED = true;

export function decideFirstRunShell(input: {
  /** Мобильный макет уже открыт и применён. */
  mobileLayout: boolean;
  /** Телефон или сохранённый выбор «мобильный» — есть смысл ждать ответа. */
  mobilePreferred: boolean;
  accessAnswered: boolean;
  timedOut: boolean;
  /** Для тестов логики; по умолчанию — `FIRST_RUN_STEPPER_ENABLED`. */
  stepperEnabled?: boolean;
}): FirstRunShell {
  if (!(input.stepperEnabled ?? FIRST_RUN_STEPPER_ENABLED)) return 'dialogs';
  if (input.mobileLayout) return 'stepper';
  if (input.mobilePreferred && !input.accessAnswered && !input.timedOut) return 'hold';
  return 'dialogs';
}
