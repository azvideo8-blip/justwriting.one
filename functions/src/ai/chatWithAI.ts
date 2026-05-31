import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, checkDailyLimit, getDailyLimitCount, checkRateLimit, withinGlobalDailyLimit, GEMINI_MODEL, getGenAI, INJECTION_PATTERNS, getLangfuse } from '../shared/aiUtils';
import { PERSONA_PROMPTS, TOPIC_GUARD, PRESET_PERSONA_IDS, type PersonaId } from '../shared/prompts';

const inputSchema = z.object({
  personaId: z.enum(['group_psychology', 'cbt', 'coach', 'editor', 'journalist', 'custom']),
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
});

export const chatWithAI = onCall({
  secrets: ['GEMINI_API_KEY'],
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  if (!(await checkDailyLimit(uid))) {
    const { used, date } = await getDailyLimitCount(uid);
    throw new HttpsError('resource-exhausted', `Daily limit reached. Used ${used}/${process.env.AI_DAILY_LIMIT ?? 50} on ${date}.`);
  }

  if (!(await checkRateLimit(uid))) {
    throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
  }

  if (!(await withinGlobalDailyLimit())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    console.error('Validation failed for chatWithAI. Errors:', JSON.stringify(parsed.error.format()));
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait } = parsed.data;

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
    ? `${customSystemPrompt!}\n\n${TOPIC_GUARD}`
    : `${personaPrompt}\n\n${TOPIC_GUARD}`;

  if (userPortrait) {
    systemInstruction = `${systemInstruction}\n\n---\n[Портрет пользователя (личность, темы, контекст)]\n${userPortrait}`;
  }

  const model = getGenAI().getGenerativeModel({ model: GEMINI_MODEL, systemInstruction });

  const chatHistory: { role: 'user' | 'model'; parts: [{ text: string }] }[] = [];
  const allMessages = [...messages];

  if (documentContent) {
    const safeMood = documentMood ? sanitizeAiInput(documentMood) : 'не указано';
    const docMessage = `[Документ пользователя]\n${sanitizeAiInput(documentContent)}\n[Настроение: ${safeMood}]`;
    allMessages.unshift({ role: 'user', content: docMessage });
    if (allMessages.length > 1 && allMessages[1].role === 'user') {
      allMessages.splice(1, 0, { role: 'assistant', content: 'Документ получен. Готов обсудить.' });
    }
  }

  const lastMessage = allMessages[allMessages.length - 1];
  const historyMessages = allMessages.slice(0, -1);

  for (const m of historyMessages) {
    chatHistory.push({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: sanitizeAiInput(m.content) }],
    });
  }

  const lf = getLangfuse();
  const trace = lf?.trace({ name: 'chatWithAI', userId: uid, metadata: { personaId } });
  const generation = trace?.generation({ name: 'gemini', model: GEMINI_MODEL, input: chatHistory });

  const chat = model.startChat({ history: chatHistory });
  let result;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      result = await chat.sendMessage(sanitizeAiInput(lastMessage.content), { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.error('[chatWithAI] Gemini request failed:', e);
    throw new HttpsError('internal', 'AI request failed.');
  }
  const response = result.response;
  const text = sanitizeAiResponse(response.text());

  const tokensIn = response.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = response.usageMetadata?.candidatesTokenCount ?? 0;

  generation?.end({ output: text, usage: { promptTokens: tokensIn, completionTokens: tokensOut } });
  recordUsage(uid, tokensIn, tokensOut).catch(e => console.error('[AI chat] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  return { result: text };
});
