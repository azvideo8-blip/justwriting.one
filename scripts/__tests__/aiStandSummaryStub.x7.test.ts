import { describe, it, expect, vi } from 'vitest';
import type { AiContext } from '../../src/shared/ai/context.js';
import { completionContent, noteSummaryJson, noteFromBody } from '../stand/ai-stub-rules.mjs';

// R7Q-036: прежде этот файл проверял только двойку (заглушку) — на поломке
// продукта тест оставался зелёным. Ниже добавлен прогон через настоящий
// `summarizeDocumentLogic`: ответ заглушки проходит через sanitization,
// isUsable, validateVerbatimQuote и разделение фактов/намерений продукта.
const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }));
vi.mock('../../api/ai/provider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../api/ai/provider')>();
  return { ...orig, generate: (...a: unknown[]) => generateMock(...(a as [])) };
});

function makeCtx(): AiContext {
  return {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-17' }),
    checkDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-17' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-17' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-10-17', shardId: '0', allowance: 8192 }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn().mockResolvedValue(20),
    isAdmin: vi.fn().mockResolvedValue(false),
  } as unknown as AiContext;
}

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

  it('тон и суть — читаемые по признаку кириллицы', async () => {
    const parsed = JSON.parse(await completionContent(messages));

    const cyrRatio = (value: unknown) => ((String(value).match(/[а-яё]/g) ?? []).length / String(value).length);
    expect(cyrRatio(parsed.summary), 'суть заметки не переживёт фильтр isUsable').toBeGreaterThanOrEqual(0.2);
    expect(parsed.tone).toBe('задумчивый');
    expect(parsed.extractedFacts.length).toBeGreaterThan(0);
  });

  it('текст заметки берётся из маркеров, а не из служебной шапки', () => {
    expect(noteFromBody(`Инструкция для модели:\n${NOTE_PROMPT}\nВерни JSON.`)).toBe(NOTE);
    expect(JSON.parse(noteSummaryJson(NOTE)).summary).toContain('бежал шесть километров');
  });

  // Продукт, а не двойка: если `summarizeDocumentLogic` станет строже (isUsable,
  // валидатор цитаты, разделение модальностей) и ответ стендовой заглушки
  // перестанет проходить — красный здесь, а не молчаливый 503 на стенде.
  it('продукт: summarizeDocumentLogic принимает ответ заглушки без потерь', async () => {
    const raw = await completionContent(messages);
    generateMock.mockResolvedValue({ text: raw, tokensIn: 40, tokensOut: 60, model: 'stand-stub' });

    const { summarizeDocumentLogic } = await import('../../api/ai/summarizeDocument.logic');
    const out = await summarizeDocumentLogic(makeCtx(), 'u_x7_product', { content: NOTE }) as Record<string, unknown>;

    expect(typeof out.summary, 'суть съедена isUsable продукта').toBe('string');
    expect(String(out.summary)).toContain('бежал шесть километров');
    expect(Array.isArray(out.themes) && (out.themes as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(out.extractedFacts) && (out.extractedFacts as unknown[]).length).toBeGreaterThan(0);
    expect(out.tone).toBe('задумчивый');
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
