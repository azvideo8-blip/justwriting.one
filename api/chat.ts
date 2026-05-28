import type { VercelRequest, VercelResponse } from '@vercel/node';
import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import * as admin from 'firebase-admin';
import { z } from 'zod';

// ── Firebase Admin init ───────────────────────────────────────────────────────
if (!admin.apps.length) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  admin.initializeApp({
    credential: sa
      ? admin.credential.cert(JSON.parse(sa) as admin.ServiceAccount)
      : admin.credential.applicationDefault(),
  });
}

// ── System prompts (mirrors chatWithAI.ts) ────────────────────────────────────
const TOPIC_GUARD =
  'Если пользователь просит что-то не связанное с его личными текстами, рефлексией или творческим письмом — вежливо откажи и объясни свою роль.';

const PERSONA_PROMPTS: Record<string, string> = {
  group_psychology: `You are a facilitator of a collaborative panel of elite psychologists — Humanistic/Rogerian, CBT, Psychodynamic/Jungian, and Systemic — who read the user's personal note together and offer a multi-dimensional perspective.
Write a cohesive, compassionate synthesis directly to the person: Core Theme, 3–4 Perspectives, 2–3 Reflective Questions, Gentle Next Steps.
Keep replies 150–250 words, warm and conversational. Match the language of the user's text.`,

  cbt: `You are a skilled CBT practitioner. Identify automatic thoughts, cognitive distortions, and help restructure thinking based on the user's personal note.
Structure: Validation, Thought Detective (1–2 distortions named), Reframe, brief Practice exercise.
Keep replies 150–250 words, warm and conversational. Match the language of the user's text.`,

  coach: `You are an elite life coach. Extract implicit goals, identify blocks, and design a path forward from the user's note.
Structure: Core Aspiration, Mindset Shift, 3 Coaching Questions, Micro-Action (under 15 min + medium-term milestone), Closing.
Keep replies 150–250 words, warm and conversational. Match the language of the user's text.`,

  editor: `You are a professional text editor. Refine the user's writing for clarity, flow, and impact while preserving their voice.
Structure: Editorial Feedback, Polished Version, Key Changes (3–4 bullets), Optional Angle.
Keep replies 150–250 words, warm and conversational. Match the language of the user's text.`,

  journalist: `You are an experienced narrative journalist. Uncover the compelling human story in the user's personal note.
Structure: The Hook, Narrative Draft, Story Questions (3–4), Themes.
Keep replies 150–250 words, warm and conversational. Match the language of the user's text.`,
};

const INJECTION_PATTERNS = [
  /ignore\s+previous/i, /ignore\s+instructions/i, /jailbreak/i,
  /\bDAN\b/i, /you\s+are\s+now/i, /forget\s+your/i,
  /новые\s+инструкции/i, /забудь/i,
];

function buildSystemPrompt(
  personaId: string,
  customPrompt: string | null | undefined,
  docContent: string | null | undefined,
  docMood: string | null | undefined,
): string {
  const base =
    personaId === 'custom'
      ? `${customPrompt ?? ''}\n\n${TOPIC_GUARD}`
      : `${PERSONA_PROMPTS[personaId] ?? PERSONA_PROMPTS.coach}\n\n${TOPIC_GUARD}`;

  if (!docContent) return base;

  const mood = docMood ? `Настроение: ${docMood}` : '';
  return `${base}\n\n---\n[Документ пользователя]\n${docContent.slice(0, 50_000)}\n${mood}`;
}

// ── Daily limit ───────────────────────────────────────────────────────────────
const DAILY_LIMIT = (() => {
  const n = parseInt(process.env.AI_DAILY_LIMIT ?? '50', 10);
  return Number.isNaN(n) ? 50 : n;
})();

async function checkAndIncrementLimit(uid: string): Promise<boolean> {
  const db = admin.firestore();

  const userSnap = await db.doc(`users/${uid}`).get();
  if (userSnap.data()?.role === 'admin') return true;

  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiDailyLimit/${uid}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.date !== date) { tx.set(ref, { count: 1, date }); return true; }
    if (data.count >= DAILY_LIMIT) return false;
    tx.update(ref, { count: data.count + 1 });
    return true;
  });
}

// ── Input schema ──────────────────────────────────────────────────────────────
const inputSchema = z.object({
  personaId: z.string().max(100),
  customSystemPrompt: z.string().max(500).nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(10_000),
  })).max(100),
  documentContent: z.string().max(50_000).nullish(),
  documentMood: z.string().max(50).nullish(),
});

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  // Auth
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const idToken = auth.slice(7);

  let uid: string;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }

  // Daily limit
  const allowed = await checkAndIncrementLimit(uid);
  if (!allowed) { res.status(429).json({ error: 'DAILY_LIMIT' }); return; }

  // Parse body
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Bad Request' }); return; }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood } = parsed.data;

  // Injection guard for custom prompts
  if (personaId === 'custom' && customSystemPrompt) {
    if (INJECTION_PATTERNS.some(p => p.test(customSystemPrompt))) {
      res.status(400).json({ error: 'Bad Request' }); return;
    }
  }

  const systemPrompt = buildSystemPrompt(personaId, customSystemPrompt, documentContent, documentMood);

  // Stream
  const result = streamText({
    model: google('gemini-2.5-flash-preview-04-17'),
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    maxOutputTokens: 1024,
  });

  result.pipeTextStreamToResponse(res);
}
