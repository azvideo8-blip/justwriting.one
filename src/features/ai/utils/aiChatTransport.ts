import { getCurrentUser, getIdToken } from '../../../core/auth';
import type { AIMessage } from '../services/AIService';
import { AIService } from '../services/AIService';
import { useAiLimitStore } from '../store/useAiLimitStore';

export let _streamUnavailableUntil = 0;
export function _resetStreamUnavailable(): void {
  _streamUnavailableUntil = 0;
}
export const CONTEXT_WINDOW = 14;

// Detect "search my notes" intent. Regex-based (not a fixed phrase list) so
// follow-ups like "а где про Сашу пишу?" also trigger. Avoids the imperative
// "напиши …" (write-for-me) by requiring a word boundary before пиш/писа.
//
// `\b` is ASCII-only: it never matches beside a Cyrillic letter, so every
// pattern below that used it was dead — `/\b(найди|поищи)\b/` is false for
// "найди про Сашу" AND for "a найди b". Half the intent detection has never
// fired; "просканируй всё" reached the model with no search at all, and
// "поищи в заметках" only worked because another pattern matched "заметк".
// LB/RB are the Cyrillic-safe boundaries the temporal patterns already use.
const LB = '(?:^|[^а-яёА-ЯЁa-zA-Z0-9])';
const RB = '(?![а-яёА-ЯЁa-zA-Z0-9])';
// A search verb alone is too broad to act on — "покажи мне картинку" is not a
// search. It has to point at something to look for.
const SEARCH_TARGET = '(про|о\\s|об\\s|что|где|когда|как|вс[ёея]|весь|всю|всех|мо[ий])';

export const NOTE_SEARCH_PATTERNS: RegExp[] = [
  new RegExp(`заметк|${LB}запис|дневник`, 'i'),
  /что годится в пост/i,
  new RegExp(
    `${LB}(найди|найти|поищи|поиск|ищу|напомни|вспомни|посмотри|посмотреть|проверь|перепроверь|глянь|собери|подбери|покажи|просканируй|сканируй|пробеги|пересмотри|поройся|прошерсти)`
    + `.{0,20}${SEARCH_TARGET}`,
    'i',
  ),
  // question word + writing/telling verb: "где про Сашу пишу", "о чём я писал"
  new RegExp(`(что|где|когда|о\\s*ч[её]м|про\\s+ко|про\\s+что|сколько|как часто).{0,40}${LB}(пиш|писа|говорил|упомина|вспомина|расска|отмеча)`, 'i'),
  // "… про X пишу/писал"
  new RegExp(`${LB}(пиш[уеёя]|писа[лнв])${RB}.{0,30}${LB}про${RB}`, 'i'),
  new RegExp(`что (я )?(обычно |часто |вообще )?(про|о)${RB}`, 'i'),
  /что у меня про|что есть про/i,
  /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(в|за|про)\s+(январ|феврал|март|апрел|ма[йе]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i,
  /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(прошл|этой?|следующ)\s+(недел|месяц|год)/i,
  /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])что\s+было(?![а-яёА-ЯЁa-zA-Z0-9])|(?:^|[^а-яёА-ЯЁa-zA-Z0-9])напомни(?![а-яёА-ЯЁa-zA-Z0-9])|(?:^|[^а-яёА-ЯЁa-zA-Z0-9])расскажи\s+что/i,
];

export function looksLikeNoteSearch(text: string): boolean {
  return NOTE_SEARCH_PATTERNS.some(re => re.test(text));
}

// "разбери/прочитай/посмотри" + "заметк/запис" — an analysis request. On its own
// this does NOT mean the attached note: "посмотри в моих заметках про Сашу" is a
// search. What separates them is the target, not the verb.
const ANALYSIS_INTENT = [/(заметк|запис|аскез)/i, /(разбер|разбор|проанализ|анализ|прочит|посмотр|глян)/i];
const ARCHIVE_SCOPE = new RegExp(
  `${LB}(в|во|по)\\s+(мо[а-яё]+\\s+)?(всех?\\s+)?(заметк|запис|дневник|архив|баз)`
  + `|${LB}(везде|целиком|полностью)${RB}`
  + `|${LB}вс[еюяё]х?${RB}\\s*(мо[а-яё]+\\s*)?(заметк|запис|дневник|баз|архив)`,
  'i',
);

export function looksLikeNoteAnalysis(text: string): boolean {
  return ANALYSIS_INTENT.every(re => re.test(text));
}

const AGGREGATE_PATTERNS: RegExp[] = [
  /сколько раз/i,
  /как часто/i,
  new RegExp(`${LB}(статистик|динамик|тенденц|закономерн|паттерн|чаще всего)`, 'i'),
  new RegExp(`(вс[ею]|каждую|всю базу|целиком|полностью).{0,30}${LB}(замет|запис)`, 'i'),
  new RegExp(`${LB}(замет|запис).{0,30}(вс[ею]|каждую|всю базу|целиком|полностью)`, 'i'),
];

export function looksLikeAggregateQuery(text: string): boolean {
  return AGGREGATE_PATTERNS.some(re => re.test(text));
}

/**
 * Whether to run the full-archive search for this turn.
 *
 * An attached note used to switch the search off unconditionally, so once
 * anything was attached — by hand or by the auto-attacher — no later message
 * could reach the archive, and the model answered "I only have the two notes in
 * front of me". Now the search is suppressed only for an analysis request aimed
 * at the attached note itself ("разбери эту заметку"); an analysis request that
 * names the archive ("посмотри в моих заметках про X") searches.
 */
export function shouldRunFullSearch(text: string, hasAttachment: boolean): boolean {
  if (!looksLikeNoteSearch(text)) return false;
  if (!hasAttachment) return true;
  return !looksLikeNoteAnalysis(text) || ARCHIVE_SCOPE.test(text);
}

// A chat message sent to the API is capped at 10K chars. Small messages pass
// through untouched (so an attached note that fits is delivered IN the message,
// the most reliable channel — same as file upload). Only OVERSIZED attachment
// messages are collapsed to their marker (the full note then travels via
// documentContent), with a hard slice as the final safety net.
export const API_MSG_CAP = 9_500;
export const API_ASSISTANT_OLD_CAP = 1_500;

export function toApiContent(content: string, cap = API_MSG_CAP): string {
  if (content.length <= cap) return content;
  const noteMatch = content.match(/^\[Прикреплена заметка: "[^"]+"\]/);
  if (noteMatch) return noteMatch[0];
  return content.slice(0, cap);
}

export function pruneMessages(messages: AIMessage[]): AIMessage[] {
  const chatOnly = messages.filter(m => m.type !== 'system');
  if (chatOnly.length <= CONTEXT_WINDOW) return chatOnly;
  const first = chatOnly[0];
  if (!first) return chatOnly;
  const rest = chatOnly.slice(-CONTEXT_WINDOW);
  if (first === rest[0]) return rest;
  return [first, ...rest];
}

/**
 * PROMPT-2: Cap assistant messages older than the last two to ~1500 chars (head).
 * User messages remain intact (up to API_MSG_CAP).
 */
export function prepareApiMessages(messages: AIMessage[]): AIMessage[] {
  const pruned = pruneMessages(messages.filter(m => m.type !== 'system'));
  const assistantIndices: number[] = [];
  for (let i = 0; i < pruned.length; i++) {
    if (pruned[i]?.role === 'assistant') {
      assistantIndices.push(i);
    }
  }
  const lastTwoAssistant = new Set(assistantIndices.slice(-2));

  return pruned.map((m, idx) => {
    if (m.role === 'assistant' && !lastTwoAssistant.has(idx)) {
      return { ...m, content: toApiContent(m.content, API_ASSISTANT_OLD_CAP) };
    }
    return { ...m, content: toApiContent(m.content, API_MSG_CAP) };
  });
}

// AUDIT-part3 2: единая точка разбора кода ошибки из тела ответа. Сервер в
// переходный период шлёт обе формы ({error:'CODE'} и {error:{code,message}}) —
// PWA держит старый бандл у части клиентов, поэтому сервер не может выбрать
// одну форму сразу, а клиент обязан понимать обе.
export function extractErrorCode(body: unknown): string | undefined {
  const e = (body as { error?: unknown } | null | undefined)?.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return undefined;
}

export async function streamChat(params: {
  personaId: string;
  customSystemPrompt?: string | undefined;
  messages: AIMessage[];
  documentContent?: string | undefined;
  documentMood?: string | undefined;
  userPortrait?: string | null | undefined;
  memoryContext?: string | null | undefined;
  responseLength?: 'short' | 'standard' | 'detailed' | undefined;
  reasoning?: boolean | undefined;
  signal?: AbortSignal | undefined;
  onChunk: (partial: string, reasoning: string | null) => void;
}): Promise<string> {
  const user = getCurrentUser();
  if (!user) {
    throw new Error('You must be logged in to chat with the AI.');
  }

  const { getAiConsent, isProfileLoaded } = await import('../../../core/ai/aiConsent');
  if (isProfileLoaded(user.uid) && !getAiConsent(user.uid)) {
    throw Object.assign(new Error('AI_CONSENT_REQUIRED'), { code: 'AI_CONSENT_REQUIRED' });
  }

  const idToken = await getIdToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      personaId: params.personaId,
      customSystemPrompt: params.customSystemPrompt,
      messages: params.messages.map(({ role, content }) => ({ role, content })),
      documentContent: params.documentContent,
      documentMood: params.documentMood,
      userPortrait: params.userPortrait,
      memoryContext: params.memoryContext,
      responseLength: params.responseLength,
      reasoning: params.reasoning,
    }),
    signal: params.signal ?? null,
  });

  // SA-2: «unavailable» приходит без x-ai-quota-used — на стриминговом пути
  // без этой ветки отметка терялась.
  if (typeof response.headers.has === 'function'
    && (response.headers.has('x-ai-quota-used') || response.headers.get('x-ai-quota-status') === 'unavailable')) {
    useAiLimitStore.getState().syncFromHeaders(response.headers);
  }

  if (response.status === 404) {
    _streamUnavailableUntil = Date.now() + 60_000;
    throw new Error('STREAM_FALLBACK');
  }

  if (response.status === 401) throw new Error('AUTH_REQUIRED');
  // E-1: Distinguish GLOBAL_LIMIT (project-wide cap, daily limit refunded by
  // server) from DAILY_LIMIT (per-user cap). Without this, a GLOBAL_LIMIT 429
  // corrupts the client's daily-limit state (sets remaining=0 permanently).
  if (response.status === 429) {
    let errorKind = 'RATE_LIMIT';
    const retryAfter = response.headers.get('Retry-After');
    const retrySec = retryAfter ? parseInt(retryAfter, 10) : NaN;
    try {
      const body = await response.json();
      const code = extractErrorCode(body);
      if (code === 'GLOBAL_LIMIT') errorKind = 'GLOBAL_LIMIT';
      if (code === 'DAILY_LIMIT') errorKind = 'DAILY_LIMIT';
      if (code === 'RATE_LIMIT') {
        errorKind = !isNaN(retrySec) && retrySec > 0 ? `RATE_LIMIT:${retrySec}` : 'RATE_LIMIT';
      }
      if (code === 'REASONING_LIMIT') errorKind = 'REASONING_LIMIT';
    } catch {
      if (!isNaN(retrySec) && retrySec > 0) {
        errorKind = `RATE_LIMIT:${retrySec}`;
      }
    }
    throw new Error(errorKind);
  }
  if (response.status === 503) {
    // Only OUR "could not check the limit" 503 carries the code. A bare 503 from
    // nginx or the provider is still an upstream outage, as it was before S-15.
    let code: string | undefined;
    try { code = extractErrorCode(await response.clone().json()); } catch { /* not json */ }
    throw new Error(code === 'SERVICE_UNAVAILABLE' ? 'SERVICE_UNAVAILABLE' : 'UPSTREAM');
  }
  if (response.status === 502 || response.status === 504) throw new Error('UPSTREAM');
  if (!response.ok) {
    // Сервер отвечает кодом в теле; без разбора человек видит «произошла
    // ошибка» на несколько разных случаев, из которых часть он может исправить
    // сам: согласие не дано, лимит, неверный размер запроса.
    let code = 'SERVER_ERROR';
    try {
      const body = await response.clone().json();
      code = extractErrorCode(body) ?? 'SERVER_ERROR';
    } catch { /* тело не JSON или стрим уже начат — остаётся SERVER_ERROR */ }
    throw new Error(code);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  try {
   while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) {
      fullText += text;
      // Parse reasoning/answer sections from stream. DeepSeek exposes thinking
      // in three shapes, handled in priority order:
      //  1. <think>…</think> inline tags (reasoning models via OpenRouter)
      //  2. <reasoning>…</reasoning><answer>…</answer> XML
      //  3. markdown headers ХОД МЫСЛИ: … ОТВЕТ: …
      const thinkMatch = fullText.match(/<think>([\s\S]*?)(<\/think>|$)/i);
      const reasoningMatch = fullText.match(/(?:\/\/)?<reasoning>([\s\S]*?)(<\/reasoning>|$)/i);
      const answerMatch = fullText.match(/<\/reasoning>\s*(?:\/\/)?<answer>([\s\S]*?)(<\/answer>|$)/i);
      // Маркеры ищутся только как отдельные строки. Сервер пишет их именно так
      // ('ХОД МЫСЛИ:\n' и '\n\nОТВЕТ:\n'), а поиск по вхождению обрезал бы
      // обычную реплику: «интересный ход мысли… ответ: попробуй» — фраза, для
      // разговора с психологом совершенно рядовая, — превратилась бы в
      // скрытые размышления плюс огрызок ответа.
      const MD_REASONING_LINE = /^ХОД МЫСЛИ:\s*$/im;
      const MD_ANSWER_LINE = /^ОТВЕТ:\s*$/im;
      const mdReasoningIdx = fullText.search(MD_REASONING_LINE);
      const mdAnswerIdx = fullText.search(MD_ANSWER_LINE);

      let reasoningText: string | null = null;
      let answerText: string;

      if (thinkMatch) {
        reasoningText = thinkMatch[1]!.trim();
        // answer is whatever follows the closing </think>
        const after = fullText.split(/<\/think>/i)[1];
        answerText = after !== undefined ? after.trim() : '';
      } else if (reasoningMatch) {
        reasoningText = reasoningMatch[1]!.trim();
        answerText = answerMatch ? answerMatch[1]!.trim() : '';
      } else if (mdReasoningIdx >= 0) {
        const reasoningStart = mdReasoningIdx + fullText.slice(mdReasoningIdx).match(MD_REASONING_LINE)![0].length;
        const reasoningEnd = mdAnswerIdx > mdReasoningIdx ? mdAnswerIdx : fullText.length;
        reasoningText = fullText.slice(reasoningStart, reasoningEnd).trim();
        answerText = mdAnswerIdx > mdReasoningIdx
          ? fullText.slice(mdAnswerIdx).replace(MD_ANSWER_LINE, '').trim()
          : '';
      } else {
        // LX-1: Inline leak — "ОТВЕТ:" present without "ХОД МЫСЛИ:" prefix.
        // The model dumped CoT into content; split at "ОТВЕТ:" line.
        const hasAnswerMarker = mdAnswerIdx >= 0;
        if (hasAnswerMarker) {
          const answerIdx = mdAnswerIdx;
          if (answerIdx > 0) {
            reasoningText = fullText.slice(0, answerIdx).trim();
            answerText = fullText.slice(answerIdx).replace(MD_ANSWER_LINE, '').trim();
          } else {
            reasoningText = null;
            answerText = fullText;
          }
        } else {
          // No reasoning markers yet — show raw text as answer
          reasoningText = null;
          answerText = fullText;
        }
      }
      params.onChunk(answerText, reasoningText || null);
    }
   }
  } catch (e) {
    // AppUser pressed Stop — keep whatever streamed so far instead of erroring.
    if (params.signal?.aborted) return fullText;
    throw e;
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  return fullText;
}

export async function callableChat(params: {
  personaId: string;
  customSystemPrompt?: string | undefined;
  messages: AIMessage[];
  documentContent?: string | undefined;
  userPortrait?: string | null | undefined;
  memoryContext?: string | null | undefined;
  responseLength?: 'short' | 'standard' | 'detailed' | undefined;
  reasoning?: boolean | undefined;
  callType?: 'auto_name' | 'follow_up' | 'query_expand' | undefined;
  /** SB-4: уход со страницы должен обрывать и этот путь, не только стрим. */
  signal?: AbortSignal | undefined;
}): Promise<string> {
  const result = await AIService.chat({
    personaId: params.personaId,
    customSystemPrompt: params.customSystemPrompt,
    messages: params.messages.map(({ role, content }) => ({ role, content })),
    documentContent: params.documentContent,
    userPortrait: params.userPortrait,
    memoryContext: params.memoryContext,
    responseLength: params.responseLength,
    reasoning: params.reasoning,
    callType: params.callType,
  }, params.signal ? { signal: params.signal } : undefined);


  if (!result.ok) {
    // Отмена по уходу со страницы — не поломка: тот же 'ABORTED', что и у
    // кнопки «стоп», иначе ушедший чат показывал бы ошибку на пустом месте.
    if (params.signal?.aborted) throw new Error('ABORTED');
    if (result.error === 'DAILY_LIMIT') throw new Error('DAILY_LIMIT');
    if (result.error === 'REASONING_LIMIT') throw new Error('REASONING_LIMIT');
    if (result.error === 'AUTH_REQUIRED') throw new Error('AUTH_REQUIRED');
    if (result.error === 'RATE_LIMIT') throw new Error('RATE_LIMIT');
    if (result.error === 'UPSTREAM') throw new Error('UPSTREAM');
    throw new Error('SERVER_ERROR');
  }

  return result.text;
}

export function extractReasoning(text: string): string | undefined {
  // 1. <think> tags
  const think = text.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
  if (think) {
    const r = think[1]!.trim();
    return r || undefined;
  }
  // 2. XML tags: <reasoning>...</reasoning>
  const xml = text.match(/(?:\/\/)?<reasoning>([\s\S]*?)(?:<\/reasoning>|$)/i);
  if (xml) {
    const r = xml[1]!.trim();
    return r || undefined;
  }
  // 3. Markdown header: ХОД МЫСЛИ: ... (until ОТВЕТ: or end)
  const md = text.match(/(?:^|\n)ХОД МЫСЛИ:\s*([\s\S]*?)(?=(?:^|\n)ОТВЕТ:|$)/i);
  if (md) {
    const r = md[1]!.trim();
    return r || undefined;
  }
  // 4. Standalone "ОТВЕТ:" line without "ХОД МЫСЛИ:" prefix: everything before is reasoning
  const answerLineMatch = text.match(/(?:^|\n)ОТВЕТ:\s*/);
  if (answerLineMatch && answerLineMatch.index !== undefined && answerLineMatch.index > 0) {
    const r = text.slice(0, answerLineMatch.index).trim();
    return r || undefined;
  }
  return undefined;
}

export function extractAnswer(text: string): string {
  // 1. <think>...</think> — answer is what follows the closing tag
  if (/<\/think>/i.test(text)) {
    const after = text.split(/<\/think>/i)[1];
    if (after !== undefined) return after.trim();
  }
  if (/<think>/i.test(text)) {
    // Only opened <think>, no closing tag — stream aborted during reasoning
    return '';
  }

  // 2. XML tags: <answer>...</answer>
  const answerMatch = text.match(/(?:\/\/)?<answer>([\s\S]*?)(?:<\/answer>|$)/i);
  if (answerMatch) {
    return answerMatch[1]!.trim();
  }
  if (/(?:\/\/)?<reasoning>/i.test(text) && !/(?:\/\/)?<answer>/i.test(text)) {
    // Only reasoning XML tags present, no answer
    const stripped = text.replace(/(?:\/\/)?<\/?reasoning>[\s\S]*?(?:<\/reasoning>|$)/gi, '').trim();
    return stripped;
  }

  // 3. Markdown: ХОД МЫСЛИ: ... ОТВЕТ: ...
  if (/(?:^|\n)ХОД МЫСЛИ:/i.test(text)) {
    const mdAnswerMatch = text.match(/(?:^|\n)ОТВЕТ:\s*([\s\S]*?)$/i);
    if (mdAnswerMatch) {
      return mdAnswerMatch[1]!.trim();
    }
    // "ХОД МЫСЛИ:" with no "ОТВЕТ:" means the model produced only reasoning
    return '';
  }

  // 4. Standalone "ОТВЕТ:" line at line start
  const standaloneAnswerMatch = text.match(/(?:^|\n)ОТВЕТ:\s*([\s\S]*?)$/);
  if (standaloneAnswerMatch && standaloneAnswerMatch.index !== undefined && standaloneAnswerMatch.index > 0) {
    return standaloneAnswerMatch[1]!.trim();
  }

  // 5. Normal text with no markers
  return text.trim();
}
