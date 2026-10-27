/**
 * PR-10 (18.2): род автора — чистым правилом, а не догадкой модели.
 *
 * В записях автор говорит о себе формами прошедшего времени: «я проснулся» /
 * «я проснулась». Прилагательное («я рад» / «я рада») родительный род не
 * выражает и родом автора не считается. Смешанные формы — род не передан:
 * угадывать при противоречии хуже, чем оставить нейтрально.
 *
 * Ищем только форму сразу после «я» (до четырёх слов): глаголы в тексте без
 * местоимения — чужие реплики и цитаты, по ним род не определить.
 */
const MASC_VERB = /^(?:[а-яё]{2,}(?:л|лся)|мог|смог|лег|нес|вел|шел|умер)$/;
const FEM_VERB = /^(?:[а-яё]{2,}(?:ла|лась)|могла|смогла|легла|несла|вела|шла|умерла)$/;

export function detectAuthorGender(text: string | null | undefined): 'm' | 'f' | null {
  if (!text) return null;
  const tokens = text.toLowerCase().replace(/ё/g, 'е').split(/[^а-я]+/);
  let male = 0;
  let female = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 'я') continue;
    for (let j = i + 1; j < Math.min(tokens.length, i + 5); j++) {
      const word = tokens[j]!;
      if (MASC_VERB.test(word)) { male++; break; }
      if (FEM_VERB.test(word)) { female++; break; }
    }
  }
  if (male && !female) return 'm';
  if (female && !male) return 'f';
  return null;
}
