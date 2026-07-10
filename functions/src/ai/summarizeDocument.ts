import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, tryReserveGlobalRequest, refundGlobalRequest, hasInjectionAttempt, getLangfuse } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

// Repairs a JSON string that was truncated mid-output (reasoning models can
// still run past the token budget). Closes a dangling string and any open
// arrays/objects so JSON.parse succeeds with the fields produced so far.
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
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

const SUMMARY_SYSTEM_PROMPT = `Проанализируй личную заметку и верни JSON. Отвечай СТРОГО на русском языке.

Поля:
- summary: 1–2 предложения от третьего лица о чём эта запись и какова её главная суть («Автор размышляет о...»).
- tone: одно слово из списка: нейтральный / задумчивый / тревожный / вдохновляющий / радостный / грустный / злой / усталый / ностальгический / противоречивый / благодарный / растерянный.
- frequentWords: 3–6 самых значимых слов из текста (существительные или глаголы, не стоп-слова, не «я», «это», «что»).
- insights: ключевые мысли или внутренние наблюдения, которые звучат в тексте — только то, что реально написано.
- themes: 1–3 основные темы.
- extractedFacts: конкретные факты ПРОШЕДШЕГО или НАСТОЯЩЕГО времени, которые буквально написаны в тексте. НЕ включай планы, намерения, мечты, гипотезы или события будущего времени. Если факт неточный или косвенный — не включай. Лучше меньше, но достоверно.
- mentionedPeople: объекты { name, role } для реальных людей, упомянутых по имени. role — отношение к автору (жена/муж/партнёр/дочь/сын/мать/отец/брат/сестра/друг/коллега/терапевт/итд). Не выдумывай роли. Если роль неизвестна — "неизвестно". Если людей нет — [].
- commitments: список планов, обещаний или намерений автора на будущее от первого лица (например, «позвонить маме», «начать бегать с понедельника»). Массив строк. Если планов/намерений в тексте нет — [].
- valence: оценка эмоционального тона заметки, число от -1 (очень негативный) до 1 (очень позитивный).
- arousal: оценка физиологического/эмоционального возбуждения/энергии, число от 0 (очень спокойный/апатичный) до 1 (крайне активный/взволнованный).
- echo: одна фраза на русском языке, лаконично связывающая данную заметку с недавними темами из контекста recentContext (если предоставлен). Если связь неочевидна или recentContext пуст, верни пустую строку.

ВАЖНО: опирайся ТОЛЬКО на написанное. Не додумывай, не реконструируй, не добавляй деталей которых нет в тексте.
Верни ТОЛЬКО валидный JSON без пояснений и markdown-обёртки.`;

// deepseek-v4-flash: reliable for structured JSON, no reasoning leakage into content
// (reasoning emitted in separate field on OpenRouter, not in content).
// Override via AI_SUMMARY_MODEL; falls back to AI_FACET_MODEL for compat.
const SUMMARY_MODEL = process.env.AI_SUMMARY_MODEL ?? 'deepseek/deepseek-v4-flash';

const inputSchema = z.object({
  content: z.string().min(50).max(50_000),
  mood: z.string().max(50).nullish(),
  recentContext: z.string().max(5000).optional(),
});

export const summarizeDocument = onCall({
  secrets: ['OPENROUTER_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  // UXFIX-3: summarizeDocument is background analysis, not chat.
  // Removed checkDailyLimit/checkRateLimit — only tryReserveGlobalRequest guards.

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { content, mood, recentContext } = parsed.data;

  if (hasInjectionAttempt(content)) {
    throw new HttpsError('invalid-argument', 'Disallowed patterns in content.');
  }

  const sanitizedContent = sanitizeAiInput(content);

  // Scale item counts to text length to avoid over-extraction on short notes.
  const wordCount = sanitizedContent.split(/\s+/).filter(Boolean).length;
  const insightCount = wordCount < 100 ? '1–2' : wordCount < 300 ? '2–3' : '3–4';
  const factCount = wordCount < 100 ? '0–1' : wordCount < 300 ? '1–2' : '1–4';
  const scaledPrompt = SUMMARY_SYSTEM_PROMPT
    .replace('insights: ключевые мысли', `insights: ${insightCount} ключевые мысли`)
    .replace('extractedFacts: конкретные факты', `extractedFacts: ${factCount} конкретных факта`);

  const safeMood = mood ? sanitizeAiInput(mood) : null;
  let prompt = safeMood
    ? `[Настроение документа: ${safeMood}]\n\n${sanitizedContent}`
    : sanitizedContent;

  if (recentContext) {
    prompt = `[recentContext (недавние темы):\n${recentContext}]\n\n${prompt}`;
  }

  if (!(await tryReserveGlobalRequest())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const lf = getLangfuse();
  const activeModel = SUMMARY_MODEL;
  const trace = lf?.trace({ name: 'summarizeDocument', userId: uid });
  const generation = trace?.generation({ name: activeModel, model: activeModel, input: prompt });

  let text: string;
  let tokensIn = 0;
  let tokensOut = 0;
  let usedModel = activeModel;
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
    await refundGlobalRequest();
    generation?.end({ output: String(e), level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(() => {});
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new HttpsError('internal', 'AI summarization failed.');
  }

  let parsed_json: {
    summary?: string;
    tone: string;
    frequentWords: string[];
    insights: string[];
    themes: string[];
    extractedFacts: string[];
    mentionedPeople?: { name: string; role: string }[];
    commitments?: string[];
    valence?: number;
    arousal?: number;
    echo?: string;
  };
  try {
    let textToParse = text.trim();
    if (textToParse.startsWith('```')) {
      textToParse = textToParse.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    }
    try {
      parsed_json = JSON.parse(textToParse);
    } catch {
      // Salvage a truncated response (reasoning model overran the budget) so a
      // long note still yields a usable summary instead of a 500.
      parsed_json = JSON.parse(repairTruncatedJson(textToParse));
      console.warn('[AI summarize] recovered truncated JSON output');
    }
  } catch {
    console.error('[AI summarize] failed to parse model output:', text.slice(0, 500));
    generation?.end({ output: text, level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));
    throw new HttpsError('internal', 'Failed to parse summary.');
  }

  generation?.end({ output: text, usage: { promptTokens: tokensIn, completionTokens: tokensOut } });
  recordUsage(uid, tokensIn, tokensOut, { model: usedModel, fn: 'summarize' }).catch(e => console.error('[AI summarize] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  // Drop strings where Cyrillic chars are less than 20% of length — catches
  // reasoning leakage (English/Chinese fragments, garbled words) in array fields.
  const cyrRatio = (s: string) => {
    const cyr = (s.match(/[а-яёА-ЯЁ]/g) ?? []).length;
    return s.length > 0 ? cyr / s.length : 0;
  };
  const isUsable = (s: string) => s.trim().length > 0 && cyrRatio(s) >= 0.2;

  const rawSummary = sanitizeAiResponse(parsed_json.summary ?? '');
  const rawEcho = sanitizeAiResponse(parsed_json.echo ?? '');
  return {
    summary: isUsable(rawSummary) ? rawSummary : undefined,
    tone: sanitizeAiResponse(parsed_json.tone ?? 'нейтральный'),
    frequentWords: (parsed_json.frequentWords ?? []).map((s) => sanitizeAiResponse(s)).filter(isUsable),
    insights: (parsed_json.insights ?? []).map((s) => sanitizeAiResponse(s)).filter(isUsable),
    themes: (parsed_json.themes ?? []).map((s) => sanitizeAiResponse(s)).filter(isUsable),
    extractedFacts: (parsed_json.extractedFacts ?? []).map((s) => sanitizeAiResponse(s)).filter(isUsable),
    mentionedPeople: (parsed_json.mentionedPeople ?? []).map(p => ({
      name: sanitizeAiResponse(p.name ?? ''),
      role: sanitizeAiResponse(p.role ?? ''),
    })).filter(p => p.name.length > 0 && cyrRatio(p.name) >= 0.3),
    commitments: (parsed_json.commitments ?? []).map((s) => sanitizeAiResponse(s)).filter(isUsable),
    valence: typeof parsed_json.valence === 'number' ? parsed_json.valence : undefined,
    arousal: typeof parsed_json.arousal === 'number' ? parsed_json.arousal : undefined,
    echo: isUsable(rawEcho) ? rawEcho : undefined,
  };
});
