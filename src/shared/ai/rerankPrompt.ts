/**
 * SA-7: промпт и разбор ответа ранжирования — в одном месте.
 *
 * Харнес `scripts/rerank-bench/rerank-real.mjs` держал свою копию промпта
 * ранжирования и свой контракт ответа: прод просил `{"idx":[1,2]}` (номера
 * кандидатов), харнес — `{"ids":["docId"]}` (идентификаторы). Разошедшиеся
 * контракты означают, что бенчмарк мерил соглашение модели с другим промптом, а
 * вывод из него переносился на прод.
 *
 * Отсюда же берётся и разбор: пустой `content` — это отказ транспорта, а не
 * «модель сочла все заметки нерелевантными». Прод на пустой ответ кидается
 * (AiError internal); харнес обязан кидаться так же, иначе пустой ответ
 * записывается в вердикт «ОТКАЗ» и попадает в точность.
 */

export const RERANK_SYSTEM_PROMPT = 'Ты — модуль ранжирования заметок. По запросу пользователя и списку заметок-кандидатов выбери самые релевантные по смыслу и намерению запроса. Верни ТОЛЬКО валидный JSON-объект вида {"idx":[1,2]} — массив номеров выбранных кандидатов (начиная с 1) по убыванию релевантности, без пояснений.';

export function buildRerankUserMessage(safeQuery: string, cardsText: string, maxResults: number): string {
  return `Запрос пользователя: "${safeQuery}"\n\nКандидаты-заметки:\n${cardsText}\n\nВыбери до ${maxResults} самых релевантных.`;
}

/** Ответ модели (не JSON / пустой) — исключение, а не пустой список. */
export class RerankResponseError extends Error {
  constructor(message = 'Rerank response was not valid JSON.') {
    super(message);
    this.name = 'RerankResponseError';
  }
}

/**
 * Номера кандидатов (`idx`) → их идентификаторы; старое поле `ids` принимается,
 * если в нём строковые идентификаторы из входа. Пустой текст — ошибка.
 */
export function parseRerankSelection(text: string, candidateIds: string[], maxResults: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) throw new RerankResponseError('Rerank response was empty.');

  let body = trimmed;
  if (body.startsWith('```')) {
    body = body.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RerankResponseError();
  }

  const obj = parsed as { idx?: unknown; ids?: unknown };
  const known = new Set(candidateIds);
  const ids: string[] = [];

  if (Array.isArray(obj.idx)) {
    for (const item of obj.idx) {
      const num = typeof item === 'number' ? item : parseInt(String(item), 10);
      if (Number.isNaN(num) || num < 1 || num > candidateIds.length) continue;
      const id = candidateIds[num - 1];
      if (id && !ids.includes(id)) ids.push(id);
    }
  } else if (Array.isArray(obj.ids)) {
    for (const id of obj.ids) {
      // Как в проде: без дедупликации — иначе рефакторинг меняет поведение.
      if (typeof id === 'string' && known.has(id)) ids.push(id);
    }
  }

  return ids.slice(0, maxResults);
}
