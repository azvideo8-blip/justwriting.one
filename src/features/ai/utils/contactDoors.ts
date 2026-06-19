export interface DoorsResult {
  thinking: number;
  feeling: number;
  behavior: number;
  total: number;
  lowData: boolean;
}

const THINKING_MARKERS = [
  'дума', 'мысл', 'размышл', 'счита', 'полага', 'кажет', 'предполаг', 'понима', 'осозна', 'анализ',
  'соображ', 'вспомин', 'помн', 'забы', 'представл', 'воображ', 'фантаз', 'планир', 'намер', 'составл',
  'проектир', 'оценив', 'сравнив', 'сопоставл', 'взвешив', 'логич', 'потому что', 'следовател', 'значит', 'вывод',
  'заключен', 'решил', 'вердикт', 'наверно', 'вероятн', 'возможн', 'очевидн', 'бесспор', 'естествен', 'допуст',
  'гипотез', 'теори', 'фактич', 'аргумент', 'довод', 'обоснован', 'доказ', 'опроверг', 'убежд', 'мнен',
  'иде', 'концепц', 'смысл', 'замысел', 'схем', 'проект', 'цел', 'задач', 'мыслеформ', 'умозаключ',
  'сужден', 'мировоззрен', 'взгляд', 'позици', 'ракурс', 'перспектив', 'альтернатив', 'вариант', 'выбор', 'приоритет',
  'критери', 'стандарт', 'закономерн', 'причин', 'следств', 'исслед', 'изуч', 'выясн', 'провер', 'тестир',
  'эксперимент', 'наблюд', 'фиксир', 'регистрир', 'концентрир', 'сосредоточ', 'вниман', 'отвлек', 'рассматрив', 'разбиратьс',
  'вникать', 'постиг', 'усваив', 'интерпрет', 'формулир', 'систематиз', 'классифиц', 'структурир', 'группир', 'обобщ',
  'знан', 'знаю', 'известн', 'уразуме', 'ясно', 'ясность', 'наглядн', 'колебл', 'сомнен', 'вопрос',
  'опрос', 'проблем', 'загадк', 'тайн', 'секрет', 'неизвестн', 'непонят', 'запут', 'иллюзи', 'заблужден',
  'ошибк', 'противореч', 'несоответс', 'абсурд', 'бессмысл', 'истин', 'правд', 'ложь', 'обман', 'выдумк',
  'реальн', 'объектив', 'субъектив', 'рационал', 'иррационал', 'интеллект', 'разум', 'ум', 'мудрост', 'глупост',
  'здравом', 'здраво', 'адекват', 'критич', 'скептициз', 'прагматиз', 'догм', 'стереотип', 'предубежд', 'суевер',
  'утвержд', 'заявля', 'констатир', 'декларир', 'провозглаш', 'обсужд', 'дискутир', 'спор', 'дебат', 'дискусси',
  'диалог', 'монолог', 'комментир', 'объясн', 'толковать', 'разъясн', 'уточн', 'конкретиз', 'резюмир', 'подытож',
  'цитир', 'ссылат', 'упомина', 'обознач', 'определ', 'намерева', 'собираюсь', 'склоня', 'постановил', 'установил',
  'выявил', 'обнаружил', 'догада', 'додумал', 'придумал', 'изобрел', 'разработал', 'спрогнози', 'предвид', 'предусмотр',
  'ожида', 'распредел', 'обдум', 'разложи', 'сверя', 'осмысл', 'прокручив', 'зациклен', 'внушил', 'изложи',
];

const FEELING_MARKERS = [
  'чувств', 'ощущ', 'пережив', 'состоян', 'эмоци', 'настроен', 'душ', 'сердц', 'внутри', 'самочувств',
  'реагир', 'отзывае', 'восприним', 'настрое', 'кажетс', 'устал', 'утомл', 'изнур', 'истощ', 'вялост',
  'слабост', 'бодр', 'энерги', 'прилив', 'сонлив', 'груст', 'печал', 'тоск', 'уныни', 'гореч',
  'скорб', 'плач', 'слез', 'больно', 'бол', 'страдан', 'муч', 'жалост', 'жал', 'сострад',
  'сочувств', 'огорч', 'разочаров', 'безнадеж', 'отчаян', 'бессили', 'пустот', 'удруч', 'подавлен', 'одино',
  'брошен', 'ненужн', 'отверг', 'апати', 'покинут', 'злост', 'злюсь', 'злит', 'раздраж', 'гнев',
  'ярост', 'бесит', 'возмущ', 'негодов', 'досад', 'злорад', 'ненавид', 'враждеб', 'агресси', 'обид',
  'оскорбл', 'уязв', 'неприязн', 'отвращ', 'брезгл', 'завист', 'ревн', 'сопернич', 'протест', 'нетерпим',
  'досаж', 'упрек', 'озлобл', 'мстител', 'презрен', 'страх', 'боюс', 'пуга', 'тревог', 'тревож',
  'беспоко', 'паник', 'ужас', 'опасн', 'боязн', 'волнен', 'волну', 'напряж', 'стресс', 'растеря',
  'нерешител', 'сомнени', 'мнительн', 'подозр', 'робк', 'смущен', 'трепет', 'взволнов', 'испуг', 'предчувств',
  'стыд', 'вин', 'раскаян', 'угрызен', 'сожален', 'неловк', 'неудобс', 'стыжу', 'позор', 'конфуз',
  'замешат', 'стесн', 'зажат', 'комплекс', 'самобич', 'радост', 'рад', 'счасть', 'счастл', 'восторг',
  'ликован', 'восхищ', 'вдохнов', 'окрыл', 'гордост', 'горж', 'торжеств', 'азарт', 'увлеч', 'интерес',
  'любопыт', 'удивлен', 'изумл', 'поражен', 'благогов', 'весел', 'удовлетв', 'облегчен', 'умиротвор', 'блаженс',
  'любов', 'любл', 'нежн', 'благодар', 'признат', 'симпати', 'привяз', 'тепло', 'забот', 'доброт',
  'милосерд', 'уважен', 'довер', 'надежд', 'надею', 'оптимиз', 'влюбл', 'притяж', 'близост', 'родн',
  'предан', 'верност', 'искрен', 'обожа', 'благополуч', 'скук', 'скуч', 'равнодуш', 'безразлич', 'пренебреж',
  'высокомер', 'тщеслав', 'жажд', 'страст', 'вожделен', 'влечен', 'фанат', 'одержим', 'упоен', 'экстаз',
  'эйфори', 'триумф', 'оцепене', 'ступор', 'шок', 'отороп', 'отторжен', 'предвзят', 'безучаст', 'недоуме',
];

const BEHAVIOR_MARKERS = [
  'саботир', 'прокрастин', 'бросил', 'затупил', 'туплю', 'отлож', 'слил', 'забил', 'лен', 'профук',
  'проспал', 'завис', 'избег', 'увилив', 'отлынив', 'сорв', 'сдалс', 'заброс', 'перенес',
  'затян', 'опоздал', 'прогул', 'не стал', 'пропуст', 'упуст', 'проигнор', 'тормоз', 'облаж', 'накосяч',
  'ошибс', 'застря', 'бездельн', 'филон', 'уклоня', 'запуталс', 'отказ', 'приостанов', 'схаляв', 'промедл',
  'выгор', 'сдрейф', 'проигр', 'уронил', 'забыл', 'не додел', 'не смог', 'не успел', 'не начал', 'не пришел',
  'отменил', 'растерялс', 'спасовал', 'заболел', 'сбежал', 'начал', 'приступ', 'запуст', 'открыл', 'создал',
  'взялс', 'принялс', 'иници', 'попроб', 'попыт', 'организов', 'записалс', 'запланир', 'включилс', 'настроилс',
  'собралс', 'наметил', 'подготовил', 'сделал', 'делаю', 'занималс', 'работал', 'выполн',
  'вел', 'продолж', 'стараюсь', 'трудилс', 'практик', 'соверш', 'писал', 'звонил', 'говор',
  'читал', 'смотр', 'считал', 'перевод', 'отправ', 'получ', 'нашел', 'искал', 'учил', 'повтор',
  'проверял', 'исправл', 'редакт', 'конструир', 'рисовал', 'програм', 'настраив', 'чистил', 'убирал', 'мыл',
  'ремонт', 'шил', 'вязал', 'готовил', 'законч', 'заверш', 'достиг', 'добилс', 'сдал', 'закрыл',
  'додел', 'справилс', 'победил', 'осилил', 'довел', 'выполнил', 'получилс', 'оформил', 'защитил',
  'подтвердил', 'утвердил', 'согласов', 'зафиксиров', 'пошел', 'поех', 'ушел', 'пришел', 'прилетел', 'вернулс',
  'встал', 'лег', 'сидел', 'стоял', 'бегал', 'ходил', 'посетил', 'встретилс', 'вышел', 'зашел',
  'поднялс', 'спустилс', 'прогулялс', 'добралс', 'уехал', 'прибыл', 'переехал', 'гулял', 'катался', 'плавал',
  'трениров', 'разминалс', 'прыгал', 'танцевал', 'купил', 'продал', 'оплатил', 'потратил', 'выпил', 'поел',
  'заказал', 'договор', 'набрал', 'ответил', 'спросил', 'попросил', 'помог', 'поддерж', 'подарил', 'принял',
  'отдал', 'взял', 'положил', 'повесил', 'запер', 'включил', 'выключил', 'показал', 'объяснил', 'рассказал',
  'записал', 'сфотограф', 'поделилс', 'посоветовал', 'поздрав', 'поблагодар', 'извинилс', 'обещал', 'сдержал',
];

// TICKET-048: Russian Porter Stemmer for morphological matching
export function stemRussian(word: string): string {
  word = word.toLowerCase().replace(/ё/g, 'е');
  const RVRE = /^(.*?[аеиоуыэюя])(.*)$/i;
  const match = RVRE.exec(word);
  if (!match) return word;
  const start = match[1];
  let rv = match[2] || '';
  if (!rv) return word;

  // Step 1: Perfective Gerunds, Reflexives, Adjectivals, Verbs, Nouns
  const gerundMatch = /((?:ив|ивши|ившись|ыв|ывши|ывшись)|([ая])(в|вши|вшись))$/i.exec(rv);
  if (gerundMatch) {
    rv = gerundMatch[2] ? rv.slice(0, -gerundMatch[0].length + gerundMatch[2].length) : rv.slice(0, -gerundMatch[0].length);
  } else {
    const reflexiveMatch = /(с[яь])$/i.exec(rv);
    if (reflexiveMatch) rv = rv.slice(0, -reflexiveMatch[0].length);
    const adjMatch = /(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/i.exec(rv);
    const partMatch = /((?:ивш|ывш|авш)|([ая])(ем|нн|вш|ющ|щ))$/i.exec(rv);
    if (adjMatch) {
      let len = adjMatch[0].length;
      if (partMatch) len += partMatch[2] ? partMatch[0].length - partMatch[2].length : partMatch[0].length;
      rv = rv.slice(0, -len);
    } else {
      const verbMatch = /((?:сила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ят|ует|уют|ит|ыт|ены|пить|ыть|ишь|ую|ю)$|([ая])(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно))$/i.exec(rv);
      if (verbMatch) {
        rv = verbMatch[2] ? rv.slice(0, -verbMatch[0].length + verbMatch[2].length) : rv.slice(0, -verbMatch[0].length);
      } else {
        const nounMatch = /(а|ев|ов|ах|ями|ями|ами|е|и|ия|ья|о|у|ах|ы|ь|ию|ью|я|ям|ям|ом|ем|ом|ему|ому|ях)$/i.exec(rv);
        if (nounMatch) rv = rv.slice(0, -nounMatch[0].length);
      }
    }
  }
  // Step 2: "и"
  if (rv.endsWith('и')) rv = rv.slice(0, -1);
  // Step 3: Derivational
  const derivMatch = /(ост|ость)$/i.exec(rv);
  if (derivMatch) rv = rv.slice(0, -derivMatch[0].length);
  // Step 4: Superlative, "ь"
  const superlativeMatch = /(ейше|ейш)$/i.exec(rv);
  if (superlativeMatch) rv = rv.slice(0, -superlativeMatch[0].length);
  if (rv.endsWith('ь')) rv = rv.slice(0, -1);
  return start + rv;
}

// Pre-compute stemmed markers once
const stemmedThinking = THINKING_MARKERS.map(stemRussian);
const stemmedFeeling = FEELING_MARKERS.map(stemRussian);
const stemmedBehavior = BEHAVIOR_MARKERS.map(stemRussian);

function countMatches(text: string, stemmedMarkers: string[]): number {
  const words = text.toLowerCase().match(/[а-яёa-z0-9]+/g) || [];
  const stemmedWords = words.map(stemRussian);
  let count = 0;
  for (const word of stemmedWords) {
    for (const marker of stemmedMarkers) {
      if (word.includes(marker)) {
        count++;
        break;
      }
    }
  }
  return count;
}

export function analyzeDoors(text: string): DoorsResult {
  const t = countMatches(text, stemmedThinking);
  const f = countMatches(text, stemmedFeeling);
  const b = countMatches(text, stemmedBehavior);
  const total = t + f + b;

  if (total === 0) {
    return { thinking: 0, feeling: 0, behavior: 0, total: 0, lowData: true };
  }

  return {
    thinking: t / total,
    feeling: f / total,
    behavior: b / total,
    total,
    lowData: total < 5,
  };
}

export interface AggregatedDoors {
  thinking: number;
  feeling: number;
  behavior: number;
  total: number;
  lowData: boolean;
  thinnestDoor: 'thinking' | 'feeling' | 'behavior' | null;
  dominantDoor: 'thinking' | 'feeling' | 'behavior' | null;
  byPeriod: { period: string; thinking: number; feeling: number; behavior: number; total: number }[];
}

export function aggregateDoors(
  perNote: { doors: DoorsResult; ts: number }[],
): AggregatedDoors {
  if (perNote.length === 0 || perNote.every(n => n.doors.lowData)) {
    return {
      thinking: 0, feeling: 0, behavior: 0, total: 0, lowData: true,
      thinnestDoor: null, dominantDoor: null, byPeriod: [],
    };
  }

  let totalT = 0, totalF = 0, totalB = 0, totalN = 0;
  for (const { doors } of perNote) {
    if (doors.lowData) continue;
    totalT += doors.thinking;
    totalF += doors.feeling;
    totalB += doors.behavior;
    totalN++;
  }

  if (totalN === 0) {
    return {
      thinking: 0, feeling: 0, behavior: 0, total: 0, lowData: true,
      thinnestDoor: null, dominantDoor: null, byPeriod: [],
    };
  }

  const sum = totalT + totalF + totalB || 1;
  const thinking = totalT / sum;
  const feeling = totalF / sum;
  const behavior = totalB / sum;

  const doors = { thinking, feeling, behavior };
  const entries = Object.entries(doors) as [keyof typeof doors, number][];
  const dominant = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const thinnest = entries.reduce((a, b) => (b[1] < a[1] ? b : a))[0];

  const byMonth = new Map<string, { t: number; f: number; b: number; n: number }>();
  for (const { doors: d, ts } of perNote) {
    if (d.lowData) continue;
    const monthKey = new Date(ts).toISOString().slice(0, 7);
    const existing = byMonth.get(monthKey) ?? { t: 0, f: 0, b: 0, n: 0 };
    existing.t += d.thinking;
    existing.f += d.feeling;
    existing.b += d.behavior;
    existing.n++;
    byMonth.set(monthKey, existing);
  }

  const byPeriod = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, v]) => {
      const s = v.t + v.f + v.b || 1;
      return {
        period,
        thinking: v.t / s,
        feeling: v.f / s,
        behavior: v.b / s,
        total: v.n,
      };
    });

  return {
    thinking,
    feeling,
    behavior,
    total: totalN,
    lowData: false,
    thinnestDoor: thinnest,
    dominantDoor: dominant,
    byPeriod,
  };
}

const DOOR_LABELS: Record<'thinking' | 'feeling' | 'behavior', string> = {
  thinking: 'мысли',
  feeling: 'чувства',
  behavior: 'поведение',
};

export function doorLabel(door: 'thinking' | 'feeling' | 'behavior'): string {
  return DOOR_LABELS[door];
}
