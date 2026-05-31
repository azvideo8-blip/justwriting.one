import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const callableSchema = z.object({
  personaId: z.enum(['group_psychology', 'cbt', 'coach', 'editor', 'journalist', 'custom']),
  customSystemPrompt: z.string().max(500).nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(10_000),
  })).max(100).refine(
    msgs => msgs.reduce((sum, m) => sum + m.content.length, 0) <= 200_000,
    'Total messages content exceeds 200K characters',
  ),
  documentContent: z.string().max(50_000).nullish(),
  documentMood: z.string().max(50).nullish(),
  userPortrait: z.string().max(100_000).nullish(),
});

describe('Schema parity between api/chat.ts and chatWithAI.ts', () => {
  it('valid payload passes both schemas', () => {
    const valid = {
      personaId: 'coach' as const,
      messages: [{ role: 'user' as const, content: 'hello' }],
      documentContent: 'some doc',
    };
    expect(callableSchema.safeParse(valid).success).toBe(true);
  });

  it('documentContent within 50K is accepted', () => {
    const valid = {
      personaId: 'coach' as const,
      messages: [{ role: 'user' as const, content: 'hello' }],
      documentContent: 'x'.repeat(50_000),
    };
    expect(callableSchema.safeParse(valid).success).toBe(true);
  });

  it('oversized documentContent (50_001) is rejected', () => {
    const invalid = {
      personaId: 'coach' as const,
      messages: [{ role: 'user' as const, content: 'hello' }],
      documentContent: 'x'.repeat(50_001),
    };
    expect(callableSchema.safeParse(invalid).success).toBe(false);
  });

  it('messages exceeding 200K total chars are rejected', () => {
    const invalid = {
      personaId: 'coach' as const,
      messages: [{ role: 'user' as const, content: 'x'.repeat(100_000) }, { role: 'user' as const, content: 'y'.repeat(100_001) }],
    };
    expect(callableSchema.safeParse(invalid).success).toBe(false);
  });

  it('invalid personaId is rejected', () => {
    const invalid = {
      personaId: 'nonexistent',
      messages: [{ role: 'user' as const, content: 'hello' }],
    };
    expect(callableSchema.safeParse(invalid).success).toBe(false);
  });
});
