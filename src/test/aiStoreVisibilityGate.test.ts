import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// TH-3 (дейлик 27.10, тезис 3): читатель ИИ-хранилища без фильтра видимости
// краснеет. Половина находок дейликов 21–27.10 — один класс: модуль читает
// производные заметок (`getAll('aiSummaries')`, `aiDialogueEvents`,
// `aiTimeline`…) и отдаёт их модели без фильтра скрытых/корзины/удалённых.
// Страж каждый раз стоял на конкретном входе (DY6-1 лексикон, DY6-2/3 грани,
// D-28, R7Q-019) и держался на памяти ревьюера.
//
// Гейт замораживает инвентарь: файл проходит, если в нём есть примитив
// видимости, или он в ALLOWED с причиной. Новый файл с чтением ИИ-стора без
// примитива и без строки — красный. Строка без причины — красный. Строка для
// файла, который больше не читает ИИ-стор, — тоже красный: список не должен
// зарастать мёртвыми записями.
//
// Примитивы на 0.10.12: loadVisibleNoteKeys, dropInvisible,
// hiddenNoteIdsFromDocs, isExcludedFromAI, dialogueFacetVisible, usableMemories.
//
// Мутации (прогнаны руками, см. отчёт пакета):
// - убрать loadVisibleNoteKeys из AILexiconService.ts → красный;
// - временный файл в src/ с getAll('aiSummaries') без фильтра → красный;
// - строка ALLOWED с пустой причиной → красный.
//
// ponytail: проверка по файлу, а не по пути данных. Файл с фильтром в одной
// функции и без фильтра в другой гейт пропустит — это потолок проверки, и он
// уже срабатывал: в proactive.ts примитив стоял в блоке диалогов, а хронология
// собиралась по обратному правилу (починено 27.10, TH-3). Следующий шаг, если
// гейт даст ложное спокойствие, — постулат в src/testing/postulates.mjs по пути
// «стор → промпт».

const SRC = join(process.cwd(), 'src');

/** Обратные слэши Windows → прямые, пути — от корня репозитория. */
const toPosix = (p: string) => p.split(sep).join('/');

/** Снимает комментарии: закомментированный вызов не должен притворяться чтением. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Чтение ИИ-стора: `getAll('ai…')`, `getAllKeys('ai…')`, `getAllFromIndex('ai…'`,
 * `.get('ai…')`, `.getFromIndex('ai…'`. Имена — те, что объявлены в localDb.
 */
const READ_CALL = /\.(?:getAll|getAllKeys|getAllFromIndex|getFromIndex|get)\(\s*(['"])ai([A-Za-z]+)\1/g;

const PRIMITIVES = new RegExp(
  String.raw`\b(?:${[
    'loadVisibleNoteKeys',
    'dropInvisible',
    'hiddenNoteIdsFromDocs',
    'isExcludedFromAI',
    'dialogueFacetVisible',
    'usableMemories',
  ].join('|')})\b`,
);

export interface SourceFile {
  path: string;
  text: string;
}

/** Имена ИИ-сторов, которые файл читает (без повторов, по алфавиту). */
export function aiStoreReads(text: string): string[] {
  const clean = stripComments(text);
  const out = new Set<string>();
  for (const m of clean.matchAll(READ_CALL)) out.add(`ai${m[2]}`);
  return [...out].sort();
}

export function hasVisibilityPrimitive(text: string): boolean {
  return PRIMITIVES.test(stripComments(text));
}

/** Инвентарь: файл → какие ИИ-сторы он читает. */
export function buildInventory(files: readonly SourceFile[]): { path: string; stores: string[] }[] {
  const rows: { path: string; stores: string[] }[] = [];
  for (const f of files) {
    const stores = aiStoreReads(f.text);
    if (stores.length > 0) rows.push({ path: f.path, stores });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export interface GateResult {
  /** Читатели без примитива и без строки ALLOWED; строки без причины; протухшие строки. */
  findings: string[];
}

export function evaluateGate(
  files: readonly SourceFile[],
  allowed: Readonly<Record<string, string>>,
): GateResult {
  const findings: string[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    const stores = aiStoreReads(f.text);
    if (stores.length === 0) continue;
    seen.add(f.path);

    const reason = allowed[f.path];
    if (reason !== undefined) {
      if (!reason.trim()) {
        findings.push(
          `${f.path}: строка ALLOWED без причины — напиши, почему ${stores.join(', ')} можно читать без фильтра видимости`,
        );
      }
      continue;
    }
    if (hasVisibilityPrimitive(f.text)) continue;
    findings.push(
      `${f.path}: читает ${stores.join(', ')} без примитива видимости — добавь фильтр видимости или строку в ALLOWED с причиной`,
    );
  }

  for (const path of Object.keys(allowed)) {
    if (!seen.has(path)) {
      findings.push(`${path}: строка ALLOWED устарела — файла нет или он больше не читает ИИ-стор; убери её`);
    }
  }

  return { findings: findings.sort() };
}

/**
 * Замороженный список `файл → причина`. Каждая строка — решение, проверенное
 * глазами по пути данных (куда идёт прочитанное), а не по имени файла.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'src/core/services/CloudSyncService.ts':
    'синк портрета в облако: строка едет в зашифрованную копию человека, модели не касается',
  'src/core/services/embeddingIndexCache.ts':
    'кэш индекса aiEmbeddings: отдаёт строки как есть, видимость проверяют потребители (searchNotes, relatedNotes, liteRetrieval, грани, лексикон)',
  'src/core/services/facetLock.ts':
    'обёртка блокировки записи граней: чтения делает вызывающий, фильтр — там',
  'src/core/services/LocalDocumentService.ts':
    'каскад удаления заметки: читает производные, чтобы стереть их; модели не отдаёт',
  'src/core/services/noteDerivativePurge.ts':
    'чистка производных скрытой/удалённой заметки; чтение ради удаления',
  'src/features/ai/components/AuthorPortrait.tsx':
    'экран «Обо мне»: портрет и счётчики, вызовов модели нет',
  'src/features/ai/components/LifeStoryTimeline.tsx':
    'экран «История жизни»: локальный показ, вызовов модели нет',
  'src/features/ai/components/ProfileFacets.tsx':
    'экран граней: показывает уже отфильтрованные грани и их улики; модели не отдаёт',
  'src/features/ai/hooks/useAIPageData.ts':
    'подсказки-стартеры по теме приложенной заметки: локальный текст кнопок, в промпт не идут',
  'src/features/ai/hooks/useDiagnosticsData.ts':
    'диагностика: количества и админ-действия, модель не зовёт',
  'src/features/ai/services/AIFacetJudgeService.ts':
    'судья граней: строки берутся только по noteIds/dialogueIds граней, а список граней уже отфильтрован AIProfileFacetService.getAll()',
  'src/features/ai/services/AIMonthlyDigestService.ts':
    'свой страж coversOnlyLiveNotes: дайджест отдаётся, только если все его заметки живы в хронологии; сборка идёт через AITimelineService (фильтр там)',
  'src/features/ai/services/AIPersonaService.ts':
    'персоны — настройки человека, не производные заметок',
  'src/features/ai/services/AIProfileRefreshService.ts':
    'оценка стоимости обновления профиля: месяцы, темы и числа для счётчика; текст модели не отдаёт',
  'src/features/ai/services/AITaxonomyService.ts':
    'спит: ensureBootstrap/rederive не вызываются вне файла (только getActive/getStored/save); оживить = сначала фильтр',
  'src/features/ai/services/AIThreadService.ts':
    'спит: rebuildThreads не вызывается вне файла; оживить = сначала фильтр (сам разбор читает documents и aiEmbeddings целиком)',
  'src/features/ai/services/injectionJournal.ts':
    'журнал теневого сборщика памяти: локальная диагностика, пишется уже после фильтра сборщика; модели не отдаёт',
  'src/features/ai/services/LifeStoryService.ts':
    '«История жизни» — экран и экспорт; autoPopulateFromTimeline без вызовов вне файла, в промпт не уходит',
  'src/features/archive/hooks/useArchiveWordCloud.ts':
    'облако слов архива: локальный показ, вызовов модели нет',
  'src/features/auth/services/localDataInventory.ts':
    'инвентарь перед выходом: количества, текста не читает',
  'src/features/settings/services/migrationExport.ts':
    'экспорт архива: строки переносятся как есть по действию человека, в модель не идут',
  'src/features/settings/services/migrationImport.ts':
    'импорт архива: пишет строки, модели не касается',
  'src/features/writing/components/WritingFinishModal.tsx':
    'экран завершения: локальный подбор похожей записи по готовым векторам, вызова ИИ нет',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Исходники приложения: `src/**` без тестов, тестовых обвязок и `src/test/`. */
function loadSources(): SourceFile[] {
  return walk(SRC)
    .map(p => ({ path: toPosix(relative(process.cwd(), p)), text: readFileSync(p, 'utf8') }))
    .filter(f => !f.path.startsWith('src/test/'));
}

describe('TH-3: чтение ИИ-хранилища без фильтра видимости краснеет', () => {
  const files = loadSources();
  const inventory = buildInventory(files);

  it('инвентарь непустой: гейт не слепой', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(inventory.length).toBeGreaterThan(30);
    const stores = new Set(inventory.flatMap(r => r.stores));
    expect(stores.size).toBeGreaterThan(10);
    expect(stores.has('aiSummaries')).toBe(true);
    expect(stores.has('aiTimeline')).toBe(true);
    expect(stores.has('aiChatMemory')).toBe(true);
  });

  it('каждый список ALLOWED несёт причину', () => {
    for (const [path, reason] of Object.entries(ALLOWED)) {
      expect(reason.trim(), `${path}: пустая причина в ALLOWED`).not.toBe('');
    }
  });

  it('в репозитории нет читателей без примитива и вне ALLOWED', () => {
    const { findings } = evaluateGate(files, ALLOWED);
    expect(findings).toEqual([]);
  });

  it('самопроверка: синтетический файл с getAll("aiSummaries") даёт находку с подсказкой', () => {
    const { findings } = evaluateGate(
      [{ path: 'src/features/ai/services/NewReader.ts', text: `const rows = await db.getAll('aiSummaries');` }],
      {},
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('добавь фильтр видимости или строку в ALLOWED с причиной');
  });

  it('самопроверка: примитив видимости снимает находку', () => {
    const { findings } = evaluateGate(
      [
        {
          path: 'src/features/ai/services/GoodReader.ts',
          text: `const rows = (await db.getAll('aiSummaries')).filter(s => !isExcludedFromAI(s));`,
        },
      ],
      {},
    );
    expect(findings).toEqual([]);
  });

  it('самопроверка: строка ALLOWED с пустой причиной красная', () => {
    const { findings } = evaluateGate(
      [{ path: 'src/features/ai/services/Allowed.ts', text: `const rows = await db.getAll('aiChatMemory');` }],
      { 'src/features/ai/services/Allowed.ts': '   ' },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('строка ALLOWED без причины');
  });

  it('самопроверка: строка ALLOWED с причиной пропускает читателя', () => {
    const { findings } = evaluateGate(
      [{ path: 'src/features/ai/services/Allowed.ts', text: `const rows = await db.getAll('aiChatMemory');` }],
      { 'src/features/ai/services/Allowed.ts': 'локальная диагностика, модели не отдаёт' },
    );
    expect(findings).toEqual([]);
  });

  it('самопроверка: протухшая строка ALLOWED красная', () => {
    const { findings } = evaluateGate(
      [{ path: 'src/features/ai/services/NoReads.ts', text: `const x = 1;` }],
      { 'src/features/ai/services/NoReads.ts': 'было чтение — стало нет' },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('строка ALLOWED устарела');
  });

  it('самопроверка: закомментированное чтение не считается', () => {
    expect(aiStoreReads(`// const rows = await db.getAll('aiSummaries');\nconst x = 1;`)).toEqual([]);
  });

  it('самопроверка: ловятся все три формы и getAllKeys', () => {
    expect(aiStoreReads(`db.getAllFromIndex('aiTimeline', 'by-month', '2026-10')`)).toEqual(['aiTimeline']);
    expect(aiStoreReads(`db.get('aiDialogueEvents', id)`)).toEqual(['aiDialogueEvents']);
    expect(aiStoreReads(`db.getAllKeys('aiEmbeddings')`)).toEqual(['aiEmbeddings']);
  });
});
