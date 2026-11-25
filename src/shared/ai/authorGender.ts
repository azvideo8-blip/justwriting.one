/**
 * PR-10 (18.2): род автора — чистым правилом, а не догадкой модели.
 *
 * В записях автор говорит о себе формами прошедшего времени: «я проснулся» /
 * «я проснулась». Прилагательное («я рад» / «я рада») родительный род не
 * выражает и родом автора не считается.
 *
 * К29-1 (случай #29): одна чужая форма («она сказала: я устал») обнуляла ответ, и
 * модель писала «сделал(а)». Решает перевес — не меньше трёх форм и не меньше 80 %
 * одного рода. Перевеса нет — род не передан: угадывать хуже, чем писать без рода.
 *
 * Ищем только форму сразу после «я» (до четырёх слов) внутри той же части фразы:
 * глаголы в тексте без местоимения — чужие реплики и цитаты, по ним род не определить.
 * Знак препинания, союз, чужое подлежащее и глагол настоящего времени обрывают окно:
 * «я думаю, он хотел», «я знаю что она устала», «я вижу стол» — не о роде автора.
 */
const MASC_VERB = /^(?:[а-яё]{2,}(?:л|лся)|мог|смог|лег|нес|вел|шел|умер)$/;
const FEM_VERB = /^(?:[а-яё]{2,}(?:ла|лась)|могла|смогла|легла|несла|вела|шла|умерла)$/;

export type AuthorGender = 'm' | 'f';

const STOP_RE = /^(?:он|она|оно|они|мы|ты|вы|что|чтобы|как|когда|если|где|кто|пока|и|а|но|или|мама|папа|муж|жена|брат|сестра|друг|подруга)$/;
// Глагол первого лица настоящего времени («думаю», «вижу», «боюсь») — дальше уже не о себе в прошлом.
const PRESENT_RE = /^(?!(?:поэтому|потому|почему|никому|кому|ему|нему|этому|тому|всю|эту|одну|свою|мою|маму|самому)$)[а-я]*(?:ю|юсь|жу|шу|чу|щу|ду|ту|су|гу|ку|бу|му|ну|ру|усь)$/;
const MIN_FORMS = 3;
const MIN_SHARE = 0.8;

export function genderByForms(male: number, female: number): AuthorGender | null {
  const top = Math.max(male, female);
  if (male + female < MIN_FORMS || top < MIN_SHARE * (male + female)) return null;
  return male > female ? 'm' : 'f';
}

export function detectAuthorGender(text: string | null | undefined): AuthorGender | null {
  if (!text) return null;
  // Чужая речь в кавычках — не формы автора.
  const tokens = text.replace(/«[^»]*»|"[^"]*"|„[^“]*“|“[^”]*”/g, ' ').toLowerCase().replace(/ё/g, 'е').replace(/(?<=[а-я])-(?=[а-я])/g, '').replace(/[^а-я\s]+/g, ' | ').replace(/\n/g, ' | ').split(/\s+/);
  let male = 0;
  let female = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 'я') continue;
    for (let j = i + 1; j < Math.min(tokens.length, i + 5); j++) {
      const word = tokens[j]!;
      if (word === 'и' && tokens[j - 1] === 'так') continue; // «так и не»
      if (word === '|' || STOP_RE.test(word)) break;
      if (MASC_VERB.test(word)) { male++; break; }
      if (FEM_VERB.test(word)) { female++; break; }
      if (PRESENT_RE.test(word)) break;
    }
  }
  return genderByForms(male, female);
}

/** К29-1: строка рода — одна на ход, вне ограды данных, рядом со строкой обращения. */
export const AUTHOR_GENDER_LINES: Record<AuthorGender | 'none', string> = {
  m: 'РОД ЧЕЛОВЕКА В ЭТОМ ДИАЛОГЕ — мужской: о человеке пиши в мужском роде, без форм со скобкой и через косую черту. Род решён заранее.',
  f: 'РОД ЧЕЛОВЕКА В ЭТОМ ДИАЛОГЕ — женский: о человеке пиши в женском роде, без форм со скобкой и через косую черту. Род решён заранее.',
  none: 'РОД ЧЕЛОВЕКА неизвестен: говори о человеке без родовых форм (настоящее время, «у тебя получилось», «ты смотришь на это»), без форм со скобкой и через косую черту.',
};

// Мужская форма → женская, когда «-а/-ла/-на» простым хвостом не выходит.
const FEM_IRREGULAR: Record<string, string> = {
  должен: 'должна', согласен: 'согласна', нужен: 'нужна', способен: 'способна', свободен: 'свободна',
  важен: 'важна', спокоен: 'спокойна', один: 'одна', мог: 'могла', смог: 'смогла', помог: 'помогла',
  лег: 'легла', лёг: 'легла', нес: 'несла', нёс: 'несла', вел: 'вела', вёл: 'вела', привел: 'привела', привёл: 'привела',
};
// Краткие прилагательные и местоимения с хвостом «а».
const FEM_PLAIN = new Set(['готов', 'рад', 'сам', 'уверен', 'занят', 'прав', 'виноват', 'одинок', 'знаком', 'жив', 'здоров', 'открыт', 'закрыт', 'растерян', 'напуган', 'обижен']);

function femOf(word: string): string | null {
  const low = word.toLowerCase();
  const as = (f: string) => (word[0] === low[0] ? f : f[0]!.toUpperCase() + f.slice(1));
  if (FEM_IRREGULAR[low]) return as(FEM_IRREGULAR[low]);
  if (/ш[её]л$/.test(low)) return `${word.slice(0, -2)}ла`;
  if (/лся$/.test(low)) return `${word.slice(0, -2)}ась`;
  if (NOUNS.has(low)) return null;
  if (/[аеиоуыэюя]л$/.test(low) || FEM_PLAIN.has(low)) return `${word}а`;
  return null;
}

const BRACKET_FORM_RE = /([а-яё]{2,})\(-?(а|ла|на|ась|лась)\)(?![а-яё])/gi;
const QUOTED_SPAN_RE = /«(?:[^«»]|«[^«»]*»)*»|“[^“”]*”|"[^"]*"|„[^“”]*[“”]|‘[^’]*’|`[^`]*`/g;
// О человеке — когда во фразе есть «ты/вы»: «начальник сам(а) не понял(а)» не правим.
const YOU_RE = /(?:^|[^а-яё])(?:ты|тебе|тебя|тобой|вы|вам|вас)(?![а-яё])/i;
const NOUNS = new Set(['материал', 'канал', 'журнал', 'футбол', 'стол', 'потенциал', 'идеал', 'сериал', 'финал', 'скандал', 'сигнал', 'персонал', 'капитал', 'ритуал', 'бокал', 'вокзал', 'угол', 'пол', 'гол', 'зал', 'бал']);

/**
 * К29-1: «сделал(а)» в ответе раскрывается по роду. Форма, которой таблица не знает
 * («заметк(а)»), остаётся как есть; в кавычках — чужие слова, их не трогаем. Фраза без
 * «ты/вы» — не о человеке.
 */
export function expandGenderForms(text: string, gender: AuthorGender | null | undefined): string {
  if (!gender || !text.includes('(')) return text;
  const spans: [number, number][] = [...text.matchAll(QUOTED_SPAN_RE)].map(m => [m.index, m.index + m[0].length]);
  const sentenceAt = (i: number) => {
    const from = Math.max(...['.', '!', '?', '…', '\n'].map(c => text.lastIndexOf(c, i - 1))) + 1;
    const to = text.slice(i).search(/[.!?…\n]/);
    return text.slice(from, to === -1 ? undefined : i + to);
  };
  return text.replace(BRACKET_FORM_RE, (all: string, word: string, tail: string, at: number) => {
    if (spans.some(([a, b]) => at >= a && at < b) || !YOU_RE.test(sentenceAt(at))) return all;
    // «вернул(ась)» — мужская форма «вернулся», снять скобку нельзя.
    if (/ась$/.test(tail) && !/ся$/i.test(word)) return all;
    const fem = femOf(word);
    if (!fem) return all;
    return gender === 'f' ? fem : word;
  });
}
