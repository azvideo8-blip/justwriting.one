import { useContentStore } from '../store/useContentStore';

/**
 * Единственный способ вставить распознанный текст в заметку (D-1).
 *
 * Диктовка дописывает в конец заметки, а не встаёт в курсор — это поведение
 * осталось до D-1 и им не меняется.
 *
 * Читается свежий content из стора, а не тот, что был в момент монтирования:
 * реплики одной непрерывной сессии приходят подряд, и захваченное значение
 * затирала бы уже вставленный текст.
 */
export function appendDictation(text: string): void {
  const cur = useContentStore.getState().content;
  useContentStore.getState().setContent(cur ? cur.trimEnd() + ' ' + text : text);
}
