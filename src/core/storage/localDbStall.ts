import { reportError } from '../../shared/errors/reportError';

/**
 * DY10-9 (инцидент 30.10, Яндекс.Браузер на Mac): сохранение и «Заметки» встали
 * на локальной базе браузера без единой ошибки — запрос к IndexedDB просто ждал,
 * и человек видел вечное «сохраняю». Сторож ничего не прерывает: через 10 с
 * пишет предупреждение с именем операции и поднимает событие — оболочка
 * показывает подсказку закрыть другие вкладки и перезагрузить страницу.
 */
export const LOCAL_DB_STALL_MS = 10_000;
export const LOCAL_DB_STALLED_EVENT = 'jw-local-db-stalled';

export function watchLocalDbStall<T>(op: string, work: Promise<T>, ms: number = LOCAL_DB_STALL_MS): Promise<T> {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    reportError(new Error(`LOCAL_DB_STALLED: ${op}`), { action: 'localDbStalled', op }, 'warning');
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOCAL_DB_STALLED_EVENT, { detail: { op } }));
  }, ms);
  return work.finally(() => {
    settled = true;
    clearTimeout(timer);
  });
}
