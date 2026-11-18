// ED-6: выкачка памяти на длинном диалоге упиралась в потолок maxTokens=1000.
// Обрезанный массив не имеет закрывающей скобки, прежний фолбэк на нём молча
// терял ВЕСЬ вывод, и запрос оставался оплачен без единой сохранённой памяти.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock, settleMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  settleMock: vi.fn(),
}));

vi.mock('../ai/provider', () => ({
  generate: (...a: unknown[]) => generateMock(...(a as [])),
}));

// Резерв подменяем полностью: важно смотреть, каким исходом закончился вызов.
vi.mock('../../src/shared/ai/aiPolicy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/ai/aiPolicy.js')>();
  return {
    ...actual,
    MEMORY_EXTRACT_MAX_MESSAGES: actual.MEMORY_EXTRACT_MAX_MESSAGES,
    chargeCall: vi.fn(async () => ({
      settle: settleMock,
      markProduced: vi.fn(),
      recordUsage: vi.fn(async () => {}),
      attachGlobalReservation: vi.fn(),
      refunded: false,
      get settled() { return settleMock.mock.calls[0]?.[0] ?? null; },
    })),
  };
});

process.env.OPENROUTER_API_KEY = 'test-key';

import { extractChatMemoryLogic, salvageMemories } from '../ai/extractChatMemory.logic';
import type { AiContext } from '../../src/shared/ai/context.js';

const ctx = {
  checkAndIncrementBulkLimit: vi.fn(async () => ({ ok: true, day: '2026-10-09' })),
  tryReserveGlobalRequest: vi.fn(async () => ({ tokens: 0, refunded: false })),
  recordUsage: vi.fn(async () => {}),
} as unknown as AiContext;

// Реплика человека содержит всё, что выкачка сохраняет: с К25-5 единица без
// опоры в словах человека отбрасывается, а здесь проверяется только сборка обрезанного массива.
const DATA = { messages: [{ role: 'user' as const, content: 'Я переехала в Казань и записалась на скалодром. Хочу ходить на скалодром дважды в неделю. Прошу отвечать короче.' }] };

function result(text: string) {
  return { text, tokensIn: 900, tokensOut: 2000, model: 'deepseek/deepseek-v4-flash' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ED-6: обрезанный ответ выкачки памяти', () => {
  it('массив обрезан на четвёртом объекте — сохраняются три целых, исход done', async () => {
    generateMock.mockResolvedValue(result(
      '[{"kind":"fact","text":"Переехала в Казань."},'
      + '{"kind":"commitment","text":"Хочу ходить на скалодром дважды в неделю."},'
      + '{"kind":"preference","text":"Прошу отвечать короче."},'
      + '{"kind":"fact","text":"А ещё я начала',
    ));
    const out = await extractChatMemoryLogic(ctx, 'u_ed6', DATA) as { memories: { kind: string; text: string }[] };
    expect(out.memories).toHaveLength(3);
    expect(out.memories.map(m => m.kind)).toEqual(['fact', 'commitment', 'preference']);
    expect(settleMock).toHaveBeenCalledWith('done');
  });

  it('обрезан первый же объект — нечего спасать: пустой список и исход failed, как раньше', async () => {
    generateMock.mockResolvedValue(result('[{"kind":"fac'));
    const out = await extractChatMemoryLogic(ctx, 'u_ed6', DATA) as { memories: unknown[] };
    expect(out.memories).toHaveLength(0);
    expect(settleMock).toHaveBeenCalledWith('failed');
  });

  it('валидный JSON — поведение прежнее, спасение не требуется', async () => {
    generateMock.mockResolvedValue(result('[{"kind":"fact","text":"Переехала в Казань."}]'));
    const out = await extractChatMemoryLogic(ctx, 'u_ed6', DATA) as { memories: { kind: string; text: string }[] };
    expect(out.memories).toEqual([{ kind: 'fact', text: 'Переехала в Казань.' }]);
    expect(settleMock).toHaveBeenCalledWith('done');
  });

  it('потолок вывода поднят с 1000 и резерв считается от него же', async () => {
    generateMock.mockResolvedValue(result('[]'));
    await extractChatMemoryLogic(ctx, 'u_ed6', DATA);
    expect(generateMock.mock.calls[0]?.[0]).toMatchObject({ maxTokens: 2000 });
    const reserved = (ctx.tryReserveGlobalRequest as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as number;
    expect(reserved).toBeGreaterThanOrEqual(2000);
  });

  it('salvageMemories берёт только целые объекты с kind и text', () => {
    expect(salvageMemories(`{"kind":"fact","text":"а"}},{"kind":"ins`)).toEqual([{ kind: 'fact', text: 'а' }]);
    expect(salvageMemories(`{"kind":"fact"} и {"text":"без kind"}`)).toEqual([]);
  });

  // Инвариант W-4: текст ошибки провайдера не едет в серверный журнал — тело
  // ответа провайдера может цитировать вход, то есть текст заметок человека.
  it('сбой провайдера: в журнал уходит форма ошибки, а не её текст', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    generateMock.mockRejectedValue(new Error('OpenRouter 400: {"error":{"message":"rejected input: СЕКРЕТНЫЙ ТЕКСТ ЗАМЕТКИ"}}'));
    await expect(extractChatMemoryLogic(ctx, 'u_ed6', DATA)).rejects.toThrow('Memory extraction failed.');
    const logged = errSpy.mock.calls.map(c => c.map(String).join(' ')).join('\n');
    expect(logged).not.toContain('СЕКРЕТНЫЙ');
    expect(logged).toMatch(/name=Error/);
    errSpy.mockRestore();
  });
});
