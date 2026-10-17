/**
 * Знаки из ответа модели — на слова человека.
 *
 * На длинной диктовке (две минуты, распознавание с ошибками) модель почти всегда
 * «чинит» хоть одно слово, хотя промпт это запрещает: склеивает «то ли»,
 * дописывает «В» к «общем». Прежняя проверка «все слова совпали» на этом
 * выбрасывала всю пунктуацию (0.9.34, прод). Здесь слова исходника и ответа
 * выравниваются (наибольшая общая подпоследовательность), и с совпавших слов
 * переносятся знаки после слова и заглавная буква. Слова всегда остаются
 * исходными — порядок, состав и написание; модель решает только «что между».
 */

const WORD = /[\p{L}\p{N}]+/gu;
const fold = (w: string) => w.toLowerCase().replace(/ё/g, 'е');

interface Token { word: string; gapAfter: string }

function tokenize(text: string): { lead: string; tokens: Token[] } {
  const tokens: Token[] = [];
  let lead = '';
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    const gap = text.slice(last, m.index);
    if (tokens.length === 0) lead = gap;
    else tokens[tokens.length - 1]!.gapAfter = gap;
    tokens.push({ word: m[0], gapAfter: '' });
    last = m.index + m[0].length;
  }
  if (tokens.length > 0) tokens[tokens.length - 1]!.gapAfter = text.slice(last);
  return { lead, tokens };
}

// ponytail: O(n·m) по памяти и времени; две минуты речи ≈ 300 слов → 90 тыс.
// клеток. Общий префикс и суффикс снимаются до DP, поэтому платят только слова
// между ними. Больше MAX_CELLS — не выравниваем, а отдаём исходник.
const MAX_CELLS = 4_000_000;

/** Индекс слова ответа для каждого слова исходника (−1 — пары нет). */
function align(a: string[], b: string[]): Int32Array | null {
  const n = a.length, m = b.length;
  const pair = new Int32Array(n).fill(-1);

  // R7Q-025: модель правит одно слово из двух тысяч, и без этого среза DP стоил
  // n·m клеток — на 2100 словах предел был превышен, выравнивание возвращало
  // null, и вся расставленная пунктуация улетала в «слова изменены».
  let lo = 0;
  while (lo < n && lo < m && a[lo] === b[lo]) lo++;
  let tail = 0;
  while (tail < n - lo && tail < m - lo && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
  for (let i = 0; i < lo; i++) pair[i] = i;
  for (let t = 0; t < tail; t++) pair[n - 1 - t] = m - 1 - t;

  const midN = n - lo - tail, midM = m - lo - tail;
  if (midN * midM > MAX_CELLS) return null;
  const dp = new Int32Array((midN + 1) * (midM + 1));
  const at = (i: number, j: number) => i * (midM + 1) + j;
  for (let i = midN - 1; i >= 0; i--) {
    for (let j = midM - 1; j >= 0; j--) {
      dp[at(i, j)] = a[lo + i] === b[lo + j] ? dp[at(i + 1, j + 1)]! + 1 : Math.max(dp[at(i + 1, j)]!, dp[at(i, j + 1)]!);
    }
  }
  let x = 0, y = 0;
  while (x < midN && y < midM) {
    if (a[lo + x] === b[lo + y]) { pair[lo + x] = lo + y; x++; y++; }
    else if (dp[at(x + 1, y)]! >= dp[at(x, y + 1)]!) x++;
    else y++;
  }
  return pair;
}

/** Пробелы и знаки между словами без букв; пустой промежуток — пробел. */
function cleanGap(gap: string): string {
  return gap.length > 0 ? gap : ' ';
}

export interface TransferResult {
  text: string;
  /** Доля слов исходника, нашедших пару в ответе модели. */
  coverage: number;
}

export function transferPunctuation(raw: string, punctuated: string): TransferResult | null {
  const src = tokenize(raw).tokens;
  const { lead, tokens: out } = tokenize(punctuated);
  if (src.length === 0) return { text: raw, coverage: 1 };
  const pair = align(src.map(t => fold(t.word)), out.map(t => fold(t.word)));
  if (!pair) return null;

  let matched = 0;
  let text = pair[0] === 0 ? lead.trimStart() : '';
  src.forEach((tok, i) => {
    const j = pair[i]!;
    let word = tok.word;
    if (j >= 0) {
      matched++;
      const model = out[j]!.word;
      // Заглавная — решение модели; остальные буквы — исходные (ё, редкие формы).
      // R7Q-025: заглавные внутри слова — тоже не решение модели. «ФСБ», которое
      // модель вернула строчными, обязано остаться «ФСБ», а не стать «фСБ».
      const innerCaps = word.slice(1) !== word.slice(1).toLowerCase();
      const first = innerCaps
        ? word.charAt(0)
        : (model.charAt(0) === model.charAt(0).toUpperCase() ? word.charAt(0).toUpperCase() : word.charAt(0).toLowerCase());
      word = first + word.slice(1);
    }
    text += word;
    if (i === src.length - 1) {
      text += j >= 0 ? out[j]!.gapAfter.trimEnd() : '';
    } else if (j >= 0) {
      text += cleanGap(out[j]!.gapAfter);
    } else {
      // R7F-017: граница предложения стоит ровно на слове, которое модель
      // «починила»: у него нет пары, а знак лежит в промежутке перед СЛЕДУЮЩИМ
      // совпавшим словом модели. Прежний простой пробел терял его: «…друзьями!
      // Мы…» превращалось в «…друзей Мы…». Своего знака у слова нет — берём тот
      // разрыв, а не выдумываем.
      // Слот перед следующим совпавшим словом может быть парой ПРЕДЫДУЩЕГО слова
      // (модель выбросила «ну»): его знак уже стоит, второй раз не берём.
      const next = pair[i + 1] ?? -1;
      const gap = next > 0 && !pair.includes(next - 1) ? out[next - 1]!.gapAfter : '';
      const marks = gap.trim();
      text += marks.length === 0 ? ' ' : (/\s$/.test(gap) ? gap : `${marks} `);
    }
  });
  // Начало фразы, слово которого модель «дописала» («В общем» к «общем»): после
  // переноса оно оказалось строчным. Регистр — не слово, его можно поправить.
  text = text.replace(/(^|[.!?…]\s+|\n\s*)(\p{Ll})/gu, (_m, before: string, ch: string) => before + ch.toUpperCase());
  return { text, coverage: matched / src.length };
}
