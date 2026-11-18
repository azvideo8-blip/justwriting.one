// THERAPY-2: Conservative crisis risk detector.
// Catches ONLY explicit acute risk markers (suicidal intent, plan, self-harm).
// Does NOT trigger on normal heavy reflection (sadness, fatigue, "всё плохо").

import { classifyInvisibleCodePoint, CONFUSABLES_MAP, foldConfusables } from '../../../shared/ai/buildChatPrompt';

// Текст сравнивается после normalize(): нижний регистр, ё→е, без невидимых
// символов — поэтому в паттернах только «е».

// C-1 (решение владельца 2026-10-02, backlog «Crisis detector» §1): канонические
// формулировки прямого намерения. Это эталон правила «такая фраза — знак риска в
// любом окружении», от него считаются и сильные, и подавленные формы
// (crisisStrongProperty.test.ts).
export const STRONG_RISK_PHRASES: readonly string[] = [
  'хочу умереть',
  'хочу умирать',
  'хочу убить себя',
  'покончить с собой',
  'покончить с жизнью',
  'не хочу жить',
  'не хочу больше жить',
  'хочу исчезнуть навсегда',
  'уснуть и не проснуться',
  'i want to die',
  'kill myself',
  'end my life',
];

// R5-016: «покончить с X» остро, только если X — «собой», «жизнью» или голое
// «с этим / со всем (этим)» в конце клаузы. «покончить с прокрастинацией»,
// «с этим бардаком» — быт. «Покончить» без «с …» остаётся острым.
const POKONCHIT = String.raw`покончить(?:\s+со?\s+(?:собо[йю]|(?:[а-я]+\s+)?жизнью|(?:всем|этим)(?:\s+(?:всем|этим))?(?:\s+(?:раз\s+и\s+)?навсегда)?(?![^\S\n]*[а-я]))|(?!\s+со?\s))`;
// R5-016 / S-1 (owner decision 2026-10-01): «хочу умереть» — маркер риска.
// Исключение остаётся только одно — смех («умереть от смеха», «со смеху»).
// Всё остальное («от любви», «от стыда», «со скуки») острое.
// C-2: в сильном слое глагол совпадает целиком, а смех — отдельная проверка
// подавления (LAUGHTER_AFTER): иначе погашенная фраза не попадает в void-диапазон
// и её подхватывает слабый means-паттерн из соседней клаузы («выпила таблетки,
// хочу умереть от смеха»). S-50: «умереть от смеха и от горя» — второе «и от …»
// снимает исключение.
const UMERET_STRONG = String.raw`(?:умереть|умирать|умру)(?![а-я])`;
// C-2: «покончить с X» во всех формах глагола. Остро, если названо «с собой / с
// жизнью» (или голое «со всем этим» в конце клаузы), либо дополнения нет вовсе в
// пределах клаузы: «покончила наконец с налоговой декларацией» — быт; голое
// «покончила» на конце («с готовкой на сегодня покончила») сейчас ложно остро (known gap, T-2).
const POKONCHIT_STRONG = String.raw`поконч(?:ить|у|ишь|ет|ем|ете|ут|ил[аи]?|евши)(?:\s+бы)?(?:\s+со?\s+(?:собо[йю]|(?:[а-я]+\s+)?жизнью|(?:всем|этим)(?:\s+(?:всем|этим))?(?:\s+(?:раз\s+и\s+)?навсегда)?(?![^\S\n]*[а-я]))|(?![^.!?\n,;]{0,25}\sсо?\s+[а-я]))`;
// S-50: техника «решила сдохнуть» — не человек. C-2: только слабый слой —
// «телефон молчит хочу умереть» остаётся острым.
const DEVICE_BEFORE = String.raw`(?<!(?:ноутбук|телефон|комп|компьютер|машина|принтер|роутер|холодильник|сервер|батарея|аккумулятор)\s+(?:[а-я]+\s+)?)`;
// C-2 (регрессии-ложняки «можно сдохнуть от тоски на этой лекции», «чуть не
// сдохнуть от страха на американских горках»): гипербола снимает только «сдохнуть».
const HYPERBOLE_BEFORE = String.raw`(?<!(?:можно|нельзя|чуть|немного)\s+(?:не\s+)?)`;
// R5-004: «не хочу жить в этом городе / у родителей / с ним / одна» — про место
// и соседей, не острое. «в/на» с миром, светом, болью, страхом, одиночеством
// и т. п. остаются острыми, «с» — только с людьми (с этой болью — острое).
const ZHIT_WHERE = String.raw`(?:в|во|на)\s+(?!(?:[а-я]+\s+)?(?:мир|свет|жизн|ад[уе]?(?![а-я])|страх|бол|муч|одиночеств|тоск|пустот|отчаяни|депресс|тел[еоу]?(?![а-я])|темнот))[а-я]`;
const ZHIT_WITH = String.raw`со?\s+(?:(?:ним|ней|ними|тобой|вами)(?![а-я])|родител|мам|пап|муж|жен|сосед|бывш|парн|девушк)`;
const ZHIT_PLACE = String.raw`(?:у|под|за|возле|около|рядом|вместе|среди|здесь|тут|там|одн[аио]|один)(?![а-я])`;
// S-12: образ действия и творительный падеж («по-старому», «как раньше», «прошлым», «чужой жизнью»)
// C-2 (регрессия «незачем жить ради такого»): указательное местоимение уклад не
// называет — «ради этого/такого/них» оговоркой не считается.
// R-4: класс `не[её]` — обе буквы кириллические.
// T-7: буква `ё` после ё→е не доходит до шаблона — альтернатива `неё|` мертва и снята.
const ZHIT_RADI = String.raw`ради\s+(?!этого|этим|такого|такое|такой|того|той|тех|этих|них|него|не[её](?![а-я]))[а-я]+`;
const ZHIT_MANNER = String.raw`(?:(?:по|как)\s+[а-я]+|прошлым|чужой\s+жизнью|${ZHIT_RADI}|от\s+[а-я]+\s+до\s+[а-я]+|так\s+(?:экономно|скромно|бедно|дорого|далеко))(?![а-я])`;
const ZHIT_SUPPRESS = String.raw`(?:${ZHIT_WHERE}|${ZHIT_WITH}|${ZHIT_PLACE}|${ZHIT_MANNER})`;
// C-2: для сильной фразы «не хочу жить» оговоркой остаётся только то, что называет
// место или людей («в этом городе», «с ним», «у родителей»). «так бедно и одиноко»
// уклада не описывает — это по-прежнему отказ от воли жить (регрессия из backlog).
// T-7: «ради» снято и с сильного слоя («не хочу жить ради детей / себя» — риск).
// Единственный уклад по «ради» — конкретное «ради чужих ожиданий» (S-50).
const ZHIT_MANNER_STRONG = String.raw`(?:(?:по|как)\s+[а-я]+|прошлым|чужой\s+жизнью|ради\s+чужих\s+ожиданий|от\s+[а-я]+\s+до\s+[а-я]+)(?![а-я])`;
const ZHIT_SUPPRESS_STRONG = String.raw`(?:${ZHIT_WHERE}|${ZHIT_WITH}|${ZHIT_PLACE}|${ZHIT_MANNER_STRONG})`;

// S-41: левая граница — «решили» сидит внутри «разрешили» («ему разрешили умереть дома»).
// S-50: «за-» перед хоте/хоч остаётся головой («я захотела умереть», «если я захочу умереть»).
// C-2: голова расширена формами настоящего/будущего и «хотелось» — открытые пропуски
// «мне хотелось умереть», «он захочет убить себя».
const HEAD = String.raw`(?<![а-я])(?:(?:за|до|пере)?(?:хоч(?:у|ешь|ет|ем|ете|ут|ется)|хот(?:ел[аи]?|ела|ели|ите|елось)(?:\s+бы)?|хотеть)|(?:бу(?:ду|дешь|дем|дете|дет|дут)\s+)?хот(?:еть|ело)|готов[аы]?(?:\s+бы)?|собира(?:юсь|ется|емся|етесь)|планиру(?:ю|ешь|ет|ем|ете|ют)|решил[аи]?)`;
const METHOD_VERBS = String.raw`повеситься|застрелиться|утопиться|отравиться|вскрыть\s+вены|спрыгнуть(?:\s+с\s+[а-я]+)?|прыгнуть\s+с\s+(?:моста|крыши|окна|балкона)(?!\s+(?:на\s+тарзанк|(?:[а-я]+\s+){0,3}(?:в|под)\s+(?:сугроб|снег|бассейн|воду|пруд|озеро|такси|машин)))|броситься\s+под(?:\s+[а-я]+)?|наглота(?:ться|юсь)(?:\s+таблеток)?|выброситься|шагнуть\s+с\s+крыши|вып(?:ить|ью)\s+все\s+таблетки(?:\s+разом)?`;

const STRONG_RISK_PATTERNS: RegExp[] = [
  // C-2: сильное намерение. Ни оговорка про технику, ни уклад/место, ни голое
  // «раньше» его не гасят — только отрицание, смех и отказ (hasStrongSuppression).
  new RegExp(String.raw`${HEAD}\s+${UMERET_STRONG}`),
  new RegExp(String.raw`${HEAD}\s+убить\s+себя`),
  /убью\s+себя|себя\s+убью/,
  // «не хочу жить» абсолютно; с названным местом/людьми — не про волю жить.
  // «больше/дальше/вообще/совсем» — остро при любом дополнении (регрессия
  // «не хочу больше жить ради этого»).
  new RegExp(String.raw`не\s+хочу\s+(?:больше|дальше|вообще|совсем)\s+жить|не\s+хочу\s+(?:[а-я]+\s+){0,2}жить(?!\s+${ZHIT_SUPPRESS_STRONG})`),
  /(?:так\s+жить\s+не\s+хочу|не\s+хочу\s+так\s+жить|жить\s+не\s+хочется|жить\s+больше\s+не\s+могу)/,
  // «хочу исчезнуть» без названного направления — то же намерение другими словами
  // (регрессия «устала жить ради других, хочу исчезнуть»).
  new RegExp(String.raw`${HEAD}\s+исчезнуть(?![^.!?\n,;]{0,25}\s(?:из|со?|в|во|на|под|за|от|куда)\s+[а-я])`),
  new RegExp(String.raw`уснуть\s+и\s+(?:никогда\s+)?не\s+(?:проснуться|просыпаться)(?![а-я])`),
  // HY-1 (стенд гипотез Fable, 17.11): «не хочу больше просыпаться» — отказ от
  // жизни, но только в конце клаузы: «не хочу больше просыпаться в шесть утра» — быт.
  new RegExp(String.raw`не\s+хочу\s+(?:больше|вообще)\s+просыпаться(?=\s*(?:[.!?,;\n—–]|$|и\s|никогда|совсем))`),
  /хочу,?\s+чтобы\s+меня\s+не\s+стало/,
  // T-7: «уходить/уйти из жизни» в 1-м лице наст./буд.
  // T-10: не когда за «из жизни» стоит родительный падеж лица (этого человека, бывшего, его/её).
  // 0.9.30 review: «из жизни <чего угодно>» — уйти из чьей-то жизни, из соцсетей,
  // из мегаполиса — быт. Остро только голое «из жизни»: конец клаузы, «навсегда»,
  // слово времени.
  /(?:уйти|уходить|уйду|ухожу)\s+из\s+жизни(?=\s*(?:[.!?,;\n—–]|$|навсегда|сегодня|завтра|скоро|сейчас|прямо|уже))|(?:расстаться|расстанусь)\s+с\s+жизнью|закончить\s+(?:свою\s+)?жизнь|перестать\s+существовать/,
  // «меня не станет» — почти всегда о себе всерьёз: без якоря начала и без правила
  // запятой (T-10 их сюда зря распространил: «Меня не станет, и никто не вспомнит»
  // молчало). Исключения — «не станет видно/слышно» и «не станет + глагол»: «он меня
  // не станет слушать / ждать» — «не будет делать», а не «меня не будет».
  /меня\s+(?:(?:просто|уже|больше|скоро|завтра|совсем)\s+)?не\s+станет(?!\s+(?:видно|слышно|[а-я]+(?:ть|ти|чь)(?![а-я])))/,
  // «меня не будет» — быт («на встрече меня не будет», «сегодня меня не будет,
  // заболела»), кроме двух форм:
  // 1) продолжение говорит, о каком «не будет» речь: «…, и никто не заметит», «…, я
  //    всё решила», «когда меня не будет, вы поймёте», «…, и это к лучшему»;
  /меня\s+(?:(?:уже|больше|просто|совсем|скоро|завтра)\s+)?не\s+будет\s*[,—–-]?\s*(?:и\s+)?(?:никто|никому|всем|вам\s+станет|тебе\s+станет|это\s+к\s+лучшему|я\s+(?:все\s+|так\s+|уже\s+)?решил|вы\s+поймете|ты\s+поймешь|обещаю|навсегда|совсем(?![а-я])|больше\s+никогда)/,
  // 2) голое «(завтра/скоро/уже) меня не будет» с начала клаузы и до её настоящего
  //    конца (точка, ?!, перевод строки): тире и «;» продолжают бытовую фразу
  //    («Меня не будет — уезжаю в отпуск», «Завтра меня не будет; перенеси встречу»).
  /(?:^|[.!?\n])\s*(?:я\s+)?(?:(?:завтра|скоро|послезавтра)\s+)?меня\s+(?:(?:завтра|скоро|послезавтра|уже|больше|просто)\s+)?не\s+будет(?:\s+(?:завтра|скоро|послезавтра))?(?=\s*(?:[.!?\n]|$))/,
  // T-7: «хочу быть мёртв(ой|ым)».
  // T-10: не с «в игре/на сцене/персонажем/от усталости».
  // 0.9.30 review: остро только «быть мёртвой» без дополнения (конец клаузы, «и …»,
  // «навсегда»); «мёртвой царевной на маскараде», «в игре», «персонажем» — быт.
  new RegExp(String.raw`${HEAD}\s+быть\s+мертв(?:ой|ым|а|ом)?(?=\s*(?:[.!?,;\n—–]|$|и\s|навсегда|уже|прямо|сейчас))`),
  /лучше\s+бы\s+(?:я\s+)?(?:был|была|быть)\s+мертв(?:ой|ым|а|ом)?(?![а-я])/,
  /(?:свести|сведу)\s+счет[ые]\s+с\s+жизнью|(?:наложить|наложу)\s+на\s+себя\s+руки|(?:лишить|лишу)\s+себя\s+жизни/,
  // «лучше умереть», «лучше бы я умер» — пожелание смерти себе. Смех
  // («лучше бы я умер со смеху») снимает это проверкой LAUGHTER_AFTER, не формой.
  /(?:лучше\s+бы|скорей\s+бы|скорее\s+бы|пусть|лучше)\s+(?:я\s+|мне\s+|меня\s+)?(?:умру|умереть|умер(?:ла|ло|ли)?)(?![а-я])/,
  /лучше\s+бы\s+(?:меня\s+не\s+было|(?:я|меня)\s+не\s+родил(?:ся|ась))/,
  // Голое «покончила» без названного дополнения — конец, а не уборка.
  new RegExp(String.raw`${POKONCHIT_STRONG}(?:\s+со?\s+(?:собо[йю]|(?:[а-я]+\s+)?жизнью)|(?!\s+со?\s+[а-я]))`),
];

const RISK_PATTERNS: RegExp[] = [
  // Explicit suicidal intent & personal forms
  // S-50: «ноутбук решил сдохнуть» — техника, не человек; C-2: умереть/убить себя/
  // покончить ушли в сильный слой, здесь остаются «сдохнуть/помереть» и способы.
  new RegExp(String.raw`${DEVICE_BEFORE}${HEAD}\s+(?:сдохнуть|помереть|${METHOD_VERBS})`),
  // S-50: целым словом — иначе проверка позиции после совпадения видит «о…» из окончания.
  /суицид[а-я]*/,
  /самоубийств[а-я]*/,
  // First-person future
  /повешусь|застрелюсь|утоплюсь|отравлюсь|вскрою\s+вены|спрыгну\s+с\s+(?:крыши|моста|окна|балкона)|брошусь\s+под|наглотаюсь(?:\s+таблеток)?|выброшусь(?:\s+(?:из|в|с)\s+окн[а-я]*)?|выпью\s+все\s+таблетки/,
  // S-41: та же оговорка про место и соседей, что у «не хочу жить» («надоело жить в этом городе»).
  new RegExp(String.raw`(?:мне\s+)?надоело\s+жить(?!\s+${ZHIT_SUPPRESS})`),
  new RegExp(String.raw`не\s+вижу\s+смысла\s+(?:дальше\s+)?жить(?!\s+${ZHIT_SUPPRESS})`),
  // S-41: \b после кириллицы не работает (ASCII-граница) — «от(?![а-я])».
  // S-50: «от» снимает только быт — жара, скука, смех, усталость, голод, холод; «сдохнуть от этой жизни» остро.
  new RegExp(String.raw`(?:^|[^а-я])${DEVICE_BEFORE}${HYPERBOLE_BEFORE}сдохнуть(?!\s+(?:можно|от\s+(?:(?:этой|этого|такой|такого)\s+)?(?:жар|скук|смех|устал|голод|холод|духот|жажд)))(?![а-я])`),
  /пора\s+(?:уже\s+)?вс[её]\s+закончить/,
  /(?:скоро\s+)?вс[её]\s+закончу\s+со?\s+собой/,
  /смерть\s+кажется\s+избавлением/,
  // C-2 (ложное срабатывание «не хочу просыпаться никогда по будильнику»): названная
  // бытовая причина снимает; «хочу больше не просыпаться» остаётся.
  /хочу\s+больше\s+не\s+просыпаться|не\s+хочу\s+(?:больше\s+)?просыпаться\s+(?:больше\s+)?никогда(?![^.!?\n]{0,30}(?:будильник|звонк|утром|на\s+работ))/,
  /ищу\s+способ\s+убить\s+себя/,
  /нет\s+смысла\s+(дальше\s+)?жить/,
  /лучше\s+бы\s+(?:я\s+)?погиб/,
  // Просторечные «сдохнуть/помереть», «устал жить», «незачем жить» — те же намерения
  // другими словами (раунд 5, таблица пропусков), но в слабом слое: уклад и место
  // («устала жить с родителями», «незачем жить в этом городе») снимают.
  /(?:хочу|хочется|хотел[аи]?)\s+(?:сдохнуть|помереть)|лучше\s+бы\s+(?:я\s+)?(?:сдох|помер)/,
  new RegExp(String.raw`устал[аи]?\s+жить(?!\s+${ZHIT_SUPPRESS})|незачем\s+(?:больше\s+)?жить(?!\s+${ZHIT_SUPPRESS})`),
  new RegExp(String.raw`думал.{0,200}\s+(?:о\s+смерти(?!\s+(?:мамы|папы|отца|родител|бабушк|дедушк|друг|близк|родных|собак|кошк))|убить\s+себя|${POKONCHIT})`),
  // R5-014: настоящее время. «думаю о смерти» сюда нарочно не входит — это
  // чаще горе о ком-то, чем план.
  new RegExp(String.raw`думаю.{0,200}\s+(?:убить\s+себя|${POKONCHIT})`),
  // HY-1: «думаю наглотаться таблеток», «подумываю повеситься» — способ сразу после
  // «думаю» (без зазора: «думаю, кошка могла отравиться» — не о себе).
  new RegExp(String.raw`(?<![а-я])(?:думаю|подумываю|задумываюсь)\s+(?:о\s+том,?\s+(?:как|чтобы)\s+)?(?:${METHOD_VERBS})`),
  // HY-1: «всем без меня будет проще» — в конце клаузы («им без меня проще работать» — быт).
  new RegExp(String.raw`(?:(?<![а-я])(?:всем|им|вам|семье|родным|близким|детям|миру)\s+(?:(?:будет|станет)\s+)?(?:только\s+)?(?:лучше|проще|легче|спокойнее)\s+без\s+меня|(?<![а-я])(?:всем|им|вам|семье|родным|близким|детям|миру)\s+без\s+меня\s+(?:(?:будет|станет)\s+)?(?:только\s+)?(?:лучше|проще|легче|спокойнее)|без\s+меня\s+(?:всем|им|вам|семье|родным|близким|детям|миру)\s+(?:(?:будет|станет)\s+)?(?:только\s+)?(?:лучше|проще|легче|спокойнее))(?=\s*(?:[.!?,;\n—–]|$|и\s))`),
  // Plan / means. Средства — целыми словами: «яд» сидит внутри «порядок», «наряд».
  // S-12 / S-30: вторая группа сужена с голого «себя» до действия («убить себя», «умереть», «с собой», «покончить»).
  // Граница допускает запятую (means/goal across a comma — решение S-30).
  // S-41: голое «с собой» — «таблетки взяла с собой в отпуск»; нужно «поконч… с собой».
  // S-50: «поконч…» — только «с собой / с жизнью» или в конце клаузы: «взяла таблетки от головы и покончила с уборкой» — быт.
  // C-2: «мост» — место до глагола («стою на мосту хочу прыгнуть»); «таблетки/лекарства
  // от <чего>» — назначение, а не средство; мягкое приземление прыжка — тоже не средство.
  new RegExp(String.raw`(?:^|[^а-я])((?:таблетк|снотворн)(?![а-я]*(?:\s+[а-я]+){0,2}\s+от\s+[а-я])|нож|веревк|оруж|мост[а-я]*|яд(?![а-я])|выброс[а-я]*\s+(?:из|в|с)\s+окн|выпрыгн|крыш|поезд|утоп)[^.!?\n]{0,100}\s+(?:${POKONCHIT}|поконч(?:у|ил[аи]?)(?:\s+со?\s+(?:собо[йю]|жизнью)|(?![^\S\n]*[а-я]))|(?<!не\s+)умереть|убить\s+себя|уснуть\s+навсегда|не\s+проснуться|поре[зж][а-я]*\s+себ[яе]|${METHOD_VERBS}|вып(?:ью|ить)\s+вс[её](?:\s+(?:сразу|разом))?(?![а-я])|прыгнуть(?![а-я])(?!\s+(?:на\s+тарзанк|(?:[а-я]+\s+){0,3}(?:в|под)\s+(?:сугроб|снег|бассейн|воду|пруд|озеро|такси|машин))))`),
  // Self-harm intent
  /хочу\s+(порезать|навредить|причинить\s+боль|наказывать|ударить)\s+(себе|себя)/,
  /причинить\s+себе\s+боль|(?:порезал[аи]?|режу|порежу|порезать|перережу)\s+(?:себе\s+)?(?:руки|вены|запяст)/,
  /(?:наказывать|ударить|наказать)\s+себя.{0,100}\s+(?:до\s+крови|чтобы\s+было\s+больно|физически)/,
  /(?:режу|порежу)\s+себя/,
  // S-50: «сегодня снова порезалась» — возвратная форма с «снова/опять/специально»; «порезала палец» — быт.
  // C-2 (регрессии-ложняки «опять порезалась бумагой», «снова порезалась, когда
  // резала лук»): названная бытовая причина снимает — порез не замысел.
  /(?:снова|опять|специально|нарочно)\s+порезал[аи]сь(?![^.!?\n]{0,40}(?:бумаг|луко|лука|ножницам|при\s+готовк|когда\s+резал|на\s+работ))|порезал[аи]сь\s+(?:снова|опять|специально|нарочно)(?![^.!?\n]{0,40}(?:бумаг|луко|лука|ножницам|при\s+готовк|когда\s+резал|на\s+работ))/,
  /самоповрежд/,
  /наказать\s+себя.{0,200}\s+(физическ|боль|травм)/,
  // Goodbye / finality
  // C-2 (регрессии «…перед тем как я уйду навсегда», «…в этом чате и в этой жизни»):
  // бытовое назначение снимает, только пока в продолжении не названы жизнь или уход.
  /прощайте(?!\s*,?\s*(?:уезжаю|в\s+отпуск))|прощай\s+всем|это\s+мо[её]\s+последн(?:ее\s+(?:письмо|сообщение)(?!\s+(?:в\s+(?:этом\s+)?(?:чате|группе|треде)|перед\s)(?![^.!?\n]{0,40}(?:жизн|навсегда|уход)))|яя\s+записка|ий\s+день)|это\s+мо[её]\s+последнее(?!\s+(?:предупрежден|занятие|сообщение\s+(?:в\s+(?:этом\s+)?(?:чате|группе|треде)|перед\s)(?![^.!?\n]{0,40}(?:жизн|навсегда|уход))))/,
  /никто\s+не\s+заметит.{0,200}(если|когда).{0,200}\s+(меня\s+не\s+будет|я\s+умру)/,
];
// M-16: разрывы между группами ограничены .{0,200} — с .* вырожденный ввод
// («никто не заметит если когда …» ×50k) бэктрекал минуты.

// L-1: короткие списки EN и транслита. Совпадают с латинским вариантом текста
// (кириллица сложена в латиницу), а не с кириллическим.
// M-15: \b — иначе «i want to diet» ловилось как «die».
const STRONG_FOREIGN_RISK_PATTERNS: RegExp[] = [
  /\b(?:i\s+)?(?:want\s+to|wanna|going\s+to|gonna|plan\s+to|planning\s+to)\s+(?:die|kill\s+myself|end\s+my\s+life|take\s+my\s+life|end\s+it\s+all|off\s+myself|stop\s+existing|never\s+wake\s+up|hang\s+myself|overdose)\b/,
  /\bkill\s+myself\b/,
  /\bend\s+my\s+life\b/,
  /\bend\s+it\s+all\b/,
  /\bdon['’]?t\s+want\s+to\s+live\b|\bdo\s+not\s+want\s+to\s+live\b/,
  /\b(?:better\s+off\s+dead|wish\s+i\s+(?:could\s+die|(?:was|were)\s+dead))\b/,
  // C-2: транслит — те же сильные формулировки, записанные латиницей.
  /\b(?:hochu|xochu|hot(?:el|ela|eli|elo|al[ia]?))\s+(?:ume?re?t|ubit\s+sebya)\b/,
  /\b(?:ubyu|ubju)\s+sebya\b/,
  /\bpokonchit\s+s\s+sobo[jiy]\b/,
  /\bne\s+(?:hochu|xochu)\s+(?:bolshe\s+)?(?:zhit|jit)\b/,
];

const FOREIGN_RISK_PATTERNS: RegExp[] = [
  // English
  // S-41: «will / might / ready to» — только от первого лица и на себя; голое «will die» — быт
  // («my plants will die», «i might die of boredom»).
  /\bi\s+(?:will|might)\s+(?:kill\s+myself|end\s+my\s+life|take\s+my\s+life|end\s+it\s+all|off\s+myself|stop\s+existing|never\s+wake\s+up|hang\s+myself|overdose)\b|\bi(?:['’]?m|\s+am)\s+ready\s+to\s+(?:die|kill\s+myself|end\s+my\s+life|take\s+my\s+life|end\s+it\s+all|off\s+myself|stop\s+existing|never\s+wake\s+up|hang\s+myself|overdose)\b/,
  // S-50: «i will die tonight, i have the pills» — первое лицо + время или средство; «my plants will die» — быт.
  // C-2 (регрессии-ложняки «i will die today if i don't get coffee», «i might die this
  // week from all the deadlines»): названное условие или причина — гипербола, не план.
  /\bi\s+(?:will|might|am\s+going\s+to)\s+die\s+(?:tonight|today|soon|this\s+(?:night|week))\b(?![^.!?\n]{0,40}\b(?:if|from|because|unless)\b)|\bi\s+will\s+die\b[^.!?\n]{0,80}\b(?:pills|rope|knife|gun|overdose)\b/,
  /\bno\s+reason\s+to\s+(?:live|stay\s+alive)\b/,
  /\bplanning\s+to\s+hurt\s+myself\b/,
  // S-42.3: «commit/attempt … suicide» убран — строго внутри `\bsuicid`, ни одна фраза не красит корпус без него.
  /\bsuicid/,
  // Translit
  /\b(?:hochu|xochu|hotel[ai]?)\s+(?:sdochnut)\b/,
  /\bsamoubiy?stv|\bsamoubitstv/,
  /\b(?:sbrositsya|povesitsya|vskryt\s+veny)\b/,
  /\bnet\s+smysla\s+(dalshe\s+)?zhit\b/,
  /\bdumal\s+o\s+smerti\b/,
];

function toGlobalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  return new RegExp(pattern.source, flags);
}

// S-13: Precompile global versions of regexes once at module scope with p.flags + 'g'.
const GLOBAL_STRONG_RISK_PATTERNS: RegExp[] = STRONG_RISK_PATTERNS.map(toGlobalPattern);
const GLOBAL_RISK_PATTERNS: RegExp[] = RISK_PATTERNS.map(toGlobalPattern);
const GLOBAL_STRONG_FOREIGN_RISK_PATTERNS: RegExp[] = STRONG_FOREIGN_RISK_PATTERNS.map(toGlobalPattern);
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
// C-2: список глаголов расширен формами головы намерения (хочет/хотела/хотелось,
// планируем/собираетесь/намерена) — сильный слой проверяет отрицание этим же регуляром.
const RU_NEGATION_BEFORE = /(?:^|[^а-я])(?:никогда\s+не|не)\s+(?:(?:хоч(?:у|ешь|ет|ем|ете|ут|ется)|хот(?:ел[аи]?|ела|ели|ось|ите)|буду|будет|будем|будете|будут|дума[а-я]*|планиру[а-я]*|собира[а-я]*|решил[аи]?|намер[еява]*)\s+(?:о\s+том,?\s+чтобы\s+)?)?$/;

// 2. Маркеры прошлого и совладания: только до совпадения, целыми словами, и не после «не ».
// S-41: голое «раньше» гасит только вплотную перед фразой («раньше [думал/хотел] хотел умереть»);
// «раньше я любила жизнь теперь хочу умереть» — остро. Отрицание через слово («не могу преодолеть») тоже снимает маркер.
// S-50: между «раньше» и фразой допускается до четырёх слов («раньше у меня были мысли покончить с собой»);
// маркер настоящего в этом промежутке («теперь/сейчас/снова/опять») снимает оговорку.
const PAST_COPING_BEFORE = /(?:^|[^а-я])(?<!не\s+(?:[а-я]+\s+)?)(?:раньше(?:\s+(?!(?:теперь|сейчас|снова|опять)(?![а-я]))[а-я]+){0,4}\s+$|была\s+мысль\s+но|(?:справляюсь|преодол[а-я]*)(?:\s+[а-я]+){0,2}\s+$)(?![а-я])/;

// C-2 (c): отказ «раньше … — сейчас/теперь не …» для сильного слоя. Маркер прошлого
// стоит вплотную (до четырёх слов), сама фраза в прошедшем времени или названа
// «мыслью», а следом нет подтверждения в настоящем. «раньше я хотела умереть, и
// сейчас тоже» — риск; «раньше хотел умереть, сейчас не хочу» — safe.
const PAST_DENIAL_BEFORE = /(?:^|[^а-я])(?:раньше|прежде|когда-то|ранее|в\s+прошлом(?:\s+году)?)(?:\s+(?!(?:теперь|сейчас|сегодня|уже|снова|опять|до\s+сих\s+пор)(?![а-я]))[а-я]+){0,4}\s+(?!(?:[а-я]+\s+){0,4}(?:хочу|хочет|хотим|хотите|хотят))$/;
const PAST_GOVERNED = /(?:хот(?:ел[аи]?|ела|ели|ось|ите)|дум(?:ал[аи]?|аю)|планировал[аи]?|собирал[аи]?сь|решил[аи]?|мысл[а-я]*)\s*$/;
// Настоящее без отрицания — подтверждение намерения, а не отказ.
const PRESENT_REFIRM_AFTER = /^[\s,—–]*(?:и\s+)?(?:сейчас|теперь|сегодня|уже|снова|опять|вс[её]\s+ещ[ёе])(?![^.!?\n]{0,24}не\s)/;
// C-2 (b): смех — единственное исключение из «хочу умереть». S-50: «и от …»
// следом снимает исключение («умереть от смеха и от горя» остаётся острым).
const LAUGHTER_AFTER = /^\s+(?:от|со)\s+(?:смех|смеху|хохот)[а-я]*(?![а-я])(?!\s+(?:и|да)\s+(?:от|со)\s)/;

// 3. Маркеры позиции. До совпадения — только если управляют фразой, т. е. вплотную перед ней
// (S-41: «в прошлом году я поняла что хочу умереть» — остро); после — см. STANCE_AFTER.
// S-50: «не вариант / не про меня» перед фразой гасят только тему-существительное («самоубийство — не про меня,
// суицид…»); перед глагольной фразой («жить так не вариант хочу умереть») они её не снимают.
const STANCE_BEFORE = /(?:^|[^а-я])в\s+прошлом(?:\s+году)?\s+(?:я\s+)?$/;
const STANCE_BEFORE_NOUN = /(?:^|[^а-я])(?:не\s+вариант|не\s+про\s+меня)\s+(?:я\s+)?$/;
const NOUN_TOPIC = /^(?:суицид[а-я]*|самоубийств[а-я]*)$/;
// S-41: «для\b» после кириллицы — мёртвая граница; «суицид не вариант для меня, а выход» — остро.
// S-50: «X не вариант (для меня)» — защитная позиция; остро только продолжение через «а/но» («не вариант для меня, а выход»).
// C-2: позиция снимает острую тему, только если в том же предложении не утверждён
// выход («суицид не вариант для меня, это единственный выход» — риск); «для меня»
// может стоять и до слова позиции («суицид для меня не вариант» — safe).
const STANCE_AFTER = /^[\s,—–]*(?:для\s+меня\s+|это\s+|уже\s+)?(?:не\s+вариант(?!\s*,?\s*(?:а|но)(?![а-я]))(?!\s+для\s+меня\s*,?\s*(?:а|но)(?![а-я]))(?:\s+для\s+меня)?|не\s+про\s+меня(?:\s+сейчас)?|в\s+прошлом(?!\s+(?:вс[её]|все|было|год)))(?![а-я])(?![^.!?\n]{0,40}(?:выход|остал[а-я]*\s+реши|так\s+и\s+сделаю))/;

// M-15: отрицание для EN/транслита — «I don't want to kill myself», «ne hochu umeret».
// Только если оно управляет самой фразой, вплотную перед ней: «I'm not ok and
// I want to die» — одна клауза, но «not» к «want to die» не относится.
// R5-017 / S-5: вспомогательный глагол с отрицанием управляет и самим «kill»:
// «I won't / will not / wouldn't kill myself», «it's not that I want to die», «don't think I will».
const FOREIGN_NEGATION_BEFORE = /(?:\bdo(?:n['’]?t| not)|\bnot|\bnever|\bwon['’]?t)\s+(?:want|going|plan(?:ning)?|gonna|wanna)\s+(?:to\s+)?$|\b(?:won['’]?t(?:\s+ever)?|will\s+(?:not|never)|would(?:n['’]?t|\s+not|\s+never)|never|do(?:n['’]?t|\s+not)|(?:it['’]?s\s+|it\s+is\s+)?not\s+that|not)\s+$|\bdo(?:n['’]?t|\s+not)\s+think\s+(?:i\s+)?(?:will\s+)?$|\b(?:it['’]?s|it\s+is)\s+not\s+that\s+(?:i\s+)?(?:(?:want|plan)\s+to|going\s+to|gonna|wanna)?\s+$|\bne\s+$/;

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

const SPACED_LETTERS_RE = /(?:(?<=^|[^\p{L}])\p{L}(?:[^\S\n]+\p{L}){2,}(?=[^\p{L}]|$))/gu;

function collapseSpacedSingleLetters(text: string): string {
  return text.replace(SPACED_LETTERS_RE, (match) => {
    return match.replace(/[^\S\n]+/g, '');
  });
}

// C-2: то же свёртывание, но с перенумерацией карты смещений — пробелы, которые
// внутри «х о ч у» убираются,исчезают из карты тоже.
function collapseWithOffsets(text: string, offsets: Int32Array): { normalized: string; offsets: Int32Array } {
  SPACED_LETTERS_RE.lastIndex = 0;
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(SPACED_LETTERS_RE)) {
    if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length]);
  }
  if (ranges.length === 0) return { normalized: text, offsets };
  let out = '';
  const kept: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const inRange = ranges.some(([from, to]) => i >= from && i < to);
    if (inRange && /[^\S\n]/.test(text[i]!)) continue;
    out += text[i];
    kept.push(offsets[i]!);
  }
  return { normalized: out, offsets: Int32Array.from(kept) };
}

function baseNormalize(text: string, dropMode: 'space' | 'delete' = 'space'): { normalized: string; hadDrops: boolean; offsets: Int32Array | null } {
  let out = '';
  let dropped = false;
  let hadDrops = false;
  let lastChar = '';
  // Карту смещений заводим только если в тексте есть невидимые символы.
  const trackOffsets = /[^\p{L}\p{N}\s\p{P}]/u.test(text);
  const srcOffsets: number[] = [];
  let srcPos = 0;
  // S-4: NFC preserves precomposed characters (e.g. Cyrillic "й") while isolating non-precomposed accents.
  const nfc = text.normalize('NFC');
  for (const ch of nfc) {
    const cp = ch.codePointAt(0) ?? 0;
    const startPos = srcPos;
    srcPos += ch.length;
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
      if (trackOffsets) srcOffsets.push(startPos);
    }
    dropped = false;
    const emitted = action === 'space' ? ' ' : ch;
    out += emitted;
    lastChar = emitted;
    if (trackOffsets) srcOffsets.push(startPos);
  }
  let lower = '';
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    const low = ch.toLowerCase();
    lower += low.length === 1 ? low : ch;
  }
  lower = lower.replace(/ё/g, 'е');
  if (!trackOffsets) return { normalized: collapseSpacedSingleLetters(lower), hadDrops, offsets: null };
  const collapsed = collapseWithOffsets(lower, Int32Array.from(srcOffsets));
  return { normalized: collapsed.normalized, hadDrops, offsets: collapsed.offsets };
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
    if (STANCE_BEFORE_NOUN.test(before)) return true;
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

// C-2 (a,b,c): сильный слой гасится только (a) управляющим отрицанием, (b) смехом,
// (c) отказом «раньше … — сейчас не …». Оговорки быта (техника, способ, уклад,
// место, прощание, «от жары») к нему не применяются — за них отвечает слабый слой.
const hasStrongSuppression: ContextCheck = (lower, start, end, breaks) => {
  const before = clauseWindowBefore(lower, start, end, breaks);
  if (RU_NEGATION_BEFORE.test(before) || FOREIGN_NEGATION_BEFORE.test(before)) return true;

  const matched = lower.slice(start, end);
  const tail = lower.slice(end, end + 40);
  // (b) смех — только там, где речь и так о смерти («хочу умереть от смеха»).
  if (/умер|умир|умр/.test(matched) && LAUGHTER_AFTER.test(tail)) return true;

  // (c) отказ: маркер прошлого вплотную, сама фраза в прошедшем или названа
  // «мыслью», и следом нет подтверждения в настоящем.
  if (PAST_DENIAL_BEFORE.test(before) && (PAST_GOVERNED.test(before) || /(?:ел[аи]?|ось|али)(?![а-я])/.test(matched))) {
    return !PRESENT_REFIRM_AFTER.test(lower.slice(end, end + 60));
  }
  return false;
};

const hasForeignStrongSuppression: ContextCheck = (lower, start, end, breaks) => {
  if (hasStrongSuppression(lower, start, end, breaks)) return true;
  // EN-смех: «i want to die laughing», «killed myself laughing» — шутка, а не намерение.
  return /\b(?:laugh\w*|lol)\b/.test(lower.slice(end, end + 30));
};

// S-50: совпадение опознаётся по паттерну и его порядковому номеру в тексте, а
// не по тексту совпадения: одна и та же фраза дважды — раз с отрицанием, раз
// без — иначе гасилась целиком («не хочу умереть. хочу умереть.»).
// C-2: слой («s»/«w») входит в ключ, иначе индексы сильного и слабого списков
// сталкиваются и cross-variant множество гасит не то совпадение.
type MatchKey = string;

function* acuteMatches(text: string, patterns: RegExp[], tier: 's' | 'w', offsets: Int32Array | null): Generator<[string, number, number, ClauseBreak[], MatchKey]> {
  let breaks: ClauseBreak[] | null = null;
  for (let p = 0; p < patterns.length; p++) {
    const pattern = patterns[p]!;
    pattern.lastIndex = 0;
    let n = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      breaks ??= collectClauseBreaks(text);
      // Нет карты (в тексте не было невидимых символов) — старый ключ по номеру.
      const at = offsets ? (offsets[match.index] ?? match.index) : n;
      yield [match[0], match.index, match.index + match[0].length, breaks, `${tier}:${p}:${at}`];
      n++;
    }
  }
}

function overlapsVoids(voids: [number, number][], start: number, end: number): boolean {
  for (const [vs, ve] of voids) {
    if (start < ve && vs < end) return true;
  }
  return false;
}

// C-2: сильный слой проверяется первым. Погашенная сильная фраза попадает в
// void-диапазон, и слабое совпадение, накрывающее её, отбрасывается: отрицание,
// смех или отказ управляют фразой независимо от того, каким паттерном её увидели
// («выпила таблетки, я не хочу умереть» — быт, а не план).
function firstRiskMatch(
  text: string,
  strong: RegExp[],
  weak: RegExp[],
  strongSuppressed: ContextCheck,
  weakSafe: ContextCheck,
  offsets: Int32Array | null,
  negatedElsewhere?: (key: MatchKey) => boolean,
): string | null {
  const voids: [number, number][] = [];
  for (const [matched, start, end, breaks, key] of acuteMatches(text, strong, 's', offsets)) {
    if (strongSuppressed(text, start, end, breaks) || negatedElsewhere?.(key)) {
      voids.push([start, end]);
      continue;
    }
    return matched;
  }
  for (const [matched, start, end, breaks, key] of acuteMatches(text, weak, 'w', offsets)) {
    if (overlapsVoids(voids, start, end)) continue;
    if (weakSafe(text, start, end, breaks)) continue;
    if (negatedElsewhere?.(key)) continue;
    return matched;
  }
  return null;
}

interface Pass {
  text: string;
  strong: RegExp[];
  weak: RegExp[];
  strongSuppressed: ContextCheck;
  weakSafe: ContextCheck;
  // «Гасит ли это именно отрицание» — для множества negatedMatches (S-41).
  negated: ContextCheck;
}

// Три прохода одного текста: кириллические паттерны — против латинских
// букв-двойников; EN/транслит — против кириллицы, сложенной в латиницу.
// R5-018: CONFUSABLES_MAP складывает кириллическую «у» в «y», а в EN/транслите
// она подменяет и «u» («sуicide», «hochу») — второй проход с «у»→«u».
function passes(lower: string): Pass[] {
  return [
    {
      text: foldLatinLookalikes(lower),
      strong: GLOBAL_STRONG_RISK_PATTERNS,
      weak: GLOBAL_RISK_PATTERNS,
      strongSuppressed: hasStrongSuppression,
      weakSafe: hasRussianSafeContext,
      negated: hasRussianNegationBefore,
    },
    {
      text: foldConfusables(lower),
      strong: GLOBAL_STRONG_FOREIGN_RISK_PATTERNS,
      weak: GLOBAL_FOREIGN_RISK_PATTERNS,
      strongSuppressed: hasForeignStrongSuppression,
      weakSafe: hasForeignNegationBefore,
      negated: hasForeignNegationBefore,
    },
    {
      text: foldConfusables(lower.replace(/у/g, 'u')),
      strong: GLOBAL_STRONG_FOREIGN_RISK_PATTERNS,
      weak: GLOBAL_FOREIGN_RISK_PATTERNS,
      strongSuppressed: hasForeignStrongSuppression,
      weakSafe: hasForeignNegationBefore,
      negated: hasForeignNegationBefore,
    },
  ];
}

function checkRiskOnNormalized(lower: string, offsets: Int32Array | null, negatedElsewhere?: (passIdx: number) => (key: MatchKey) => boolean): RiskResult {
  // Все совпадения всех паттернов: исключение у ранней фразы («раньше думал
  // о смерти») не должно прятать острую позже («а сейчас режу себя»).
  const all = passes(lower);
  for (let i = 0; i < all.length; i++) {
    const pass = all[i]!;
    const matched = firstRiskMatch(pass.text, pass.strong, pass.weak, pass.strongSuppressed, pass.weakSafe, offsets, negatedElsewhere?.(i));
    if (matched) return { isRisk: true, severity: 'acute', matchedPattern: matched };
  }
  return { isRisk: false, severity: 'none' };
}

// S-41: совпадения, которые в этом варианте нормализации гасит отрицание.
// Ключ — проход, слой, паттерн, порядковый номер (S-50), чтобы совпасть с тем же
// вхождением во втором варианте.
function negatedMatches(lower: string, offsets: Int32Array | null): Set<MatchKey> {
  const out = new Set<MatchKey>();
  passes(lower).forEach((pass, passIdx) => {
    for (const tier of ['s', 'w'] as const) {
      const patterns = tier === 's' ? pass.strong : pass.weak;
      for (const [, start, end, breaks, key] of acuteMatches(pass.text, patterns, tier, offsets)) {
        if (pass.negated(pass.text, start, end, breaks)) out.add(`${passIdx}|${key}`);
      }
    }
  });
  return out;
}

export function detectRisk(text: string): RiskResult {
  // S-4: Двойная нормализация — сначала удаление невидимых (склеивает разорванные слова),
  // затем замена на пробел (разлепляет склеенные невидимыми символами слова).
  const { normalized: normDelete, hadDrops, offsets: offDelete } = baseNormalize(text, 'delete');
  if (!hadDrops) return checkRiskOnNormalized(normDelete, offDelete);
  const { normalized: normSpace, offsets: offSpace } = baseNormalize(text, 'space');
  if (normSpace === normDelete) return checkRiskOnNormalized(normDelete, offDelete);

  // S-41: удаление невидимого склеивает отрицание с глаголом («не{ZWSP}хочу умереть» →
  // «нехочу умереть», «don{ZWSP}t» → «dont»). Фраза остра, только если её не гасит
  // отрицание в другом варианте нормализации; «по{ZWSP}вешусь» в «space» просто не
  // совпадает — не отрицание, остаётся острым. Множество считается лениво, по первой находке.
  const negatedIn = (variant: string) => {
    let set: Set<MatchKey> | null = null;
    return (passIdx: number) => (key: MatchKey) => (set ??= negatedMatches(variant, variant === normSpace ? offSpace : offDelete)).has(`${passIdx}|${key}`);
  };
  const resDelete = checkRiskOnNormalized(normDelete, offDelete, negatedIn(normSpace));
  if (resDelete.isRisk) return resDelete;
  return checkRiskOnNormalized(normSpace, offSpace, negatedIn(normDelete));
}