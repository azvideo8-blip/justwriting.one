import { describe, it, expect } from 'vitest';
import { buildChatSystemPrompt, assembleChatPromptParams, chatInputSchema } from '../buildChatPrompt';

const base = { personaId: 'coach', messages: [{ role: 'user' as const, content: 'Разбери эту заметку' }] };

describe('noteScope в системном промпте', () => {
  it('строгий ход: только эта заметка, с названием и настоящей датой', () => {
    const prompt = buildChatSystemPrompt(assembleChatPromptParams({
      ...base, noteScope: { mode: 'note', title: 'Аскеза 6', date: '29 сентября 2026' },
    }));
    expect(prompt).toContain('АНАЛИЗИРУЙ ТОЛЬКО заметку «Аскеза 6» от 29 сентября 2026');
    expect(prompt).not.toContain('ДРУГИЕ заметки');
  });

  it('широкий ход: найденное — другие заметки', () => {
    const prompt = buildChatSystemPrompt(assembleChatPromptParams({
      ...base, noteScope: { mode: 'wide', title: 'Аскеза 6', date: '29 сентября 2026' },
    }));
    expect(prompt).toContain('ДРУГИЕ заметки');
    expect(prompt).not.toContain('АНАЛИЗИРУЙ ТОЛЬКО');
  });

  it('без заметки-темы — ни того ни другого', () => {
    const prompt = buildChatSystemPrompt(assembleChatPromptParams(base));
    expect(prompt).not.toContain('АНАЛИЗИРУЙ ТОЛЬКО');
    expect(prompt).not.toContain('ДРУГИЕ заметки');
  });

  it('схема API принимает поле и режет длинное', () => {
    expect(chatInputSchema.safeParse({ ...base, noteScope: { mode: 'note', title: 'T', date: '29 сентября 2026' } }).success).toBe(true);
    expect(chatInputSchema.safeParse({ ...base, noteScope: { mode: 'note', title: 'x'.repeat(301), date: 'd' } }).success).toBe(false);
  });
});
