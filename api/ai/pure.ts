// api/ai/pure.ts
//
// The AI helpers that touch no Firestore, copied out of
// functions/src/shared/aiUtils.ts for the VPS service.
//
// Why a copy rather than an import: the root package is "type": "module" and
// functions/ is CommonJS, so importing across that boundary fails at load time —
// Node cannot detect named exports of a transpiled-TS CJS module, and the whole
// service exits on boot with "does not provide an export named …" while tsc is
// perfectly happy. Verified by experiment: the same file under functions/ fails,
// the same file inside the root package loads.
//
// The duplication is deliberate and short-lived. functions/ is deleted once the
// client moves to this service, and it takes its copy with it.

import { createHash } from 'crypto';
import DOMPurify from 'isomorphic-dompurify';
import { Langfuse } from 'langfuse';
import { sanitizeAiInputShared, classifyInvisibleCodePoint, MAX_AI_CONTENT_LENGTH } from './buildChatPrompt';

export { MAX_AI_CONTENT_LENGTH };
/** Потолок тела запроса. Скопирован раньше в три файла — при расхождении один
 *  эндпоинт молча принимает то, что другой отвергает. */
export const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

// Mirror of src/shared/ai/injectionPatterns.ts — keep in sync.
// After migration to Supabase, both sides will import from a single shared package.

// Patterns written for Latin-script phrases. Checked against a homoglyph-
// folded copy of the input (see foldLatinHomoglyphs below) so that visually
// identical Cyrillic/Greek lookalikes (e.g. Cyrillic "i" in "ignore previous")
// don't bypass them.
const LATIN_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+instructions/i,
  /jailbreak/i,
  /(?<=^|[^а-яёА-ЯЁa-zA-Z0-9])DAN(?=$|[^а-яёА-ЯЁa-zA-Z0-9])/i,
  /you\s+are\s+now/i,
  /forget\s+your/i,
  /(^|\n)\s*system\s*:/i,
  /as\s+an\s+AI(?=$|[^а-яёА-ЯЁa-zA-Z0-9])/i,
  /(^|\n)\s*developer\s*:/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
  /<developer>/i,
  /<end_of_turn>/i,
  // Промежуток ограничен длиной: с открытым `.*` движок перебирает позиции
  // квадратично, и 50 000 пробелов после «repeat» занимают процесс на секунду.
  /repeat\s+.{0,200}(system|initial)\s+prompt/i,
  /output\s+your\s+instructions/i,
  /reveal\s+your\s+system\s+prompt/i,
];

// Patterns written for Cyrillic/Russian phrases. Checked against the
// ORIGINAL (non-folded) text — folding to Latin would break these, since
// they need to match real Cyrillic letters.
const CYRILLIC_PATTERNS = [
  /новые\s+инструкции/i,
  /забудь\s+(вс[её]|свои|преды|инструк)/i,
  /выведи\s+.{0,200}(системный|свой)\s+промпт/i,
  /покажи\s+.{0,200}(системный\s+промпт|свои\s+инструкции)/i,
  /напиши\s+свои\s+системные\s+инструкции/i,
];


// Flat list kept for compatibility with any lingering direct reference.
export const INJECTION_PATTERNS = [...LATIN_PATTERNS, ...CYRILLIC_PATTERNS];

// Нормализуем невидимые символы перед проверкой инъекций.
// Символы категории 'space' (U+2000..U+200A, U+2028, U+2029 и т.д.) заменяются на U+0020,
// чтобы сохранить границу слова для паттернов с \s+.
// Символы категории 'drop' (нулевая ширина, U+2060, U+FE0F, теги U+E0000..E007F) удаляются.
function stripInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const action = classifyInvisibleCodePoint(code);
    if (action === 'space') {
      out += ' ';
    } else if (action === 'keep') {
      out += ch;
    }
  }
  return out;
}

// Cyrillic/Greek letters visually identical to a Latin letter in most fonts —
// used to spoof a Latin-script phrase (jailbreak, ignore previous, etc.) past
// a regex expecting real Latin letters. Deliberately a small, explicit map
// (not a general Unicode confusables table) — covers only letters that could
// plausibly stand in for a letter appearing in LATIN_PATTERNS above. These are
// ordinary printable Cyrillic letters (not invisible characters) — fine to
// type as normal literal characters, unlike ZERO_WIDTH_CODE_POINTS above.
const HOMOGLYPH_MAP: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'х': 'x', 'у': 'y', 'і': 'i', 'ѕ': 's', 'һ': 'h',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'Х': 'X', 'У': 'Y',
  // Greek lookalikes (the comment above always claimed Greek coverage; these were
  // missing, so a Greek-omicron "ignore previous" bypassed every LATIN_PATTERN).
  'ο': 'o', 'α': 'a', 'ι': 'i', 'ν': 'v', 'ρ': 'p', 'υ': 'u', 'κ': 'k', 'τ': 't',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M',
  'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
};

function foldLatinHomoglyphs(text: string): string {
  let out = '';
  for (const ch of text) {
    out += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return out;
}

export function hasInjectionAttempt(text: string): boolean {
  const stripped = stripInvisible(text);
  const latinFolded = foldLatinHomoglyphs(stripped);
  return LATIN_PATTERNS.some(p => p.test(latinFolded)) || CYRILLIC_PATTERNS.some(p => p.test(stripped));
}

let _langfuse: Langfuse | null = null;

export function hashUid(uid: string): string {
  if (!uid) return 'anonymous';
  return createHash('sha256').update(uid).digest('hex').slice(0, 16);
}

export function getLangfuse(): Langfuse | null {

  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  if (!secretKey || !publicKey) return null;
  if (!_langfuse) {
    _langfuse = new Langfuse({ secretKey, publicKey, flushAt: 1, fetchRetryCount: 1 });
  }
  return _langfuse;
}

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
    // Strip CJK characters leaked from model reasoning chains (gpt-oss/DeepSeek
    // internal thinking sometimes bleeds into content field).
    // Ranges: CJK Unified (4E00-9FFF), Extension A (3400-4DBF), Compat (F900-FAFF),
    // Radicals (2E80-2EFF), Symbols (3000-303F), Kana (3040-30FF).
    // eslint-disable-next-line no-irregular-whitespace
    cleaned = cleaned.replace(/[⺀-⻿　-ヿ㐀-䶿一-鿿豈-﫿]/g, '');
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

