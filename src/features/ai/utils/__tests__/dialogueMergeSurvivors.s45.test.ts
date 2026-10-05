import { describe, it, expect } from 'vitest';
import { mergeDialogues, withMessageIds } from '../../../../core/storage/dialogueMerge';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';

// S-45 (S-29): правила слияния, у которых не было теста, краснеющего при их
// откате: фильтр отметок об удалении в хвосте, правило общего префикса,
// позиция в id старой реплики.

const NOW = 1_700_000_000_000;

function dialogue(messages: DialogueMessage[], extra: Partial<AIDialogue> = {}): AIDialogue {
  return {
    id: 'd', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1000, updatedAt: 2000, messages, ...extra,
  };
}

function m(role: 'user' | 'assistant', id: string, content: string, createdAt: number, extra: Partial<DialogueMessage> = {}): DialogueMessage {
  return { role, id, content, createdAt, ...extra };
}

const P = [m('user', 'u0', 'Общий вопрос', 10), m('assistant', 'a0', 'Общий ответ', 11, { turnId: 'u0' })];
const ids = (d: AIDialogue) => d.messages.map(x => x.id);

describe('S-45: merge rules that survived a revert', () => {
  it('tail tombstone filter: an answer deleted on A after B got it does not return from B\'s longer tail', () => {
    const a = dialogue([...P, m('user', 'ua', 'Вопрос A', 20)], { deletedMessages: [{ id: 'aa', at: NOW - 1000 }], updatedAt: 3000 });
    const b = dialogue([...P, m('user', 'ua', 'Вопрос A', 20), m('assistant', 'aa', 'Ответ A', 21, { turnId: 'ua' }), m('user', 'ub', 'Вопрос B', 30), m('assistant', 'ab', 'Ответ B', 31, { turnId: 'ub' })]);

    expect(ids(mergeDialogues(a, b, NOW)), 'удалённый ответ вернулся из хвоста').toEqual(['u0', 'a0', 'ua', 'ub', 'ab']);
    expect(ids(mergeDialogues(b, a, NOW))).toEqual(['u0', 'a0', 'ua', 'ub', 'ab']);
  });

  it('common prefix keeps its order even when createdAt in it is out of order', () => {
    const shared = [
      m('user', 'u1', 'Вопрос один', 100), m('assistant', 'a1', 'Ответ один', 101, { turnId: 'u1' }),
      m('user', 'u2', 'Вопрос два', 50), m('assistant', 'a2', 'Ответ два', 51, { turnId: 'u2' }),
    ];
    const a = dialogue(shared, { updatedAt: 3000 });
    const b = dialogue(shared.map(x => ({ ...x })));

    expect(ids(mergeDialogues(a, b, NOW)), 'общий префикс пересортирован по часам').toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('legacy id includes the position: two identical legacy messages stay two messages', () => {
    const x = dialogue([
      { role: 'user', content: 'да' }, { role: 'assistant', content: 'ок' },
      { role: 'user', content: 'да' }, { role: 'assistant', content: 'ок' },
    ]);

    expect(new Set(ids(withMessageIds(x))).size).toBe(4);
    expect(mergeDialogues(x, x, NOW).messages, 'одинаковые реплики схлопнулись в одну').toHaveLength(4);
  });
});
