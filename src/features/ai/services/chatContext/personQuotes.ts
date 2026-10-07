// DLG-Q9 (Fable T-17): реплика «мама против переезда» при записях, где мама сама
// зовёт в Казань. Модель подгоняет записи под реплику: с отдельным блоком цитат
// она называет расхождение в 3–4 прогонов из 9, без блока — 0 из 9. Ложных
// расхождений, когда реплика совпадает с записями, 0 из 9.
//
// Модуль чистый: ничего не читает из базы и не ищет. Распознаёт человека в
// реплике и собирает блок его строк из переданных текстов.

export const LB = '(?:^|[^а-яёА-ЯЁ])';
export const RB = '(?![а-яёА-ЯЁ])';

export interface PersonMention {
  /** Ключ роли («мама») или самого имени. */
  key: string;
  /** Форма этого человека в тексте — по ней ищем его строки в записях. */
  pattern: RegExp;
}

// Падежные формы перечислены, а не свёрнуты в жадную маску: «мужчина»,
// «женщина», «братство», «другой», «мамонт» и «мужество» — не про человека
// собеседника, и отсекаются они именно списком окончаний + границей слова.
export const ROLE_STEMS: Array<{ key: string; stems: string[] }> = [
  { key: 'мама', stems: ['мам(?:а|ы|е|у|ой|ам|ах|ами|ин[а-яё]{0,3})?', 'мат(?:ь|ери|ерью|еру|еря|ерев[а-яё]{0,2})'] },
  { key: 'папа', stems: ['пап(?:а|ы|е|у|ой|ам|ах|ами|ин[а-яё]{0,3})?', 'отц(?:|е|а|у|ом|ов|ам|ах)'] },
  { key: 'брат', stems: ['брат(?:а|у|ом|е|ы|ья|ев|ьев|ам|ах)?'] },
  { key: 'сестра', stems: ['сестр(?:а|ы|е|у|ой|ам|ами|ах|енк[а-яё]{0,2})'] },
  { key: 'муж', stems: ['муж(?:а|у|ем|е|ья)?'] },
  { key: 'жена', stems: ['жен(?:а|ы|е|у|ой|ам|ами|ах)'] },
  { key: 'друг', stems: ['друг(?:а|у|ом|е)?', 'друз(?:ья|ей|ьям|ьями)'] },
  { key: 'подруга', stems: ['подруг(?:а|и|е|у|ой|ам|ами|ах)', 'подруз(?:ья|ей|ьям|ьями)'] },
  { key: 'начальник', stems: ['начальник(?:|а|у|ом|е|и|ов|ам|ах)', 'начальств(?:|о|а|у|ом|е|енн[а-яё]{0,3})'] },
  { key: 'коллега', stems: ['коллег(?:а|и|е|у|ой|ам|ах|ов)'] },
];

// «друг друга» — про взаимность, а не про конкретного человека.
const MUTUAL = /друг[а-яё]*\s+друг[а-яё]*/i;

// Стоп-лист заглавных слов, которые не люди: дни, месяцы, частые города, «Бог»
// и слова, которые законно открывают фразу.
export const NAME_STOPWORDS = new Set([
  'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье',
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  'москва', 'питер', 'казань', 'тверь', 'сочи', 'уфа', 'омск', 'новосибирск', 'екатеринбург', 'владивосток',
  'россия', 'русский', 'русская', 'бог', 'бег', 'утро', 'вечер', 'день', 'ночь', 'лето', 'зима', 'весна', 'осень',
  'это', 'они', 'мы', 'как', 'почему', 'что', 'кто', 'когда', 'где', 'если', 'хоть', 'опять', 'может', 'кажется', 'конечно',
]);

// Частые начала фразы (DLG-Q10/R-4): в начале предложения они пишутся с
// заглавной, но людьми не являются.
export const SENTENCE_HEAD_WORDS = new Set([
  'сегодня', 'вчера', 'завтра', 'утром', 'днём', 'вечером', 'ночью', 'потом', 'когда', 'но', 'а', 'и', 'я',
  'мне', 'меня', 'мы', 'он', 'она', 'они', 'это', 'там', 'тут', 'так', 'всё', 'все', 'ещё', 'еще', 'даже',
  'просто', 'наверное', 'кажется', 'зато', 'только', 'опять', 'снова', 'теперь', 'сейчас', 'почему', 'зачем',
  'как', 'что', 'кто', 'где', 'если', 'хотя', 'пока', 'уже',
]);

const NAME_RE = /[А-ЯЁ][а-яё]{2,}/g;
const SENTENCE_HEAD = /(?:^|[.!?…][\s\n]|\n)\s*$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const normName = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/**
 * О ком говорят в реплике: не больше двух, первые по порядку.
 *
 * Имя в начале предложения — особое правило: «Оля отменила бег» теряет человека,
 * если отбрасывать всё с заглавной из-за позиции. Такое имя принимается, когда
 * оно встречается и внутри записей этого хода (`corpusText`) — тогда оно точно
 * имя, а не начало фразы.
 */
export function detectPersonMentions(
  text: string,
  opts: { selfName?: string | undefined; corpusText?: string | undefined },
): PersonMention[] {
  const found: Array<{ at: number; mention: PersonMention }> = [];
  // R-5: в профиле обычно «имя фамилия», поэтому сверяемся со каждым словом, а
  // не со строкой целиком — иначе собственное имя считалось чужим человеком.
  const selfWords = new Set((opts.selfName ?? '')
    .split(/\s+/)
    .map(normName)
    .filter(Boolean));

  for (const role of ROLE_STEMS) {
    const pattern = new RegExp(`${LB}(${role.stems.join('|')})${RB}`, 'i');
    const re = new RegExp(pattern.source, 'gi');
    const m = re.exec(text);
    if (!m) continue;
    if (role.key === 'друг' && MUTUAL.test(text.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12))) continue;
    found.push({ at: m.index, mention: { key: role.key, pattern } });
  }

  for (const m of text.matchAll(NAME_RE)) {
    const name = m[0];
    if (NAME_STOPWORDS.has(name.toLowerCase())) continue;
    if (selfWords.has(normName(name))) continue;
    const sentenceInitial = m.index === 0 || SENTENCE_HEAD.test(text.slice(0, m.index));
    if (sentenceInitial && !(opts.corpusText ?? '').match(new RegExp(`(?:^|[^.!?…\\n])\\s${escapeRegExp(name)}(?![а-яё])`, 'm'))) continue;
    if (found.some(f => f.mention.pattern.test(name))) continue;
    found.push({
      at: m.index,
      mention: { key: name, pattern: new RegExp(`${LB}(${escapeRegExp(name)}[а-яё]*)${RB}`, 'i') },
    });
  }

  return found.sort((a, b) => a.at - b.at).slice(0, 2).map(f => f.mention);
}

export interface PersonNote {
  id: string;
  date: string;
  text: string;
}

const MAX_LINES = 4;
const MAX_LINE_CHARS = 200;
const MAX_BLOCK_CHARS = 600;

/** Предложения записей, где этот человек говорит или действует. */
export function buildPersonQuotesBlock(person: PersonMention, notes: PersonNote[]): string | null {
  const lines: string[] = [];
  outer: for (const note of notes) {
    for (const sentence of note.text.split(/[.!?…]\s+/)) {
      const clean = sentence.replace(/\s+/g, ' ').trim();
      if (clean.length < 8 || !person.pattern.test(clean)) continue;
      const body = clean.replace(/[.,;:!?\s]+$/, '');
      const clipped = body.length > MAX_LINE_CHARS ? `${clipAtWord(body, MAX_LINE_CHARS)}…` : body;
      const line = `— «${clipped}» [#${note.id} · ${note.date}]`;
      if (lines.includes(line)) continue;
      lines.push(line);
      if (lines.length >= MAX_LINES) break outer;
    }
  }
  if (lines.length === 0) return null;

  const header = `[Что в записях говорит/делает «${person.key}»]`;
  let body = '';
  for (const line of lines) {
    if (`${header}${body}\n${line}`.length > MAX_BLOCK_CHARS) break;
    body += `\n${line}`;
  }
  return body ? `${header}${body}` : null;
}

function clipAtWord(s: string, max: number): string {
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return at > max / 2 ? cut.slice(0, at) : cut;
}

/** Заметки, чьи строки могли попасть в блок, — их id нужны в allowlist цитат. */
export function personQuoteIds(person: PersonMention, notes: PersonNote[]): string[] {
  return notes
    .filter(note => note.text.split(/[.!?…]\s+/).some(s => person.pattern.test(s)))
    .map(note => note.id);
}
