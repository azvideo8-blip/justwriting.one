import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { hideExcludedNotes, useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';

// S-63.1 (регрессия S-51): «Вставить как заметку» прикладывает текст под id
// `pasted-<ts>` без строки в documents. isExcludedFromAI(undefined) с S-51
// читается как «скрыта» — и вставленный текст уходил в модель как
// «[заметка скрыта от ИИ]», в ходе и в истории.

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const PASTED = 'ВСТАВЛЕННЫЙ ТЕКСТ, который человек хочет обсудить.';
const DAY = new Date('2026-10-02T12:00:00').getTime();
const pasted = { documentId: 'pasted-1759392000000', title: 'Вставленный текст', lastSessionAt: DAY, content: PASTED };

describe('S-63: pasted text is not a note and is never hidden', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const rec of await db.getAll('documents')) await db.delete('documents', rec.id);
  });

  it('hideExcludedNotes keeps the pasted block although there is no documents row', async () => {
    const db = await getLocalDb();
    const out = (await hideExcludedNotes([pasted], db)).text;
    expect(out).toContain(PASTED);
    expect(out).not.toContain('[заметка скрыта от ИИ]');
  });

  it('a deleted real note next to it is still hidden', async () => {
    const db = await getLocalDb();
    const gone = { documentId: 'local_gone', title: 'Удалённая', lastSessionAt: DAY, content: 'ТЕЛО УДАЛЁННОЙ' };
    const out = (await hideExcludedNotes([pasted, gone], db)).text;
    expect(out).toContain(PASTED);
    expect(out).not.toContain('ТЕЛО УДАЛЁННОЙ');
  });

  it('paste → send: the attached block handed to the model contains the pasted text', async () => {
    const { result } = renderHook(() => useAIChatContext('editor'));
    const ctx = await result.current.buildContext({
      text: 'Что скажешь об этом?',
      // Как собирает useAIPageData: вставленный текст — блок с id `pasted-…`.
      attached: { blocks: [pasted] },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });
    expect(ctx.searchContext).toContain(PASTED);
    expect(ctx.searchContext).not.toContain('[заметка скрыта от ИИ]');
  });
});
