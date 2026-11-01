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
  'tag', 'newTag', 'theme', 'themes', 'label', 'name', 'query', 'snippet', 'prompt', 'answer', 'message',
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

// N1-2 (дейлик 01.11, Н-4): три формы выше ловят идентификатор и почту, но не
// фрагмент дневникового текста. Движок вшивает его в сообщение SyntaxError в
// кавычках — `Unexpected token 'М', "Свидетель_дневника"... is not valid JSON`,
// — а ключи `error` и `reason` в PII_KEYS отсутствуют по имени. Дописывать имена
// в список класс не закрывает: следующий `detail:` придёт новым именем.
// Поэтому режем по ЗНАЧЕНИЮ: любая кавычка (одинарные, двойные, «ёлочки») — это
// прилетевшее содержимое, а не описание ошибки, независимо от длины.
//
// Фрагмент обязан открываться после не-буквы/не-цифры: апостроф внутри слова
// («Can't», «talkin'») кавычку не открывает, иначе сгорает всякий легитимный
// текст ошибки. Оставляем форму: `Unexpected token …, … is not valid JSON`.
// Ревью 0.11.3: попарный разбор кавычек протекал, когда в самом фрагменте есть
// кавычки (`"{"a":Развод день 4}"`) или он обрезан на середине (`.slice(0, 200)`).
// Режем от первой открывающей кавычки до последней закрывающей (за ней не буква),
// а если закрывающей нет — до конца.
const QUOTED_TAIL = /(^|[^\p{L}\p{N}])['"«](?:[\s\S]*['"»](?=[^\p{L}\p{N}]|$)|[\s\S]*$)/gu;

function cutQuotedFragments(input: string): string {
  return input.replace(QUOTED_TAIL, (_match, lead: string) => `${lead}…`);
}

function redactString(value: string): string {
  return cutQuotedFragments(redactMessage(value));
}

// N1-2 (самопроверка, сверка 28): `addActivity` принимает контекст как
// `Record<string, unknown>`, то есть вложенный объект или список — законны.
// Прежний фильтр смотрел только верхний уровень: `{ meta: { title: 'Развод,
// день 4' } }` проходил дословно, и весь смысл единого списка ключей
// терялся. Теперь фильтр идёт за значением на глубину, имена ключей
// вычёркиваются на любом уровне, циклы не зацикливают прогон.
const MAX_DEPTH = 4;

function redactValue(value: unknown, depth = 0, seen?: Set<unknown>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return redactString(value.message);
  if (value && typeof value === 'object' && 'message' in (value as Record<string, unknown>)
    && typeof (value as { message: unknown }).message === 'string') {
    return redactString((value as { message: string }).message);
  }
  if (!value || typeof value !== 'object') return value;
  // Ревью N1: глубже предела объект не уходит как есть — там тоже бывает текст.
  if (depth >= MAX_DEPTH) return '[depth]';
  const visited = seen ?? new Set<unknown>();
  if (visited.has(value)) return '[circular]';
  visited.add(value);
  if (Array.isArray(value)) return value.map(item => redactValue(item, depth + 1, visited));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (PII_KEYS.has(key)) continue;
    out[key] = redactValue(nested, depth + 1, visited);
  }
  return out;
}


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
