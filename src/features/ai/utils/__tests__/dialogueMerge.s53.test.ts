import { describe, it, expect } from 'vitest';
import { mergeDialogues, DIALOGUE_SCHEMA } from '../../../../core/storage/dialogueMerge';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';

// S-53 (S-37): старый клиент хранит id у прежних реплик и дописывает новую без
// id. Если её текст повторяет прежнюю («да»), подбор по роли и тексту отдавал
// ей id прежней, и дедупликация по id съедала новый ход.

const NOW = 1_700_000_000_000;

function dialogue(messages: DialogueMessage[], extra: Partial<AIDialogue> = {}): AIDialogue {
  return {
    id: 'd', title: 'Т', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    createdAt: 1000, updatedAt: 2000, messages, ...extra,
  };
}

function m(role: 'user' | 'assistant', id: string | undefined, content: string, createdAt?: number, extra: Partial<DialogueMessage> = {}): DialogueMessage {
  return { role, ...(id ? { id } : {}), content, ...(createdAt !== undefined ? { createdAt } : {}), ...extra };
}

const texts = (d: AIDialogue) => d.messages.map(x => x.content);

const OURS = dialogue([
  m('user', 'u1', 'Привет', 10), m('assistant', 'a1', 'Здравствуйте', 11, { turnId: 'u1' }),
  m('user', 'u2', 'да', 20), m('assistant', 'a2', 'Хорошо', 21, { turnId: 'u2' }),
], { schema: DIALOGUE_SCHEMA });

describe('S-53: an old client\'s repeated turn is not lost', () => {
  it('a new id-less «да / Хорошо» after an identical id\'d pair gives 6 messages, in both argument orders', () => {
    const theirs = dialogue([...OURS.messages, m('user', undefined, 'да'), m('assistant', undefined, 'Хорошо')], { updatedAt: 3000 });

    const fromUpload = mergeDialogues(OURS, theirs, NOW);
    expect(texts(fromUpload), `повтор съеден: ${JSON.stringify(texts(fromUpload))}`)
      .toEqual(['Привет', 'Здравствуйте', 'да', 'Хорошо', 'да', 'Хорошо']);
    const fromRestore = mergeDialogues(theirs, OURS, NOW);
    expect(texts(fromRestore)).toEqual(texts(fromUpload));
    expect(new Set(fromUpload.messages.map(x => x.id)).size).toBe(6);
  });

  it('an id-less copy of an existing message still adopts that message\'s id and createdAt (no duplicate)', () => {
    const theirs = dialogue([m('user', undefined, 'Привет'), m('assistant', undefined, 'Здравствуйте'), m('user', undefined, 'да'), m('assistant', undefined, 'Хорошо')], { updatedAt: 3000 });

    const merged = mergeDialogues(OURS, theirs, NOW);
    expect(texts(merged)).toEqual(['Привет', 'Здравствуйте', 'да', 'Хорошо']);
    expect(merged.messages.map(x => x.createdAt)).toEqual([10, 11, 20, 21]);
  });

  it('tombstone dates for the same id merge by max', () => {
    const a = dialogue([OURS.messages[0]!], { deletedMessages: [{ id: 'a1', at: NOW - 5000 }] });
    const b = dialogue([OURS.messages[0]!], { deletedMessages: [{ id: 'a1', at: NOW - 1000 }], updatedAt: 1500 });
    expect(mergeDialogues(a, b, NOW).deletedMessages).toEqual([{ id: 'a1', at: NOW - 1000 }]);
    expect(mergeDialogues(b, a, NOW).deletedMessages).toEqual([{ id: 'a1', at: NOW - 1000 }]);
  });
});
