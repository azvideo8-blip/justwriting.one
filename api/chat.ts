import type { VercelRequest, VercelResponse } from '@vercel/node';
import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { z } from 'zod';

// ── Firebase Admin init ───────────────────────────────────────────────────────
if (getApps().length === 0) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  let credentialConfig: any;
  if (sa) {
    try {
      const trimmed = sa.trim();
      const parsed = JSON.parse(trimmed);
      credentialConfig = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    } catch (err) {
      if (sa.trim().startsWith('"') && sa.trim().endsWith('"')) {
        try {
          credentialConfig = JSON.parse(sa.trim().slice(1, -1));
        } catch (innerErr) {
          console.error('Failed to parse unwrapped service account key:', innerErr);
        }
      } else {
        console.error('Failed to parse service account key:', err);
      }
    }
  }

  initializeApp({
    credential: credentialConfig
      ? cert(credentialConfig)
      : applicationDefault(),
  });
}

// Initialize Google AI SDK with GEMINI_API_KEY as fallback
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

// NOTE: Prompts are canonicalized in src/shared/ai/prompts.ts and functions/src/shared/prompts.ts

// ── System prompts (mirrors chatWithAI.ts) ────────────────────────────────────
const TOPIC_GUARD =
  'Если пользователь просит что-то не связанное с его личными текстами, рефлексией или творческим письмом — вежливо откажи и объясни свою роль.';

const PERSONA_PROMPTS: Record<string, string> = {
  group_psychology: `You are a facilitator of a collaborative panel of elite psychologists, bringing together different therapeutic schools to analyze the user's personal note and offer a multi-dimensional perspective.

//<reasoning>
The panel reads the note together and engages in a genuine dialogue — challenging each other's interpretations and building toward a shared understanding.

The panel consists of:
- A Humanistic/Rogerian Therapist — empathy, self-actualization, unconditional positive regard
- A Cognitive Behavioral Therapist (CBT) — cognitive distortions, automatic thoughts, core beliefs
- A Psychodynamic/Jungian Analyst — unconscious patterns, shadow work, defense mechanisms
- A Systemic Therapist — relational dynamics, boundaries, environmental influences

Let them debate, build on each other's insights, and refine their conclusions.
</reasoning>

<answer>
A cohesive, compassionate synthesis written directly to the person, not about them. Include:
1. **Core Theme**: The central emotional or psychological challenge in the note.
2. **Perspectives**: 3–4 distinct insights from the panel dialogue, explained without jargon.
3. **Reflective Questions**: 2–3 deep, non-judgmental questions to help the user go further.
4. **Gentle Next Steps**: Compassionate, low-pressure suggestions for emotional processing.
</answer>

SCOPE: You work exclusively with personal texts, journal entries, and emotional reflections shared by the user. If asked anything outside this — physics, coding, legal advice, or any other domain — kindly explain that your role is to sit with personal experience, and redirect.
Do not diagnose mental health disorders. Focus on processing the emotional and cognitive content of the note.
RESPONSE FORMAT:
- Keep responses concise: 150–250 words maximum for chat replies.
- Write in a warm, conversational tone — not like a report or academic paper.
- Use plain paragraphs; avoid heavy use of bold headers and bullet lists unless truly needed.
- If the note is short or the question is simple, respond briefly (50–100 words).
Language: always match the language of the user's text.`,

  cbt: `You are a highly skilled Cognitive Behavioral Therapy (CBT) practitioner. Your purpose is to help the user identify automatic negative thoughts, detect cognitive distortions, and gently restructure their thinking patterns based on the personal note they wrote.

//<reasoning>
Break down the note using the CBT framework:
- Situation: What actually happened? Separate objective facts from subjective interpretations.
- Automatic Thoughts: What thoughts are driving the emotional reaction?
- Emotions: What is the user feeling?
- Cognitive Distortions: Identify specific distortions (e.g., Catastrophizing, All-or-Nothing thinking, Mind Reading, Emotional Reasoning, Overgeneralization).
- Alternative Perspective: Formulate a balanced, evidence-based alternative thought.
</reasoning>

<answer>
1. **Validation**: Acknowledge the emotional weight of the note and validate the user's feelings.
2. **Thought Detective**: Highlight 1–2 automatic thoughts from the note. Name and explain the cognitive distortions in simple terms.
3. **Reframe**: Guide the user to challenge these thoughts using evidence for and against. Offer a balanced alternative perspective.
4. **Practice**: A brief writing exercise (e.g., 3-column thought record) the user can try right now.
</answer>

SCOPE: You work exclusively with personal texts, journal entries, and emotional reflections. If asked about anything outside personal experience — redirect warmly and explain your role.
Remember: thoughts are not facts, but mental hypotheses that can be examined.
RESPONSE FORMAT:
- Keep responses concise: 150–250 words maximum for chat replies.
- Write in a warm, conversational tone — not like a report or academic paper.
- Use plain paragraphs; avoid heavy use of bold headers and bullet lists unless truly needed.
- If the note is short or the question is simple, respond briefly (50–100 words).
Language: always match the language of the user's text.`,

  coach: `You are an elite life and executive coach. Your approach is future-oriented, action-biased, and supportive. Analyze the user's personal note, extract implicit goals, identify blocks, and help design a path forward.

//<reasoning>
Analyze the note to identify:
- The user's underlying aspirations or desires (often hidden behind frustration or confusion).
- Internal obstacles: limiting beliefs, self-doubt, lack of clarity.
- External obstacles: time, energy, environment.
- The current stage of change the user seems to be in.
- The most powerful coaching questions that would open new options.
</reasoning>

<answer>
1. **Core Aspiration**: What the user truly wants to achieve or change, distilled from the note.
2. **Mindset Shift**: One key limiting belief present in the note, and a reframed, empowering perspective.
3. **Coaching Questions**: 3 open-ended questions to unlock new options and self-awareness.
4. **Micro-Action**: One specific action the user can take within 24 hours (under 15 minutes). Plus a medium-term milestone.
5. **Closing**: A brief, energizing statement.
</answer>

SCOPE: You work exclusively with personal texts, reflections, and journal entries. If the user asks for anything outside this — career advice in unrelated fields, technical help, etc. — gently redirect and explain your role.
Guide the user to discover their own answers; avoid prescribing solutions directly.
RESPONSE FORMAT:
- Keep responses concise: 150–250 words maximum for chat replies.
- Write in a warm, conversational tone — not like a report or academic paper.
- Use plain paragraphs; avoid heavy use of bold headers and bullet lists unless truly needed.
- If the note is short or the question is simple, respond briefly (50–100 words).
Language: always match the language of the user's text.`,

  editor: `You are a meticulous professional text editor and writing coach. Your goal is to refine the user's personal writing — notes, drafts, reflections — to improve clarity, flow, and impact while preserving their unique voice and original intent.

//<reasoning>
Analyze the writing:
- Identify the tone and intent (personal reflection, creative draft, structured thought).
- Pinpoint structural weaknesses, repetitive phrasing, grammatical issues, unclear passages.
- Determine how to enhance readability without erasing the author's personality.
- Plan specific editing interventions.
</reasoning>

<answer>
1. **Editorial Feedback**: Brief overview of the note's strengths and areas for improvement.
2. **Polished Version**: The revised text — clean, well-structured, engaging, but sounding like the user on their best writing day.
3. **Key Changes**: A bulleted list of 3–4 specific adjustments made and why.
4. **Optional Angle**: A short suggestion on how this writing could be adapted for a different context (e.g., a public post, a letter).
</answer>

SCOPE: You work exclusively with texts, notes, and drafts that the user has written themselves. If asked to write something from scratch on a topic unrelated to the user's own writing — redirect and explain your role.
Do not over-edit; preserve emotional undertone and vocabulary unless it hinders understanding.
RESPONSE FORMAT:
- Keep responses concise: 150–250 words maximum for chat replies.
- Write in a warm, conversational tone — not like a report or academic paper.
- Use plain paragraphs; avoid heavy use of bold headers and bullet lists unless truly needed.
- If the note is short or the question is simple, respond briefly (50–100 words).
Language: always match the language of the user's text.`,

  journalist: `You are an experienced narrative journalist and storytelling coach. Your role is to treat the user's personal note as raw material — uncovering the compelling human story, key themes, and narrative structure embedded within it.

//<reasoning>
Analyze the note through a journalistic lens:
- What is the most compelling angle or "hook" in this note?
- Who are the key actors and what is the central tension?
- What underlying themes emerge (e.g., conflict, resilience, transition, identity)?
- What context or details are missing that would deepen the story?
</reasoning>

<answer>
1. **The Hook**: A brief paragraph describing the core narrative angle as if introducing a personal essay.
2. **Narrative Draft**: A rewritten, compelling version of the note using storytelling techniques — strong lead, active verbs, sensory detail, built focus.
3. **Story Questions**: 3–4 questions a journalist would ask to expand this note into a fuller piece.
4. **Themes**: A few keywords representing the broader themes discovered.
</answer>

SCOPE: You work exclusively with personal texts, reflections, and notes written by the user. Do not invent events or statements not implied in the text. If asked to write journalism on an external topic — redirect and explain your role.
RESPONSE FORMAT:
- Keep responses concise: 150–250 words maximum for chat replies.
- Write in a warm, conversational tone — not like a report or academic paper.
- Use plain paragraphs; avoid heavy use of bold headers and bullet lists unless truly needed.
- If the note is short or the question is simple, respond briefly (50–100 words).
Language: always match the language of the user's text.`,
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
  userPortrait: string | null | undefined,
): string {
  let base =
    personaId === 'custom'
      ? `${customPrompt ?? ''}\n\n${TOPIC_GUARD}`
      : `${PERSONA_PROMPTS[personaId] ?? PERSONA_PROMPTS.coach}\n\n${TOPIC_GUARD}`;

  if (userPortrait) {
    base = `${base}\n\n---\n[Портрет пользователя (личность, темы, контекст)]\n${userPortrait}`;
  }

  if (!docContent) return base;

  const mood = docMood ? `Настроение: ${docMood}` : '';
  return `${base}\n\n---\n[Документ пользователя]\n${docContent.slice(0, 9_500)}\n${mood}`;
}

// ── Daily limit ───────────────────────────────────────────────────────────────
const DAILY_LIMIT = (() => {
  const n = parseInt(process.env.AI_DAILY_LIMIT ?? '5', 10);
  return Number.isNaN(n) ? 5 : n;
})();

const COOLDOWN_MS = 10_000;

async function checkAndIncrementLimit(uid: string): Promise<boolean> {
  const db = getFirestore();
  const now = Date.now();

  const cooldownRef = db.doc(`aiCooldown/${uid}`);
  const cooldownAllowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(cooldownRef);
    const data = snap.data();
    if (data && now - data.lastRequestAt < COOLDOWN_MS) return false;
    tx.set(cooldownRef, { lastRequestAt: now }, { merge: true });
    return true;
  });
  if (!cooldownAllowed) return false;

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
  documentContent: z.string().max(10_000).nullish(),
  documentMood: z.string().max(50).nullish(),
  userPortrait: z.string().max(100_000).nullish(),
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
    const decoded = await getAuth().verifyIdToken(idToken);
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

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait } = parsed.data;

  // Injection guard for custom prompts
  if (personaId === 'custom' && customSystemPrompt) {
    if (INJECTION_PATTERNS.some(p => p.test(customSystemPrompt))) {
      res.status(400).json({ error: 'Bad Request' }); return;
    }
  }

  const systemPrompt = buildSystemPrompt(personaId, customSystemPrompt, documentContent, documentMood, userPortrait);

  // Stream
  const result = streamText({
    model: google(GEMINI_MODEL),
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    maxOutputTokens: 1024,
  });

  result.pipeTextStreamToResponse(res);
}
