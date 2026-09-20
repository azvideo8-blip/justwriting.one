// api/ai/pure.ts
//
// The AI helpers that touch no database. Historically copied out of
// functions/src/shared/aiUtils.ts; that tree was deleted with Firebase
// (step C4 of docs/migration-plan.md). The remaining duplication with
// src/shared/ai/ is tracked as AG-AIONE-1.

import DOMPurify from 'isomorphic-dompurify';
import { sanitizeAiInputShared, MAX_AI_CONTENT_LENGTH } from '../../src/shared/ai/buildChatPrompt.js';

export { MAX_AI_CONTENT_LENGTH };
/** Потолок тела запроса. Скопирован раньше в три файла — при расхождении один
 *  эндпоинт молча принимает то, что другой отвергает. */
export const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

// AG-AIONE-1: вся логика инъекций (паттерны, невидимые символы, гомоглифы)
// живёт в src/shared/ai/injectionPatterns.ts — здесь только ре-экспорт.
export {
  INJECTION_PATTERNS,
  hasInjectionAttempt,
} from '../../src/shared/ai/injectionPatterns.js';

export function sanitizeAiInput(content: string): string {
  return sanitizeAiInputShared(content);
}

// Strips ALL HTML tags and attributes from AI responses using DOMPurify.
// Also strips reasoning artifacts (//<reasoning>, <reasoning>, thinking text)
// that reasoning models like DeepSeek may leak into responses.
// RSN-3: In reasoning mode, keep <reasoning>/<answer> text content.
export function sanitizeAiResponse(response: string, keepReasoning = false): string {
  let cleaned = response;
  if (!keepReasoning) {
    // 1. <think>...</think> tags and closing </think>
    if (/<\/think>/i.test(cleaned)) {
      const after = cleaned.split(/<\/think>/i)[1];
      if (after !== undefined) cleaned = after;
    } else {
      cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
      cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
    }
    // 2. <answer> tags
    const answerMatch = cleaned.match(/(?:\/\/)?<answer>([\s\S]*?)(?:<\/answer>|$)/i);
    if (answerMatch) {
      cleaned = answerMatch[1]!;
    }
    // 3. Markdown: ХОД МЫСЛИ: ... ОТВЕТ: ...
    if (/(?:^|\n)ХОД МЫСЛИ:/i.test(cleaned)) {
      const mdAnswerMatch = cleaned.match(/(?:^|\n)ОТВЕТ:\s*([\s\S]*?)$/i);
      cleaned = mdAnswerMatch ? mdAnswerMatch[1]! : '';
    } else {
      // 4. Standalone ОТВЕТ: line
      const standaloneAnswerMatch = cleaned.match(/(?:^|\n)ОТВЕТ:\s*([\s\S]*?)$/);
      if (standaloneAnswerMatch && standaloneAnswerMatch.index !== undefined && standaloneAnswerMatch.index > 0) {
        cleaned = standaloneAnswerMatch[1]!;
      }
    }
    // OPT-8: Strip reasoning blocks that reasoning models leak into output
    cleaned = cleaned.replace(/\/\/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
    cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
    cleaned = cleaned.replace(/\/\/<reasoning>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/<reasoning>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/^\/\/<reasoning>/gim, '');
    // Вырезание CJK убрано (#35). Оно стояло здесь ради иероглифов,
    // просочившихся из рассуждений, — но к этой строке рассуждения уже вырезаны
    // выше (блоки <think>, «ХОД МЫСЛИ:», <reasoning>), и под нож попадали только
    // цитаты самого человека: authorPhrases, quotableSentence, редактура его
    // текста. Залётный знак в ответе видно и можно игнорировать; пропавшую
    // цитату из собственной заметки человек не видит никогда.
    // Strip citation artifacts that gpt-oss appends to factual sentences
    // (e.g. "30 000 рублейreferences" or "степень awarded").
    cleaned = cleaned.replace(/([а-яёА-ЯЁ\d])(references?|sources?|citations?|awarded)(?=$|[^а-яёА-ЯЁa-zA-Z0-9])/gi, '$1');
    // Collapse any double-spaces created by the strips above.
    cleaned = cleaned.replace(/  +/g, ' ').trim();
  }
  return DOMPurify.sanitize(cleaned, {
    ALLOWED_TAGS: keepReasoning ? ['reasoning', 'answer'] : [],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Why an AI call failed, from the provider error the request threw.
 *
 * Everything used to be re-thrown as HttpsError('internal'), so a provider
 * outage was indistinguishable from a bug in our own request — the client could
 * not tell the user anything more useful than "something went wrong", and could
 * not decide whether retrying made sense. aiProvider has already retried the
 * transient cases by the time we get here.
 */
export function classifyProviderFailure(err: unknown): { code: 'unavailable' | 'internal'; reason: string } {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/OpenRouter 5\d\d/i.test(msg)) return { code: 'unavailable', reason: 'UPSTREAM_ERROR' };
  if (/body read timeout|aborted|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)) {
    return { code: 'unavailable', reason: 'UPSTREAM_TIMEOUT' };
  }
  if (/OpenRouter 4\d\d/i.test(msg)) return { code: 'internal', reason: 'BAD_REQUEST' };
  if (/OPENROUTER_API_KEY not set/i.test(msg)) return { code: 'internal', reason: 'MISCONFIGURED' };
  return { code: 'internal', reason: 'UNKNOWN' };
}

// Одна общая дневная корзина: из неё платит и чат, и обновление профиля
// (D4.24). Обновление стоит десяток-полтора вызовов, поэтому при прежних 10
// запросах в сутки оно не помещалось в лимит целиком и обрывалось на середине.
export const DAILY_LIMIT = (() => {
  const raw = process.env.AI_DAILY_LIMIT;
  if (!raw) return 30;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? 30 : parsed;
})();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// Project-wide daily request/token budget guard for the OpenRouter chat model.
// Override via env. Keep these numbers in sync with the mirror in api/chat.ts.
export const TIER_LIMITS = {
  requestsPerDay: envInt('AI_TIER_RPD', 10_000),
  tokensPerDay: envInt('AI_TIER_TPD', 25_000_000),
  requestsPerMinute: envInt('AI_TIER_RPM', 1_000),
  tokensPerMinute: envInt('AI_TIER_TPM', 1_000_000),
};


// Per-user daily cap with an admin bump: users with role 'admin' get
// AI_ADMIN_DAILY_LIMIT, everyone else keeps DAILY_LIMIT (30).
export const ADMIN_DAILY_LIMIT = envInt('AI_ADMIN_DAILY_LIMIT', 60);

// ── Модальность извлечённых фактов ───────────────────────────────────────────
//
// extractedFacts попадает в контекст чата под ярлыком «Факты», и дальше модель
// говорит о них как о состоявшемся. Промпт требует складывать планы в
// commitments, но модель регулярно кладёт в факты «завтра куплю подписку» или
// «нужно заработать», и чат отвечает «ты купил подписку», «ты оплатил юриста».
// Пользователь читает про свою жизнь то, чего не было.
//
// Поэтому классификация не оставлена на усмотрение модели: намерение узнаётся
// по маркерам здесь. Асимметрия сознательная — лишний перенос факта в планы
// стоит строчки шума в списке открытых планов, а оставленное в фактах намерение
// становится ложным утверждением о жизни человека. При сомнении переносим.
//
// Список намеренно узкий и состоит из явных маркеров. Русское будущее время
// первого лица («куплю», «заплачу») морфологически не отличить от настоящего
// без разбора, поэтому ловим не сам глагол, а обрамление: намерение,
// долженствование, неуверенность и отнесение в будущее.
const IRREALIS_MARKERS = [
  // намерение
  'собираюсь', 'собирается', 'собираются', 'планирую', 'планирует', 'планируют',
  'намерен', 'намерена', 'хочу', 'хочет', 'хотел бы', 'хотела бы', 'мечтаю', 'мечтает',
  'задумал', 'задумала', 'решил купить', 'план такой',
  // долженствование
  'нужно', 'надо', 'должен', 'должна', 'придётся', 'придется', 'предстоит',
  // неуверенность
  'наверное', 'наверно', 'видимо', 'возможно', 'вероятно', 'скорее всего',
  'может быть', 'думаю, что', 'думаю что',
  // отнесение в будущее
  'буду', 'будет', 'будем', 'будут', 'завтра', 'послезавтра', 'потом', 'позже',
  'на этой неделе', 'на следующей', 'в следующем', 'в следующую', 'если ',
] as const;

const normalizeForModality = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** true, если строка описывает намерение, а не состоявшееся событие. */
export function isIrrealis(fact: string): boolean {
  const t = normalizeForModality(fact);
  return IRREALIS_MARKERS.some(m => t.includes(normalizeForModality(m)));
}

/**
 * Переносит намерения из фактов в планы. Возвращает новые массивы; порядок
 * сохраняется, дубликаты в планах не создаются.
 */
export function splitFactsByModality(
  facts: readonly string[],
  commitments: readonly string[],
): { facts: string[]; commitments: string[] } {
  const keptFacts: string[] = [];
  const movedFacts: string[] = [];
  for (const f of facts) {
    if (isIrrealis(f)) movedFacts.push(f);
    else keptFacts.push(f);
  }
  const seen = new Set(commitments.map(normalizeForModality));
  const added = movedFacts.filter(f => {
    const key = normalizeForModality(f);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { facts: keptFacts, commitments: [...commitments, ...added] };
}

// ── Bulk Daily limit ─────────────────────────────────────────────────────────
export const BULK_DAILY_LIMIT = (() => {
  const raw = process.env.AI_BULK_DAILY_LIMIT;
  if (!raw) return 50;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? 50 : parsed;
})();

