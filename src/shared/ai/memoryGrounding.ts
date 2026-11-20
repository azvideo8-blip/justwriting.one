/**
 * К25-5 (случай #25): «Память ИИ» сохраняла объяснение ассистента от первого
 * лица человека («Я хочу перестать тратить время на…»), хотя промпт выписки
 * это прямо запрещает. Проверка кодом: единица остаётся, только если её
 * значимые слова есть в репликах самого человека.
 *
 * ponytail: сверка по основам слов, не по смыслу. Ловит мысль, которой у
 * человека не было вовсе; пересказ ассистента словами человека пройдёт.
 * Сильнее — отдельный вызов-проверяющий, если этого окажется мало.
 */
const STOP = new Set([
  'хочу', 'хочет', 'хотел', 'хотела', 'хотят', 'могу', 'может', 'можно', 'очень', 'этого', 'этой', 'этом', 'чтобы',
  'когда', 'котор', 'себя', 'себе', 'собой', 'свой', 'своей', 'свою', 'своего', 'своих', 'меня', 'мной', 'было',
  'быть', 'есть', 'просто', 'такой', 'такая', 'тоже', 'сейчас', 'всегда', 'никогда', 'иногда', 'только', 'пользователь',
  'пользователя', 'ассистент', 'ассистента', 'будто', 'потому', 'поэтому', 'этот', 'того', 'тому', 'него', 'неё', 'нее',
]);

function stems(text: string): string[] {
  const words = text.toLowerCase().replace(/ё/g, 'е').match(/[а-яa-z]{4,}/g) ?? [];
  return [...new Set(words.filter(w => !STOP.has(w)).map(w => w.slice(0, Math.max(4, w.length - 2))))];
}

/** Доля значимых слов единицы, найденных в репликах человека, не ниже которой единица остаётся. */
export const MEMORY_GROUNDED_SHARE = 0.5;

export function groundedInUser(memoryText: string, userText: string): boolean {
  const own = stems(memoryText);
  if (own.length === 0) return false;
  const body = userText.toLowerCase().replace(/ё/g, 'е');
  return own.filter(s => body.includes(s)).length / own.length >= MEMORY_GROUNDED_SHARE;
}

// Обязательство — это намерение. «Я испытываю чувство ненужности» в «Обязательствах» (случай #25) — нет.
const INTENT_RE = /(?:^|[^а-яё])(?:хоч[уе]|хотел[аи]?|буду|будем|планиру|собира|решил|решила|намерен|попробу|начн[уё]|перестан|постара|обеща|не\s+буду|надо|нужно|стану|сделаю|возьмусь|откажусь|брошу|займусь)/i;

export function memoryKindFixed(kind: string, text: string): string {
  return kind === 'commitment' && !INTENT_RE.test(text) ? 'insight' : kind;
}

/** Длина дословного куска (в словах), с которой он считается эхом ответа модели. */
export const ECHO_RUN_WORDS = 8;

const wordsOf = (text: string): string[] => text.toLowerCase().replace(/ё/g, 'е').match(/[а-яa-z0-9]+/g) ?? [];

/**
 * К28-3 (случаи #27, #28): человек вставил в реплику слова модели — фразу в кавычках или
 * кусок ответа — и согласился («похоже»); сверка памяти (`groundedInUser`) принимала такую
 * реплику за свои слова. Вырезаем из реплики (1) текст в кавычках «…» / "…", дословно
 * найденный в прошлом ответе модели, (2) любой кусок от ECHO_RUN_WORDS слов подряд,
 * дословно совпадающий с прошлым ответом. Согласие («похоже») и всё остальное остаются.
 *
 * ponytail: дословное совпадение по словам без пунктуации и регистра; пересказ
 * модели чужими словами человека проходит как раньше.
 */
export function stripEchoedAssistantText(userText: string, assistantTexts: string[]): string {
  if (assistantTexts.length === 0) return userText;
  const wordHays = assistantTexts.map(a => ` ${wordsOf(a).join(' ')} `);

  // (1) кавычки
  let text = userText.replace(/«([^»]+)»|"([^"]+)"/g, (whole, a: string | undefined, b: string | undefined) => {
    // По словам целиком: «устал» в кавычках не вырезается из-за «устало» в ответе.
    const inner = wordsOf(a ?? b ?? '').join(' ');
    return inner.length >= 3 && wordHays.some(h => h.includes(` ${inner} `)) ? ' ' : whole;
  });

  // (2) восемь слов подряд
  const spans: { word: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/[а-яА-ЯёЁa-zA-Z0-9]+/g)) {
    spans.push({ word: m[0].toLowerCase().replace(/ё/g, 'е'), start: m.index!, end: m.index! + m[0].length });
  }
  const echoed = new Array<boolean>(spans.length).fill(false);
  for (let i = 0; i + ECHO_RUN_WORDS <= spans.length; i++) {
    const window = ` ${spans.slice(i, i + ECHO_RUN_WORDS).map(w => w.word).join(' ')} `;
    if (wordHays.some(h => h.includes(window))) for (let j = i; j < i + ECHO_RUN_WORDS; j++) echoed[j] = true;
  }
  let out = '';
  let cursor = 0;
  for (let i = 0; i < spans.length; i++) {
    if (!echoed[i]) continue;
    let j = i;
    while (j + 1 < spans.length && echoed[j + 1]) j++;
    out += text.slice(cursor, spans[i]!.start);
    cursor = spans[j]!.end;
    i = j;
  }
  text = out + text.slice(cursor);
  return text.replace(/\s+/g, ' ').trim();
}
