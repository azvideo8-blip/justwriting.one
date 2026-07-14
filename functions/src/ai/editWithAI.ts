import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, checkAndIncrementLimit, refundDailyLimit, tryReserveGlobalRequest, refundGlobalRequest, getLangfuse, hasInjectionAttempt, MAX_AI_CONTENT_LENGTH } from '../shared/aiUtils';
import { generate, getActiveModel } from '../shared/aiProvider';

const actionSchema = z.enum(['shorten', 'accents', 'ideas', 'summarize', 'tags', 'mood', 'continue']);

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(10_000),
});

const inputSchema = z.object({
  content: z.string().min(1).max(MAX_AI_CONTENT_LENGTH),
  action: actionSchema,
  history: z.array(messageSchema).max(10).nullish(),
});

const ACTION_PROMPTS: Record<string, string> = {
  shorten: 'Сократи текст, сохранив суть и стиль автора. Без пояснений — только результат.',
  accents: 'Выдели 3–5 ключевых мыслей из текста. Верни маркированный список.',
  ideas: 'Предложи 5 идей для развития темы. Кратко, одна строка каждая.',
  summarize: 'Краткое резюме в 2–3 предложениях.',
  tags: 'Верни JSON-массив из 3–7 тегов-ключевых слов, строчными, без `#`. Только JSON, без пояснений.',
  mood: 'Одним словом определи тональность текста (нейтральный / задумчивый / тревожный / вдохновляющий / радостный / грустный).',
  continue: 'Продолжи текст в том же стиле, ещё 2–3 абзаца.',
};

function buildPrompt(action: string, content: string): string {
  const task = ACTION_PROMPTS[action] ?? 'Обработай текст согласно действию.';
  return `${task}\n\nЯзык ответа должен совпадать с языком входного текста.\n\n${content}`;
}

async function callModel(
  content: string,
  action: string,
  history?: { role: 'user' | 'assistant'; content: string }[]
): Promise<{ text: string; tokensIn: number; tokensOut: number; model: string }> {
  const messages = (history ?? []).map(m => ({
    role: m.role,
    content: sanitizeAiInput(m.content),
  }));
  messages.push({ role: 'user', content: buildPrompt(action, content) });

  try {
    return await generate({ messages, maxTokens: 4096, abortMs: 110_000 });
  } catch (e) {
    console.error('[editWithAI] AI request failed:', e);
    throw new HttpsError('internal', 'AI request failed.');
  }
}

export const editWithAI = onCall({
  secrets: ['OPENROUTER_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { content, action, history } = parsed.data;

  if (hasInjectionAttempt(content)) {
    throw new HttpsError('invalid-argument', 'Content contains disallowed patterns.');
  }

  const sanitizedInput = sanitizeAiInput(content);

  if (history) {
    for (const m of history) {
      if (hasInjectionAttempt(m.content)) {
        throw new HttpsError('invalid-argument', 'History contains disallowed patterns.');
      }
    }
  }

  const limitResult = await checkAndIncrementLimit(uid);
  if (limitResult === 'DAILY_LIMIT') {
    throw new HttpsError('resource-exhausted', 'Daily limit reached.');
  }
  if (limitResult === 'RATE_LIMIT') {
    throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
  }

  const reservation = await tryReserveGlobalRequest(4096);
  if (!reservation) {
    await refundDailyLimit(uid);
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const lf = getLangfuse();
  const activeModel = await getActiveModel();
  const trace = lf?.trace({ name: 'editWithAI', userId: uid, metadata: { action } });
  const generation = trace?.generation({ name: activeModel, model: activeModel, input: sanitizedInput });

  let result;
  try {
    result = await callModel(sanitizedInput, action, history ?? undefined);
  } catch (e) {
    await refundDailyLimit(uid);
    await refundGlobalRequest(reservation);
    throw e;
  }
  const sanitizedOutput = sanitizeAiResponse(result.text);

  generation?.end({ output: sanitizedOutput, usage: { promptTokens: result.tokensIn, completionTokens: result.tokensOut } });
  recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'edit' }, reservation).catch(e => console.error('[AI] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  return { result: sanitizedOutput };
});
