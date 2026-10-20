import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// S0-6: гейты, чтобы найденные классы не возвращались.
//
// 1. Очередь ИИ-синка не имеет права лежать на общем ключе браузера: одна
//    битая строка чужой учётки останавливала выгрузку и забор у всех аккаунтов
//    устройства (F-3 / R7F-020, закрыто в S0-2). Форма «localStorage в коде
//    очереди = 0» — про щель в 5 МБ, приватный Safari и читается как
//    запрещённое; что осталось честно — в базовой линии с причиной.
//
// 2. Часы устройства в ПРАВИЛЕ спора copies. Класс находок F-2/S0-3/S0-4:
//    решение «чья копия новее», построенное на `Date.now()` или `new Date()`,
//    зависело от хода часов конкретного прибора и держало чужую правку в
//    заложниках ровно на величину расхождения. Правка перевела спор на серверные
//    отметки (`stamped_at` миграции 0037, `updated_at` 0028/0043).
//    Гейт смотрит НЕ на файл целиком (там таймеры, логи и заголовки форков —
//    законные читатели часов), а на размеченные участки правила.
//
// 3 (SF-9). Часовое решение переживает переезд на серверные метки и в том виде,
//    когда `Date.now()` в коде не появляется: сравниваются ШТАМПЫ, которые
//    прибор когда-то придумал сам и положил в данные (`updatedAt` черновика,
//    `lastSessionAt`, `savedAt`). Регэксп только по `Date.now()`/`new Date()`
//    такого не видел — метация «Date.now() в строку legacy» проходила гейт
//    зелёной. Поэтому: метки охватывают ВЕСЬ блок решения, а не одну строку, и
//    отдельное ребро ищет сравнения приборных штампов. Оно храповик: список
//    разрешённых строк с причиной, новая строка или правка старой — красные.
//
// Мутация каждого: вернуть чтение часов внутрь помеченного правила, либо
// `localStorage.getItem` в модуль очереди → красный с именем файла и строки.
// Плюс самопроверка ребра: та же функция, применённая к тексту с намеренно
// внесённым нарушением, обязана его найти (иначе зелёный цвет ничего не стоит).
//
// Образец храповика — `src/test/bootChunkGraph.n2.test.ts`: проверяется причина,
// а не следствие, и тесту не нужны ни dist, ни стенд.

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel.split('/').join(sep)), 'utf8');

/** Снимает комментарии: закоммеченный вызов не должен притворяться ребром. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Номера строк (1-based) совпадений в оригинальном файле, по очищенному тексту. */
function locate(src: string, re: RegExp): number[] {
  const clean = stripComments(src);
  const offsets: number[] = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  while ((m = rx.exec(clean)) !== null) {
    offsets.push(m.index);
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return offsets.map(o => clean.slice(0, o).split('\n').length);
}

// ── Гейт 1: код очереди синка ────────────────────────────────────────────────

//** Файлы, которые и есть очередь: журналы правок, удалений, отвергнутых, долгов. */
const QUEUE_FILES = [
  'core/services/pendingDuration.ts',
  'features/ai/services/pendingAnalysisDeletes.ts',
];

/**
 * Единственный модуль, которому разрешено касаться localStorage ради журналов:
 * он собирает ключ учётки и больше нигде хранилище не трогаем. Отсюда две
 * проверки: обращений ровно два (обёртки getItem/setItem), и ни одно из них не
 * получает литеральный ключ — иначе общий ключ вернётся прямо в этом модуле.
 */
const JOURNAL_ADAPTER = 'core/sync/syncJournal.ts';
const JOURNAL_ADAPTER_CALLS = 2;

/**
 * Базовая линия: `localStorage` вне модулей очереди. В `LocalStoreSyncService`
 * остались два законных потребителя: (а) починка битого журнала — бэкап сырого
 * текста, чтобы потеря была видна, (б) отметки `oversized` (R4-017, уже на ключе
 * учётки). Перенос этих записей в IndexedDB — следующий пакет (см. отчёт SYNC0,
 * S0-2 «не сделано»), и рост против базовой линии красен уже сейчас.
 */
const STORAGE_BASELINE: Record<string, number> = {
  // SF2-7 поднял 8 → 11: починка нечитаемого журнала правок подрезала прежние
  // копии `…corrupt.<ts>` цикром, продублированным из починки журнала удалений.
  // Раунд 3 (мелочь из тикета): подрезка вынесена в общий помощник
  // `removeJournalBackups`, и храповик вернулся к 8 — обращения остались в одном
  // месте, а не в двух. Перенос этих записей в IndexedDB — S0-2-б, он на решении
  // владельца.
  'core/services/LocalStoreSyncService.ts': 8,
};

const STORAGE_CALL = /localStorage\s*\.\s*(?:getItem|setItem|removeItem|key|length)/;

// ── Гейт 2: помеченные правила спора ────────────────────────────────────────

const MARK_START = '/*gate:clock-rule*/';
const MARK_END = '/*endgate:clock-rule*/';
const CLOCK_READS = /Date\.now\(\)|new Date\(\s*\)/;

/**
 * Файлы, где правило обязано быть размечено, и сколько размеченных участков ждём.
 * SF-9: метки охватывают ВЕСЬ блок решения, а не одну строку `pending !== false`
 * или `localSeenTime > 0` — иначе сравнение приборных штампов и запасной путь
 * оставались за разметкой, и `Date.now()`, внесённый в строку `legacy`, гейт не
 * видел (мутация из ревью проходила зелёной).
 */
const RULE_MARKS: Record<string, number> = {
  'features/ai/services/AIRestoreService.ts': 1,
  'core/services/CloudSyncService.ts': 2,
  'core/services/ConflictResolver.ts': 1,
  'core/services/LocalStoreSyncService.ts': 3,
  'core/data/providers/localStore.ts': 1,
  'features/writing/services/WritingDraftService.ts': 1,
};

/**
 * SF-9, второе ребро: сравнение штамп-в-штамп. Класс багов не в том, что код
 * смотрит на `Date.now()`, а в том, что он решает спор по числам, которые прибор
 * придумал сам и положил в данные (`updatedAt`, `lastSessionAt`, `savedAt`,
 * локальные `localTs`/`cloudTs`). Такие сравнения не отличимы от часовых ничем,
 * кроме имени поля, — и `Date.now()`-регэксп их не ловил вовсе.
 *
 * Оператор обязан быть порядковым (`<`, `>`, `<=`, `>=`) и отбитым пробелом:
 * дженерики (`Set<string>`), стрелки (`=>`) и `payload->>updatedAt` в строке
 * фильтром не считаются.
 */
const STAMP_FIELDS = 'updatedAt|lastSessionAt|savedAt|localTs|cloudTs|localSeenTime|cloudTime|cloudSeen|stamped_at|stampedAt|cloudStamp|base|deletedAt|deletedAtMs|trashedAt';
// SF2-6: поле может стоять не непосредственно перед оператором, а в конце
// вызова: `(toTimestampMs(x.updatedAt) ?? 0) <= deletedAt`. Без закрывающих
// скобок этот вид часового сравнения фильтром не виделся — ровно та дыра, из-за
// которой страж удалённого черновика жил в гейте «невидимкой».
const ORDER_OP = '(?:<=|>=|(?<![=<>=!])<(?![=<])|(?<![=<>=!])>(?![=<>]))(?=\\s)';
const FIELD_BEFORE_OP = `(?:[A-Za-z_$][\\w$]*\\.)?(?:${STAMP_FIELDS})[)\\]]*\\s*`;
const STAMP_COMPARE = new RegExp(
  `(?:\\b${FIELD_BEFORE_OP}${ORDER_OP}|${ORDER_OP}\\s*(?:[A-Za-z_$][\\w$]*\\.)?(?:${STAMP_FIELDS})\\b)`,
  'g',
);

/**
 * Базовая линия: строки, где сравнение штампов уже есть и оправдано. Храповик в
 * обе стороны: новой строки не будет, а исчезнувшая (или переписанная) тоже
 * красная — иначе список превращается в «разрешено всё».
 *
 * - `processedAt >= cloudTs` — разбор (`ai_summaries`): серверной метки у таблицы
 *   нет, миграция `0044` на решение владельца (отчёт SYNC0, S0-4 пункт 2).
 * - `legacy` и `lastSessionAt` — переходные пути S0-3 и S0-4: записи, которым
 *   нечего сверять по серверу, судятся по времени прибора.
 * - `cloudStamp > o.base`, `cloudTime > localSeenTime`, `groupMax > base`,
 *   `cloud > base`, `o.cloudTs <= o.cloudSeen` — сервер против сервера: фильтр не
 *   различает, поле он читает или серверную отметку, поэтому в списке.
 * - черновик: `o.cloudTs <= o.cloudSeen` (SF-2/SF2-1 — метка облака против
 *   запомненной, сравнение двух серверных чисел) и коридор по часам — для копий
 *   без запомненной метки и для настоящего спора, когда в локальной копии есть
 *   правки после последней отправки.
 */
const STAMP_COMPARE_BASELINE: Record<string, string[]> = {
  'features/ai/services/AIRestoreService.ts': [
    "if (existing && (existing.processedAt ?? 0) >= cloudTs) continue;",
    "const legacy = o.localTs !== null && o.cloudTs !== null && o.cloudTs > o.localTs ? 'cloud' : 'local';",
    "if (typeof o.base === 'number') return o.cloudStamp > o.base ? 'cloud' : 'local';",
  ],
  'core/services/CloudSyncService.ts': [
    'const isCloudNewer = localSeenTime > 0',
    '? cloudTime > localSeenTime',
    '(cloudTime > (localDoc.lastSessionAt || 0) && cloudDoc.currentVersion >= localDoc.currentVersion));',
  ],
  'core/services/LocalStoreSyncService.ts': [
    'if (base !== null && groupMax > base) {',
    // SF3-2: к той же сверке добавлено «и обязательства нет» — мёртвая запись не
    // имеет права быть пропущенной в «отправить всё». Сравнение то же: метка
    // облака против запомненной базы, оба серверные.
    'if (typeof base === \'number\' && cloud !== undefined && cloud > base && !(obligated !== null && obligated.has(id))) continue;',
  ],
  'features/writing/services/WritingDraftService.ts': [
    "if (o.cloudTs <= o.cloudSeen) return 'local';",
    "if (Math.abs(o.localTs - o.cloudTs) < 60_000) return o.localWords >= o.cloudWords ? 'local' : 'cloud';",
    "return o.localTs > o.cloudTs ? 'local' : 'cloud';",
    // SF2-6: сверка «не старше ли отметки удаления» осталась только там, где обе
    // величины придуманы прибором (локальная копия и отметка удаления). Облачный
    // штамп с deletedAt больше не сравнивается — различение идёт по хэшу
    // удалённого содержимого (`isDeletedDraft`).
    "if (deletedAt && (isDeletedDraft(winner) || (toTimestampMs(winner.updatedAt) ?? 0) <= deletedAt)) {",
    "if (deletedAt && (isDeletedDraft(resolved) || (toTimestampMs(resolved.updatedAt) ?? 0) <= deletedAt)) {",
  ],
};

/** Текст без комментариев и строковых литералов: фильтры вида `payload->>updatedAt`
 *  не должны притворяться сравнениями. */
function codeOnly(src: string): string {
  return stripComments(src).replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

/** Та же нормализация для строк базовой линии, чтобы сверять одинаковый текст. */
const normalizeLine = (line: string): string => line.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""').trim();

/** Trim-строки, где встречается порядковое сравнение штамп-в-штамп. */
function stampComparisonLines(src: string): string[] {
  const lines = codeOnly(src).split('\n');
  const found: string[] = [];
  for (const line of lines) {
    STAMP_COMPARE.lastIndex = 0;
    if (STAMP_COMPARE.test(line)) found.push(line.trim());
  }
  return found;
}

/** Часы устройства внутри размеченных блоков текста (строки от начала файла). */
function clockReadsInBlocks(src: string): number[] {
  const hits: number[] = [];
  let from = 0;
  while (true) {
    const s = src.indexOf(MARK_START, from);
    if (s < 0) return hits;
    const e = src.indexOf(MARK_END, s);
    expect(e, `${src.slice(0, 40)}…: у метки правила нет конца`).toBeGreaterThan(s);
    const body = src.slice(s + MARK_START.length, e);
    for (const rel of locate(body, CLOCK_READS)) hits.push(src.slice(0, s).split('\n').length + rel);
    from = e + MARK_END.length;
  }
}

describe('S0-6: гейты классов синхронизации', () => {
  it('в модулях очереди синка нет ни одного обращения к localStorage', () => {
    const offenders = QUEUE_FILES.flatMap(f => {
      const hits = locate(read(f), STORAGE_CALL);
      return hits.map(line => `${f}:${line}`);
    });
    expect(offenders, `очередь обязана жить в базе аккаунта (S0-2): ${offenders.join(', ')}`).toEqual([]);
  });

  it('адаптер журналов — единственное место хранилища, и без литеральных ключей', () => {
    const src = read(JOURNAL_ADAPTER);
    const hits = locate(src, STORAGE_CALL);
    expect(hits, `${JOURNAL_ADAPTER}: обращений должно быть ровно ${JOURNAL_ADAPTER_CALLS} (обёртки), сейчас ${hits.length}: ${hits.join(', ')}`)
      .toHaveLength(JOURNAL_ADAPTER_CALLS);
    // Литеральный ключ внутри адаптера = общий ключ браузера, ровно та форма,
    // из- которой вырос F-3.
    const literal = locate(src, /localStorage\s*\.\s*\w+\(\s*['"`]/);
    expect(literal, `${JOURNAL_ADAPTER}: литеральный ключ хранилища на строке ${literal.join(', ')}`).toEqual([]);
  });

  it('каждый журнал учётки объявлен в инвентаре выхода (иначе его снесёт чужой выход)', async () => {
    const { JOURNAL_BASE_NAMES } = await import('../core/sync/syncJournal');
    const { accountScopedLocalStorageKeys } = await import('../features/auth/services/accountScopedKeys');
    const declared = new Set(accountScopedLocalStorageKeys('u-probe'));
    const missing = JOURNAL_BASE_NAMES.filter(base => !declared.has(`${base}:u-probe`));
    expect(missing, `не объявлены: ${missing.join(', ')}`).toEqual([]);
  });

  it('ключ журнала собирается из учётки, а не лежит общим', async () => {
    const { journalKeyFor } = await import('../core/sync/syncJournal');
    expect(journalKeyFor('ai_sync_pending_deletes', 'u1')).toBe('ai_sync_pending_deletes:u1');
    // Гость: общего ключа нет, есть ключ «без учётки» — и записи других
    // аккаунтов в него не попадают (фильтр по uid при переносе).
    expect(journalKeyFor('ai_sync_pending_deletes', null)).toBe('ai_sync_pending_deletes');
  });

  it('код очереди не разрастается поверх базовой линии localStorage', () => {
    const grown = Object.entries(STORAGE_BASELINE).flatMap(([f, allowed]) => {
      const hits = locate(read(f), STORAGE_CALL);
      return hits.length > allowed
        ? hits.slice(allowed).map(line => `${f}:${line} (было разрешено ${allowed}, стало ${hits.length})`)
        : [];
    });
    expect(grown, `новые обращения к localStorage в ${Object.keys(STORAGE_BASELINE).join(', ')}: ${grown.join(', ')}`).toEqual([]);
  });

  it('каждое размеченное правило спора найдено — метки не потерялись', () => {
    for (const [f, expected] of Object.entries(RULE_MARKS)) {
      const src = read(f);
      const starts = src.split(MARK_START).length - 1;
      const ends = src.split(MARK_END).length - 1;
      expect(starts, `${f}: метка начала правила (${starts}) не равна ожиданию ${expected}`).toBe(expected);
      expect(ends, `${f}: метка конца правила (${ends}) не равна началу`).toBe(starts);
    }
  });

  it('внутри правил спора нет чтения часов устройства', () => {
    const offenders: string[] = [];
    for (const f of Object.keys(RULE_MARKS)) {
      for (const line of clockReadsInBlocks(read(f))) offenders.push(`${f}:${line}`);
    }
    expect(offenders, `часы устройства в правиле выбора копии: ${offenders.join(', ')}`).toEqual([]);
  });

  // Мутация SF-9 (проверяется здесь же, на синтетическом тексте, чтобы ребро
  // нельзя было позеленить правкой самого гейта): внесённый `Date.now()` в строку
  // `legacy` обязан быть найден. До расширения меток он падал мимо разметки.
  it('самопроверка: Date.now() в строку legacy гейт ловит', () => {
    const original = read('features/ai/services/AIRestoreService.ts');
    const mutated = original.replace(
      "const legacy = o.localTs !== null",
      "const legacy = Date.now() > 0 && o.localTs !== null",
    );
    expect(mutated, 'метка правила должна покрывать строку legacy').not.toBe(original);
    expect(clockReadsInBlocks(mutated), 'Date.now() внутри помеченного правила не найден').not.toEqual([]);
    expect(clockReadsInBlocks(original), 'в исходном коде часов в правиле нет').toEqual([]);
  });

  // Вторая самопроверка: добавленное сравнение приборных штампов (без всякого
  // `Date.now()`) тоже красное — ровно тот класс, который прежний регэксп не видел.
  it('самопроверка: новое сравнение приборных штампов гейт ловит', () => {
    const original = read('core/services/CloudSyncService.ts');
    const mutated = `${original}\nconst probe = (a: { updatedAt: number }, b: { updatedAt: number }) => a.updatedAt > b.updatedAt;\n`;
    const before = stampComparisonLines(original);
    const after = stampComparisonLines(mutated);
    expect(after.length, 'сравнение по updatedAt должно добавиться').toBe(before.length + 1);
    expect(after).toContain('const probe = (a: { updatedAt: number }, b: { updatedAt: number }) => a.updatedAt > b.updatedAt;');
  });

  // SF2-6: та же самопроверка на форме, которую прежний регэксп не видел вовсе:
  // поле спрятано за вызовом, а справа — отметка удаления прибора.
  it('самопроверка: сравнение со скобкой и deletedAt и deletedAt гейт ловит', () => {
    const original = read('core/services/ConflictResolver.ts');
    const probe = 'const revived = (toTimestampMs(cloud.updatedAt) ?? 0) <= deletedAt;\n';
    const after = stampComparisonLines(`${original}\n${probe}`);
    expect(stampComparisonLines(original), 'в исходном файле такой строки нет').not.toContain(probe.trim());
    expect(after, `(toTimestampMs(…updatedAt) ?? 0) <= deletedAt должно находиться`).toContain(probe.trim());
  });

  it('сравнения штампов в файлах решений — только из базовой линии', () => {
    for (const [f, listed] of Object.entries(STAMP_COMPARE_BASELINE)) {
      const allowed = listed.map(normalizeLine);
      const found = stampComparisonLines(read(f));
      const extra = found.filter(line => !allowed.includes(line));
      expect(extra, `${f}: новое сравнение штампов вне базовой линии: ${extra.join(' | ')}`).toEqual([]);
      const gone = allowed.filter(line => !found.includes(line));
      expect(gone, `${f}: строка из базовой линии исчезла или переписана: ${gone.join(' | ')}`).toEqual([]);
    }
    for (const f of Object.keys(RULE_MARKS)) {
      if (f in STAMP_COMPARE_BASELINE) continue;
      const found = stampComparisonLines(read(f));
      expect(found, `${f}: здесь сравнений штампов быть не должно, найдено ${found.length}: ${found.join(' | ')}`).toEqual([]);
    }
  });
});
