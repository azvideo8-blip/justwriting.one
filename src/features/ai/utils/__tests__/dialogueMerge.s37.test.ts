import { describe, it, expect } from 'vitest';
import { mergeDialogues, withMessageIds, DIALOGUE_SCHEMA, TOMBSTONE_TTL_MS } from '../../../../core/storage/dialogueMerge';
import type { AIDialogue, DialogueMessage } from '../../../../core/storage/localDb';

// S-37: смешанные версии и рост записи. Запись старого клиента (без маркера
// схемы, с репликами без id) не плодит дублей и не трактуется как удаление;
// слияние идемпотентно после первого прохода; отметки об удалении старше
// 90 дней снимаются.

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

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
const count = (d: AIDialogue, t: string) => texts(d).filter(x => x === t).length;

describe('S-37: records from an old client (no schema marker)', () => {
  it('a middle message spliced out by the old client is not treated as deleted and the rest is not duplicated', () => {
    const legacy = [
      m('user', undefined, 'q1'), m('assistant', undefined, 'a1'),
      m('user', undefined, 'q2'), m('assistant', undefined, 'a2'),
      m('user', undefined, 'q3'), m('assistant', undefined, 'a3'),
    ];
    const ours = { ...withMessageIds(dialogue(legacy)), schema: DIALOGUE_SCHEMA, updatedAt: 2000 };
    // Старый клиент вырезал q2/a2 позиционно и дописал ход без id.
    const theirs = dialogue([
      legacy[0]!, legacy[1]!, legacy[4]!, legacy[5]!,
      m('user', undefined, 'q4'), m('assistant', undefined, 'a4'),
    ], { updatedAt: 3000 });

    const merged = mergeDialogues(ours, theirs, NOW);

    for (const t of ['q1', 'a1', 'q2', 'a2', 'q3', 'a3', 'q4', 'a4']) {
      expect(count(merged, t), `«${t}» встречается ${count(merged, t)} раз: ${JSON.stringify(texts(merged))}`).toBe(1);
    }
    expect(merged.schema).toBe(2);
  });

  it('a regenerate on the old client (splice + append without ids) gives one question with both answers', () => {
    const ours = dialogue([m('user', 'Q', 'q', 5000), m('assistant', 'A', 'ans1', 5001, { turnId: 'Q' })], { schema: DIALOGUE_SCHEMA });
    const theirs = dialogue([m('user', undefined, 'q'), m('assistant', undefined, 'ans2')], { updatedAt: 3000 });

    const merged = mergeDialogues(ours, theirs, NOW);

    expect(count(merged, 'q'), `вопрос продублирован: ${JSON.stringify(texts(merged))}`).toBe(1);
    expect(texts(merged)).toContain('ans1');
    expect(texts(merged)).toContain('ans2');
  });
});

describe('S-37: growth', () => {
  it('merge(x, x) is idempotent after the first pass, including on a legacy record', () => {
    const x = dialogue([
      m('user', undefined, 'Вопрос'),
      m('assistant', undefined, 'v1', undefined, { variants: ['v0', 'v1'], variantIndex: 1 }),
      m('user', undefined, 'Ещё вопрос'),
      m('assistant', undefined, 'Ответ', undefined, { variants: ['старый'] }),
    ], { lastExtractedIdx: 2 });

    const once = mergeDialogues(x, x, NOW);
    const twice = mergeDialogues(once, once, NOW);

    expect(twice).toEqual(once);
    expect(mergeDialogues(twice, twice, NOW)).toEqual(once);
  });

  it('tombstones older than 90 days are dropped; younger ones still suppress the message', () => {
    const base = [m('user', 'u1', 'Вопрос', 10), m('assistant', 'a1', 'Ответ', 11, { turnId: 'u1' })];
    const other = dialogue(base, { updatedAt: 1500 });

    const old = dialogue([base[0]!], { deletedMessages: [{ id: 'a1', at: NOW - TOMBSTONE_TTL_MS - DAY }] });
    const merged = mergeDialogues(old, other, NOW);
    expect(merged.deletedMessages ?? []).toEqual([]);
    expect(texts(merged)).toEqual(['Вопрос', 'Ответ']);

    const fresh = dialogue([base[0]!], { deletedMessages: [{ id: 'a1', at: NOW - TOMBSTONE_TTL_MS + DAY }] });
    const kept = mergeDialogues(fresh, other, NOW);
    expect(kept.deletedMessages?.map(t => t.id)).toEqual(['a1']);
    expect(texts(kept), 'удалённая реплика вернулась при живой отметке').toEqual(['Вопрос']);
  });
});
