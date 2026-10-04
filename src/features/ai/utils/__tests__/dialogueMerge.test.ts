import { describe, it, expect } from 'vitest';
import { mergeDialogues, withMessageIds } from '../../../../core/storage/dialogueMerge';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';

// S-29: слияние двух реплик диалога вместо last-writer-wins.

function msg(over: Partial<DialogueMessage> & { id: string; content: string }): DialogueMessage {
  return { role: over.role ?? 'user', createdAt: 1000, ...over };
}

function dialogue(over: Partial<AIDialogue> & { id: string }): AIDialogue {
  return {
    title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1000, updatedAt: 2000, messages: [], ...over,
  };
}

const base = [
  msg({ id: 'u1', content: 'Вопрос один', role: 'user', createdAt: 10 }),
  msg({ id: 'a1', content: 'Ответ один', role: 'assistant', createdAt: 11 }),
];

describe('S-29: mergeDialogues', () => {
  it('оба устройства дописали ход после общего префикса — сохранены оба, по createdAt', () => {
    const a = dialogue({ id: 'd', messages: [...base, msg({ id: 'u2a', content: 'Вопрос из A', createdAt: 20 }), msg({ id: 'a2a', content: 'Ответ из A', role: 'assistant', createdAt: 21 })], updatedAt: 30 });
    const b = dialogue({ id: 'd', messages: [...base, msg({ id: 'u2b', content: 'Вопрос из B', createdAt: 22 }), msg({ id: 'a2b', content: 'Ответ из B', role: 'assistant', createdAt: 23 })], updatedAt: 31 });

    const merged = mergeDialogues(a, b);

    expect(merged.messages.map(m => m.content)).toEqual([
      'Вопрос один', 'Ответ один', 'Вопрос из A', 'Ответ из A', 'Вопрос из B', 'Ответ из B',
    ]);
    expect(merged.messages).toHaveLength(6);
  });

  it('ход, удалённый на одном устройстве, не возвращается с другого', () => {
    const a = dialogue({ id: 'd', messages: base, deletedMessages: [{ id: 'a1', at: Date.now() }], updatedAt: 30 });
    const b = dialogue({ id: 'd', messages: base, updatedAt: 31 });

    const merged = mergeDialogues(a, b);

    expect(merged.messages.map(m => m.id)).toEqual(['u1']);
    expect(merged.deletedMessages?.map(t => t.id)).toContain('a1');
  });

  it('перегенерация на A и новый ход на B — и варианты, и ход целы', () => {
    const regeneratedAssistant = msg({
      id: 'a1', content: 'Ответ иначе', role: 'assistant', createdAt: 11,
      variants: ['Ответ один', 'Ответ иначе'], variantIndex: 1,
    });
    const a = dialogue({ id: 'd', messages: [base[0]!, regeneratedAssistant], updatedAt: 30 });
    const b = dialogue({ id: 'd', messages: [...base, msg({ id: 'u2', content: 'Продолжим', createdAt: 20 })], updatedAt: 31 });

    const merged = mergeDialogues(a, b);

    const assistant = merged.messages.find(m => m.id === 'a1');
    expect(assistant?.variants).toEqual(['Ответ один', 'Ответ иначе']);
    expect(merged.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2']);
  });

  it('старый диалог без id сливается сам с собой без дублей (идемпотентно)', () => {
    const legacy = dialogue({
      id: 'd',
      messages: [
        { role: 'user', content: 'Вопрос один' },
        { role: 'assistant', content: 'Ответ один' },
      ] as DialogueMessage[],
    });

    const once = mergeDialogues(legacy, legacy);
    const twice = mergeDialogues(once, once);

    expect(once.messages).toHaveLength(2);
    expect(withMessageIds(legacy).messages.map(m => m.id)).toEqual(once.messages.map(m => m.id));
    expect(twice.messages).toEqual(once.messages);
  });

  it('расхождение часов переставляет хвост, но не теряет ход', () => {
    // B считает, что его реплика created позже, хотя запись A свежее по updatedAt.
    const a = dialogue({ id: 'd', messages: [...base, msg({ id: 'xa', content: 'Из A', createdAt: 9000 })], updatedAt: 10 });
    const b = dialogue({ id: 'd', messages: [...base, msg({ id: 'xb', content: 'Из B', createdAt: 5000 })], updatedAt: 9999 });

    const merged = mergeDialogues(a, b);

    expect(new Set(merged.messages.map(m => m.id))).toEqual(new Set(['u1', 'a1', 'xa', 'xb']));
    expect(merged.messages.slice(2).map(m => m.id)).toEqual(['xb', 'xa']);
    // скаляры — LWW: заголовок берётся с более свежей по updatedAt записи
    expect(mergeDialogues(dialogue({ id: 'd', title: 'Старый', updatedAt: 1 }), dialogue({ id: 'd', title: 'Новый', updatedAt: 2 })).title).toBe('Новый');
  });
});
