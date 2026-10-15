import { countWords } from '../../../shared/utils/countWords';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { startWritingSession } from '../store/storeActions';

/**
 * Единственный способ вставить распознанный текст в заметку (D-1).
 *
 * Диктовка дописывает в конец заметки, а не встаёт в курсор — это поведение
 * осталось до D-1 и им не меняется.
 *
 * Читается свежий content из стора, а не тот, что был в момент монтирования:
 * реплики одной непрерывной сессии приходят подряд, и захваченное значение
 * затирала бы уже вставленный текст.
 *
 * MF-1: вставка — такой же первый ввод, как буква. Событий редактора она не
 * даёт, и сессия оставалась в `idle`: продиктованное не считалось нигде, а
 * первая буква потом брала его в точку отсчёта. Отсчёт — слова ДО вставки.
 */
export function appendDictation(text: string): void {
  const cur = useContentStore.getState().content;
  const status = useTimerStore.getState().status;
  if (status === 'idle' || status === 'paused') startWritingSession(countWords(cur));
  useContentStore.getState().setContent(cur ? cur.trimEnd() + ' ' + text : text);
}
