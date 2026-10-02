import { describe, it, expect } from 'vitest';
import { toApiContent, prepareApiMessages, splitAttachedMessage, legacyNoteHidden } from '../aiChatTransport';

// S-63.2b: старый ход без шапки и без разделителя — «маркер + тело» (до
// 2026-07-15) неотличим от «маркер + вопрос»; S-51 резал хвост только длиннее
// 1500 знаков. Тело скрытой, удалённой или лежащей в корзине заметки-темы
// короче порога уходило в историю, память и закрывающую сводку целиком.

const BODY = `SECRET ${'тело скрытой заметки. '.repeat(70)}`.slice(0, 1439);
const LEGACY = `[Прикреплена заметка: "Скрытая"]\n\n${BODY}`;

type Doc = { id: string; title?: string; excludedFromAI?: boolean; trashedAt?: number };
function fakeDb(docs: Doc[], failing = false) {
  return {
    get: async (_s: string, id: string) => { if (failing) throw new Error('IDB down'); return docs.find(d => d.id === id); },
    getAll: async () => { if (failing) throw new Error('IDB down'); return docs; },
  } as unknown as Parameters<typeof legacyNoteHidden>[1];
}
const dlg = (documentId: string | undefined, content = LEGACY) => ({ documentId, messages: [{ role: 'user', content }, { role: 'assistant', content: 'ответ' }] });

describe('S-63: a short legacy body of a hidden note is stripped', () => {
  it('1439 chars: hidden note → marker only; open note → the S-51 threshold rule still applies', () => {
    expect(BODY).toHaveLength(1439);
    expect(toApiContent(LEGACY, undefined, { legacyNoteHidden: true })).toBe('[Прикреплена заметка: "Скрытая"]');
    expect(splitAttachedMessage(LEGACY, { legacyNoteHidden: true })).toEqual({ markers: '[Прикреплена заметка: "Скрытая"]', question: '' });
    expect(toApiContent(LEGACY, undefined, { legacyNoteHidden: false })).toBe(LEGACY);
  });

  it('prepareApiMessages passes the flag down to every turn', () => {
    const out = prepareApiMessages([{ role: 'user', content: LEGACY, type: 'chat' }, { role: 'assistant', content: 'ответ', type: 'chat' }], { legacyNoteHidden: true });
    expect(out.map(m => m.content).join('\n')).not.toContain('SECRET');
  });

  describe('legacyNoteHidden', () => {
    it('by dialogue.documentId: hidden, trashed or missing → true; open → false', async () => {
      expect(await legacyNoteHidden(dlg('local_h'), fakeDb([{ id: 'local_h', title: 'Скрытая', excludedFromAI: true }]))).toBe(true);
      expect(await legacyNoteHidden(dlg('local_t'), fakeDb([{ id: 'local_t', title: 'Скрытая', trashedAt: 1 }]))).toBe(true);
      expect(await legacyNoteHidden(dlg('local_gone'), fakeDb([]))).toBe(true);
      expect(await legacyNoteHidden(dlg('local_o'), fakeDb([{ id: 'local_o', title: 'Скрытая' }]))).toBe(false);
    });

    it('without a link: a note with the marker title decides; no such note → true', async () => {
      expect(await legacyNoteHidden(dlg(undefined), fakeDb([{ id: 'local_1', title: 'Скрытая' }]))).toBe(false);
      expect(await legacyNoteHidden(dlg(undefined), fakeDb([{ id: 'local_1', title: 'Скрытая', excludedFromAI: true }]))).toBe(true);
      expect(await legacyNoteHidden(dlg(undefined), fakeDb([{ id: 'local_1', title: 'Другая' }]))).toBe(true);
    });

    it('no header-less turns → nothing to check (false); a failed read → true', async () => {
      const headed = `[#local_1 · 2026-01-01]\n[Прикреплена заметка: "Скрытая"]\n${BODY}`;
      expect(await legacyNoteHidden(dlg('local_gone', headed), fakeDb([]))).toBe(false);
      expect(await legacyNoteHidden(dlg('local_1'), fakeDb([], true))).toBe(true);
    });
  });
});
