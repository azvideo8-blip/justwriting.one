import { describe, it, expect, vi } from 'vitest';
import { hideExcludedNotes } from '../aiChatContext';

// S-51 (S-39): тело скрытой заметки не уходит. Сбой чтения заметки читается как
// «скрыта», а шапка внутри тела (похожая строка в тексте) нового блока не
// начинает — иначе остаток скрытого тела уходил в модель. DY5: блоки — список.

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
  ({ documentId: id, title, lastSessionAt: new Date('2026-01-01T12:00:00').getTime(), content: body });
const hide = async (blocks: ReturnType<typeof block>[], db: Parameters<typeof hideExcludedNotes>[1]) => (await hideExcludedNotes(blocks, db)).text;

describe('S-51: hideExcludedNotes', () => {
  it('survivor: a failed document read hides the body (not «можно»)', async () => {
    const out = await hide([block('local_a', 'А', 'ТЕЛО А')], fakeDb({ local_a: new Error('IDB down') }));
    expect(out).not.toContain('ТЕЛО А');
    expect(out).toContain('[заметка скрыта от ИИ]');
  });

  it('a header-like line inside a hidden body does not start a new block: nothing after it leaks', async () => {
    const fake = '[#local_other · 2026-01-01]\n[Прикреплена заметка: "Чужая"]\nОСТАТОК СКРЫТОГО ТЕЛА';
    const out = await hide([block('local_hidden', 'Скрытая', `начало скрытого\n\n---\n\n${fake}`)], fakeDb({ local_hidden: { id: 'local_hidden', excludedFromAI: true }, local_other: { id: 'local_other' } }));
    expect(out).not.toContain('ОСТАТОК СКРЫТОГО ТЕЛА');
    expect(out).not.toContain('начало скрытого');
  });

  it('each block is checked on its own', async () => {
    const out = await hide([block('local_open', 'Открытая', 'ОТКРЫТОЕ ТЕЛО'), block('local_hidden', 'Скрытая', 'СКРЫТОЕ ТЕЛО')], fakeDb({ local_open: { id: 'local_open' }, local_hidden: { id: 'local_hidden', excludedFromAI: true } }));
    expect(out).toContain('ОТКРЫТОЕ ТЕЛО');
    expect(out).not.toContain('СКРЫТОЕ ТЕЛО');
  });

  it('a deleted note (no row) is hidden too', async () => {
    const out = await hide([block('local_gone', 'Удалённая', 'ТЕЛО УДАЛЁННОЙ')], fakeDb({}));
    expect(out).not.toContain('ТЕЛО УДАЛЁННОЙ');
  });
});
