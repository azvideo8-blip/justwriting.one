import { reportError } from './errors/reportError';

/** Итог операции записи, которая могла пройти локально и не дойти до облака. */
export interface MutationResult {
  cloudSyncFailed?: boolean | undefined;
}

export interface MutationUi {
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: string) => string;
}

/**
 * Сообщить человеку итог удавшейся операции. Тост зовёт сам помощник: у
 * вызывающего нет шага «достать текст и не забыть проверить результат», на
 * котором терялся `cloudSyncFailed` (дейлик 19.11 Н-3). Отказ облака — всегда
 * ошибка, а не `successText`. `successText: null` — успех молчит (правка
 * поля в списке видна и так).
 */
export function reportMutationResult(ui: MutationUi, result: MutationResult | void, opts: { successText: string | null }): void {
  if (result?.cloudSyncFailed) {
    ui.showToast(ui.t('archive_cloud_sync_failed'), 'error');
    return;
  }
  if (opts.successText !== null) ui.showToast(opts.successText, 'success');
}

/**
 * Операция целиком: бросок назван тостом и уходит в отчёт об ошибках, итог —
 * через `reportMutationResult`. Промис не отклоняется: вызовы из обработчиков
 * идут через `void`, и необработанный отказ был тишиной (дейлик 19.11, диалоги).
 * Возвращает результат или `undefined`, если операция бросила.
 */
export async function runMutation<R extends MutationResult | void>(
  ui: MutationUi,
  action: string,
  fn: () => Promise<R>,
  opts: { successText: string | null; context?: Record<string, unknown>; onFailure?: () => void | Promise<void> },
): Promise<{ result: R } | undefined> {
  let result: R;
  try {
    result = await fn();
  } catch (e) {
    reportError(e, { action, ...opts.context });
    ui.showToast(ui.t('error_generic_action'), 'error');
    await opts.onFailure?.();
    return undefined;
  }
  reportMutationResult(ui, result, opts);
  return { result };
}
