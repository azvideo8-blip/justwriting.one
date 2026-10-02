import { describe, it, expect } from 'vitest';
import { noteScopeFor } from '../noteMeta';
import { NOTE_SCOPE_TITLE_MAX } from '../../../../shared/ai/buildChatPrompt';

// S-56.6: noteScope.title на сервере — z.string().max(300); клиент слал название
// как есть: импортированное в 301–500 знаков или три склеенных по 100 → 400 на
// каждом строгом ходе.

describe('S-56: noteScopeFor', () => {
  it('cuts the title to the server limit and the date to 60', () => {
    const scope = noteScopeFor('note', { title: 'н'.repeat(500), date: 'д'.repeat(100) });
    expect(scope.title).toHaveLength(NOTE_SCOPE_TITLE_MAX);
    expect(NOTE_SCOPE_TITLE_MAX).toBe(300);
    expect(scope.date).toHaveLength(60);
    expect(scope.mode).toBe('note');
  });

  it('three joined titles of 100 chars fit after the cut', () => {
    const joined = [1, 2, 3].map(i => String(i).repeat(100)).join('», «');
    expect(noteScopeFor('wide', { title: joined }).title.length).toBeLessThanOrEqual(300);
  });

  it('a missing note gives the placeholder title and an empty date', () => {
    expect(noteScopeFor('note', null)).toEqual({ mode: 'note', title: 'приложенная заметка', date: '' });
  });
});
