// Ключи, значения которых не попадают ни в журнал активности, ни в отчёт об
// ошибке. Заголовок заметки — такие же личные данные, как её текст:
// «Развод, день 4» говорит достаточно. Он попадал в журнал активности в
// localStorage, а оттуда в буфер обмена по кнопке «скопировать журнал».
// Вычёркивание идёт по точному имени ключа, поэтому список должен покрывать
// семью, а не отдельных её представителей: `docId` рядом с `documentId` — это
// тот же идентификатор под другим именем, и одного его хватало, чтобы обойти
// защиту. `tag`, `theme` и `label` — придуманные человеком слова, то самое,
// что шифруется в облаке и не должно лежать открытым в журнале на устройстве.
//
// Единственный список на оба пути (reportError и addActivity): фильтр,
// стоящий в одном из них, не должен обходиться вторым входом.

const PII_KEYS = new Set([
  'userId', 'uid', 'email', 'linkedCloudId',
  'documentId', 'docId', 'docUuid', 'localId', 'versionId', 'sessionId',
  'personaId', 'domainId', 'labelId', 'noteId', 'threadId',
  'title', 'docTitle', 'content', 'text', 'rawContent', 'summary',
  'tag', 'theme', 'label', 'name', 'query', 'snippet', 'prompt', 'answer', 'message',
]);

type Context = Record<string, string | number | boolean | null | undefined>;

export function scrubPii<T extends Record<string, unknown>>(context: T | undefined | null): Partial<T> {
  const safe: Partial<T> = {};
  if (!context) return safe;
  for (const [key, value] of Object.entries(context)) {
    if (!PII_KEYS.has(key)) {
      (safe as Record<string, unknown>)[key] = value;
    }
  }
  return safe;
}
