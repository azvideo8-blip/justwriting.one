import { describe, it, expect } from 'vitest';
import { getChatMessageKey } from '../AIChatMessages';
import type { ChatMessage } from '../useCitationMeta';

describe('getChatMessageKey (AU-6)', () => {
  it('returns msg.id when present', () => {
    const msg: ChatMessage = {
      id: 'msg-uuid-123',
      role: 'user',
      content: 'hello',
    };
    expect(getChatMessageKey(msg, 0)).toBe('msg-uuid-123');
    expect(getChatMessageKey(msg, 5)).toBe('msg-uuid-123');
  });

  it('generates a stable key for an object reference even if index changes', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'Thinking about your note...',
    };

    const keyAtIdx0 = getChatMessageKey(msg, 0);
    const keyAtIdx1 = getChatMessageKey(msg, 1);
    const keyAtIdx5 = getChatMessageKey(msg, 5);

    expect(keyAtIdx0).toBe(keyAtIdx1);
    expect(keyAtIdx0).toBe(keyAtIdx5);
  });

  it('generates different keys for different message objects', () => {
    const msg1: ChatMessage = { role: 'user', content: 'hello' };
    const msg2: ChatMessage = { role: 'assistant', content: 'world' };

    expect(getChatMessageKey(msg1, 0)).not.toBe(getChatMessageKey(msg2, 1));
  });
});
