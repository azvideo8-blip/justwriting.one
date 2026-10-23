import { describe, it, expect } from 'vitest';
import { threadPreview } from '../AIChatPresentational';

// Н-5 (дейлик 2026-10-23): служебная строка (`type: 'system'`, например об обрезке
// заметки) стала превью диалога в списке вместо последней реплики.
// Мутация: вернуть `messages[messages.length - 1]` → красный.
describe('Н-5: превью диалога', () => {
  it('служебная строка последней — превью по последней реплике', () => {
    const d = { messages: [
      { role: 'user', content: 'кратко', type: 'chat' },
      { role: 'assistant', content: 'Ответ о заметке', type: 'chat' },
      { role: 'assistant', content: 'Модели ушло около 49 000 из 60 148 знаков', type: 'system' },
    ] };
    expect(threadPreview(d)).toBe('Ответ о заметке');
  });

  it('только служебные строки — пустое превью', () => {
    expect(threadPreview({ messages: [{ content: 'служебная', type: 'system' }] })).toBe('');
  });
});
