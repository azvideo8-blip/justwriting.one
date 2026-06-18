import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, checkDailyLimit, checkRateLimit, withinGlobalDailyLimit, INJECTION_PATTERNS, getLangfuse } from '../shared/aiUtils';
import { generate, getActiveModel } from '../shared/aiProvider';
import { PERSONA_PROMPTS, TOPIC_GUARD, NOTES_GUARD, PRESET_PERSONA_IDS, type PersonaId } from '../shared/prompts';

const inputSchema = z.object({
  personaId: z.enum(['group_psychology', 'cbt', 'coach', 'editor', 'custom']),
  customSystemPrompt: z.string().max(500).nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(10_000),
  })).max(100).refine(msgs => {
    const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
    return totalChars <= 200_000;
  }, 'Total messages content exceeds 200K characters'),
  documentContent: z.string().max(50_000).nullish(),
  documentMood: z.string().max(50).nullish(),
  userPortrait: z.string().max(100_000).nullish(),
  responseLength: z.enum(['short', 'standard', 'detailed']).nullish(),
});

export const chatWithAI = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  if (!(await withinGlobalDailyLimit())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  if (!(await checkDailyLimit(uid))) {
    throw new HttpsError('resource-exhausted', 'Daily limit reached.');
  }

  if (!(await checkRateLimit(uid))) {
    throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    console.error('Validation failed for chatWithAI. Errors:', JSON.stringify(parsed.error.format()));
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait, responseLength } = parsed.data;

  if (personaId === 'custom') {
    if (!customSystemPrompt) {
      throw new HttpsError('invalid-argument', 'customSystemPrompt is required when personaId is "custom".');
    }
    if (INJECTION_PATTERNS.some(p => p.test(customSystemPrompt))) {
      throw new HttpsError('invalid-argument', 'Custom prompt failed security check.');
    }
  }

  const personaPrompt = personaId !== 'custom' ? PERSONA_PROMPTS[personaId as PersonaId] : '';
  let systemInstruction = personaId === 'custom'
    ? `${TOPIC_GUARD}\n\n${customSystemPrompt!}\n\n${NOTES_GUARD}`
    : `${personaPrompt}\n\n${TOPIC_GUARD}\n\n${NOTES_GUARD}`;

  if (responseLength === 'short') {
    systemInstruction += '\n\nВАЖНО: Верни очень краткий, лаконичный ответ. Уложись в 1-2 абзаца, пиши только самое главное без долгих вступлений.';
  } else if (responseLength === 'detailed') {
    systemInstruction += '\n\nВАЖНО: Верни подробный, развёрнутый ответ с глубоким анализом, детальными объяснениями и выводами.';
  }

  if (userPortrait) {
    systemInstruction = `${systemInstruction}\n\n---\n[Портрет пользователя (личность, темы, контекст)]\n${userPortrait}`;
  }

  const allMessages = [...messages];

  if (documentContent) {
    const safeMood = documentMood ? sanitizeAiInput(documentMood) : 'не указано';
    const docMessage = `[Документ пользователя]\n${sanitizeAiInput(documentContent)}\n[Настроение: ${safeMood}]`;
    allMessages.unshift({ role: 'user', content: docMessage });
    if (allMessages.length > 1 && allMessages[1].role === 'user') {
      allMessages.splice(1, 0, { role: 'assistant', content: 'Документ получен. Готов обсудить.' });
    }
  }

  const providerMessages = allMessages.map(m => ({
    role: m.role,
    content: sanitizeAiInput(m.content),
  }));

  const lf = getLangfuse();
  const activeModel = await getActiveModel();
  const trace = lf?.trace({ name: 'chatWithAI', userId: uid, metadata: { personaId } });
  const generation = trace?.generation({ name: activeModel, model: activeModel, input: providerMessages });

  let gen;
  try {
    gen = await generate({ system: systemInstruction, messages: providerMessages, maxTokens: 8192, abortMs: 110_000 });
  } catch (e) {
    console.error('[chatWithAI] AI request failed:', e);
    generation?.end({ output: String(e), level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(() => {});
    throw new HttpsError('internal', 'AI request failed.');
  }

  const text = sanitizeAiResponse(gen.text);

  generation?.end({ output: text, usage: { promptTokens: gen.tokensIn, completionTokens: gen.tokensOut } });
  recordUsage(uid, gen.tokensIn, gen.tokensOut, { model: gen.model, fn: 'chat' }).catch(e => console.error('[AI chat] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  return { result: text };
});
