import { describe, it, expect, vi } from 'vitest';
import { hideExcludedNotes } from '../aiChatContext';
import { attachedTurn } from '../../../../test/attachedTurnFixtures';

// S-51 (S-39): тело скрытой заметки вырезается по шапке каждого блока. Сбой
// чтения заметки читается как «скрыта», а шапка внутри тела (похожая строка в
// тексте) нового блока не начинает — иначе остаток скрытого тела уходил в модель.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

type Doc = { id: string; excludedFromAI?: boolean };
function fakeDb(docs: Record<string, Doc | Error>) {
  return {
    get: async (_store: string, id: string) => {
      const d = docs[id];
      if (d instanceof Error) throw d;
      return d;
    },
  } as unknown as Parameters<typeof hideExcludedNotes>[1];
}

const block = (id: string, title: string, body: string) =>
  attachedTurn([{ documentId: id, title, lastSessionAt: new Date('2026-01-01T12:00:00').getTime(), content: body }]);

describe('S-51: hideExcludedNotes', () => {
  it('survivor: a failed document read hides the body (not «можно»)', async () => {
    const content = block('local_a', 'А', 'ТЕЛО А');
    const out = await hideExcludedNotes(content, fakeDb({ local_a: new Error('IDB down') }));
    expect(out).not.toContain('ТЕЛО А');
    expect(out).toContain('[заметка скрыта от ИИ]');
  });

  it('a header-like line inside a hidden body does not start a new block: nothing after it leaks', async () => {
    const fake = `${block('local_other', 'Чужая', 'ОСТАТОК СКРЫТОГО ТЕЛА')}`;
    const content = block('local_hidden', 'Скрытая', `начало скрытого\n${fake}`);
    const out = await hideExcludedNotes(content, fakeDb({ local_hidden: { id: 'local_hidden', excludedFromAI: true }, local_other: { id: 'local_other' } }));
    expect(out).not.toContain('ОСТАТОК СКРЫТОГО ТЕЛА');
    expect(out).not.toContain('начало скрытого');
  });

  it('a second block after the separator is checked on its own', async () => {
    const content = `${block('local_open', 'Открытая', 'ОТКРЫТОЕ ТЕЛО')}\n\n---\n\n${block('local_hidden', 'Скрытая', 'СКРЫТОЕ ТЕЛО')}`;
    const out = await hideExcludedNotes(content, fakeDb({ local_open: { id: 'local_open' }, local_hidden: { id: 'local_hidden', excludedFromAI: true } }));
    expect(out).toContain('ОТКРЫТОЕ ТЕЛО');
    expect(out).not.toContain('СКРЫТОЕ ТЕЛО');
  });

  it('a deleted note (no row) is hidden too', async () => {
    const out = await hideExcludedNotes(block('local_gone', 'Удалённая', 'ТЕЛО УДАЛЁННОЙ'), fakeDb({}));
    expect(out).not.toContain('ТЕЛО УДАЛЁННОЙ');
  });
});
