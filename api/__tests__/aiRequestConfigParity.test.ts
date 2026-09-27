import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { generate } from '../ai/provider';
import { buildChatRequestBody } from '../../src/shared/ai/requestConfig.js';

/**
 * SA-8: один источник конфигурации запроса к ИИ.
 *
 * Харнес `scripts/ai/citation_faithfulness.mjs` отправлял `temperature: 0` и НЕ
 * отправлял `reasoning_effort: 'none'`. Прод шлёт наоборот. Значит замеры
 * цитируемости, сделанные на этом харнесе, валидны для модели, которой в
 * приложении нет: детерминированный ответ reasoning-модели там, где живой ответ
 * греется reasoning-режимом по умолчанию.
 *
 * Проверка держит три вещи: тело прода и тело харнеса для одних параметров
 * совпадают; `temperature` нет ни там, ни там; и ни один харнес не строит тело
 * сам — статическая проверка исходников, иначе правка «вернули свою копию»
 * прошла бы зелёной. Там же (SA-7) харнес ранжирования обязан брать промпт,
 * форму user-сообщения и разбор ответа из src/shared/ai/rerankPrompt.ts.
 */

/**
 * Харнесы, обязанные идти через эталонное тело. `promptImports` — что ещё они
 * обязаны импортировать (SA-7: свой промпт ранжирования = другой измеряемый
 * контракт), а `noPromptCopy` запрещает промт-текст в коде харнеса.
 */
const HARNESS_FILES = [
  { file: 'scripts/ai/citation_faithfulness.mjs', promptImports: [] as string[], noPromptCopy: false },
  {
    file: 'scripts/rerank-bench/rerank-real.mjs',
    promptImports: ['RERANK_SYSTEM_PROMPT', 'buildRerankUserMessage', 'parseRerankSelection'],
    // У харнеса ранжирования не должно быть ни своего промпта, ни своего
    // формата ответа: в коде не бывает кириллицы, кроме цитат из общих модулей.
    noPromptCopy: true,
  },
];

// Корень ищем подъёмом от cwd, а не через import.meta.url: в jsdom модуль
// отдаётся по http://, и файл харнеса так не прочитать.
const repoRoot = (() => {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'scripts/ai/citation_faithfulness.mjs'))) return dir;
    const parent = dirname(dir);
    if (parent === dir || parse(dir).root === dir) {
      throw new Error('не найден корень репозитория — харнес не прочитан');
    }
    dir = parent;
  }
})();

const MODEL_ENV = 'OPENROUTER_MODEL';

async function prodBodyFor(params: Parameters<typeof generate>[0]): Promise<Record<string, unknown>> {
  const captured: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, init: { body: string }) => {
    captured.push(JSON.parse(init.body) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
    };
  });
  await generate(params);
  vi.unstubAllGlobals();
  const body = captured[0];
  if (!body) throw new Error('прод не вызвал fetch — тело не перехвачено');
  return body;
}

describe('SA-8: прод и харнесы шлют одно тело', () => {
  const originalModel = process.env[MODEL_ENV];

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalModel === undefined) delete process.env[MODEL_ENV];
    else process.env[MODEL_ENV] = originalModel;
  });

  it('тело generate() и тело эталонного билдера совпадают построчно', async () => {
    const params = {
      system: 'Ты — ранжировщик.',
      messages: [{ role: 'user' as const, content: 'Запрос' }],
      maxTokens: 512,
    };

    expect(await prodBodyFor(params)).toEqual(buildChatRequestBody(params));
  });

  it('ни прод, ни эталон не задают temperature', async () => {
    const params = { messages: [{ role: 'user' as const, content: 'Запрос' }] };

    expect(await prodBodyFor(params)).not.toHaveProperty('temperature');
    expect(buildChatRequestBody(params)).not.toHaveProperty('temperature');
  });

  it('reasoning выключён по умолчанию и включается только явным effort', async () => {
    const params = { messages: [{ role: 'user' as const, content: 'Запрос' }] };
    const withReasoning = { ...params, reasoningEffort: 'high' as const };

    expect(await prodBodyFor(params)).toMatchObject({ reasoning_effort: 'none' });
    expect(await prodBodyFor(withReasoning)).toMatchObject({ reasoning: { effort: 'high' } });

    expect(buildChatRequestBody(params)).not.toHaveProperty('reasoning');
    expect(buildChatRequestBody(withReasoning)).not.toHaveProperty('reasoning_effort');
  });

  it('модель берётся из OPENROUTER_MODEL с продовым фолбэком', () => {
    // Только билдер: прод читает env один раз на старте модуля (getActiveModel),
    // а эталонный модуль обязан давать тот же фолбэк для живого чтения env.
    delete process.env[MODEL_ENV];
    expect(buildChatRequestBody({ messages: [] })).toMatchObject({ model: 'deepseek/deepseek-v4-flash' });

    process.env[MODEL_ENV] = 'yandex/gpt-pro';
    expect(buildChatRequestBody({ messages: [] })).toMatchObject({ model: 'yandex/gpt-pro' });
  });

  /**
   * Статическая часть: у харнеса не должно остаться возможности молча завести
   * своё тело. Пока он импортирует билдер и не пишет ни `temperature`, ни
   * `reasoning` руками, расхождение возможно только в одном месте — и оно
   * упадёт на тесте выше.
   */
  it.each(HARNESS_FILES)('харнес $file строит тело через эталонный модуль', ({ file, promptImports, noPromptCopy }) => {
    const src = readFileSync(join(repoRoot, file), 'utf8');
    // Только код: рассуждения о temperature и reasoning в комментариях — как раз
    // то, что здесь объясняется, и запрещать их в тексте бессмысленно.
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).toContain('src/shared/ai/requestConfig');
    expect(code).toContain('buildChatRequestBody(');
    // Любое упоминание в коде, в любой форме: `temperature: 0`, `body.temperature
    // = 0`, `reasoning_effort: 'none'` — это решение харнеса, а не прода.
    expect(code).not.toMatch(/temperature/i);
    expect(code).not.toMatch(/reasoning/i);

    for (const name of promptImports) {
      expect(code).toContain(`${name}`);
    }
    if (noPromptCopy) {
      // Свой промпт = другой измеряемый контракт. Копия промта — это длинный
      // строковый литерал; короткие подписи (`'ПУСТО'`, метки строк) разрешены.
      const copied = [...code.matchAll(/(['"`])((?:\\\1|(?!\1)[\s\S])*?)\1/g)]
        .map(m => m[2] ?? '')
        .filter(text => text.length > 100)
        .map(text => `${text.slice(0, 40)}…`);
      expect(copied).toEqual([]);
    }
  });
});
