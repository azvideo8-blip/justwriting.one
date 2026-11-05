// DT-1 (дейлик 04.11, подозрение ревьюера): запасной (непотоковый) путь решает об
// «упёрся в потолок» только по счётчику токенов, потому что провайдер не отдаёт
// `finish_reason` наружу. Здесь — настоящий `generate()` на реальном теле ответа
// OpenRouter: `finish_reason: 'length'` при `completion_tokens` ниже потолка.
// Мутация: не читать `finish_reason` в `api/ai/provider.ts` → оба кейса красные.
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.OPENROUTER_API_KEY = 'test-key';

import { generate } from '../ai/provider';

function openRouterBody(finishReason: string | null, completionTokens: number) {
  return JSON.stringify({
    choices: [{ message: { content: 'оборванный на середине слова ответ' }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: completionTokens },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DT-1: finish_reason поставщика доезжает до callers', () => {
  it('лимит токенов от поставщика — в результате generate(), даже когда выдача ниже потолка', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(openRouterBody('length', 900), { status: 200 })));
    const res = await generate({ system: 's', messages: [{ role: 'user', content: 'привет' }], maxTokens: 3000, model: 'test-model' });
    expect(res.finishReason).toBe('length');
    expect(res.tokensOut).toBe(900);
  });

  it('обычный конец — stop, а не null (чтобы «нет сигнала» отличался от «поставщик доволен»)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(openRouterBody('stop', 900), { status: 200 })));
    const res = await generate({ system: 's', messages: [{ role: 'user', content: 'привет' }], maxTokens: 3000, model: 'test-model' });
    expect(res.finishReason).toBe('stop');
  });
});
