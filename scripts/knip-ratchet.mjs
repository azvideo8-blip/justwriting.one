// C-2 (R2-020): решение «можно ли записать baseline» вынесено из запуска knip,
// чтобы храповик проверялся тестом, а не глазами на вывод. knip здесь не нужен:
// на входе — два набора ключей.
//
// Ключ = `тип\tфайл:имя` (см. currentKeys в knip-check.mjs).
export const BASELINE_HEADER = [
  '# G-2: известный долг по мёртвому коду (knip). Строка = тип + файл[:имя].',
  '# Убирать строку — когда код стал живым; добавлять — только вместе с тикетом.',
].join('\n');

// mayWrite: false, когда в текущем наборе есть ключ, которого нет в baseline, и
// при этом не запрошен явный рост. --update без --grow поэтому обязан краснеть:
// иначе один прогон легализует сколько угодно нового мёртвого кода без красного
// CI (R2-020).
/**
 * @param {string[]} baseline ключи текущего baseline-файла
 * @param {string[]} current ключи, которые knip нашёл сейчас
 * @param {{ grow?: boolean }} [options]
 */
export function planBaseline(baseline, current, { grow = false } = {}) {
  const inBaseline = new Set(baseline);
  const stillThere = new Set(current);
  const added = current.filter(key => !inBaseline.has(key));
  const removed = baseline.filter(key => !stillThere.has(key));
  return {
    added,
    removed,
    mayWrite: grow || added.length === 0,
    contents: BASELINE_HEADER + '\n' + current.join('\n') + '\n',
  };
}
