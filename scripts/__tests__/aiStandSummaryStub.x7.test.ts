import { describe, it, expect } from 'vitest';
import { completionContent, noteSummaryJson, noteFromBody } from '../stand/ai-stub-rules.mjs';

// X-7: заглушка стенда обязана отвечать на промпт разбора заметки текстом,
// который проходит схему summarizeDocument. До правки она отдавала эхо-строку,
// разбор падал с 503 «Failed to parse summary», и на стенде не существовало
// конвейера «заметка → разбор → вектор → контекст чата».
process.env.OPENROUTER_API_KEY = 'test-key';

const SUMMARY_SYSTEM = 'Проанализируй личную заметку и верни JSON. Отвечай СТРОГО на русском языке.';
const NOTE = 'Сегодня бежал шесть километров вдоль набережной. Ветер был резкий, но ноги шли легко, и я впервые за неделю лег до полуночи.';
const NOTE_PROMPT = `[USER_NOTE_START]\n${NOTE}\n[USER_NOTE_END]`;

const messages = [
  { role: 'system', content: SUMMARY_SYSTEM },
  { role: 'user', content: NOTE_PROMPT },
];

describe('X-7: разбор заметки от стендовой заглушки', () => {
  it('ответ проходит схему summarizeDocument', async () => {
    const { summarySchema } = await import('../../api/ai/summarizeDocument.logic');
    const raw = await completionContent(messages);
    const parsed = summarySchema.safeParse(JSON.parse(raw));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('цитата дословная, тон и суть — читаемые по признаку кириллицы', async () => {
    const { validateVerbatimQuote } = await import('../../api/ai/summarizeDocument.logic');
    const parsed = JSON.parse(await completionContent(messages));

    expect(validateVerbatimQuote(NOTE, parsed.quotableSentence)).toBe(parsed.quotableSentence);

    const cyrRatio = (value: unknown) => ((String(value).match(/[а-яё]/g) ?? []).length / String(value).length);
    expect(cyrRatio(parsed.summary), 'суть заметки не переживёт фильтр isUsable').toBeGreaterThanOrEqual(0.2);
    expect(parsed.tone).toBe('задумчивый');
    expect(parsed.extractedFacts.length).toBeGreaterThan(0);
  });

  it('текст заметки берётся из маркеров, а не из служебной шапки', () => {
    expect(noteFromBody(`Инструкция для модели:\n${NOTE_PROMPT}\nВерни JSON.`)).toBe(NOTE);
    expect(JSON.parse(noteSummaryJson(NOTE)).summary).toContain('бежал шесть километров');
  });

  it('прочие промпты отвечают как раньше (память не пуста)', async () => {
    const raw = await completionContent([
      { role: 'system', content: 'Извлеки долговременные единицы памяти' },
      { role: 'user', content: '[CONVERSATION_START]хотел разобраться с тревогой[/CONVERSATION_START]' },
    ]);
    const units = JSON.parse(raw);
    expect(Array.isArray(units) && units.length).toBeGreaterThan(0);
  });
});
