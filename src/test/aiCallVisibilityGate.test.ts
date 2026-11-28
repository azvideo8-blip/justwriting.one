import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// HA-4 (дейлик 26.11, Н-1): вызов модели с текстом заметки без проверки видимости
// краснеет. TH-3 (`aiStoreVisibilityGate`) смотрит на чтения `ai*`-сторов, а ИИ-панель
// письма и «Analyze» в Диагностике брали текст из `versions` и буфера редактора — и
// отдавали его поставщику, даже если заметка скрыта от ИИ или в корзине.
//
// DA-5 (дейлик 27.11): проверка по файлу пропустила «Пакетный анализ» — примитив в файле
// был, но не перед вызовом. Теперь каждый файл с вызовом модели — строкой в CALLERS:
// методы и путь данных. Новый файл или метод — красный, пока не вписана причина;
// примитив без строки не пропуск. Поведение держат тесты мест (HA-1/HA-2, DA-1 и др.).
// Сюда же — прямой поток чата (`streamChat`, `callableChat`) и `callAi` с эндпоинтом модели в обход AIService.
// Мутации: вернуть цикл разбора в DiagnosticsPage.tsx → красный (файла нет в CALLERS);
// убрать noteHiddenFromAI из AIPanel.tsx при оставшемся isExcludedFromAI — ловит AIPanelHiddenNote.ha1.

const SRC = join(process.cwd(), 'src');
const toPosix = (p: string) => p.split(sep).join('/');

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Методы AIService, которые отправляют модели текст человека или его производные. `embed` — вектор, проверяется TH-3 у потребителей. */
const MODEL_CALL = /\bAIService\.(?:process|summarize|summarizeFacet|chat|streamChat|extractChatMemory|judgeFacets|pickInsight|matchInsight|rerank|pickAnchors)\b\s*\(|\b(?:streamChat|callableChat)\s*\(|\bcallAi(?:<[^>]*>)?\(\s*['"](?:editWithAI|summarizeDocument|summarizeFacet|chatWithAI|extractChatMemory|judgeFacets|pickInsight|matchInsight|rerankNotes|pickAnchors)['"]/;

const PRIMITIVES = new RegExp(String.raw`\b(?:${[
  'noteHiddenFromAI',
  'isExcludedFromAI',
  'loadVisibleNoteKeys',
  'hiddenNoteIdsFromDocs',
  'dropInvisible',
  'dialogueFacetVisible',
  'usableMemories',
  'hideExcludedNotes',
  'citesHiddenNote',
  'coversOnlyLiveNotes',
].join('|')})\b`);

interface SourceFile { path: string; text: string }

/** Место вызова модели: какие методы файл зовёт и почему текст там уже проверен. */
interface Caller {
  /** Методы, как их видит MODEL_CALL: `AIService.chat`, `streamChat`, `callAi:editWithAI`. */
  methods: readonly string[];
  /** Путь данных: откуда текст и где перечитывается видимость перед вызовом. */
  reason: string;
  /** Файл без примитива видимости — только с этой отметкой (транспорт, выдержки граней). */
  noPrimitive?: true;
}

const callName = (m: string) => m.replace(/\s*\($/, '').replace(/<[^>]*>/, '').replace(/\(\s*['"]/, ':').replace(/['"]$/, '');

// DA-5 (дейлик 27.11): примитив где-то в файле больше не пропуск. Каждый файл, который
// зовёт модель, — строкой в CALLERS с методами и путём данных. Новый файл или новый
// метод в старом — красный, пока не вписана причина. Так «Пакетный анализ» (DA-1) не
// прошёл бы: в DiagnosticsPage.tsx был isExcludedFromAI, но не перед вызовом.
export function evaluateCallGate(files: readonly SourceFile[], callers: Readonly<Record<string, Caller>>): string[] {
  const findings: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const clean = stripComments(f.text);
    const found = [...new Set((clean.match(MODEL_CALL_ALL) ?? []).map(callName))];
    if (found.length === 0) continue;
    seen.add(f.path);
    const entry = callers[f.path];
    if (!entry) {
      findings.push(`${f.path}: вызов модели (${found.join(', ')}) вне CALLERS — впиши файл, методы и путь данных`);
      continue;
    }
    if (entry.reason.trim() === '') findings.push(`${f.path}: строка CALLERS без причины`);
    for (const m of found) if (!entry.methods.includes(m)) findings.push(`${f.path}: метод ${m} не вписан в CALLERS`);
    for (const m of entry.methods) if (!found.includes(m)) findings.push(`${f.path}: ${m} в CALLERS, но файл его не зовёт — убери`);
    if (!entry.noPrimitive && !PRIMITIVES.test(clean)) findings.push(`${f.path}: нет примитива видимости — проверка пропала?`);
  }
  for (const path of Object.keys(callers)) {
    if (!seen.has(path)) findings.push(`${path}: в CALLERS, но модель не зовёт — убери строку`);
  }
  return findings;
}

const MODEL_CALL_ALL = new RegExp(MODEL_CALL.source, 'g');

/** Все места вызова модели. Текст заметки по её номеру — только NoteAnalysisService. */
const CALLERS: Readonly<Record<string, Caller>> = {
  'src/features/ai/services/NoteAnalysisService.ts': { methods: ['AIService.summarize'],
    reason: 'единственный разбор заметки по номеру: строка перечитывается до вызова, перед записью свода и в транзакции' },
  'src/features/ai/hooks/useSyncDiagnostics.tsx': { methods: ['AIService.summarize'],
    reason: 'облачная копия в Диагностике (HA-2): noteHiddenFromAI перед чтением версий и вызовом' },
  'src/features/ai/components/AIPanel.tsx': { methods: ['AIService.process'],
    reason: 'буфер редактора (HA-1): noteHiddenFromAI прямо перед вызовом; нет id — несохранённый текст' },
  'src/features/ai/services/punctuateDictation.ts': { methods: ['AIService.process'],
    reason: 'кусок диктовки: isDictationNoteHidden → noteHiddenFromAI перед вызовом' },
  'src/features/ai/hooks/useAIChat.ts': { methods: ['AIService.chat', 'streamChat', 'callableChat'],
    reason: 'ход чата: контекст от aiChatContext (hideExcludedNotes), вложения — prepareAttachment с isExcludedFromAI, история — hiddenNoteIdsFromDocs' },
  'src/features/ai/utils/aiChatTransport.ts': { methods: ['streamChat', 'callableChat', 'AIService.chat'], noPrimitive: true,
    reason: 'транспорт чата: текст ему передаёт useAIChat после сборки контекста' },
  'src/features/ai/hooks/useAIPageData.ts': { methods: ['AIService.chat'],
    reason: 'подсказки после ответа: citesHiddenNote и legacyNoteHidden перед вызовом, сбой чтения — не шлём' },
  'src/features/ai/services/AIDialogueService.ts': { methods: ['AIService.chat'],
    reason: 'итог диалога: hiddenNoteIdsFromDocs перед вызовом, ответ с цитатой скрытой уходит заглушкой' },
  'src/features/ai/hooks/useSaveInsight.ts': { methods: ['AIService.pickInsight'],
    reason: 'кнопка «сохранить вывод»: реплики диалога, цитаты скрытых — hiddenNoteIdsFromDocs' },
  'src/features/ai/services/insightCapture.ts': { methods: ['AIService.pickInsight'],
    reason: 'сбор вывода из диалога: тема-заметка проверяется isExcludedFromAI' },
  'src/features/ai/services/aiChatContext.ts': { methods: ['AIService.matchInsight'],
    reason: 'сверка выводов в ходе: dialogueFacetVisible/hideExcludedNotes' },
  'src/features/ai/services/AIChatMemoryService.ts': { methods: ['AIService.extractChatMemory'],
    reason: 'память из диалога: тема-заметка isExcludedFromAI, память — usableMemories' },
  'src/features/ai/services/AIProfileService.ts': { methods: ['AIService.chat'],
    reason: 'портрет: своды только видимых заметок (loadVisibleNoteKeys), память — usableMemories' },
  'src/features/ai/services/AIProfileFacetSummarizer.ts': { methods: ['AIService.summarizeFacet'],
    reason: 'описание грани: выдержки только видимых заметок (loadVisibleNoteKeys)' },
  'src/features/ai/services/AIMonthlyDigestService.ts': { methods: ['AIService.summarizeFacet'],
    reason: 'дайджест месяца: coversOnlyLiveNotes перед вызовом' },
  'src/features/ai/services/AIFacetJudgeService.ts': { methods: ['AIService.judgeFacets', 'AIService.summarizeFacet'], noPrimitive: true,
    reason: 'судья граней: выдержки граней, список уже отфильтрован AIProfileFacetService.getAll (TH-3)' },
  'src/features/ai/utils/retrieval/searchNotes.ts': { methods: ['AIService.rerank'],
    reason: 'переранжирование: кандидаты только видимые (loadVisibleNoteKeys/hiddenNoteIdsFromDocs)' },
  'src/features/ai/utils/retrieval/searchNotesMulti.ts': { methods: ['AIService.rerank'],
    reason: 'переранжирование нескольких запросов: те же фильтры, что searchNotes' },
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function loadSources(): SourceFile[] {
  return walk(SRC)
    .map(p => ({ path: toPosix(relative(process.cwd(), p)), text: readFileSync(p, 'utf8') }))
    .filter(f => !f.path.startsWith('src/test/') && !f.path.startsWith('src/testing/') && f.path !== 'src/features/ai/services/AIService.ts');
// AIService.ts — сами обёртки над callAi: проверка у тех, кто их зовёт.
}

describe('HA-4/DA-5: каждый вызов модели — в CALLERS с путём данных', () => {
  const files = loadSources();

  it('гейт не слепой: вызовов модели в репозитории больше десяти файлов', () => {
    expect(files.filter(f => MODEL_CALL.test(stripComments(f.text))).length).toBeGreaterThan(10);
  });

  it('в репозитории нет вызовов модели вне CALLERS, лишних методов и протухших строк', () => {
    expect(evaluateCallGate(files, CALLERS)).toEqual([]);
  });

  it('самопроверка: примитив в файле без строки CALLERS — всё равно находка (случай DA-1)', () => {
    const da1 = 'const pending = docs.filter(d => !isExcludedFromAI(d));\nfor (const d of pending) await AIService.summarize({ content });';
    expect(evaluateCallGate([{ path: 'src/x.ts', text: da1 }], {})).toHaveLength(1);
  });

  it('самопроверка: новый метод в вписанном файле, протухший метод, пропавший примитив, пустая причина', () => {
    const entry = { methods: ['AIService.chat'], reason: 'причина' };
    const ok = 'if (await noteHiddenFromAI(id)) return; await AIService.chat({});';
    expect(evaluateCallGate([{ path: 'src/x.ts', text: ok }], { 'src/x.ts': entry })).toEqual([]);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: ok + ' await AIService.summarize({});' }], { 'src/x.ts': entry })).toEqual(['src/x.ts: метод AIService.summarize не вписан в CALLERS']);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: 'await noteHiddenFromAI(id);' }], { 'src/x.ts': entry })).toEqual(['src/x.ts: в CALLERS, но модель не зовёт — убери строку']);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: 'await AIService.chat({});' }], { 'src/x.ts': entry })).toEqual(['src/x.ts: нет примитива видимости — проверка пропала?']);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: ok }], { 'src/x.ts': { ...entry, reason: ' ' } })).toEqual(['src/x.ts: строка CALLERS без причины']);
  });

  it('самопроверка: прямой callAi с эндпоинтом модели и поток чата видны; служебный callAi — нет; комментарий не считается', () => {
    expect(evaluateCallGate([{ path: 'src/x.ts', text: "await callAi('editWithAI', { content });" }], {})).toHaveLength(1);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: 'await streamChat({ messages });' }], {})).toHaveLength(1);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: "await callAi('getAIUsageStats', {});" }], {})).toEqual([]);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: '// AIService.process(text)\nconst a = 1;' }], {})).toEqual([]);
  });
});
