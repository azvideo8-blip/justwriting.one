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

export function sameWords(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  return x.length === y.length && x.every((w, i) => w === y[i]);
}
