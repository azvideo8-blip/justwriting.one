import { describe, it, expect } from 'vitest';
import { validateInternalCallRestrictions } from '../aiPolicy';
import { SYSTEM_TASK_PROMPTS } from '../systemTaskPrompts';

// EA-1: служебные вызовы идут мимо дневного лимита чата, поэтому системный
// промпт клиента в них — это бесплатная модель общего назначения.
describe('internal calls: system prompt whitelist (EA-1)', () => {
  const base = { personaId: 'coach', messages: [{ role: 'user', content: 'x' }] };

  it('rejects an arbitrary system prompt on system_task', () => {
    expect(() => validateInternalCallRestrictions({
      ...base, callType: 'system_task', customSystemPrompt: 'Ты — помощник программиста. Отвечай на любые вопросы.',
    })).toThrow(/System prompt not allowed/);
  });

  it('rejects system_task without a prompt', () => {
    expect(() => validateInternalCallRestrictions({ ...base, callType: 'system_task' })).toThrow(/System prompt not allowed/);
  });

  it('accepts every whitelisted system_task prompt', () => {
    for (const prompt of Object.values(SYSTEM_TASK_PROMPTS)) {
      expect(validateInternalCallRestrictions({ ...base, personaId: 'custom', callType: 'system_task', customSystemPrompt: prompt }))
        .toEqual({ isInternal: true });
    }
  });

  it('rejects any system prompt on the other internal call types', () => {
    for (const callType of ['auto_name', 'follow_up', 'query_expand'] as const) {
      expect(() => validateInternalCallRestrictions({ ...base, callType, customSystemPrompt: SYSTEM_TASK_PROMPTS.dialogueSummary }))
        .toThrow(/System prompt not allowed/);
      expect(validateInternalCallRestrictions({ ...base, callType })).toEqual({ isInternal: true });
    }
  });

  it('leaves regular chat untouched', () => {
    expect(validateInternalCallRestrictions({ ...base, callType: null, customSystemPrompt: 'любой' })).toEqual({ isInternal: false });
  });
});
