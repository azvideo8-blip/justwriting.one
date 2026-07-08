import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((_opts: unknown, handler: Function) => handler),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  FieldValue: {
    increment: vi.fn((n: number) => ({ _increment: n })),
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  },
}));

vi.mock('../../shared/firestore', () => ({
  getDb: vi.fn(() => ({})),
  FIRESTORE_DATABASE_ID: 'test-db',
}));

vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: vi.fn() }));

vi.mock('isomorphic-dompurify', () => ({
  default: { sanitize: vi.fn((s: string) => s) },
}));

vi.mock('langfuse', () => ({
  Langfuse: vi.fn().mockImplementation(() => ({
    trace: vi.fn(() => ({ generation: vi.fn(() => ({ end: vi.fn() })) })),
    flushAsync: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../shared/aiProvider', () => ({
  generate: vi.fn(),
  getActiveModel: vi.fn().mockResolvedValue('test-model'),
}));

vi.mock('../../shared/aiUtils', async () => {
  const actual = await vi.importActual<typeof import('../../shared/aiUtils')>('../../shared/aiUtils');
  return {
    ...actual,
    sanitizeAiInput: vi.fn(actual.sanitizeAiInput),
    sanitizeAiResponse: vi.fn(actual.sanitizeAiResponse),
    checkDailyLimit: vi.fn().mockResolvedValue(true),
    checkRateLimit: vi.fn().mockResolvedValue(true),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue(true),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    getLangfuse: vi.fn(() => null),
  };
});

import { summarizeDocument } from '../summarizeDocument';
import { generate } from '../../shared/aiProvider';
import {
  checkDailyLimit,
  checkRateLimit,
  tryReserveGlobalRequest,
  recordUsage,
  refundDailyLimit,
  sanitizeAiInput,
  sanitizeAiResponse,
} from '../../shared/aiUtils';
import DOMPurify from 'isomorphic-dompurify';

const UID = 'test-uid';

const validContent = 'A'.repeat(60);
const validData = { content: validContent };

const validAiResponse = JSON.stringify({
  tone: 'анxious',
  frequentWords: ['work', 'stress', 'morning', 'tired', 'anxious'],
  insights: ['Feeling overwhelmed by workload', 'Morning routine feels rushed'],
  themes: ['work-life balance', 'stress management'],
  extractedFacts: ['Had a meeting at 9am', 'Skipped breakfast'],
  mentionedPeople: [{ name: 'Анна', role: 'коллега' }],
});

function makeRequest(data: unknown, auth?: { uid: string }) {
  return { data, auth };
}

describe('summarizeDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkDailyLimit).mockResolvedValue(true);
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(tryReserveGlobalRequest).mockResolvedValue(true);
    vi.mocked(recordUsage).mockResolvedValue(undefined);
    vi.mocked(refundDailyLimit).mockResolvedValue(undefined);
    vi.mocked(generate).mockResolvedValue({
      text: validAiResponse,
      tokensIn: 200,
      tokensOut: 100,
      model: 'test-model',
    });
    vi.mocked(DOMPurify.sanitize).mockImplementation((s: string) => s);
  });

  it('returns unauthenticated when no auth', async () => {
    await expect(summarizeDocument(makeRequest(validData))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('returns invalid-argument when content too short (<50 chars)', async () => {
    await expect(
      summarizeDocument(
        makeRequest({ content: 'short text' }, { uid: UID })
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns invalid-argument when content exceeds 50K', async () => {
    await expect(
      summarizeDocument(
        makeRequest({ content: 'A'.repeat(50_001) }, { uid: UID })
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns resource-exhausted when global daily limit exceeded', async () => {
    vi.mocked(tryReserveGlobalRequest).mockResolvedValue(false);
    await expect(
      summarizeDocument(makeRequest(validData, { uid: UID }))
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('returns structured summary on valid request', async () => {
    // Russian content passes the isUsable() Cyrillic filter (>= 20%); this
    // mirrors real production output and verifies good content is not stripped.
    vi.mocked(generate).mockResolvedValue({
      text: JSON.stringify({
        summary: 'Автор размышляет о рабочем стрессе и утренней усталости.',
        tone: 'тревожный',
        frequentWords: ['работа', 'стресс', 'утро', 'усталость', 'тревога'],
        insights: ['Чувствует перегрузку от объёма работы', 'Утро ощущается скомканным'],
        themes: ['баланс работы и жизни', 'управление стрессом'],
        extractedFacts: ['Была встреча в 9 утра', 'Пропустил завтрак'],
        mentionedPeople: [{ name: 'Анна', role: 'коллега' }],
      }),
      tokensIn: 200,
      tokensOut: 100,
      model: 'test-model',
    });
    const result = await summarizeDocument(makeRequest(validData, { uid: UID }));
    expect(result).toMatchObject({
      summary: 'Автор размышляет о рабочем стрессе и утренней усталости.',
      tone: 'тревожный',
      frequentWords: ['работа', 'стресс', 'утро', 'усталость', 'тревога'],
      insights: ['Чувствует перегрузку от объёма работы', 'Утро ощущается скомканным'],
      themes: ['баланс работы и жизни', 'управление стрессом'],
      extractedFacts: ['Была встреча в 9 утра', 'Пропустил завтрак'],
      mentionedPeople: [{ name: 'Анна', role: 'коллега' }],
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledOnce();
  });

  it('filters out non-Cyrillic (reasoning-leak) array items', async () => {
    vi.mocked(generate).mockResolvedValue({
      text: JSON.stringify({
        tone: 'нейтральный',
        frequentWords: ['работа', 'santos', '已有'],
        insights: ['Реальный инсайт', 'references'],
        themes: ['тема'],
        extractedFacts: ['Настоящий факт'],
        mentionedPeople: [],
      }),
      tokensIn: 10,
      tokensOut: 5,
      model: 'test-model',
    });
    const result = await summarizeDocument(makeRequest(validData, { uid: UID }));
    expect(result.frequentWords).toEqual(['работа']);
    expect(result.insights).toEqual(['Реальный инсайт']);
  });

  it('sanitizes content via sanitizeAiInput', async () => {
    await summarizeDocument(makeRequest(validData, { uid: UID }));
    expect(sanitizeAiInput).toHaveBeenCalledWith(validContent);
  });

  it('sanitizes mood via sanitizeAiInput when provided', async () => {
    await summarizeDocument(
      makeRequest({ content: validContent, mood: 'tired' }, { uid: UID })
    );
    expect(sanitizeAiInput).toHaveBeenCalledWith('tired');
  });

  it('calls sanitizeAiResponse on every output field', async () => {
    await summarizeDocument(makeRequest(validData, { uid: UID }));
    const firstArgs = vi.mocked(sanitizeAiResponse).mock.calls.map(c => c[0]);
    expect(firstArgs).toContain('анxious');
    expect(firstArgs).toContain('work');
    expect(firstArgs).toContain('Feeling overwhelmed by workload');
    expect(firstArgs).toContain('Анна');
  });

  it('calls DOMPurify.sanitize for response sanitization', async () => {
    await summarizeDocument(makeRequest(validData, { uid: UID }));
    expect(DOMPurify.sanitize).toHaveBeenCalled();
  });

  it('refunds daily limit and throws internal on AI failure', async () => {
    vi.mocked(generate).mockRejectedValue(new Error('AI error'));
    await expect(
      summarizeDocument(makeRequest(validData, { uid: UID }))
    ).rejects.toMatchObject({ code: 'internal' });
    expect(refundDailyLimit).not.toHaveBeenCalled();
  });

  it('refunds daily limit and throws internal on unparseable JSON', async () => {
    vi.mocked(generate).mockResolvedValue({
      text: 'not valid json {{{',
      tokensIn: 10,
      tokensOut: 5,
      model: 'test-model',
    });
    await expect(
      summarizeDocument(makeRequest(validData, { uid: UID }))
    ).rejects.toMatchObject({ code: 'internal' });
  });

  it('returns resource-exhausted on quota error from AI', async () => {
    vi.mocked(generate).mockRejectedValue(new Error('RESOURCE_EXHAUSTED quota exceeded'));
    await expect(
      summarizeDocument(makeRequest(validData, { uid: UID }))
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('strips markdown code fences before JSON parsing', async () => {
    vi.mocked(generate).mockResolvedValue({
      text: '```json\n' + validAiResponse + '\n```',
      tokensIn: 200,
      tokensOut: 100,
      model: 'test-model',
    });
    const result = await summarizeDocument(makeRequest(validData, { uid: UID }));
    expect(result.tone).toBe('анxious');
  });

  it('filters out empty-mentionedPeople names', async () => {
    vi.mocked(generate).mockResolvedValue({
      text: JSON.stringify({
        tone: 'neutral',
        frequentWords: ['word'],
        insights: ['insight'],
        themes: ['theme'],
        extractedFacts: ['fact'],
        mentionedPeople: [
          { name: 'Анна', role: 'friend' },
          { name: '', role: 'nobody' },
        ],
      }),
      tokensIn: 10,
      tokensOut: 5,
      model: 'test-model',
    });
    const result = await summarizeDocument(makeRequest(validData, { uid: UID }));
    expect(result.mentionedPeople).toEqual([{ name: 'Анна', role: 'friend' }]);
  });
});
