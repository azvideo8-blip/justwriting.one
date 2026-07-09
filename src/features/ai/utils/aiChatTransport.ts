import { getAuth } from 'firebase/auth';
import type { AIMessage } from '../services/AIService';
import { AIService } from '../services/AIService';

export let _streamUnavailableUntil = 0;
export const CONTEXT_WINDOW = 14;

// Detect "search my notes" intent. Regex-based (not a fixed phrase list) so
// follow-ups like "а где про Сашу пишу?" also trigger. Avoids the imperative
// "напиши …" (write-for-me) by requiring a word boundary before пиш/писа.
export const NOTE_SEARCH_PATTERNS: RegExp[] = [
  /заметк|\bзапис|дневник/i,
  /что годится в пост/i,
  /\b(найди|найти|поищи|поиск|ищу|напомни|вспомни|посмотри|посмотреть|проверь|перепроверь|глянь|собери|подбери|покажи)\b/i,
  // question word + writing/telling verb: "где про Сашу пишу", "о чём я писал"
  /(что|где|когда|о\s*ч[её]м|про\s+ко|про\s+что|сколько|как часто).{0,40}\b(пиш|писа|говорил|упомина|вспомина|расска|отмеча)/i,
  // "… про X пишу/писал"
  /\b(пиш[уеёя]|писа[лнв])\b.{0,30}\bпро\b/i,
  /что (я )?(обычно |часто |вообще )?(про|о)\b/i,
  /что у меня про|что есть про/i,
  /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(в|за|про)\s+(январ|феврал|март|апрел|ма[йе]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i,
  /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(прошл|этой?|следующ)\s+(недел|месяц|год)/i,
  /(?:^|[^а-яёА-ЯЁa-zA-Z0-9])что\s+было(?![а-яёА-ЯЁa-zA-Z0-9])|(?:^|[^а-яёА-ЯЁa-zA-Z0-9])напомни(?![а-яёА-ЯЁa-zA-Z0-9])|(?:^|[^а-яёА-ЯЁa-zA-Z0-9])расскажи\s+что/i,
];

export function looksLikeNoteSearch(text: string): boolean {
  return NOTE_SEARCH_PATTERNS.some(re => re.test(text));
}

// A chat message sent to the API is capped at 10K chars. Small messages pass
// through untouched (so an attached note that fits is delivered IN the message,
// the most reliable channel — same as file upload). Only OVERSIZED attachment
// messages are collapsed to their marker (the full note then travels via
// documentContent), with a hard slice as the final safety net.
export const API_MSG_CAP = 9_500;
export function toApiContent(content: string): string {
  if (content.length <= API_MSG_CAP) return content;
  const noteMatch = content.match(/^\[Прикреплена заметка: "[^"]+"\]/);
  if (noteMatch) return noteMatch[0];
  return content.slice(0, API_MSG_CAP);
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

export async function streamChat(params: {
  personaId: string;
  customSystemPrompt?: string | undefined;
  messages: AIMessage[];
  documentContent?: string | undefined;
  documentMood?: string | undefined;
  userPortrait?: string | null | undefined;
  responseLength?: 'short' | 'standard' | 'detailed' | undefined;
  reasoning?: boolean | undefined;
  signal?: AbortSignal | undefined;
  onChunk: (partial: string, reasoning: string | null) => void;
}): Promise<string> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');

  const idToken = await user.getIdToken();

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      personaId: params.personaId,
      customSystemPrompt: params.customSystemPrompt,
      messages: params.messages.map(({ role, content }) => ({ role, content })),
      documentContent: params.documentContent,
      documentMood: params.documentMood,
      userPortrait: params.userPortrait,
      responseLength: params.responseLength,
      reasoning: params.reasoning,
    }),
    signal: params.signal ?? null,
  });

  if (response.status === 404) {
    _streamUnavailableUntil = Date.now() + 60_000;
    throw new Error('STREAM_FALLBACK');
  }

  if (response.status === 401) throw new Error('AUTH_REQUIRED');
  // E-1: Distinguish GLOBAL_LIMIT (project-wide cap, daily limit refunded by
  // server) from DAILY_LIMIT (per-user cap). Without this, a GLOBAL_LIMIT 429
  // corrupts the client's daily-limit state (sets remaining=0 permanently).
  if (response.status === 429) {
    let errorKind = 'DAILY_LIMIT';
    try {
      const body = await response.json();
      if (body?.error === 'GLOBAL_LIMIT') errorKind = 'GLOBAL_LIMIT';
    } catch { /* default to DAILY_LIMIT */ }
    throw new Error(errorKind);
  }
  if (!response.ok) throw new Error('SERVER_ERROR');

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
      const mdReasoningMatch = fullText.match(/ХОД МЫСЛИ:\s*([\s\S]*?)(?=ОТВЕТ:|$)/i);
      const mdAnswerMatch = fullText.match(/ОТВЕТ:\s*([\s\S]*?)$/i);

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
      } else if (mdReasoningMatch) {
        reasoningText = mdReasoningMatch[1]!.trim();
        answerText = mdAnswerMatch ? mdAnswerMatch[1]!.trim() : '';
      } else {
        // LX-1: Inline leak — "ОТВЕТ:" present without "ХОД МЫСЛИ:" prefix.
        // The model dumped CoT into content; split at "ОТВЕТ:" line.
        const hasAnswerMarker = /^ОТВЕТ:\s*$/im.test(fullText);
        const hasReasoningHeader = /ХОД МЫСЛИ:/i.test(fullText);
        if (hasAnswerMarker && !hasReasoningHeader) {
          const answerIdx = fullText.search(/^ОТВЕТ:\s*$/im);
          if (answerIdx > 0) {
            reasoningText = fullText.slice(0, answerIdx).trim();
            answerText = fullText.slice(answerIdx).replace(/^ОТВЕТ:\s*/im, '').trim();
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
    // User pressed Stop — keep whatever streamed so far instead of erroring.
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
  responseLength?: 'short' | 'standard' | 'detailed' | undefined;
  reasoning?: boolean | undefined;
  callType?: 'auto_name' | 'follow_up' | 'query_expand' | undefined;
}): Promise<string> {
  const result = await AIService.chat({
    personaId: params.personaId,
    customSystemPrompt: params.customSystemPrompt,
    messages: params.messages.map(({ role, content }) => ({ role, content })),
    documentContent: params.documentContent,
    userPortrait: params.userPortrait,
    responseLength: params.responseLength,
    reasoning: params.reasoning,
    callType: params.callType,
  });

  if (!result.ok) {
    if (result.error === 'DAILY_LIMIT') throw new Error('DAILY_LIMIT');
    if (result.error === 'AUTH_REQUIRED') throw new Error('AUTH_REQUIRED');
    if (result.error === 'RATE_LIMIT') throw new Error('RATE_LIMIT');
    throw new Error('SERVER_ERROR');
  }

  return result.text;
}

export function extractReasoning(text: string): string | undefined {
  // <think> tags
  const think = text.match(/<think>([\s\S]*?)(<\/think>|$)/i);
  if (think) { const r = think[1]!.trim(); return r || undefined; }
  // XML tags
  const xml = text.match(/(?:\/\/)?<reasoning>([\s\S]*?)(<\/reasoning>|$)/i);
  if (xml) { const r = xml[1]!.trim(); return r || undefined; }
  // Markdown header: ХОД МЫСЛИ: ... (until ОТВЕТ: or end)
  const md = text.match(/ХОД МЫСЛИ:\s*([\s\S]*?)(?=ОТВЕТ:|$)/i);
  if (md) { const r = md[1]!.trim(); return r || undefined; }
  // LX-1: Inline leak — "ОТВЕТ:" present WITHOUT "ХОД МЫСЛИ:" prefix.
  // The model dumped its CoT into content; everything before "ОТВЕТ:" is reasoning.
  if (!/ХОД МЫСЛИ:/i.test(text)) {
    const answerIdx = text.search(/^ОТВЕТ:\s*$/im);
    if (answerIdx > 0) {
      const r = text.slice(0, answerIdx).trim();
      return r || undefined;
    }
  }
  return undefined;
}

export function extractAnswer(text: string): string {
  // <think>...</think> — answer is what follows the closing tag
  if (/<\/think>/i.test(text)) {
    const after = text.split(/<\/think>/i)[1];
    if (after !== undefined) return after.trim();
  }
  // Try XML tags
  const answerMatch = text.match(/(?:\/\/)?<answer>([\s\S]*?)(<\/answer>|$)/i);
  if (answerMatch) return answerMatch[1]!.trim();
  // Try markdown: ОТВЕТ: ...
  const mdAnswerMatch = text.match(/ОТВЕТ:\s*([\s\S]*?)$/i);
  if (mdAnswerMatch) return mdAnswerMatch[1]!.trim();
  // LX-1: Inline leak — "ОТВЕТ:" present WITHOUT "ХОД МЫСЛИ:" prefix.
  // If there's an "ОТВЕТ:" line anywhere, the answer is what follows it.
  if (!/ХОД МЫСЛИ:/i.test(text)) {
    const answerIdx = text.search(/^ОТВЕТ:\s*$/im);
    if (answerIdx >= 0) {
      const after = text.slice(answerIdx).replace(/^ОТВЕТ:\s*/im, '').trim();
      return after || text;
    }
  }
  // Strip reasoning blocks and return the rest
  const stripped = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/(?:\/\/)?<\/?reasoning>/gi, '')
    .replace(/ХОД МЫСЛИ:[\s\S]*?(?=ОТВЕТ:|$)/gi, '')
    .replace(/ОТВЕТ:/gi, '')
    .replace(/(?:\/\/)?<answer>/gi, '')
    .replace(/<\/answer>/gi, '')
    .trim();
  if (!stripped && text.trim()) {
    return text
      .replace(/^ХОД МЫСЛИ:\s*$/gim, '')
      .replace(/^ОТВЕТ:\s*$/gim, '')
      .trim();
  }
  return stripped;
}
