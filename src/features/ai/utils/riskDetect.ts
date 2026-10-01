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
// R5-004: «не хочу жить в этом городе / у родителей / с ним / одна» — про место
// и соседей, не острое. «в/на» с миром, светом, болью, страхом, одиночеством
// и т. п. остаются острыми, «с» — только с людьми (с этой болью — острое).
const ZHIT_WHERE = String.raw`(?:в|во|на)\s+(?!(?:[а-я]+\s+)?(?:мир|свет|жизн|ад[уе]?(?![а-я])|страх|бол|муч|одиночеств|тоск|пустот|отчаяни|депресс|тел[еоу]?(?![а-я])|темнот))[а-я]`;
const ZHIT_WITH = String.raw`со?\s+(?:(?:ним|ней|ними|тобой|вами)(?![а-я])|родител|мам|пап|муж|жен|сосед|бывш|парн|девушк)`;
const ZHIT_PLACE = String.raw`(?:у|под|за|возле|около|рядом|вместе|среди|здесь|тут|там|одн[аио]|один)(?![а-я])`;
// S-12: образ действия и творительный падеж («по-старому», «как раньше», «прошлым», «чужой жизнью»)
const ZHIT_MANNER = String.raw`(?:(?:по|как)\s+[а-я]+|прошлым|чужой\s+жизнью)(?![а-я])`;
const ZHIT_SUPPRESS = String.raw`(?:${ZHIT_WHERE}|${ZHIT_WITH}|${ZHIT_PLACE}|${ZHIT_MANNER})`;

// S-41: левая граница — «решили» сидит внутри «разрешили» («ему разрешили умереть дома»).
const HEAD = String.raw`(?<![а-я])(?:хоч(?:у|ешь|ется)|хотел[аи]?(?:\s+бы)?|готов[аы]?|собира(?:юсь|ется)|планиру(?:ю|ешь|ет)|решил[аи]?)`;
const METHOD_VERBS = String.raw`повеситься|застрелиться|утопиться|отравиться|вскрыть\s+вены|спрыгнуть(?:\s+с\s+[а-я]+)?|броситься\s+под(?:\s+[а-я]+)?|наглота(?:ться|юсь)(?:\s+таблеток)?|выброситься|шагнуть\s+с\s+крыши|вып(?:ить|ью)\s+все\s+таблетки(?:\s+разом)?`;

const RISK_PATTERNS: RegExp[] = [
  // Explicit suicidal intent & personal forms
  new RegExp(String.raw`${HEAD}\s+(?:${UMERET}|${POKONCHIT}|убить\s+себя|сдохнуть|помереть|${METHOD_VERBS})`),
  /покончить\s+с\s+собой/,
  // S-41: «покончу со всем» — только с «бы» или в конце клаузы; «покончу со всеми долгами / со всем этим бардаком» — быт.
  /поконч(?:у|ил[аи]?)(?:\s+бы)?\s+с\s+собой|поконч(?:у|ил[аи]?)\s+бы\s+со\s+всем(?:\s+этим)?|поконч(?:у|ил[аи]?)\s+со\s+всем(?:\s+этим)?(?![^\S\n]*[а-я])/,
  /убью\s+себя|себя\s+убью/,
  /суицид/,
  /самоубийств/,
  // First-person future
  /повешусь|застрелюсь|утоплюсь|отравлюсь|вскрою\s+вены|спрыгну\s+с\s+(?:крыши|моста|окна|балкона)|брошусь\s+под|наглотаюсь(?:\s+таблеток)?|выброшусь(?:\s+(?:из|в|с)\s+окн[а-я]*)?|выпью\s+все\s+таблетки/,
  // S-41: голое «умру» — быт («умру без кофе», «умру со стыда»); остро только после головы намерения.
  /(?:лучше\s+бы|скорей\s+бы|скорее\s+бы|пусть)\s+(?:я\s+)?умру(?!\s+(?:от|со)\s+(?:смех|смеху))/,
  // Idioms
  /(?:свести|сведу)\s+счет[ые]\s+с\s+жизнью/,
  /(?:наложить|наложу)\s+на\s+себя\s+руки/,
  /(?:лишить|лишу)\s+себя\s+жизни/,
  // S-41: «ушла/ушел из жизни» — горе о ком-то («ушел из жизни мой дедушка»); только первое лицо.
  /(?:уйти|уйду)\s+из\s+жизни/,
  /(?:расстаться|расстанусь)\s+с\s+жизнью/,
  /закончить\s+(?:свою\s+)?жизнь/,
  /перестать\s+существовать/,
  // S-41: та же оговорка про место и соседей, что у «не хочу жить» («надоело жить в этом городе»).
  new RegExp(String.raw`(?:мне\s+)?надоело\s+жить(?!\s+${ZHIT_SUPPRESS})`),
  new RegExp(String.raw`не\s+вижу\s+смысла\s+(?:дальше\s+)?жить(?!\s+${ZHIT_SUPPRESS})`),
  /так\s+жить\s+не\s+хочу|не\s+хочу\s+так\s+жить|жить\s+не\s+хочется|жить\s+больше\s+не\s+могу/,
  // S-41: \b после кириллицы не работает (ASCII-граница) — «от(?![а-я])».
  /(?:^|[^а-я])сдохнуть(?!\s+(?:можно|от(?![а-я])))(?![а-я])/,
  /лучше\s+бы\s+(?:меня\s+не\s+было|(?:я|меня)\s+не\s+родил(?:ся|ась))/,
  /пора\s+(?:уже\s+)?вс[её]\s+закончить/,
  /(?:скоро\s+)?вс[её]\s+закончу\s+со?\s+собой/,
  /смерть\s+кажется\s+избавлением/,
  /хочу\s+больше\s+не\s+просыпаться/,
  /ищу\s+способ\s+убить\s+себя/,
  // «не хочу больше жить» — тот же канонический случай, что «не хочу жить».
  new RegExp(String.raw`не\s+хочу\s+(?:больше\s+|дальше\s+|вообще\s+)?жить(?!\s+${ZHIT_SUPPRESS})`),
  /нет\s+смысла\s+(дальше\s+)?жить/,
  /лучше\s+бы\s+(я\s+)?(умер|погиб|не\s+родился)/,
  // Просторечные «сдохнуть/помереть», «устал жить», «незачем жить», «уснуть и
  // не проснуться» — те же намерения другими словами (раунд 5, таблица пропусков).
  /хочу\s+(?:сдохнуть|помереть)|лучше\s+бы\s+(?:я\s+)?(?:сдох|помер)/,
  new RegExp(String.raw`устал[аи]?\s+жить(?!\s+${ZHIT_SUPPRESS})|незачем\s+(?:больше\s+)?жить(?!\s+${ZHIT_SUPPRESS})|уснуть\s+и\s+не\s+проснуться|(?:хочу\s+)?исчезнуть\s+навсегда(?!\s+(?:из|с)\s)`),
  new RegExp(String.raw`думал.{0,200}\s+(?:о\s+смерти(?!\s+(?:мамы|папы|отца|родител|бабушк|дедушк|друг|близк|родных|собак|кошк))|убить\s+себя|${POKONCHIT})`),
  // R5-014: настоящее время. «думаю о смерти» сюда нарочно не входит — это
  // чаще горе о ком-то, чем план.
  new RegExp(String.raw`думаю.{0,200}\s+(?:убить\s+себя|${POKONCHIT})`),
  // Plan / means. Средства — целыми словами: «яд» сидит внутри «порядок», «наряд».
  // S-12 / S-30: вторая группа сужена с голого «себя» до действия («убить себя», «умереть», «с собой», «покончить»).
  // Граница допускает запятую (means/goal across a comma — решение S-30).
  // S-41: голое «с собой» — «таблетки взяла с собой в отпуск»; нужно «поконч… с собой».
  /(?:^|[^а-я])(таблетк|снотворн|нож|веревк|оруж|яд(?![а-я])|выброс[а-я]*\s+(?:из|в|с)\s+окн|выпрыгн|крыш|поезд|утоп)[^.!?\n]{0,100}\s+(?:поконч[а-я]*|(?<!не\s+)умереть|убить\s+себя|уснуть\s+навсегда|не\s+проснуться|поре[зж][а-я]*\s+себ[яе])/,
  // Self-harm intent
  /хочу\s+(порезать|навредить|причинить\s+боль|наказывать|ударить)\s+(себе|себя)/,
  /причинить\s+себе\s+боль|(?:порезал[аи]?|режу|порежу|порезать|перережу)\s+(?:себе\s+)?(?:руки|вены|запяст)/,
  /(?:наказывать|ударить|наказать)\s+себя.{0,100}\s+(?:до\s+крови|чтобы\s+было\s+больно|физически)/,
  /(?:режу|порежу)\s+себя/,
  /самоповрежд/,
  /наказать\s+себя.{0,200}\s+(физическ|боль|травм)/,
  // Goodbye / finality
  /прощайте(?!\s*,?\s*(?:уезжаю|в\s+отпуск))|прощай\s+всем|это\s+мо[её]\s+последн(?:ее\s+(?:письмо|сообщение)|яя\s+записка|ий\s+день)|это\s+мо[её]\s+последнее(?!\s+предупрежден)/,
  /никто\s+не\s+заметит.{0,200}(если|когда).{0,200}\s+(меня\s+не\s+будет|я\s+умру)/,
];
// M-16: разрывы между группами ограничены .{0,200} — с .* вырожденный ввод
// («никто не заметит если когда …» ×50k) бэктрекал минуты.

// L-1: короткие списки EN и транслита. Совпадают с латинским вариантом текста
// (кириллица сложена в латиницу), а не с кириллическим.
// M-15: \b — иначе «i want to diet» ловилось как «die».
const FOREIGN_RISK_PATTERNS: RegExp[] = [
  // English
  /\b(?:i\s+)?(?:want\s+to|wanna|going\s+to|gonna|plan\s+to|planning\s+to)\s+(?:die|kill\s+myself|end\s+my\s+life|take\s+my\s+life|end\s+it\s+all|off\s+myself|stop\s+existing|never\s+wake\s+up|hang\s+myself|overdose)\b/,
  // S-41: «will / might / ready to» — только от первого лица и на себя; голое «will die» — быт
  // («my plants will die», «i might die of boredom»).
  /\bi\s+(?:will|might)\s+(?:kill\s+myself|end\s+my\s+life|take\s+my\s+life|end\s+it\s+all|off\s+myself|stop\s+existing|never\s+wake\s+up|hang\s+myself|overdose)\b|\bi(?:['’]?m|\s+am)\s+ready\s+to\s+(?:die|kill\s+myself|end\s+my\s+life|take\s+my\s+life|end\s+it\s+all|off\s+myself|stop\s+existing|never\s+wake\s+up|hang\s+myself|overdose)\b/,
  /\bkill\s+myself\b/,
  /\bend\s+my\s+life\b/,
  /\bend\s+it\s+all\b/,
  /\bno\s+reason\s+to\s+(?:live|stay\s+alive)\b/,
  /\bplanning\s+to\s+hurt\s+myself\b/,
  // S-42.3: «commit/attempt … suicide» убран — строго внутри `\bsuicid`, ни одна фраза не красит корпус без него.
  /\bsuicid/,
  /\b(?:better\s+off\s+dead|wish\s+i\s+(?:could\s+die|(?:was|were)\s+dead))\b/,
  /\bdon['’]?t\s+want\s+to\s+live\b|\bdo\s+not\s+want\s+to\s+live\b/,
  // Translit
  /\bne\s+(?:hochu|xochu)\s+(?:bolshe\s+)?(?:zhit|jit)\b/,
  /\b(?:hochu|xochu|hotel[ai]?)\s+(?:sdochnut|ubit\s+sebya|ume?re?t)\b/,
  /\b(?:ubyu|ubju)\s+sebya\b/,
  /\bsamoubiy?stv|\bsamoubitstv/,
  /\b(?:sbrositsya|povesitsya|vskryt\s+veny)\b/,
  /\bpokonchit\s+s\s+sobo[jiy]\b/,
  /\bnet\s+smysla\s+(dalshe\s+)?zhit\b/,
  /\bdumal\s+o\s+smerti\b/,
];

function toGlobalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  return new RegExp(pattern.source, flags);
}

// S-13: Precompile global versions of regexes once at module scope with p.flags + 'g'.
const GLOBAL_RISK_PATTERNS: RegExp[] = RISK_PATTERNS.map(toGlobalPattern);
const GLOBAL_FOREIGN_RISK_PATTERNS: RegExp[] = FOREIGN_RISK_PATTERNS.map(toGlobalPattern);

// Инверсия CONFUSABLES_MAP (кириллица→латиница): латинская буква-двойник
// складывается в кириллицу. Дубликаты («А»→A и «а»→a) разрешаются в пользу
// первой записи. Только русские буквы: греческие и «і/ѕ/һ» паттерны не знают —
// h→һ прятал «Hе хочу жить» (M-14).
// S-5: цифра 0, греческая эта (Η/η) и латинская u.
const LATIN_LOOKALIKE_TO_CYRILLIC: Record<string, string> = (() => {
  const map: Record<string, string> = {
    '0': 'о',
    '\u0397': 'н',
    '\u03b7': 'н',
    'u': 'у',
  };
  for (const [cyr, lat] of Object.entries(CONFUSABLES_MAP)) {
    if (!/^[а-яА-Я]$/.test(cyr)) continue;
    const low = lat.toLowerCase();
    if (!(low in map)) map[low] = cyr.toLowerCase();
  }
  return map;
})();

function foldLatinLookalikes(text: string): string {
  // S-5: латинская h перед e/е — «н» («he хочу» → «не хочу»); иначе — «х» («hочу» → «хочу»).
  const withH = text.replace(/h(?=[еe])/gi, 'н').replace(/h/gi, 'х');
  let out = '';
  for (const ch of withH) out += LATIN_LOOKALIKE_TO_CYRILLIC[ch] ?? ch;
  return out;
}

// S-2: Подавление в русском языке разбито на три группы:
// 1. Глагольные отрицания: не|никогда не + хочу/буду/думал[аи]?/думаю/планирую/собираюсь/хотел[аи]?.
// Подавляют только вплотную перед совпадением (аналог FOREIGN_NEGATION_BEFORE).
// S-42 (решение владельца, S-2 §4): «не думаю о том, чтобы …» тоже управляет фразой — запятая перед «чтобы» не рвёт клаузу (CLAUSE_BREAK).
const RU_NEGATION_BEFORE = /(?:^|[^а-я])(?:никогда\s+не|не)\s+(?:(?:хочу|буду|думал[аи]?|думаю|планирую|собираюсь|хотел[аи]?)\s+(?:о\s+том,?\s+чтобы\s+)?)?$/;

// 2. Маркеры прошлого и совладания: только до совпадения, целыми словами, и не после «не ».
// S-41: голое «раньше» гасит только вплотную перед фразой («раньше [думал/хотел] хотел умереть»);
// «раньше я любила жизнь теперь хочу умереть» — остро. Отрицание через слово («не могу преодолеть») тоже снимает маркер.
const PAST_COPING_BEFORE = /(?:^|[^а-я])(?<!не\s+(?:[а-я]+\s+)?)(?:раньше\s+(?:(?:думал|хотел)[аи]?\s+)?$|была\s+мысль\s+но|справляюсь|преодол[а-я]*)(?![а-я])/;

// 3. Маркеры позиции. До совпадения — только если управляют фразой, т. е. вплотную перед ней
// (S-41: «в прошлом году я поняла что хочу умереть» — остро); после — см. STANCE_AFTER.
const STANCE_BEFORE = /(?:^|[^а-я])(?:не\s+вариант|не\s+про\s+меня|в\s+прошлом(?:\s+году)?)\s+(?:я\s+)?$/;
const NOUN_TOPIC = /^(?:суицид[а-я]*|самоубийств[а-я]*)$/;
// S-41: «для\b» после кириллицы — мёртвая граница; «суицид не вариант для меня, а выход» — остро.
const STANCE_AFTER = /^[\s,—–]*(?:это\s+|уже\s+)?(?:не\s+вариант(?!\s+для(?![а-я]))|не\s+про\s+меня(?:\s+сейчас)?|в\s+прошлом(?!\s+(?:вс[её]|все|было|год)))(?![а-я])/;

// M-15: отрицание для EN/транслита — «I don't want to kill myself», «ne hochu umeret».
// Только если оно управляет самой фразой, вплотную перед ней: «I'm not ok and
// I want to die» — одна клауза, но «not» к «want to die» не относится.
// R5-017 / S-5: вспомогательный глагол с отрицанием управляет и самим «kill»:
// «I won't / will not / wouldn't kill myself», «it's not that I want to die», «don't think I will».
const FOREIGN_NEGATION_BEFORE = /(?:\bdo(?:n['’]?t| not)|\bnot|\bnever|\bwon['’]?t)\s+(?:want|going|plan(?:ning)?|gonna|wanna)\s+(?:to\s+)?$|\b(?:won['’]?t(?:\s+ever)?|will\s+(?:not|never)|would(?:n['’]?t|\s+not|\s+never)|never|do(?:n['’]?t|\s+not)|(?:it['’]?s\s+|it\s+is\s+)?not\s+that|not)\s+$|\bdo(?:n['’]?t|\s+not)\s+think\s+(?:i\s+)?(?:will\s+)?$|\bne\s+$/;

// Граница клаузы: знак препинания или союз-поворот. Исключение из соседней
// клаузы («не думал о смерти, но хочу покончить с собой») острое не гасит.
// S-42: «, чтобы» — придаточное той же клаузы («не думаю о том, чтобы покончить с собой»).
const CLAUSE_BREAK = /[.;:!?\n—–]|,(?!\s*чтобы(?![а-я]))|\s(?:но|а|однако|but)\s/g;

export interface RiskResult {
  isRisk: boolean;
  severity: 'none' | 'acute';
  matchedPattern?: string;
}

const LETTER_RE = /[\p{L}\p{N}]/u;

function collapseSpacedSingleLetters(text: string): string {
  return text.replace(/(?:(?<=^|[^\p{L}])\p{L}(?:[^\S\n]+\p{L}){2,}(?=[^\p{L}]|$))/gu, (match) => {
    return match.replace(/[^\S\n]+/g, '');
  });
}

function baseNormalize(text: string, dropMode: 'space' | 'delete' = 'space'): { normalized: string; hadDrops: boolean } {
  let out = '';
  let dropped = false;
  let hadDrops = false;
  let lastChar = '';
  // S-4: NFC preserves precomposed characters (e.g. Cyrillic "й") while isolating non-precomposed accents.
  const nfc = text.normalize('NFC');
  for (const ch of nfc) {
    const cp = ch.codePointAt(0) ?? 0;
    // S-4: Combining diacritical marks (U+0300..U+036F, e.g. accents) are dropped unconditionally.
    if (cp >= 0x0300 && cp <= 0x036F) {
      continue;
    }
    const action = classifyInvisibleCodePoint(cp);
    if (action === 'drop') {
      hadDrops = true;
      if (dropMode === 'space') {
        dropped = true;
      }
      continue;
    }
    // In 'space' mode, an invisible char between two letters emits a space boundary.
    // S-13: Track last emitted char in a variable to avoid O(N) indexing into growing string.
    if (dropMode === 'space' && dropped && LETTER_RE.test(ch) && LETTER_RE.test(lastChar)) {
      out += ' ';
      lastChar = ' ';
    }
    dropped = false;
    const emitted = action === 'space' ? ' ' : ch;
    out += emitted;
    lastChar = emitted;
  }
  const lower = out.toLowerCase().replace(/ё/g, 'е');
  return { normalized: collapseSpacedSingleLetters(lower), hadDrops };
}

interface ClauseBreak {
  start: number;
  end: number;
}

function collectClauseBreaks(text: string): ClauseBreak[] {
  const breaks: ClauseBreak[] = [];
  CLAUSE_BREAK.lastIndex = 0;
  for (const m of text.matchAll(CLAUSE_BREAK)) {
    if (m.index !== undefined) {
      breaks.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return breaks;
}

function clauseBoundsFromBreaks(breaks: ClauseBreak[], textLength: number, start: number, end: number): [number, number] {
  let from = 0;
  let to = textLength;

  let low = 0;
  let high = breaks.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const b = breaks[mid];
    if (!b) break;
    if (b.end <= start) {
      from = b.end;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  low = 0;
  high = breaks.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const b = breaks[mid];
    if (!b) break;
    if (b.start >= end) {
      to = b.start;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return [from, to];
}

// S-13 / S-44.8: клауза перед совпадением, но не длиннее ~200 символов (до границы
// слова) — иначе маркеры сканируют всю клаузу на каждое совпадение, O(n·clause).
function clauseWindowBefore(lower: string, start: number, end: number, breaks: ClauseBreak[]): string {
  const [from] = clauseBoundsFromBreaks(breaks, lower.length, start, end);
  let winStart = from;
  if (start - from > 200) {
    winStart = start - 200;
    while (winStart > from && LETTER_RE.test(lower[winStart] ?? '')) {
      winStart--;
    }
  }
  return lower.slice(winStart, start);
}

function hasRussianNegationBefore(lower: string, start: number, end: number, breaks: ClauseBreak[]): boolean {
  return RU_NEGATION_BEFORE.test(clauseWindowBefore(lower, start, end, breaks));
}

function hasRussianSafeContext(lower: string, start: number, end: number, breaks: ClauseBreak[]): boolean {
  const before = clauseWindowBefore(lower, start, end, breaks);
  if (RU_NEGATION_BEFORE.test(before)) return true;
  if (PAST_COPING_BEFORE.test(before)) return true;
  if (STANCE_BEFORE.test(before)) return true;

  const matchText = lower.slice(start, end).trim();
  if (NOUN_TOPIC.test(matchText)) {
    // S-13: STANCE_AFTER is anchored at ^ and matches within 200 chars (can cross comma/dash)
    const after = lower.slice(end, end + 200);
    if (STANCE_AFTER.test(after)) return true;
  }

  return false;
}

function hasForeignNegationBefore(lower: string, start: number, end: number, breaks: ClauseBreak[]): boolean {
  return FOREIGN_NEGATION_BEFORE.test(clauseWindowBefore(lower, start, end, breaks));
}

type ContextCheck = (lower: string, start: number, end: number, breaks: ClauseBreak[]) => boolean;

function* acuteMatches(text: string, patterns: RegExp[]): Generator<[string, number, number, ClauseBreak[]]> {
  let breaks: ClauseBreak[] | null = null;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      breaks ??= collectClauseBreaks(text);
      yield [match[0], match.index, match.index + match[0].length, breaks];
    }
  }
}

function firstAcuteMatch(
  text: string,
  patterns: RegExp[],
  isSafe: ContextCheck,
  negatedElsewhere?: (match: string) => boolean,
): string | null {
  for (const [matched, start, end, breaks] of acuteMatches(text, patterns)) {
    if (isSafe(text, start, end, breaks)) continue;
    if (negatedElsewhere?.(matched)) continue;
    return matched;
  }
  return null;
}

// Три прохода одного текста: кириллические паттерны — против латинских
// букв-двойников; EN/транслит — против кириллицы, сложенной в латиницу.
// R5-018: CONFUSABLES_MAP складывает кириллическую «у» в «y», а в EN/транслите
// она подменяет и «u» («sуicide», «hochу») — второй проход с «у»→«u».
function passes(lower: string): [string, RegExp[], ContextCheck, ContextCheck][] {
  return [
    [foldLatinLookalikes(lower), GLOBAL_RISK_PATTERNS, hasRussianSafeContext, hasRussianNegationBefore],
    [foldConfusables(lower), GLOBAL_FOREIGN_RISK_PATTERNS, hasForeignNegationBefore, hasForeignNegationBefore],
    [foldConfusables(lower.replace(/у/g, 'u')), GLOBAL_FOREIGN_RISK_PATTERNS, hasForeignNegationBefore, hasForeignNegationBefore],
  ];
}

function checkRiskOnNormalized(lower: string, negatedElsewhere?: (match: string) => boolean): RiskResult {
  // Все совпадения всех паттернов: исключение у ранней фразы («раньше думал
  // о смерти») не должно прятать острую позже («а сейчас режу себя»).
  for (const [text, patterns, isSafe] of passes(lower)) {
    const matched = firstAcuteMatch(text, patterns, isSafe, negatedElsewhere);
    if (matched) return { isRisk: true, severity: 'acute', matchedPattern: matched };
  }
  return { isRisk: false, severity: 'none' };
}

// S-41: совпадения, которые в этом варианте нормализации гасит отрицание.
function negatedMatches(lower: string): Set<string> {
  const out = new Set<string>();
  for (const [text, patterns, , isNegated] of passes(lower)) {
    for (const [matched, start, end, breaks] of acuteMatches(text, patterns)) {
      if (isNegated(text, start, end, breaks)) out.add(matched);
    }
  }
  return out;
}

export function detectRisk(text: string): RiskResult {
  // S-4: Двойная нормализация — сначала удаление невидимых (склеивает разорванные слова),
  // затем замена на пробел (разлепляет склеенные невидимыми символами слова).
  const { normalized: normDelete, hadDrops } = baseNormalize(text, 'delete');
  if (!hadDrops) return checkRiskOnNormalized(normDelete);
  const { normalized: normSpace } = baseNormalize(text, 'space');
  if (normSpace === normDelete) return checkRiskOnNormalized(normDelete);

  // S-41: удаление невидимого склеивает отрицание с глаголом («не{ZWSP}хочу умереть» →
  // «нехочу умереть», «don{ZWSP}t» → «dont»). Фраза остра, только если её не гасит
  // отрицание в другом варианте нормализации; «по{ZWSP}вешусь» в «space» просто не
  // совпадает — не отрицание, остаётся острым. Множество считается лениво, по первой находке.
  const negatedIn = (variant: string) => {
    let set: Set<string> | null = null;
    return (match: string) => (set ??= negatedMatches(variant)).has(match);
  };
  const resDelete = checkRiskOnNormalized(normDelete, negatedIn(normSpace));
  if (resDelete.isRisk) return resDelete;
  return checkRiskOnNormalized(normSpace, negatedIn(normDelete));
}
