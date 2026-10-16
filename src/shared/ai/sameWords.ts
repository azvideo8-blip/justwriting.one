/**
 * «Расставить знаки» (диктовка): ИИ вправе менять только знаки препинания,
 * заглавные буквы и разбивку на абзацы. Проверка — здесь, а не на честном слове
 * модели: последовательность слов результата обязана совпасть с исходной один в
 * один. Слово — подряд идущие буквы и цифры; регистр, ё/е и всё прочее (дефис
 * «кто то» → «кто-то», кавычки, тире) не считаются.
 */
function words(text: string): string[] {
  return text.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Форматирующие символы (Cf): мягкий перенос, zero width space/joiner,
 * LRM/RLM, BOM. Для `words()` они невидимы — то есть ответ модели, воткнувший
 * их в текст, проходит проверку «слова не меняются» и уезжает в заметку.
 */
export const FORMAT_CONTROLS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

export function stripFormatControls(text: string): string {
  return text.replace(FORMAT_CONTROLS, '');
}

export function sameWords(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  return x.length === y.length && x.every((w, i) => w === y[i]);
}
