import { describe, it, expect } from 'vitest';
import { prepareApiMessages, API_ASSISTANT_OLD_CAP } from '../aiChatTransport';
import type { AIMessage } from '../../services/AIService';

describe('PROMPT-2: prepareApiMessages', () => {
  it('preserves user messages up to API_MSG_CAP', () => {
    const longUserText = 'u'.repeat(3000);
    const msgs: AIMessage[] = [
      { role: 'user', content: longUserText, type: 'chat' },
    ];
    const result = prepareApiMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe(longUserText);
  });

  it('keeps the last two assistant messages full (up to API_MSG_CAP), caps older assistant messages to 1500', () => {
    const longText = 'a'.repeat(4000);
    const msgs: AIMessage[] = [
      { role: 'user', content: 'Вопрос 1', type: 'chat' },
      { role: 'assistant', content: longText, type: 'chat' }, // assistant #1 (older than last 2) -> capped to 1500
      { role: 'user', content: 'Вопрос 2', type: 'chat' },
      { role: 'assistant', content: longText, type: 'chat' }, // assistant #2 (older than last 2) -> capped to 1500
      { role: 'user', content: 'Вопрос 3', type: 'chat' },
      { role: 'assistant', content: longText, type: 'chat' }, // assistant #3 (second to last) -> full (4000)
      { role: 'user', content: 'Вопрос 4', type: 'chat' },
      { role: 'assistant', content: longText, type: 'chat' }, // assistant #4 (last) -> full (4000)
      { role: 'user', content: 'Вопрос 5', type: 'chat' },
    ];

    const result = prepareApiMessages(msgs);
    expect(result).toHaveLength(9);

    // Assistant #1
    expect(result[1]!.content.length).toBe(API_ASSISTANT_OLD_CAP);
    // Assistant #2
    expect(result[3]!.content.length).toBe(API_ASSISTANT_OLD_CAP);
    // Assistant #3 (one of the last 2)
    expect(result[5]!.content.length).toBe(4000);
    // Assistant #4 (one of the last 2)
    expect(result[7]!.content.length).toBe(4000);
  });

  it('does not cap assistant messages when there are 2 or fewer assistant messages', () => {
    const longText = 'a'.repeat(3000);
    const msgs: AIMessage[] = [
      { role: 'user', content: 'Вопрос 1', type: 'chat' },
      { role: 'assistant', content: longText, type: 'chat' },
      { role: 'user', content: 'Вопрос 2', type: 'chat' },
      { role: 'assistant', content: longText, type: 'chat' },
    ];

    const result = prepareApiMessages(msgs);
    expect(result[1]!.content.length).toBe(3000);
    expect(result[3]!.content.length).toBe(3000);
  });
});
