// THERAPY-2: Conservative crisis risk detector.
// Catches ONLY explicit acute risk markers (suicidal intent, plan, self-harm).
// Does NOT trigger on normal heavy reflection (sadness, fatigue, "всё плохо").

import { classifyInvisibleCodePoint, CONFUSABLES_MAP, foldConfusables } from '../../../shared/ai/buildChatPrompt';

// Текст сравнивается после normalize(): нижний регистр, ё→е, без невидимых
// символов — поэтому в паттернах только «е».

// R5-016: «покончить с X» остро, только если X — «собой», «жизнью» или голое
// «с этим / со всем (этим)» в конце клаузы. «покончить с прокрастинацией»,
// «с этим бардаком» — быт. «Покончить» без «с …» остаётся острым.
const POKONCHIT = String.raw`покончить(?:\s+со?\s+(?:собо[йю]|(?:[а-я]+\s+)?жизнью|(?:всем|этим)(?:\s+(?:всем|этим))?(?:\s+(?:раз\s+и\s+)?навсегда)?(?![^\S\n]*[а-я]))|(?!\s+со?\s))`;
// R5-016 / S-1 (owner decision 2026-10-01): «хочу умереть» — маркер риска.
// Исключение остаётся только одно — смех («умереть от смеха», «со смеху»).
// Всё остальное («от любви», «от стыда», «со скуки») острое.
const UMERET = String.raw`(?:умереть|умирать)(?!\s+(?:от|со)\s+(?:смех|смеху))`;
// R5-004: «не хочу жить в этом городе / у родителей / с ним / одна» — про место
// и соседей, не острое. «в/на» с миром, светом, болью, страхом, одиночеством
// и т. п. остаются острыми, «с» — только с людьми (с этой болью — острое).
const ZHIT_WHERE = String.raw`(?:в|во|на)\s+(?!(?:[а-я]+\s+)?(?:мир|свет|жизн|ад[уе]?(?![а-я])|страх|бол|муч|одиночеств|тоск|пустот|отчаяни|депресс|тел[еоу]?(?![а-я])|темнот))[а-я]`;
const ZHIT_WITH = String.raw`со?\s+(?:(?:ним|ней|ними|тобой|вами)(?![а-я])|родител|мам|пап|муж|жен|сосед|бывш|парн|девушк)`;
const ZHIT_PLACE = String.raw`(?:у|под|за|возле|около|рядом|вместе|среди|здесь|тут|там|одн[аио]|один)(?![а-я])`;

const HEAD = String.raw`(?:хоч(?:у|ешь|ется)|хотел[аи]?(?:\s+бы)?|готов[аы]?|собира(?:юсь|ется)|планиру(?:ю|ешь|ет)|решил[аи]?)`;
const METHOD_VERBS = String.raw`повеситься|застрелиться|утопиться|отравиться|вскрыть\s+вены|спрыгнуть(?:\s+с\s+[а-я]+)?|броситься\s+под(?:\s+[а-я]+)?|наглота(?:ться|юсь)(?:\s+таблеток)?|выброситься|шагнуть\s+с\s+крыши|вып(?:ить|ью)\s+все\s+таблетки(?:\s+разом)?`;

const RISK_PATTERNS: RegExp[] = [
  // Explicit suicidal intent & personal forms
  new RegExp(String.raw`${HEAD}\s+(?:${UMERET}|${POKONCHIT}|убить\s+себя|сдохнуть|помереть|${METHOD_VERBS})`),
  /покончить\s+с\s+собой/,
  /поконч(?:у|ил[аи]?(?:\s+бы)?)\s+со?\s+(?:собой|всем)/,
  /убью\s+себя|себя\s+убью/,
  /суицид/,
  /самоубийств/,
  // First-person future
  /повешусь|застрелюсь|утоплюсь|отравлюсь|вскрою\s+вены|спрыгну\s+с\s+(?:крыши|моста|окна|балкона)|брошусь\s+под|наглотаюсь(?:\s+таблеток)?|выброшусь(?:\s+(?:из|в|с)\s+окн[а-я]*)?|выпью\s+все\s+таблетки/,
  // Idioms
  /(?:свести|сведу)\s+счет[ые]\s+с\s+жизнью/,
  /(?:наложить|наложу)\s+на\s+себя\s+руки/,
  /(?:лишить|лишу)\s+себя\s+жизни/,
  /(?:уйти|уйду|ушла|ушел)\s+из\s+жизни/,
  /(?:расстаться|расстанусь)\s+с\s+жизнью/,
  /закончить\s+(?:свою\s+)?жизнь/,
  /перестать\s+существовать/,
  /(?:мне\s+)?надоело\s+жить/,
  /не\s+вижу\s+смысла\s+(?:дальше\s+)?жить/,
  /так\s+жить\s+не\s+хочу|не\s+хочу\s+так\s+жить|жить\s+не\s+хочется|жить\s+больше\s+не\s+могу/,
  /сдохнуть\s+бы/,
  /лучше\s+бы\s+(?:меня\s+не\s+было|(?:я|меня)\s+не\s+родил(?:ся|ась))/,
  /пора\s+(?:уже\s+)?вс[её]\s+закончить/,
  /(?:скоро\s+)?вс[её]\s+закончу\s+со?\s+собой/,
  /смерть\s+кажется\s+избавлением/,
  /хочу\s+больше\s+не\s+просыпаться/,
  /ищу\s+способ\s+убить\s+себя/,
  // «не хочу больше жить» — тот же канонический случай, что «не хочу жить».
  new RegExp(String.raw`не\s+хочу\s+(?:больше\s+|дальше\s+|вообще\s+)?жить(?!\s+(?:${ZHIT_WHERE}|${ZHIT_WITH}|${ZHIT_PLACE}))`),
  /нет\s+смысла\s+(дальше\s+)?жить/,
  /лучше\s+бы\s+(я\s+)?(умер|погиб|не\s+родился)/,
  // Просторечные «сдохнуть/помереть», «устал жить», «незачем жить», «уснуть и
  // не проснуться» — те же намерения другими словами (раунд 5, таблица пропусков).
  /хочу\s+(?:сдохнуть|помереть)|лучше\s+бы\s+(?:я\s+)?(?:сдох|помер)/,
  /устал[аи]?\s+жить|незачем\s+(?:больше\s+)?жить|уснуть\s+и\s+не\s+проснуться|хочу\s+исчезнуть\s+навсегда/,
  new RegExp(String.raw`думал.{0,200}\s+(?:о\s+смерти|убить\s+себя|${POKONCHIT})`),
  // R5-014: настоящее время. «думаю о смерти» сюда нарочно не входит — это
  // чаще горе о ком-то, чем план.
  new RegExp(String.raw`думаю.{0,200}\s+(?:убить\s+себя|${POKONCHIT})`),
  // Plan / means. Средства — целыми словами: «яд» сидит внутри «порядок», «наряд».
  /(?:^|[^а-я])(таблетк|нож|веревк|оруж|яд(?![а-я])|выброс[а-я]*\s+(?:из|в|с)\s+окн|выпрыгн|крыш|поезд|утоп)[^.,;:!?\n—–]{0,100}\s+(собой|себя|умереть|покончить)/,
  // Self-harm intent
  /хочу\s+(порезать|навредить|причинить\s+боль|наказывать|ударить)\s+(себе|себя)/,
  /причинить\s+себе\s+боль|(?:порезал[аи]?|режу|порезать)\s+(?:себе\s+)?(?:руки|вены|запяст)/,
  /(?:наказывать|ударить)\s+себя.{0,100}\s+(?:до\s+крови|чтобы\s+было\s+больно)/,
  /режу\s+себя/,
  /самоповрежд/,
  /наказать\s+себя.{0,200}\s+(физическ|боль|травм)/,
  // Goodbye / finality
  /прощайте|прощай\s+всем|это\s+мое\s+последнее/,
  /никто\s+не\s+заметит.{0,200}(если|когда).{0,200}\s+(меня\s+не\s+будет|я\s+умру)/,
];
// M-16: разрывы между группами ограничены .{0,200} — с .* вырожденный ввод
// («никто не заметит если когда …» ×50k) бэктрекал минуты.

// L-1: короткие списки EN и транслита. Совпадают с латинским вариантом текста
// (кириллица сложена в латиницу), а не с кириллическим.
// M-15: \b — иначе «i want to diet» ловилось как «die».
const FOREIGN_RISK_PATTERNS: RegExp[] = [
  // English
  /\bi\s+want\s+to\s+(die|kill\s+myself|end\s+my\s+life)\b/,
  /\bkill\s+myself\b/,
  /\bsuicid(?:e|al)/,
  /\bdon['’]?t\s+want\s+to\s+live\b|\bdo\s+not\s+want\s+to\s+live\b/,
  // Translit
  /\bne\s+hochu\s+zhit/,
  /\bhochu\s+umeret/,
  /\bpokonchit\s+s\s+sobo[jiy]/,
  /\bnet\s+smysla\s+(dalshe\s+)?zhit/,
];

// Инверсия CONFUSABLES_MAP (кириллица→латиница): латинская буква-двойник
// складывается в кириллицу. Дубликаты («А»→A и «а»→a) разрешаются в пользу
// первой записи. Только русские буквы: греческие и «і/ѕ/һ» паттерны не знают —
// h→һ прятал «Hе хочу жить» (M-14).
const LATIN_LOOKALIKE_TO_CYRILLIC: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [cyr, lat] of Object.entries(CONFUSABLES_MAP)) {
    if (!/^[а-яА-Я]$/.test(cyr)) continue;
    const low = lat.toLowerCase();
    if (!(low in map)) map[low] = cyr.toLowerCase();
  }
  return map;
})();

function foldLatinLookalikes(text: string): string {
  let out = '';
  for (const ch of text) out += LATIN_LOOKALIKE_TO_CYRILLIC[ch] ?? ch;
  return out;
}

// S-2: Подавление в русском языке разбито на три группы:
// 1. Глагольные отрицания: не|никогда не + хочу/буду/думал[аи]?/думаю/планирую/собираюсь/хотел[аи]?.
// Подавляют только вплотную перед совпадением (аналог FOREIGN_NEGATION_BEFORE).
const RU_NEGATION_BEFORE = /(?:^|[^а-я])(?:никогда\s+не|не)\s+(?:(?:хочу|буду|думал[аи]?|думаю|планирую|собираюсь|хотел[аи]?)\s+)?$/;

// 2. Маркеры прошлого и совладания: только до совпадения, целыми словами, и не после «не ».
const PAST_COPING_BEFORE = /(?:^|[^а-я])(?<!не\s+)(?:раньше(?:\s+(?:думал|хотел)[аи]?)?|была\s+мысль\s+но|справляюсь|преодол[а-я]*)(?![а-я])/;

// 3. Маркеры позиции: могут стоять после (или до) совпадения, только целыми словами.
const STANCE_MARKERS = /(?:^|[^а-я])(?:не\s+вариант|не\s+про\s+меня|в\s+прошлом)(?![а-я])/;
const NOUN_TOPIC = /^(?:суицид[а-я]*|самоубийств[а-я]*)$/;
const STANCE_AFTER = /^[\s,—–]*(?:это\s+|уже\s+)?(?:не\s+вариант(?!\s+для\b)|не\s+про\s+меня(?:\s+сейчас)?|в\s+прошлом(?!\s+(?:вс[её]|все|было|год)))(?![а-я])/;

// M-15: отрицание для EN/транслита — «I don't want to kill myself», «ne hochu umeret».
// Только если оно управляет самой фразой, вплотную перед ней: «I'm not ok and
// I want to die» — одна клауза, но «not» к «want to die» не относится.
// R5-017: вспомогательный глагол с отрицанием управляет и самим «kill»:
// «I won't / will not / wouldn't kill myself», «it's not that I want to die».
const FOREIGN_NEGATION_BEFORE = /(?:\bdo(?:n['’]?t| not)|\bnot|\bnever|\bwon['’]?t)\s+(?:want|going|plan(?:ning)?|gonna|wanna)\s+(?:to\s+)?$|\b(?:won['’]?t|will\s+(?:not|never)|would(?:n['’]?t|\s+not|\s+never)|never|do(?:n['’]?t|\s+not)|not\s+that)\s+$|\bne\s+$/;

// Граница клаузы: знак препинания или союз-поворот. Исключение из соседней
// клаузы («не думал о смерти, но хочу покончить с собой») острое не гасит.
const CLAUSE_BREAK = /[.,;:!?\n—–]|\s(?:но|а|однако|but)\s/g;

export interface RiskResult {
  isRisk: boolean;
  severity: 'none' | 'acute';
  matchedPattern?: string;
}

const LETTER_RE = /[\p{L}\p{N}]/u;

function baseNormalize(text: string): string {
  let out = '';
  let dropped = false;
  for (const ch of text) {
    const action = classifyInvisibleCodePoint(ch.codePointAt(0) ?? 0);
    if (action === 'drop') { dropped = true; continue; }
    // «drop»-символ между двумя буквами склеивал слова: «нехочужить» без
    // пробелов после выбрасывания нулевой ширины уходил мимо всех паттернов.
    // R5-014: соседи — последняя выведенная буква и следующая настоящая, а не
    // соседний невидимый символ: серия из двух ZWSP тоже даёт один пробел.
    if (dropped && LETTER_RE.test(ch) && LETTER_RE.test(out[out.length - 1] ?? '')) out += ' ';
    dropped = false;
    out += action === 'space' ? ' ' : ch;
  }
  return out.toLowerCase().replace(/ё/g, 'е');
}

function clauseBounds(lower: string, start: number, end: number): [number, number] {
  let from = 0;
  let to = lower.length;
  for (const m of lower.matchAll(CLAUSE_BREAK)) {
    const at = m.index;
    if (at + m[0].length <= start) from = at + m[0].length;
    else if (at >= end) { to = at; break; }
  }
  return [from, to];
}

function hasRussianSafeContext(lower: string, start: number, end: number): boolean {
  const [from] = clauseBounds(lower, start, end);
  const before = lower.slice(from, start);

  if (RU_NEGATION_BEFORE.test(before)) return true;
  if (PAST_COPING_BEFORE.test(before)) return true;

  if (STANCE_MARKERS.test(before)) return true;

  const matchText = lower.slice(start, end).trim();
  if (NOUN_TOPIC.test(matchText)) {
    const after = lower.slice(end);
    if (STANCE_AFTER.test(after)) return true;
  }

  return false;
}

function hasForeignNegationBefore(lower: string, start: number, end: number): boolean {
  const [from] = clauseBounds(lower, start, end);
  return FOREIGN_NEGATION_BEFORE.test(lower.slice(from, start));
}

function firstAcuteMatch(text: string, patterns: RegExp[], isSafe: (lower: string, start: number, end: number) => boolean): string | null {
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
      if (!isSafe(text, match.index, match.index + match[0].length)) {
        return match[0];
      }
    }
  }
  return null;
}

export function detectRisk(text: string): RiskResult {
  const lower = baseNormalize(text);

  // Все совпадения всех паттернов: исключение у ранней фразы («раньше думал
  // о смерти») не должно прятать острую позже («а сейчас режу себя»).
  // Кириллические паттерны — против латинских букв-двойников; EN/транслит —
  // против кириллицы, сложенной в латиницу.
  const cyr = foldLatinLookalikes(lower);
  const cyrMatch = firstAcuteMatch(cyr, RISK_PATTERNS, hasRussianSafeContext);
  if (cyrMatch) return { isRisk: true, severity: 'acute', matchedPattern: cyrMatch };
  // R5-018: CONFUSABLES_MAP складывает кириллическую «у» в «y», а в EN/транслите
  // она подменяет и «u» («sуicide», «hochу») — второй проход с «у»→«u».
  const latMatch = firstAcuteMatch(foldConfusables(lower), FOREIGN_RISK_PATTERNS, hasForeignNegationBefore)
    ?? firstAcuteMatch(foldConfusables(lower.replace(/у/g, 'u')), FOREIGN_RISK_PATTERNS, hasForeignNegationBefore);
  if (latMatch) return { isRisk: true, severity: 'acute', matchedPattern: latMatch };

  return { isRisk: false, severity: 'none' };
}
