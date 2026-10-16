// R7Q-032: два способов, которыми гейт-скрипт ломался на Windows, вынесены сюда,
// чтобы их было чем проверить на macOS.
//
// 1. `import.meta.url === \`file://${process.argv[1]}\``. На Windows argv[1] —
//    `C:\…\script.mjs`, а import.meta.url — `file:///C:/…/script.mjs`: сравнение
//    не совпадает никогда, то есть весь блок «запустить гейт и выйти с 1» не
//    исполняется. Скрипт при этом печатает ноль строк и выходит с нулём —
//    «зелёные» ворота, которые ничего не проверяли.
// 2. `readdirSync(..., { recursive: true })` на Windows отдаёт `\` как разделитель,
//    а фильтры и сообщения гейтов написаны через `/`.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Запуск напрямую (`node scripts/x.mjs`), а не импорт из теста.
 *
 * `realpathSync` обязателен: Node берёт канонический путь модуля, и на macOS
 * `/tmp/…` превращается в `/private/tmp/…`, а `process.argv[1]` остаётся тем
 * путём, что дали командной строке. Без realpath проверка расходится на любом
 * прогоне из симлинка (тот же класс молчания, что и на Windows).
 */
export function isMainRun(argv1, metaUrl) {
  if (!argv1) return false;
  let resolved = String(argv1);
  try {
    resolved = realpathSync(resolved);
  } catch {
    // Файла нет (устаревший argv из чужого процесса) — сравниваем как есть.
  }
  return pathToFileURL(resolved).href === metaUrl;
}

/** `\` → `/`: на Windows это единственный вид пути, который понимают регулярки гейтов. */
export function toPosixPath(p) {
  return String(p).replace(/\\/g, '/');
}
