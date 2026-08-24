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
  // AUD-16: путь документа строится как users/${userId} — тот же
  // идентификатор, что в uid, но под другим ключом.
  'path', 'docPath', 'docPathFull',
]);

// AUD-17: ключи фильтруются по имени, а сообщение — по форме: идентификатор и
// адрес почты узнаваемы и без знания текста. Это не защита от всего, а закрытие
// самых частых утечек — их и наблюдали. Ровно три формы, ничего «похожего на
// заметку» не угадываем: фильтр, ломающий легитимный текст ошибки, хуже
// отсутствия фильтра.
const REDACTIONS: Array<[RegExp, string]> = [
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>'],
  [/[^\s@]+@[^\s@]+\.[^\s@]+/g, '<email>'],
  [/[A-Za-z0-9+/]{40,}={0,2}/g, '<blob>'],
];

export function redactMessage(message: string): string {
  let out = message;
  for (const [re, replacement] of REDACTIONS) {
    out = out.replace(re, replacement);
  }
  return out;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactMessage(value);
  if (value instanceof Error) return redactMessage(value.message);
  if (value && typeof value === 'object' && 'message' in (value as Record<string, unknown>)
    && typeof (value as { message: unknown }).message === 'string') {
    return redactMessage((value as { message: string }).message);
  }
  return value;
}

type Context = Record<string, string | number | boolean | null | undefined>;

export function scrubPii<T extends Record<string, unknown>>(context: T | undefined | null): Partial<T> {
  const safe: Partial<T> = {};
  if (!context) return safe;
  for (const [key, value] of Object.entries(context)) {
    if (!PII_KEYS.has(key)) {
      (safe as Record<string, unknown>)[key] = redactValue(value);
    }
  }
  return safe;
}
