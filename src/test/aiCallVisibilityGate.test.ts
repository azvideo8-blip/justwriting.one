import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// HA-4 (дейлик 26.11, Н-1): вызов модели с текстом заметки без проверки видимости
// краснеет. TH-3 (`aiStoreVisibilityGate`) смотрит на чтения `ai*`-сторов, а ИИ-панель
// письма и «Analyze» в Диагностике брали текст из `versions` и буфера редактора — и
// отдавали его поставщику, даже если заметка скрыта от ИИ или в корзине.
//
// Файл с вызовом `AIService.<метод, отдающий текст модели>` проходит, если в нём есть
// примитив видимости, или он в ALLOWED с причиной. Протухшая строка ALLOWED — красная.
// ponytail: проверка по файлу, как у TH-3; потолок тот же — файл с проверкой в одной
// функции и без неё в другой пройдёт.
//
// Сюда же — прямой поток чата (`streamChat`, `callableChat`) и `callAi` с эндпоинтом модели в обход AIService.
// Мутации: убрать `noteHiddenFromAI` из AIPanel.tsx → красный; строка ALLOWED без причины → красный.
// Потолок: в useSyncDiagnostics.tsx есть и `isExcludedFromAI` (пометка строк) — снятие проверки
// перед разбором ловит не гейт, а useSyncDiagnosticsHiddenNote.ha2.

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

export function evaluateCallGate(files: readonly SourceFile[], allowed: Readonly<Record<string, string>>): string[] {
  const findings: string[] = [];
  const callers = new Set<string>();
  for (const f of files) {
    const clean = stripComments(f.text);
    if (!MODEL_CALL.test(clean)) continue;
    callers.add(f.path);
    if (PRIMITIVES.test(clean)) continue;
    const reason = allowed[f.path];
    if (reason === undefined) findings.push(`${f.path}: вызов модели без проверки видимости — добавь noteHiddenFromAI/isExcludedFromAI или строку в ALLOWED с причиной`);
    else if (reason.trim() === '') findings.push(`${f.path}: строка ALLOWED без причины`);
  }
  for (const path of Object.keys(allowed)) {
    if (!callers.has(path)) findings.push(`${path}: в ALLOWED, но модель не зовёт — убери строку`);
  }
  return findings;
}

/** Файлы, где вызов модели безопасен без примитива. Причина — путь данных, а не имя файла. */
const ALLOWED: Readonly<Record<string, string>> = {
  'src/features/ai/utils/aiChatTransport.ts':
    'транспорт чата: определяет streamChat/callableChat, текст ему передаёт useAIChat после сборки контекста с hideExcludedNotes',
  'src/features/ai/services/AIFacetJudgeService.ts':
    'судья граней: текст — выдержки граней, а список граней уже отфильтрован AIProfileFacetService.getAll (TH-3)',
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

describe('HA-4: вызов модели с текстом заметки без проверки видимости краснеет', () => {
  const files = loadSources();

  it('гейт не слепой: вызовов модели в репозитории больше десяти файлов', () => {
    expect(files.filter(f => MODEL_CALL.test(stripComments(f.text))).length).toBeGreaterThan(10);
  });

  it('в репозитории нет вызовов модели без проверки и вне ALLOWED', () => {
    expect(evaluateCallGate(files, ALLOWED)).toEqual([]);
  });

  it('самопроверка: вызов без примитива — находка; с примитивом — нет; закомментированный не считается', () => {
    expect(evaluateCallGate([{ path: 'src/x.ts', text: 'await AIService.process(text, "ideas");' }], {})).toHaveLength(1);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: 'if (await noteHiddenFromAI(id)) return; await AIService.process(text, "ideas");' }], {})).toEqual([]);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: '// AIService.process(text)\nconst a = 1;' }], {})).toEqual([]);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: "await callAi('editWithAI', { content });" }], {})).toHaveLength(1);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: 'await streamChat({ messages });' }], {})).toHaveLength(1);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: "await callAi('getAIUsageStats', {});" }], {})).toEqual([]);
  });

  it('самопроверка: строка ALLOWED без причины и протухшая строка — красные', () => {
    expect(evaluateCallGate([{ path: 'src/x.ts', text: 'await AIService.chat({});' }], { 'src/x.ts': ' ' })).toEqual(['src/x.ts: строка ALLOWED без причины']);
    expect(evaluateCallGate([{ path: 'src/x.ts', text: 'const a = 1;' }], { 'src/x.ts': 'причина' })).toHaveLength(1);
  });
});
