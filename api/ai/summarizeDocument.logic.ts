// functions/src/ai/summarizeDocument.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, hasInjectionAttempt, getLangfuse, hashUid } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from './context';

// ── Helpers (kept in sync with summarizeDocument.ts) ─────────────────────────

export function validateVerbatimQuote(sanitizedContent: string, candidateQuote?: string): string | undefined {
  if (!candidateQuote || typeof candidateQuote !== 'string') return undefined;
  const quote = candidateQuote.trim();
  if (!quote) return undefined;
  if (sanitizedContent.includes(quote)) return quote;
  const normalize = (s: string) =>
    s.toLowerCase().replace(/ё/g, 'е').replace(/[«»""']/g, '"').replace(/[—–-]/g, '-');
  if (normalize(sanitizedContent).includes(normalize(quote))) return quote;
  return undefined;
}

const SUMMARY_SYSTEM_PROMPT = `Проанализируй личную заметку и верни JSON. Отвечай СТРОГО на русском языке.

Поля:
- summary: 1–2 предложения от третьего лица о чём эта запись и какова её главная суть («Автор размышляет о...»).
- tone: одно слово из списка: нейтральный / задумчивый / тревожный / вдохновляющий / радостный / грустный / злой / усталый / ностальгический / противоречивый / благодарный / растерянный.
- frequentWords: 3–6 самых значимых слов из текста (существительные или глаголы, не стоп-слова, не «я», «это», «что»).
- authorPhrases: 0–4 характерных авторских слова, идиомы или словечка, отражающих уникальный язык автора. Если нет — [].
- insights: ключевые мысли или внутренние наблюдения — только то, что реально написано.
- quotableSentence: одна дословная яркая цитата (предложение) из текста. Верни ДОСЛОВНО как в оригинале.
- themes: 1–3 основные темы.
- extractedFacts: конкретные факты ПРОШЕДШЕГО или НАСТОЯЩЕГО времени из текста. Сохраняй оговорки. НЕ включай планы/мечты/будущее.
- mentionedPeople: объекты { name, role } для реальных людей по имени. Если нет — [].
- commitments: планы/обещания/намерения автора на будущее. Если нет — [].
- valence: число от -1 до 1 (эмоциональный тон).
- arousal: число от 0 до 1 (энергия/возбуждение).
- echo: одна фраза, связывающая заметку с recentContext. Если связь неочевидна — "".
- eventDate: дата событий в формате YYYY-MM-DD. Запись написана {noteDate}. «сегодня» → дата написания; «вчера» → −1 день. Если нет указаний — дата написания.

ВАЖНО: опирайся ТОЛЬКО на написанное. Не додумывай деталей.
Верни ТОЛЬКО валидный JSON без пояснений и markdown-обёртки.`;

const SUMMARY_MODEL = process.env.AI_SUMMARY_MODEL ?? 'deepseek/deepseek-v4-flash';

function repairTruncatedJson(raw: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of raw) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = raw;
  if (inStr) { if (esc) { out = out.slice(0, -1); } out += '"'; }
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

const inputSchema = z.object({
  content: z.string().min(50).max(50_000),
  mood: z.string().max(50).nullish(),
  recentContext: z.string().max(5000).optional(),
  noteDate: z.string().max(50).optional(),
});

export async function summarizeDocumentLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid payload.');
  }

  const { content, mood, recentContext, noteDate } = parsed.data;

  if (hasInjectionAttempt(content)) throw new AiError('invalid-argument', 'Disallowed patterns in content.');
  if (recentContext && hasInjectionAttempt(recentContext)) throw new AiError('invalid-argument', 'Disallowed patterns in recentContext.');
  if (mood && hasInjectionAttempt(mood)) throw new AiError('invalid-argument', 'Disallowed patterns in mood.');

  const allowed = await ctx.checkAndIncrementBulkLimit(uid);
  if (!allowed) throw new AiError('resource-exhausted', 'Daily bulk operations limit reached.');

  const sanitizedContent = sanitizeAiInput(content);
  const sanitizedRecentContext = recentContext ? sanitizeAiInput(recentContext) : null;

  const effectiveNoteDate = (noteDate && /^\d{4}-\d{2}-\d{2}$/.test(noteDate.trim()))
    ? noteDate.trim()
    : new Date().toISOString().slice(0, 10);

  const wordCount = sanitizedContent.split(/\s+/).filter(Boolean).length;
  const insightCount = wordCount < 100 ? '1–2' : wordCount < 300 ? '2–3' : '3–4';
  const factCount = wordCount < 100 ? '0–1' : wordCount < 300 ? '1–2' : '1–4';

  const scaledPrompt = SUMMARY_SYSTEM_PROMPT
    .replace('insights: ключевые мысли', `insights: ${insightCount} ключевые мысли`)
    .replace('extractedFacts: конкретные факты', `extractedFacts: ${factCount} конкретных факта`)
    .replace('{noteDate}', effectiveNoteDate);

  const safeMood = mood ? sanitizeAiInput(mood) : null;
  let prompt = safeMood ? `[Настроение документа: ${safeMood}]\n\n${sanitizedContent}` : sanitizedContent;
  if (sanitizedRecentContext) {
    prompt = `[recentContext (недавние темы):\n${sanitizedRecentContext}]\n\n${prompt}`;
  }

  const reservation = await ctx.tryReserveGlobalRequest(8192);
  if (!reservation) {
    await ctx.refundBulkLimit(uid);
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const lf = getLangfuse();
  const trace = lf?.trace({ name: 'summarizeDocument', userId: hashUid(uid) });
  const generation = trace?.generation({ name: SUMMARY_MODEL, model: SUMMARY_MODEL });

  let text: string;
  let tokensIn = 0, tokensOut = 0, usedModel = SUMMARY_MODEL;
  try {
    const result = await generate({
      system: scaledPrompt,
      messages: [{ role: 'user', content: prompt }],
      json: true,
      maxTokens: 8192,
      abortMs: 110_000,
      model: SUMMARY_MODEL,
    });
    text = result.text;
    tokensIn = result.tokensIn;
    tokensOut = result.tokensOut;
    usedModel = result.model;
  } catch (e) {
    console.error('[AI summarize] generation failed:', e);
    await ctx.refundBulkLimit(uid);
    await ctx.refundGlobalRequest(reservation);
    generation?.end({ output: String(e), level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(() => {});
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new AiError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new AiError('internal', 'AI summarization failed.');
  }

  type ParsedJson = {
    summary?: string; tone: string; frequentWords: string[];
    authorPhrases?: string[]; insights: string[];
    quotableSentence?: string; themes: string[]; extractedFacts: string[];
    mentionedPeople?: { name: string; role: string }[];
    commitments?: string[]; valence?: number; arousal?: number;
    echo?: string; eventDate?: string;
  };

  let parsed_json: ParsedJson;
  try {
    let textToParse = text.trim();
    if (textToParse.startsWith('```')) {
      textToParse = textToParse.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    }
    try { parsed_json = JSON.parse(textToParse); }
    catch { parsed_json = JSON.parse(repairTruncatedJson(textToParse)); console.warn('[AI summarize] recovered truncated JSON'); }
  } catch {
    await ctx.refundBulkLimit(uid);
    await ctx.refundGlobalRequest(reservation);
    console.error('[AI summarize] failed to parse model output:', text.slice(0, 500));
    generation?.end({ output: text, level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));
    throw new AiError('internal', 'Failed to parse summary.');
  }

  generation?.end({ output: text, usage: { promptTokens: tokensIn, completionTokens: tokensOut } });
  ctx.recordUsage(uid, tokensIn, tokensOut, { model: usedModel, fn: 'summarize' }, reservation)
    .catch(e => console.error('[AI summarize] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  const cyrRatio = (s: string) => {
    const cyr = (s.match(/[а-яёА-ЯЁ]/g) ?? []).length;
    return s.length > 0 ? cyr / s.length : 0;
  };
  const isUsable = (s: string) => s.trim().length > 0 && cyrRatio(s) >= 0.2;

  let validEventDate = effectiveNoteDate;
  if (typeof parsed_json.eventDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed_json.eventDate.trim())) {
    const candidate = parsed_json.eventDate.trim();
    if (candidate <= effectiveNoteDate) {
      const d = new Date(candidate);
      if (!isNaN(d.getTime())) validEventDate = candidate;
    }
  }

  const rawSummary = sanitizeAiResponse(parsed_json.summary ?? '');
  const rawEcho = sanitizeAiResponse(parsed_json.echo ?? '');
  const validatedQuote = validateVerbatimQuote(sanitizedContent, parsed_json.quotableSentence);

  return {
    summary: isUsable(rawSummary) ? rawSummary : undefined,
    tone: sanitizeAiResponse(parsed_json.tone ?? 'нейтральный'),
    frequentWords: (parsed_json.frequentWords ?? []).map(s => sanitizeAiResponse(s)).filter(isUsable),
    authorPhrases: (parsed_json.authorPhrases ?? []).map(s => sanitizeAiResponse(s)).filter(isUsable),
    insights: (parsed_json.insights ?? []).map(s => sanitizeAiResponse(s)).filter(isUsable),
    quotableSentence: validatedQuote ? sanitizeAiResponse(validatedQuote) : undefined,
    themes: (parsed_json.themes ?? []).map(s => sanitizeAiResponse(s)).filter(isUsable),
    extractedFacts: (parsed_json.extractedFacts ?? []).map(s => sanitizeAiResponse(s)).filter(isUsable),
    mentionedPeople: (parsed_json.mentionedPeople ?? []).map(p => ({
      name: sanitizeAiResponse(p.name ?? ''),
      role: sanitizeAiResponse(p.role ?? ''),
    })).filter(p => p.name.length > 0 && cyrRatio(p.name) >= 0.3),
    commitments: (parsed_json.commitments ?? []).map(s => sanitizeAiResponse(s)).filter(isUsable),
    valence: typeof parsed_json.valence === 'number' ? parsed_json.valence : undefined,
    arousal: typeof parsed_json.arousal === 'number' ? parsed_json.arousal : undefined,
    echo: isUsable(rawEcho) ? rawEcho : undefined,
    eventDate: validEventDate,
    promptVersion: 2,
  };
}
