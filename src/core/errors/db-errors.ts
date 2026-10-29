import { getCurrentUser } from '../auth';
import { OperationType, DbErrorInfo } from '../../shared/errors/errorTypes';
import { reportError } from '../../shared/errors/reportError';

export { OperationType };
export type { DbErrorInfo };

export function handleDbError(error: unknown, operationType: OperationType, path: string | null): DbErrorInfo {
  const errInfo: DbErrorInfo = {
    // Журнал владельца 29.10: supabase-js отдаёт не Error, а объект с message —
    // String() давал «[object Object]», и reportError не узнавал обрыв сети.
    error: error instanceof Error ? error.message
      : typeof (error as { message?: unknown } | null)?.message === 'string' ? (error as { message: string }).message
      : String(error),
    authInfo: {
      userId: getCurrentUser()?.uid,
    },
    operationType,
    path
  };
  
  // AUD-16: путь вида users/<uid>-… несёт uid внутри себя — вычёркивание
  // ключа `uid` не спасало, тот же идентификатор приходил вторым входом.
  // Отладке нужна форма (коллекция), а не значение.
  reportError(errInfo.error, {
    operationType,
    collection: path?.split('/')[0] ?? 'unknown',
  });

  const errorCode = error instanceof Error && 'code' in error ? (error as { code: string }).code : 'unknown';

  if (import.meta.env.DEV) {
    // Один аргумент: второй у console.error затирал первый (pass B, находка 5).
    console.error(`DB error [${operationType}] code=${errorCode} path=${path ?? null}`);
  }

  return errInfo;
}
