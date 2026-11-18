// A-4: строка [chat-shape] не содержит ни одного символа пользовательского текста.
//
// Мутация, на которой тест краснеет: добавить в chatShape поле title:
// input.noteScope?.title (или documentContent: input.documentContent) — красный
// на ассерте «в строке лога нет букв из заметки».
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chatShape, logChatShape } from '../chatShape.js';

function findRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src/shared/ai/chatShape.ts'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('не найден корень репозитория');
    dir = parent;
  }
}

// Маркеры — только кириллица: тогда любой символ из заметки в строке лога —
// провал, а совпадения с латинскими ключами JSON исключены по построению.
const DOC = 'ЗелёныеЖёлудиНаПолкеЩукаПолнаСалажки';
const PORTRAIT = 'МарафонВыносливостьВечерниеЗаметки';
const MEMORY = 'ГолосКартыПервыеДатыПрофиль';
const TITLE = 'РазговорПроСрокиИПаузы';
const HISTORY = 'ПрошлаяРепликаПроШагиИКолена';
const SYSTEM = DOC + PORTRAIT + MEMORY + TITLE + HISTORY;

const input = {
  personaId: 'group_psychology',
  noteScope: { mode: 'note' as const, title: TITLE, date: '8 октября 2026 г.' },
  crisis: false,
  reasoning: true,
  messages: [{ role: 'user', content: HISTORY }, { role: 'assistant', content: HISTORY }, { role: 'user', content: HISTORY }],
  documentContent: DOC,
  userPortrait: PORTRAIT,
  memoryContext: MEMORY,
  system: SYSTEM,
};

describe('A-4: форма запроса в журнал — только размеры', () => {
  it('поля и типы зафиксированы', () => {
    const shape = chatShape(input);
    expect(Object.keys(shape).sort()).toEqual([
      'crisis', 'docChars', 'histChars', 'memoryChars', 'msgs', 'persona', 'portraitChars', 'reasoning', 'scope', 'systemChars',
    ].sort());
    expect(shape.msgs).toBe(3);
    expect(shape.histChars).toBe(HISTORY.length * 3);
    expect(shape.docChars).toBe(DOC.length);
    expect(shape.portraitChars).toBe(PORTRAIT.length);
    expect(shape.memoryChars).toBe(MEMORY.length);
    expect(shape.systemChars).toBe(SYSTEM.length);
    expect(shape.scope).toBe('note');
    expect(shape.persona).toBe('group_psychology');
    expect(shape.reasoning).toBe(true);
    expect(shape.crisis).toBe(false);
  });

  it('в строке лога нет ни одного символа из заметки, портрета, памяти, названия и реплик', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    logChatShape(input);
    expect(info).toHaveBeenCalledTimes(1);
    const line = info.mock.calls[0]!.join(' ');
    const forbidden = new Set([...DOC, ...PORTRAIT, ...MEMORY, ...TITLE, ...HISTORY]);
    const leaked = [...line].filter(ch => forbidden.has(ch));
    expect(leaked, `утекло: ${leaked.join('')}`).toEqual([]);
    // даты, id, uid — тоже мимо
    expect(line).not.toContain('2026');
    expect(line).not.toMatch(/uid|documentId|title/i);
  });

  it('неизвестная персона не протаскивает произвольную строку', () => {
    expect(chatShape({ ...input, personaId: DOC }).persona).toBe('other');
    expect(chatShape({ ...input, noteScope: undefined }).scope).toBeNull();
    expect(chatShape({ ...input, crisis: undefined, reasoning: undefined }).crisis).toBe(false);
    expect(chatShape({ ...input, documentContent: null, userPortrait: null, memoryContext: null }).docChars).toBe(0);
  });

  it('оба бэкенда пишут строку после сборки запроса провайдеру', () => {
    const root = findRoot();
    const stream = readFileSync(join(root, 'api/chat.ts'), 'utf8');
    const callable = readFileSync(join(root, 'api/ai/chatWithAI.logic.ts'), 'utf8');

    // Форма проверки — регэксп, а не точная строка: с DR-8 из того же модуля
    // импортируют не только logChatShape.
    const importsShape = (src: string, prefix: string) =>
      new RegExp(`import \\{[^}]*\\blogChatShape\\b[^}]*\\} from '${prefix}src/shared/ai/chatShape\\.js'`).test(src);
    expect(importsShape(stream, '../')).toBe(true);
    expect(importsShape(callable, '../../')).toBe(true);
    // вызов — после сборки providerRequest, иначе в строке не та форма, что ушла провайдеру
    expect(stream.indexOf('logChatShape({')).toBeGreaterThan(stream.indexOf('const providerRequest'));
    expect(callable.indexOf('logChatShape({')).toBeGreaterThan(callable.indexOf('const request ='));
  });
});

describe('разбор 18.11: счётчики опор гипотезы', () => {
  it('есть — едут в строку числами; нет — поля нет', () => {
    const hypoStats = { cands: 12, picked: 3, quoted: 3, diverse: 1, shown: 0 };
    expect(chatShape({ ...input, hypoStats }).hypo).toEqual(hypoStats);
    expect('hypo' in chatShape(input)).toBe(false);
  });
});


describe('разбор 18.11: схема запроса — счётчики опор только числами', () => {
  it('числа проходят; лишнее поле или строка — счётчики отброшены, ход не падает', async () => {
    const { chatInputSchema } = await import('../buildChatPrompt.js');
    const base = { personaId: 'coach', messages: [{ role: 'user', content: 'x' }] };
    const ok = chatInputSchema.safeParse({ ...base, hypoStats: { cands: 1, picked: 1, quoted: 1, diverse: 1, shown: 0 } });
    expect(ok.success && ok.data.hypoStats).toEqual({ cands: 1, picked: 1, quoted: 1, diverse: 1, shown: 0 });
    for (const bad of [{ cands: 1, picked: 1, quoted: 1, diverse: 1, shown: 0, note: 'текст' }, { cands: 'много', picked: 1, quoted: 1, diverse: 1, shown: 0 }, { cands: 5000, picked: 1, quoted: 1, diverse: 1, shown: 0 }]) {
      const r = chatInputSchema.safeParse({ ...base, hypoStats: bad });
      expect(r.success).toBe(true);
      expect(r.success && r.data.hypoStats).toBeUndefined();
    }
  });
});
