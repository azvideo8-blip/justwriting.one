// C-2 (R2-020): решение «можно ли записать baseline» вынесено из запуска knip,
// чтобы храповик проверялся тестом, а не глазами на вывод. knip здесь не нужен:
// на входе — два набора ключей.
//
// Ключ = `тип\tфайл:имя` (см. issueKeys ниже).
import path from 'node:path';

export const BASELINE_HEADER = [
  '# G-2: известный долг по мёртвому коду (knip). Строка = тип + файл[:имя].',
  '# Убирать строку — когда код стал живым; добавлять — только вместе с тикетом.',
].join('\n');

// C-3 (R2-021): сюда добавлены `unresolved` и `unlisted`. Без них гейт не видел
// ни импорта несуществующего файла, ни импорта пакета, которого нет в
// package.json, — а `unlisted` как раз ломает прод-сборку на чистом `npm ci`,
// оставаясь при этом зелёным в CI. В baseline такие ключи не вписываются (даже
// через --grow): чинится объявлением зависимости либо путём импорта.
export const TYPES = ['files', 'exports', 'types', 'enumMembers', 'duplicates', 'dependencies', 'devDependencies', 'unresolved', 'unlisted'];

// Мёртвый файл knip описывает самой записью (файл == предмет), у остального
// предмет — элемент с именем. Дублирующиеся экспорты идут списком списков: там
// имена — у вложенных элементов, а не у внешнего.
/**
 * @param {any[]} issues запись `issues` из `knip --reporter json`
 * @param {string} root корень репозитория (cwd прогона knip)
 */
export function issueKeys(issues, root) {
  const keys = [];
  for (const entry of issues) {
    const file = path.relative(root, entry.file).replaceAll(path.sep, '/');
    for (const type of TYPES) {
      const items = (entry[type] ?? []).flatMap(item => (Array.isArray(item) ? item : [item]));
      for (const item of items) {
        if (type === 'files') {
          keys.push(`files\t${file}`);
          continue;
        }
        const name = typeof item === 'string' ? item : (item?.name ?? item?.symbol ?? '');
        if (!name) {
          console.error(`::error::knip выдал ${type} без имени в ${file} — ключ не построить`);
          process.exit(1);
        }
        keys.push(`${type}\t${file}:${name}`);
      }
    }
  }
  return keys.sort();
}

// mayWrite: false, когда в текущем наборе есть ключ, которого нет в baseline, и
// при этом не запрошен явный рост. --update без --grow поэтому обязан краснеть:
// иначе один прогон легализует сколько угодно нового мёртвого кода без красного
// CI (R2-020).
//
// blocked — то, что не вписывается в baseline даже с --grow (R2-021):
// unresolved/unlisted ломают сборку на чистом `npm ci`, их лечит только код.
export const UNBASELINABLE_TYPES = ['unresolved', 'unlisted'];

const keyType = key => key.slice(0, key.indexOf('\t'));

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
  const blocked = added.filter(key => UNBASELINABLE_TYPES.includes(keyType(key)));
  return {
    added,
    removed,
    blocked,
    mayWrite: (grow || added.length === 0) && blocked.length === 0,
    contents: BASELINE_HEADER + '\n' + current.join('\n') + '\n',
  };
}
